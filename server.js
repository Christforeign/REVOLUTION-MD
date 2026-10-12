try { require('dotenv').config(); } catch (e) {}
require('./config');
const { hookWASocket } = require('./brand');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const NodeCache = require('node-cache');
const { smsg } = require('./lib/myfunc');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('baileys');

let EliteProHandler = null;
try {
    EliteProHandler = require('./ElitePro');
    console.log('[✓] Moteur ElitePro.js (330+ commandes) chargé avec succès !');
} catch (e) {
    console.error('[!] Erreur fatale dans ElitePro.js :', e);
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
    if (activeSessions.has(phone)) {
        const existing = activeSessions.get(phone);
        if (existing?.ws?.readyState === 1) return existing;
        activeSessions.delete(phone);
    }

    const sessionDir = getSessionDir(phone);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));
    const msgRetryCounterCache = new NodeCache();

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
        markOnlineOnConnect: true,
        fireInitQueries: false,
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: undefined,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock = hookWASocket(sock);

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = decodeURIComponent(jid);
            return decode;
        }
        return jid;
    };

    sock.ev.on('creds.update', async () => {
        await saveCreds();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            sessionStatuses.set(phone, {
                status: 'connected',
                connectedAt: new Date().toISOString(),
                registered: true
            });
            console.log(`[SESSION] +${phone} connecté avec succès à WhatsApp !`);

            // ENVOI IMMÉDIAT DU MESSAGE DE BIENVENUE
            setTimeout(async () => {
                try {
                    const rawId = sock.user?.id || '';
                    const userJid = rawId ? rawId.split(':')[0] + '@s.whatsapp.net' : `${phone}@s.whatsapp.net`;
                    await sock.sendMessage(userJid, {
                        text: `🩸 *REVOLUTION MD EST OPÉRATIONNEL !* 🧟\n\n👑 *Créateur :* Mr Christ X (+50937081286)\n⚡ *Statut :* Session active & connectée\n\n👉 *Tapez :* .menu pour afficher la liste des commandes.\n\n_Zombie & Biohazard Multi-Device Edition_`
                    });
                    console.log(`[BIENVENUE] Message envoyé avec succès à +${phone}`);
                } catch (err) {
                    console.error('[BIENVENUE ERROR]', err.message);
                }
            }, 3000);

        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            activeSessions.delete(phone);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                removeSessionData(phone);
            } else {
                sessionStatuses.set(phone, { status: 'reconnecting', registered: true });
                setTimeout(() => {
                    initSession(phone).catch(e => console.error('[RECONNECT ERROR]', e.message));
                }, 1500);
            }
        }
    });

    // TRAITEMENT ET RÉPONSE AUX COMMANDES (.menu, etc.)
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages, type } = chatUpdate;
            if (type !== 'notify' || !messages || !messages[0]) return;
            const rawM = messages[0];
            if (!rawM.message) return;

            // Sérialisation du message via smsg pour compatibilité ElitePro
            let m = rawM;
            try {
                m = smsg(sock, rawM, null);
            } catch (err) {
                m = rawM;
            }

            const body = m.body 
                || m.message?.conversation 
                || m.message?.extendedTextMessage?.text 
                || m.message?.imageMessage?.caption 
                || '';

            let config = { prefix: '.' };
            try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
            const prefix = config.prefix || '.';

            // 1. Exécution des commandes Custom du panel admin
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

            // 2. Exécution du moteur natif ElitePro.js (330+ commandes)
            if (EliteProHandler) {
                await EliteProHandler(sock, m, chatUpdate, null);
            }
        } catch (err) {
            console.error('[COMMAND DISPATCH ERROR] :', err.message);
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

app.post('/api/pairing', async (req, res) => {
    try {
        const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8) {
            return res.status(400).json({ error: 'Numéro invalide' });
        }

        const currentStat = sessionStatuses.get(phone);
        if (currentStat && currentStat.status !== 'connected') {
            removeSessionData(phone);
        }

        const sock = await initSession(phone);

        if (!sock.authState.creds.registered) {
            await new Promise(r => setTimeout(r, 3000));
            try {
                const code = await sock.requestPairingCode(phone);
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                return res.json({ code: formatted });
            } catch (err) {
                removeSessionData(phone);
                return res.status(500).json({ error: 'Échec Baileys. Réessayez.' });
            }
        } else {
            return res.json({ error: 'Ce numéro est déjà lié et actif.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Erreur interne' });
    }
});

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

app.get('/api/admin/commands', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    const list = [];
    
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
    if (!cmd || !cmd.filePath) return res.status(404).json({ error: 'Commande introuvable' });

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
