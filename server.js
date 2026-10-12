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

// Chargement sécurisé du moteur principal ElitePro
let EliteProHandler = null;
try {
    EliteProHandler = require('./ElitePro');
    console.log('[✓] Moteur ElitePro.js (330+ commandes) chargé avec succès.');
} catch (e) {
    console.error('[!] Erreur dans ElitePro.js :', e);
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

// Configuration globale du bot avec options boostées
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
    autoReplyStatusText: '🩸 Statut vu par Revolution MD (Mr Christ X) !',
    antiSleep: true
};

const configPath = path.join(__dirname, 'config.json');
try {
    if (fs.existsSync(configPath)) {
        botConfig = { ...botConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } else {
        fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
    }
} catch (e) {}

// Store en mémoire pour tracer les messages supprimés (.reveal / .rv)
const store = {
    messages: {},
    contacts: {},
    loadMessage: async (chat, id) => {
        return store.messages[chat]?.[id] || null;
    }
};

// ========================================================
// 🚀 ENGINE ANTI-VEILLE / BOOST DE PERFORMANCE PERMANENT
// ========================================================
// 1. Ping HTTP local toutes les 3 minutes pour empêcher le conteneur de dormir
setInterval(() => {
    try {
        http.get(`http://127.0.0.1:${PORT}/api/ping`, (res) => {}).on('error', () => {});
    } catch (e) {}
}, 3 * 60 * 1000);

// 2. Maintien actif de la présence WhatsApp en ligne toutes les 2 minutes
setInterval(async () => {
    for (const [phone, sock] of activeSessions.entries()) {
        try {
            if (sock?.ws?.readyState === 1) {
                await sock.sendPresenceUpdate('available');
            }
        } catch (e) {}
    }
}, 2 * 60 * 1000);

// Chargement des plugins personnalisés
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

// Enregistrement automatique des contacts (AutoSave Contact)
function saveContactAutomatically(senderJid, pushName) {
    try {
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') return;
        const contactsFile = path.join(__dirname, 'database', 'contacts.json');
        if (!fs.existsSync(path.dirname(contactsFile))) fs.mkdirSync(path.dirname(contactsFile), { recursive: true });

        let contacts = {};
        if (fs.existsSync(contactsFile)) {
            try { contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8')); } catch (e) {}
        }

        const phone = senderJid.split('@')[0];
        if (!contacts[phone]) {
            contacts[phone] = {
                name: pushName || `Contact ${phone}`,
                jid: senderJid,
                savedAt: new Date().toISOString()
            };
            fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));
            console.log(`[AUTOSAVE] Contact sauvegardé : +${phone} (${pushName || 'Inconnu'})`);
        }
    } catch (e) {
        console.error('[AUTOSAVE ERROR]', e.message);
    }
}

// Menus Multilingues Complets (.cr, .fr, .en, .sp)
function getLanguageMenu(lang, userName, prefix) {
    switch (lang) {
        case 'cr':
            return `🇭🇹 *REVOLUTION MD - MENI AN KREYÒL* 🧟
━━━━━━━━━━━━━━━━━━━━
👑 *Mèt Bòt la :* Mr Christ X (+50937081286)
👤 *Itilizatè :* ${userName}
⚡ *Prefiks :* [ ${prefix} ]

📌 *KÒMAND POPILÈ :*
│𖥟╾ ${prefix}menu : Tout meni an nèt (330+ kòmand)
│𖥟╾ ${prefix}ping : Tcheke vitès bòt la
│𖥟╾ ${prefix}play <mizik> : Telechaje mizik YouTube (MP3)
│𖥟╾ ${prefix}tiktok <lyen> : Telechaje videyo TikTok san filigran
│𖥟╾ ${prefix}sticker : Fè foto oswa videyo tounen sticker
│𖥟╾ ${prefix}ai <kesyon> : Poze entèlijans atifisyèl kesyon
│𖥟╾ ${prefix}remini : Fè foto vin klè (HD)
│𖥟╾ ${prefix}vv : Ouvri foto/videyo View Once
│𖥟╾ ${prefix}tagall : Tag tout moun nan gwoup la

🌐 *LÒT LANG DISPONIB :*
• *${prefix}fr* : Menu en Français 🇫🇷
• *${prefix}en* : English Menu 🇺🇸
• *${prefix}sp* : Menú en Español 🇪🇸

> *Propulse pa Mr Christ X*`;

        case 'fr':
            return `🇫🇷 *REVOLUTION MD - MENU FRANÇAIS* 🧟
━━━━━━━━━━━━━━━━━━━━
👑 *Créateur :* Mr Christ X (+50937081286)
👤 *Utilisateur :* ${userName}
⚡ *Préfixe :* [ ${prefix} ]

📌 *COMMANDES POPULAIRES :*
│𖥟╾ ${prefix}menu : Grand Menu complet (330+ commandes)
│𖥟╾ ${prefix}ping : Vitesse de réponse et Uptime
│𖥟╾ ${prefix}play <titre> : Télécharger audio YouTube (MP3)
│𖥟╾ ${prefix}tiktok <lien> : Télécharger vidéo TikTok sans filigrane
│𖥟╾ ${prefix}sticker : Convertir photo/vidéo en sticker
│𖥟╾ ${prefix}ai <texte> : Poser une question à l'IA
│𖥟╾ ${prefix}hd : Améliorer la qualité d'une photo (Remini)
│𖥟╾ ${prefix}vv : Récupérer média à vue unique (View-Once)
│𖥟╾ ${prefix}tagall : Mentionner tous les membres du groupe

🌐 *AUTRES LANGUES DISPONIBLES :*
• *${prefix}cr* : Meni an Kreyòl 🇭🇹
• *${prefix}en* : English Menu 🇺🇸
• *${prefix}sp* : Menú en Español 🇪🇸

> *Propulsé par Mr Christ X*`;

        case 'en':
            return `🇺🇸 *REVOLUTION MD - ENGLISH MENU* 🧟
━━━━━━━━━━━━━━━━━━━━
👑 *Owner :* Mr Christ X (+50937081286)
👤 *User :* ${userName}
⚡ *Prefix :* [ ${prefix} ]

📌 *POPULAR COMMANDS :*
│𖥟╾ ${prefix}menu : Full command menu (330+ commands)
│𖥟╾ ${prefix}ping : Bot response speed & uptime
│𖥟╾ ${prefix}play <song> : Download YouTube audio (MP3)
│𖥟╾ ${prefix}tiktok <url> : Download TikTok video without watermark
│𖥟╾ ${prefix}sticker : Convert picture/video to sticker
│𖥟╾ ${prefix}ai <query> : Ask artificial intelligence
│𖥟╾ ${prefix}hd : Enhance image quality
│𖥟╾ ${prefix}vv : Anti view-once reveal
│𖥟╾ ${prefix}tagall : Mention all group members

🌐 *OTHER LANGUAGES :*
• *${prefix}cr* : Kreyòl Ayisyen 🇭🇹
• *${prefix}fr* : Menu en Français 🇫🇷
• *${prefix}sp* : Menú en Español 🇪🇸

> *Powered by Mr Christ X*`;

        case 'sp':
            return `🇪🇸 *REVOLUTION MD - MENÚ EN ESPAÑOL* 🧟
━━━━━━━━━━━━━━━━━━━━
👑 *Creador :* Mr Christ X (+50937081286)
👤 *Usuario :* ${userName}
⚡ *Prefijo :* [ ${prefix} ]

📌 *COMANDOS PRINCIPALES :*
│𖥟╾ ${prefix}menu : Menú completo (330+ comandos)
│𖥟╾ ${prefix}ping : Velocidad del bot y tiempo activo
│𖥟╾ ${prefix}play <canción> : Descargar música MP3
│𖥟╾ ${prefix}tiktok <enlace> : Descargar video de TikTok sin marca
│𖥟╾ ${prefix}sticker : Crear sticker de imagen/video
│𖥟╾ ${prefix}ai <pregunta> : Preguntar a la inteligencia artificial
│𖥟╾ ${prefix}hd : Mejorar resolución de imagen
│𖥟╾ ${prefix}vv : Revelar fotos de una sola vista
│𖥟╾ ${prefix}tagall : Mencionar a todos en el grupo

🌐 *OTROS IDIOMAS :*
• *${prefix}cr* : Kreyòl Ayisyen 🇭🇹
• *${prefix}fr* : Menu en Français 🇫🇷
• *${prefix}en* : English Menu 🇺🇸

> *Desarrollado por Mr Christ X*`;
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
        keepAliveIntervalMs: 15000,
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

            setTimeout(async () => {
                try {
                    const rawId = sock.user?.id || '';
                    const userJid = rawId ? rawId.split(':')[0] + '@s.whatsapp.net' : `${phone}@s.whatsapp.net`;
                    await sock.sendMessage(userJid, {
                        text: `🩸 *REVOLUTION MD EST OPÉRATIONNEL & BOOSTÉ !* 🧟\n\n👑 *Propriétaire :* Mr Christ X (+50937081286)\n⚡ *Statut :* Actif permanent (Anti-veille activé)\n\n📌 *Commandes de langues :*\n• *.cr* : Meni an Kreyòl Ayisyen 🇭🇹\n• *.fr* : Menu en Français 🇫🇷\n• *.en* : English Menu 🇺🇸\n• *.sp* : Menú en Español 🇪🇸\n• *.menu* : Grand Menu complet (330+ cmds)\n\n_AutoSave Contact & AutoStatus actifs._`
                    });
                } catch (err) {
                    console.error('[WELCOME ERROR]', err.message);
                }
            }, 3000);

        } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            activeSessions.delete(phone);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                removeSessionData(phone);
                console.log(`[SESSION] +${phone} déconnecté définitivement.`);
            } else {
                sessionStatuses.set(phone, { status: 'reconnecting', registered: true });
                console.log(`[RECONNECT] Reconnexion automatique pour +${phone} dans 2 secondes...`);
                setTimeout(() => {
                    initSession(phone).catch(e => console.error('[RECONNECT ERROR]', e.message));
                }, 2000);
            }
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const { messages, type } = chatUpdate;
            if (type !== 'notify' || !messages || !messages[0]) return;
            const rawM = messages[0];
            if (!rawM.message) return;

            const fromJid = rawM.key?.remoteJid;

            // 1. GESTION DES STATUTS (Auto View, Auto Like, Auto Reply)
            if (fromJid === 'status@broadcast') {
                if (botConfig.autoViewStatus) {
                    await sock.readMessages([rawM.key]).catch(() => {});
                }
                if (botConfig.autoLikeStatus) {
                    const participant = rawM.key.participant;
                    if (participant) {
                        await sock.sendMessage('status@broadcast', {
                            react: { text: botConfig.autoLikeStatusEmoji || '🔥', key: rawM.key }
                        }, { statusJidList: [participant] }).catch(() => {});
                    }
                }
                if (botConfig.autoReplyStatus) {
                    const participant = rawM.key.participant;
                    if (participant && !rawM.key.fromMe) {
                        await sock.sendMessage(participant, {
                            text: botConfig.autoReplyStatusText || 'Statut vu par Revolution MD !'
                        }).catch(() => {});
                    }
                }
                return;
            }

            // 2. ENREGISTREMENT DANS LE STORE POUR .reveal
            if (fromJid && rawM.key.id) {
                if (!store.messages[fromJid]) store.messages[fromJid] = {};
                store.messages[fromJid][rawM.key.id] = rawM;
            }

            // 3. AUTOSAVE CONTACT
            if (botConfig.autoSaveContact && fromJid && !fromJid.endsWith('@g.us') && !rawM.key.fromMe) {
                saveContactAutomatically(fromJid, rawM.pushName);
            }

            // 4. SÉRIALISATION DU MESSAGE (smsg)
            let m = rawM;
            try { m = smsg(sock, rawM, store); } catch (err) { m = rawM; }

            const body = m.body 
                || m.message?.conversation 
                || m.message?.extendedTextMessage?.text 
                || m.message?.imageMessage?.caption 
                || '';

            const prefix = botConfig.prefix || '.';

            if (body && body.startsWith(prefix)) {
                const args = body.slice(prefix.length).trim().split(/\s+/);
                const cmdName = args.shift().toLowerCase();
                const userName = m.pushName || 'Utilisateur';

                // Commandes multilingues
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

                // Commandes d'administration des fonctionnalités à la volée
                if (cmdName === 'autosave') {
                    const opt = args[0]?.toLowerCase();
                    if (opt === 'on') { botConfig.autoSaveContact = true; return m.reply('✅ AutoSave Contact activé.'); }
                    if (opt === 'off') { botConfig.autoSaveContact = false; return m.reply('❌ AutoSave Contact désactivé.'); }
                    return m.reply(`Usage : ${prefix}autosave on/off (Actuel : ${botConfig.autoSaveContact ? 'ON' : 'OFF'})`);
                }

                if (cmdName === 'autoreplystatus') {
                    const opt = args[0]?.toLowerCase();
                    if (opt === 'on') { 
                        botConfig.autoReplyStatus = true; 
                        if (args.slice(1).join(' ')) botConfig.autoReplyStatusText = args.slice(1).join(' ');
                        return m.reply('✅ AutoReply Status activé.'); 
                    }
                    if (opt === 'off') { botConfig.autoReplyStatus = false; return m.reply('❌ AutoReply Status désactivé.'); }
                    return m.reply(`Usage : ${prefix}autoreplystatus on <message> / off`);
                }

                // Exécution des plugins personnalisés
                if (customCommands.has(cmdName)) {
                    const customCmd = customCommands.get(cmdName);
                    await customCmd.execute(sock, m, args, {
                        config: botConfig,
                        apis: botConfig.apiKeys || {}
                    });
                    return;
                }
            }

            // 5. Exécution des 330+ commandes du fichier ElitePro.js
            if (EliteProHandler) {
                await EliteProHandler(sock, m, chatUpdate, store);
            }
        } catch (err) {
            console.error('[DISPATCH ERROR] :', err.message);
        }
    });

    activeSessions.set(phone, sock);
    sessionStatuses.set(phone, {
        status: sock.authState.creds.registered ? 'connected' : 'waiting_auth',
        registered: sock.authState.creds.registered
    });

    return sock;
}

// Endpoint de santé / ping anti-sommeil
app.get('/api/ping', (req, res) => {
    res.json({ status: 'alive', uptime: process.uptime(), activeSessions: activeSessions.size });
});

// Routes Web et Panel Administrateur
app.get('/christechadmin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.post('/api/pairing', async (req, res) => {
    try {
        const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 8) return res.status(400).json({ error: 'Numéro invalide' });

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
    res.json(botConfig);
});

app.post('/api/admin/config', (req, res) => {
    if (req.headers['x-admin-pass'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Accès refusé' });
    botConfig = { ...botConfig, ...req.body };
    fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
    res.json({ success: true, updated: botConfig });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[✓] Revolution MD Boosted Edition lancé sur le port ${PORT}`);
});
