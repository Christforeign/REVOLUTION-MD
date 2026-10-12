try { require('dotenv').config(); } catch (e) {}
require('./config');
const { hookWASocket } = require('./brand');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const pino = require('pino');
const NodeCache = require('node-cache');
const { writeExifImg, writeExifVid } = require('./lib/exif');
const { smsg, getBuffer } = require('./lib/myfunc');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadContentFromMessage,
    jidDecode
} = require('baileys');

// Configuration globale injectée dans le scope Node
let botConfig = {
    botName: 'Revolution MD',
    ownerName: 'Mr Christ X',
    ownerNumber: '50937081286',
    prefix: '.',
    autoSaveContact: true,
    autoViewStatus: true,
    autoLikeStatus: true,
    autoLikeStatusEmoji: '🔥',
    autoReplyStatus: false,
    autoReplyStatusText: '🩸 Statut vu par Revolution MD (Mr Christ X) !'
};

const configPath = path.join(__dirname, 'config.json');
try {
    if (fs.existsSync(configPath)) {
        botConfig = { ...botConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
} catch (e) {}

// Initialisation globale indispensable pour ElitePro.js
global.prefix = botConfig.prefix || '.';
global.botname = botConfig.botName || 'Revolution MD';
global.ownername = botConfig.ownerName || 'Mr Christ X';
global.author = 'Mr Christ X';
global.packname = 'Revolution MD';
global.botMode = 'public';
global.autoread = false;
global.autobio = false;
global.autoTyping = false;
global.autoRecording = false;
global.autorecordtype = false;
global.autoreact = false;
global.autoviewstatus = true;
global.autolikestatus = true;
global.autolikestatusEmoji = '🔥';
global.mess = {
    owner: '👑 Cette commande est réservée au créateur (Mr Christ X).',
    admin: '⚠️ Cette commande est réservée aux administrateurs.',
    botAdmin: '⚠️ Le bot doit être administrateur du groupe.',
    group: '⚠️ Cette commande fonctionne uniquement dans un groupe.',
    private: '⚠️ Cette commande fonctionne uniquement en privé.',
    wait: '⏳ Veuillez patienter...',
    done: '✅ Exécuté avec succès !',
    error: '❌ Une erreur est survenue.'
};

let EliteProHandler = null;
try {
    EliteProHandler = require('./ElitePro');
    console.log('[✓] Moteur ElitePro.js (330+ commandes) connecté avec succès.');
} catch (e) {
    console.error('[!] Erreur chargement ElitePro.js :', e);
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

const store = {
    messages: {},
    contacts: {},
    loadMessage: async (chat, id) => store.messages[chat]?.[id] || null
};

// ==========================================
// 🚀 BOOST ANTI-VEILLE PERMANENT
// ==========================================
setInterval(() => {
    try {
        http.get(`http://127.0.0.1:${PORT}/api/ping`, () => {}).on('error', () => {});
    } catch (e) {}
}, 2 * 60 * 1000);

setInterval(async () => {
    for (const [, sock] of activeSessions.entries()) {
        try {
            if (sock?.ws?.readyState === 1) await sock.sendPresenceUpdate('available');
        } catch (e) {}
    }
}, 60 * 1000);

function loadCustomPlugins() {
    customCommands.clear();
    const dir = path.join(__dirname, 'plugins', 'custom');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.js')) {
            const fullPath = path.join(dir, f);
            delete require.cache[require.resolve(fullPath)];
            try {
                const cmd = require(fullPath);
                if (cmd && cmd.name) customCommands.set(cmd.name.toLowerCase(), { ...cmd, fileName: f, filePath: fullPath });
            } catch (err) {}
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
        try { activeSessions.get(phone).end(); } catch (e) {}
        activeSessions.delete(phone);
    }
    sessionStatuses.delete(phone);
    const sessionDir = path.join(__dirname, 'sessions', phone);
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
}

function saveContactAutomatically(senderJid, pushName) {
    try {
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;
        const contactsFile = path.join(__dirname, 'database', 'contacts.json');
        fs.mkdirSync(path.dirname(contactsFile), { recursive: true });

        let contacts = {};
        if (fs.existsSync(contactsFile)) {
            try { contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8')); } catch (e) {}
        }

        const phone = senderJid.split('@')[0];
        if (!contacts[phone]) {
            contacts[phone] = { name: pushName || `Contact ${phone}`, jid: senderJid, savedAt: new Date().toISOString() };
            fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));
        }
    } catch (e) {}
}

function getLanguageMenu(lang, userName, prefix) {
    if (lang === 'cr') {
        return `🇭🇹 *REVOLUTION MD - MENI KREYÒL* 🧟\n━━━━━━━━━━━━━━━━━━━━\n👑 *Mèt Bòt :* Mr Christ X (+50937081286)\n👤 *Itilizatè :* ${userName}\n⚡ *Prefiks :* [ ${prefix} ]\n\n📌 *KÒMAND :*\n│𖥟╾ ${prefix}menu : Tout meni an\n│𖥟╾ ${prefix}ping : Vitès bòt la\n│𖥟╾ ${prefix}play <mizik> : Telechaje MP3\n│𖥟╾ ${prefix}tiktok <lyen> : Telechaje TikTok\n│𖥟╾ ${prefix}sticker : Fè foto tounen fich\n│𖥟╾ ${prefix}ai <kesyon> : Poze AI kesyon\n│𖥟╾ ${prefix}remini : Fè foto vin klè\n│𖥟╾ ${prefix}tagall : Tag tout moun nan gwoup la\n\n> *Propulse pa Mr Christ X*`;
    }
    if (lang === 'fr') {
        return `🇫🇷 *REVOLUTION MD - MENU FRANÇAIS* 🧟\n━━━━━━━━━━━━━━━━━━━━\n👑 *Créateur :* Mr Christ X (+50937081286)\n👤 *Utilisateur :* ${userName}\n⚡ *Préfixe :* [ ${prefix} ]\n\n📌 *COMMANDES :*\n│𖥟╾ ${prefix}menu : Menu complet (330+ commandes)\n│𖥟╾ ${prefix}ping : Vitesse et Uptime\n│𖥟╾ ${prefix}play <titre> : Télécharger MP3\n│𖥟╾ ${prefix}tiktok <lien> : Télécharger TikTok sans filigrane\n│𖥟╾ ${prefix}sticker : Créer un sticker\n│𖥟╾ ${prefix}ai <texte> : Poser une question à l'IA\n│𖥟╾ ${prefix}hd : Améliorer la qualité d'une photo\n│𖥟╾ ${prefix}tagall : Mentionner tout le groupe\n\n> *Propulsé par Mr Christ X*`;
    }
    if (lang === 'en') {
        return `🇺🇸 *REVOLUTION MD - ENGLISH MENU* 🧟\n━━━━━━━━━━━━━━━━━━━━\n👑 *Owner :* Mr Christ X (+50937081286)\n👤 *User :* ${userName}\n⚡ *Prefix :* [ ${prefix} ]\n\n📌 *COMMANDS :*\n│𖥟╾ ${prefix}menu : Full command list\n│𖥟╾ ${prefix}ping : Bot response speed\n│𖥟╾ ${prefix}play <song> : Download MP3 audio\n│𖥟╾ ${prefix}tiktok <url> : Download TikTok video\n│𖥟╾ ${prefix}sticker : Convert picture to sticker\n│𖥟╾ ${prefix}ai <query> : Ask artificial intelligence\n│𖥟╾ ${prefix}hd : Enhance image quality\n│𖥟╾ ${prefix}tagall : Mention all members\n\n> *Powered by Mr Christ X*`;
    }
    if (lang === 'sp') {
        return `🇪🇸 *REVOLUTION MD - MENÚ EN ESPAÑOL* 🧟\n━━━━━━━━━━━━━━━━━━━━\n👑 *Creador :* Mr Christ X (+50937081286)\n👤 *Usuario :* ${userName}\n⚡ *Prefijo :* [ ${prefix} ]\n\n📌 *COMANDOS :*\n│𖥟╾ ${prefix}menu : Menú completo\n│𖥟╾ ${prefix}ping : Velocidad del bot\n│𖥟╾ ${prefix}play <canción> : Descargar MP3\n│𖥟╾ ${prefix}tiktok <enlace> : Descargar TikTok\n│𖥟╾ ${prefix}sticker : Crear sticker\n│𖥟╾ ${prefix}ai <pregunta> : Preguntar a la IA\n│𖥟╾ ${prefix}hd : Mejorar resolución\n│𖥟╾ ${prefix}tagall : Mencionar a todos en el grupo\n\n> *Desarrollado por Mr Christ X*`;
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
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock = hookWASocket(sock);

    sock.public = true;

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
        }
        return jid;
    };

    sock.getName = (jid) => {
        const id = sock.decodeJid(jid);
        return store.contacts[id]?.name || id.split('@')[0];
    };

    sock.sendText = (jid, text, quoted = '', options = {}) => {
        return sock.sendMessage(jid, { text, ...options }, { quoted, ...options });
    };

    sock.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(message, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    };

    sock.downloadAndSaveMediaMessage = async (message, filename) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        const trueFileName = filename || path.join(__dirname, 'database', 'temp', `${Date.now()}.${mime.split('/')[1] || 'bin'}`);
        fs.mkdirSync(path.dirname(trueFileName), { recursive: true });
        fs.writeFileSync(trueFileName, buffer);
        return trueFileName;
    };

    sock.sendImageAsSticker = async (jid, pth, quoted, options = {}) => {
        let buff = Buffer.isBuffer(pth) ? pth : /^https?:\/\//.test(pth) ? await getBuffer(pth) : fs.existsSync(pth) ? fs.readFileSync(pth) : Buffer.alloc(0);
        let buffer = (options && (options.packname || options.author)) ? await writeExifImg(buff, options) : buff;
        await sock.sendMessage(jid, { sticker: { url: buffer } }, { quoted });
        return buffer;
    };

    sock.sendVideoAsSticker = async (jid, pth, quoted, options = {}) => {
        let buff = Buffer.isBuffer(pth) ? pth : /^https?:\/\//.test(pth) ? await getBuffer(pth) : fs.existsSync(pth) ? fs.readFileSync(pth) : Buffer.alloc(0);
        let buffer = (options && (options.packname || options.author)) ? await writeExifVid(buff, options) : buff;
        await sock.sendMessage(jid, { sticker: { url: buffer } }, { quoted });
        return buffer;
    };

    sock.ev.on('creds.update', async () => await saveCreds());

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            sessionStatuses.set(phone, { status: 'connected', connectedAt: new Date().toISOString(), registered: true });
            console.log(`[SESSION] +${phone} connecté à WhatsApp !`);

            setTimeout(async () => {
                try {
                    const rawId = sock.user?.id || '';
                    const userJid = rawId ? rawId.split(':')[0] + '@s.whatsapp.net' : `${phone}@s.whatsapp.net`;
                    await sock.sendMessage(userJid, {
                        text: `🩸 *REVOLUTION MD EST OPÉRATIONNEL & BOOSTÉ !* 🧟\n\n👑 *Propriétaire :* Mr Christ X (+50937081286)\n⚡ *Statut :* En ligne 24h/24 (Anti-veille activé)\n\n📌 *Commandes rapides :*\n• *.cr* : Meni an Kreyòl Ayisyen 🇭🇹\n• *.fr* : Menu en Français 🇫🇷\n• *.en* : English Menu 🇺🇸\n• *.sp* : Menú en Español 🇪🇸\n• *.menu* : Grand Menu (330+ commandes)\n• *.ping* : Tester la réactivité du bot`
                    });
                } catch (err) {}
            }, 3000);

        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            activeSessions.delete(phone);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                removeSessionData(phone);
            } else {
                sessionStatuses.set(phone, { status: 'reconnecting', registered: true });
                setTimeout(() => { initSession(phone).catch(() => {}); }, 1500);
            }
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages } = chatUpdate;
            if (!messages || !messages[0]) return;
            const rawM = messages[0];
            if (!rawM.message) return;

            const fromJid = rawM.key?.remoteJid;

            // Statuts (Auto View / Like / Reply)
            if (fromJid === 'status@broadcast') {
                if (botConfig.autoViewStatus) await sock.readMessages([rawM.key]).catch(() => {});
                if (botConfig.autoLikeStatus && rawM.key.participant) {
                    await sock.sendMessage('status@broadcast', {
                        react: { text: botConfig.autoLikeStatusEmoji || '🔥', key: rawM.key }
                    }, { statusJidList: [rawM.key.participant] }).catch(() => {});
                }
                return;
            }

            if (fromJid && rawM.key.id) {
                if (!store.messages[fromJid]) store.messages[fromJid] = {};
                store.messages[fromJid][rawM.key.id] = rawM;
            }

            if (botConfig.autoSaveContact && fromJid && !fromJid.endsWith('@g.us') && !rawM.key.fromMe) {
                saveContactAutomatically(fromJid, rawM.pushName);
            }

            let m = rawM;
            try { m = smsg(sock, rawM, store); } catch (err) { m = rawM; }

            const body = (typeof m.text === 'string' && m.text.length > 0) ? m.text :
                (m.body ||
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                m.message?.videoMessage?.caption || '');

            const prefix = botConfig.prefix || '.';

            if (body && body.startsWith(prefix)) {
                const args = body.slice(prefix.length).trim().split(/\s+/);
                const cmdName = args.shift().toLowerCase();
                const userName = m.pushName || 'Utilisateur';

                if (['cr', 'kreyol', 'creole'].includes(cmdName)) {
                    return await sock.sendMessage(m.chat, { text: getLanguageMenu('cr', userName, prefix) }, { quoted: m });
                }
                if (['fr', 'francais', 'french'].includes(cmdName)) {
                    return await sock.sendMessage(m.chat, { text: getLanguageMenu('fr', userName, prefix) }, { quoted: m });
                }
                if (['en', 'english'].includes(cmdName)) {
                    return await sock.sendMessage(m.chat, { text: getLanguageMenu('en', userName, prefix) }, { quoted: m });
                }
                if (['sp', 'es', 'espanol', 'spanish'].includes(cmdName)) {
                    return await sock.sendMessage(m.chat, { text: getLanguageMenu('sp', userName, prefix) }, { quoted: m });
                }

                if (customCommands.has(cmdName)) {
                    const customCmd = customCommands.get(cmdName);
                    await customCmd.execute(sock, m, args, { config: botConfig, apis: botConfig.apiKeys || {} });
                    return;
                }
            }

            if (EliteProHandler) {
                await EliteProHandler(sock, m, chatUpdate, store);
            }
        } catch (err) {
            console.error('[DISPATCH ERROR] :', err.message);
        }
    });

    activeSessions.set(phone, sock);
    sessionStatuses.set(phone, { status: sock.authState.creds.registered ? 'connected' : 'waiting_auth', registered: sock.authState.creds.registered });
    return sock;
}

app.get('/api/ping', (req, res) => res.json({ status: 'alive', uptime: process.uptime() }));
app.get('/christechadmin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

app.post('/api/pairing', async (req, res) => {
    try {
        const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8) return res.status(400).json({ error: 'Numéro invalide' });

        const currentStat = sessionStatuses.get(phone);
        if (currentStat && currentStat.status !== 'connected') removeSessionData(phone);

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
    for (const [phone, data] of sessionStatuses.entries()) list.push({ phone, ...data });
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
        list.push({ name: cmd.name, description: cmd.description || 'Plugin personnalisé', category: cmd.category || 'custom', fileName: cmd.fileName, isCustom: true });
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
                list.push({ name: cmd, description: 'Commande native ElitePro', category: 'core', fileName: 'ElitePro.js', isCustom: false });
            }
        }
    } catch (e) {}
    res.json({ commands: list, totalCore: list.filter(c => !c.isCustom).length, totalCustom: customCommands.size });
});

app.listen(PORT, '0.0.0.0', () => console.log(`[✓] Revolution MD Boosted Edition lancé sur le port ${PORT}`));
