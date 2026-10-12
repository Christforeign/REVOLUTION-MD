try { require('dotenv').config(); } catch (e) {}
require('./config');
const { hookWASocket } = require('./brand');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const NodeCache = require('node-cache');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('baileys');

let EliteProHandler;
try {
    EliteProHandler = require('./ElitePro');
} catch (e) {
    console.error('[!] Erreur chargement ElitePro.js :', e.message);
}

const app = express();
const PORT = process.env.PORT || 30600;
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@#xbot#@';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeSessions = new Map();
const sessionStatuses = new Map();
const customCommands = new Map();

// Charger les plugins custom
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

// Supprimer proprement une session du disque et de la mémoire
function removeSessionData(phone) {
    if (activeSessions.has(phone)) {
        try { 
            const s = activeSessions.get(phone);
            s.ws?.close();
            s.end(); 
        } catch (e) {}
        activeSessions.delete(phone);
    }
    sessionStatuses.delete(phone);
    const sessionDir = path.join(__dirname, 'sessions', phone);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
}

async function initSession(phone) {
    // Si une session active et connectée existe déjà, on la réutilise
    if (activeSessions.has(phone)) {
        const existing = activeSessions.get(phone);
        if (existing?.ws?.readyState === 1) return existing;
        activeSessions.delete(phone);
    }

    const sessionDir = getSessionDir(phone);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
    const msgRetryCounterCache = new NodeCache();

    // Purge des résidus d'appairage non validés pour éviter les désynchronisations
    if (!state.creds.registered && state.creds.pairingCode) {
        delete state.creds.pairingCode;
        delete state.creds.me;
        await saveCreds();
    }

    let sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        msgRetryCounterCache,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
        fireInitQueries: false,
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: undefined,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock = hookWASocket(sock);

    // Enregistrement asynchrone des clés
    sock.ev.on('creds.update', async () => {
        await saveCreds();
    });

    // Gestion de cycle de vie et reconnexion automatique
    sock.ev.on('connection.update', async (update) => {
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
            console.log(`[SESSION] +${phone} déconnecté (Code status : ${statusCode || 'inconnu'})`);
            
            // Retrait obligatoire de l'ancien socket mort pour permettre la recréation
            activeSessions.delete(phone);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                removeSessionData(phone);
                console.log(`[SESSION] +${phone} déconnecté définitivement par WhatsApp.`);
            } else {
                // Reconnexion automatique (notamment après la saisie du code où WhatsApp redémarre le flux)
                sessionStatuses.set(phone, { status: 'reconnecting', registered: true });
                setTimeout(() => {
                    initSession(phone).catch(e => console.error('[RECONNECT ERROR]', e.message));
                }, 1500);
            }
        }
    });

    // Dispatch des commandes
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages, type } = chatUpdate;
            if (type !== 'notify' || !messages || !messages[0]) return;
            const m = messages[0];
            if (!m.message) return;

            const body = m.message?.conversation 
                || m.message?.extendedTextMessage?.text 
                || m.message?.imageMessage?.caption 
                || '';
            
            let config = { prefix: '.' };
            try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
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
                    return;
                }
            }

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

    return sock;
}

app.get('/christechadmin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Endpoint Pairing Code Web avec stabilisation WebSocket
app.post('/api/pairing', async (req, res) => {
    try {
        const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8) {
            return res.status(400).json({ error: 'Numéro invalide (ex: 50937081286)' });
        }

        // Si la session existait sans être validée, on purge pour repartir sur un handshake propre
        const currentStat = sessionStatuses.get(phone);
        if (currentStat && currentStat.status !== 'connected') {
            removeSessionData(phone);
        }

        const sock = await initSession(phone);

        if (!sock.authState.creds.registered) {
            // Délai de 3 secondes pour s'assurer que la socket WebSocket est complètement ouverte
            await new Promise(r => setTimeout(r, 3000));

            try {
                const code = await sock.requestPairingCode(phone);
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`[PAIRING WEB] Nouveau code généré pour +${phone} : ${formatted}`);
                return res.json({ code: formatted });
            } catch (err) {
                console.error('[PAIRING ERROR]', err);
                removeSessionData(phone);
                return res.status(500).json({ error: 'Échec Baileys. Réessayez dans quelques secondes.' });
            }
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

app.delete('/api/admin/sessions/:phone', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const phone = req.params.phone.replace(/[^0-9]/g, '');
    removeSessionData(phone);
    res.json({ success: true, message: `Session ${phone} supprimée.` });
});

// Extraction dynamique de toutes les commandes natives + custom
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

    // Scan complet d'ElitePro.js pour afficher les commandes natives
    try {
        const eliteCode = fs.readFileSync(path.join(__dirname, 'ElitePro.js'), 'utf8');
        const regex = /case\s+['"]([a-zA-Z0-9_-]+)['"]\s*:/g;
        let match;
        const found = new Set();
        while ((match = regex.exec(eliteCode)) !== null) {
            const cmd = match[1].toLowerCase();
            if (!found.has(cmd) && !customCommands.has(cmd)) {
                found.add(cmd);
                list.push({
                    name: cmd,
                    description: 'Commande native ElitePro Engine',
                    category: 'core',
                    requiredApi: null,
                    fileName: 'ElitePro.js',
                    isCustom: false
                });
            }
        }
    } catch (e) {}

    res.json({ commands: list, totalCore: list.filter(c => !c.isCustom).length, totalCustom: customCommands.size });
});

app.get('/api/admin/commands/:name', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const cmd = customCommands.get(req.params.name.toLowerCase());
    if (!cmd || !cmd.filePath) return res.status(404).json({ error: 'Commande introuvable ou commande native du core.' });

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
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
    res.json(config);
});

app.post('/api/admin/config', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    let current = {};
    try { current = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
    const updated = { ...current, ...req.body };
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(updated, null, 2));
    res.json({ success: true, updated });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✓] Revolution MD Ultimate Fusion lancé sur le port ${PORT}`);
});
