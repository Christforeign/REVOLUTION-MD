require('./config');
const { hookWASocket } = require('./brand');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const NodeCache = require('node-cache');
const {
    default: makeWaSocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('baileys');

// Chargement du moteur de commandes d'ElitePro (332 commandes natives)
let EliteProHandler;
try {
    EliteProHandler = require('./ElitePro');
} catch (e) {
    console.error('[!] Erreur chargement ElitePro.js :', e);
}

const app = express();
const PORT = process.env.PORT || 30600;
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@#xbot#@';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stockage des sessions actives en mémoire
const activeSessions = new Map(); // phone -> sock
const sessionStatuses = new Map(); // phone -> { status, connectedAt, registered }
const customCommands = new Map(); // name -> { execute, description, category, requiredApi, fileName, filePath }

// Charger les commandes personnalisées depuis plugins/custom
function loadCustomPlugins() {
    customCommands.clear();
    const dir = path.join(__dirname, 'plugins', 'custom');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const files = fs.readdirSync(dir);
    for (const f of files) {
        if (f.endsWith('.js')) {
            const fullPath = path.join(dir, f);
            delete require.cache[require.resolve(fullPath)];
            try {
                const cmd = require(fullPath);
                if (cmd && cmd.name) {
                    customCommands.set(cmd.name.toLowerCase(), {
                        ...cmd,
                        fileName: f,
                        filePath: fullPath
                    });
                }
            } catch (err) {
                console.error(`Erreur plugin ${f}:`, err.message);
            }
        }
    }
}
loadCustomPlugins();

function getSessionDir(phone) {
    const dir = path.join(__dirname, 'sessions', phone);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Fonction d'initialisation de session sans saisie en console
async function initSession(phone) {
    if (activeSessions.has(phone)) return activeSessions.get(phone);

    const sessionDir = getSessionDir(phone);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
    const msgRetryCounterCache = new NodeCache();

    const sock = makeWaSocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        msgRetryCounterCache,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            sessionStatuses.set(phone, {
                status: 'connected',
                connectedAt: new Date().toISOString(),
                registered: true
            });
            console.log(`[SESSION] +${phone} connecté avec succès à WhatsApp !`);
        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                activeSessions.delete(phone);
                sessionStatuses.delete(phone);
                console.log(`[SESSION] +${phone} déconnecté définitivement.`);
            } else {
                sessionStatuses.set(phone, { status: 'reconnecting', registered: true });
                initSession(phone);
            }
        }
    });

    // Branchement des messages sur ElitePro + Commandes custom
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages, type } = chatUpdate;
            if (type !== 'notify' || !messages || !messages[0]) return;
            const m = messages[0];
            if (!m.message) return;

            // 1. Exécution des commandes custom du panel admin en priorité
            const body = m.message?.conversation 
                || m.message?.extendedTextMessage?.text 
                || m.message?.imageMessage?.caption 
                || '';
            
            const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
            const prefix = config.prefix || '.';

            if (body && body.startsWith(prefix)) {
                const args = body.slice(prefix.length).trim().split(/\s+/);
                const cmdName = args.shift().toLowerCase();

                if (customCommands.has(cmdName)) {
                    const customCmd = customCommands.get(cmdName);
                    await customCmd.execute(sock, m, args, {
                        config,
                        apis: config.apiKeys || {}
                    });
                    return; // Si géré par un plugin custom, on s'arrête
                }
            }

            // 2. Exécution du moteur complet ElitePro (332 commandes natives)
            if (EliteProHandler) {
                await EliteProHandler(sock, m, chatUpdate, null);
            }
        } catch (err) {
            console.error('Erreur dispatch message :', err);
        }
    });

    activeSessions.set(phone, sock);
    sessionStatuses.set(phone, {
        status: sock.authState.creds.registered ? 'connected' : 'waiting_auth',
        registered: sock.authState.creds.registered
    });

    sock = hookWASocket(sock);
    return sock;
}

// Redirection vers le panel admin
app.get('/christechadmin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Endpoint Pairing Code Web sans saisie console
app.post('/api/pairing', async (req, res) => {
    try {
        const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8) {
            return res.status(400).json({ error: 'Numéro invalide (ex: 50937081286)' });
        }

        const sock = await initSession(phone);

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phone);
                    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`[PAIRING WEB] Code pour ${phone} : ${formatted}`);
                    return res.json({ code: formatted });
                } catch (err) {
                    console.error('[PAIRING ERROR]', err);
                    return res.status(500).json({ error: 'Échec génération Baileys. Réessayez dans 10 secondes.' });
                }
            }, 6000);
        } else {
            return res.json({ error: 'Ce numéro est déjà lié et actif.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur interne' });
    }
});

// APIs Administration
app.get('/api/admin/sessions', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const list = [];
    for (const [phone, data] of sessionStatuses.entries()) {
        list.push({ phone, ...data });
    }
    res.json({ sessions: list });
});

app.get('/api/admin/commands', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const list = [];
    
    // Commandes custom
    for (const [name, cmd] of customCommands.entries()) {
        list.push({
            name: cmd.name,
            description: cmd.description || 'Plugin personnalisé',
            category: cmd.category || 'custom',
            requiredApi: cmd.requiredApi || null,
            fileName: cmd.fileName,
            isCustom: true
        });
    }

    // Commandes natives d'ElitePro
    const eliteSamples = [
        'ping', 'alive', 'tiktok', 'play', 'ytmp3', 'ytmp4', 'mediafire', 'wallpaper',
        'gpt', 'ai', 'truth', 'dare', 'lyrics', 'sticker', 'take', 'tourl', 'hd', 'remini',
        'tagall', 'hidetag', 'kick', 'promote', 'demote', 'warn', 'warnings', 'resetlink',
        'weather', 'define', 'savecontact', 'quotes', 'fact', 'topmembers'
    ];
    for (const c of eliteSamples) {
        list.push({
            name: c,
            description: 'Commande native ElitePro Engine',
            category: 'elitepro_core',
            requiredApi: null,
            fileName: 'ElitePro.js',
            isCustom: false
        });
    }

    res.json({ commands: list, totalCore: 332, totalCustom: customCommands.size });
});

app.get('/api/admin/commands/:name', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const cmd = customCommands.get(req.params.name.toLowerCase());
    if (!cmd || !cmd.filePath) return res.status(404).json({ error: 'Commande introuvable ou commande native non modifiable ici.' });

    const code = fs.readFileSync(cmd.filePath, 'utf8');
    res.json({
        name: cmd.name,
        fileName: cmd.fileName,
        description: cmd.description || '',
        category: cmd.category || 'custom',
        requiredApi: cmd.requiredApi || '',
        code
    });
});

app.post('/api/admin/commands', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const { filename, code } = req.body;
    if (!filename || !code) return res.status(400).json({ error: 'Nom et code requis' });
    if (!filename.endsWith('.js')) return res.status(400).json({ error: 'Extension .js requise' });

    const safeName = path.basename(filename);
    const dest = path.join(__dirname, 'plugins', 'custom', safeName);
    fs.mkdirSync(path.join(__dirname, 'plugins', 'custom'), { recursive: true });
    fs.writeFileSync(dest, code, 'utf8');

    loadCustomPlugins();
    res.json({ success: true, message: `Commande ${safeName} enregistrée et active !` });
});

app.delete('/api/admin/commands/:name', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const cmd = customCommands.get(req.params.name.toLowerCase());
    if (!cmd || !cmd.filePath) return res.status(404).json({ error: 'Commande introuvable' });

    if (fs.existsSync(cmd.filePath)) fs.unlinkSync(cmd.filePath);
    loadCustomPlugins();
    res.json({ success: true, message: 'Commande supprimée avec succès.' });
});

app.get('/api/admin/config', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    res.json(config);
});

app.post('/api/admin/config', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const current = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const updated = { ...current, ...req.body };
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(updated, null, 2));
    res.json({ success: true, updated });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✓] Revolution MD Ultimate Fusion lancé sur le port ${PORT}`);
    console.log(`[i] Pairing Interface Zombie : http://localhost:${PORT}`);
    console.log(`[i] Panel Administrateur : http://localhost:${PORT}/christechadmin`);
});
