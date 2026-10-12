try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const pino = require('pino');
const NodeCache = require('node-cache');
const axios = require('axios');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidDecode
} = require('baileys');

const app = express();
const PORT = process.env.PORT || 30600;
const ADMIN_PASSWORD = process.env.ADMIN_PASS || '@#xbot#@';
const KNIGHT_API_KEY = 'knight';
const KNIGHT_API_BASE = 'https://knightbotapi.stream';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🌐 SERVEUR WEB PRIORITAIRE (Empêche toute coupure de l'URL)
app.get('/api/ping', (req, res) => res.json({ status: 'alive', uptime: process.uptime() }));
app.get('/christechadmin', (req, res) => {
    const adminPath = path.join(__dirname, 'public/admin.html');
    if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
    res.send('Admin panel en cours de chargement...');
});

const activeSessions = new Map();
const sessionStatuses = new Map();
const loadedCommands = new Map();

// Configuration
let botConfig = {
    botName: 'Revolution MD',
    ownerName: 'Mr Christ X',
    ownerNumber: '50937081286',
    prefix: '.',
    autoSaveContact: true,
    autoViewStatus: true,
    autoLikeStatus: true,
    autoLikeStatusEmoji: '🔥',
    flirtChats: []
};

const configPath = path.join(__dirname, 'config.json');
try {
    if (fs.existsSync(configPath)) {
        botConfig = { ...botConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    } else {
        fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
    }
} catch (e) {}

// 🚀 CHARGEMENT SÉCURISÉ DU DOSSIER commands/ SANS RISQUE DE CRASH
function loadKnightCommands() {
    loadedCommands.clear();
    const cmdDir = path.join(__dirname, 'commands');
    if (!fs.existsSync(cmdDir)) return;

    const files = fs.readdirSync(cmdDir);
    for (const file of files) {
        if (file.endsWith('.js')) {
            const cmdName = file.replace('.js', '').toLowerCase();
            try {
                const fullPath = path.join(cmdDir, file);
                delete require.cache[require.resolve(fullPath)];
                const mod = require(fullPath);
                loadedCommands.set(cmdName, mod);
            } catch (err) {
                console.warn(`[CMD SKIP] ${file} non chargé (${err.message}) - Fallback activé.`);
            }
        }
    }
    console.log(`[✓] ${loadedCommands.size} modules de commande initialisés.`);
}
loadKnightCommands();

// 🚀 ENGINE ANTI-VEILLE (Toutes les 2 minutes)
setInterval(() => {
    try { http.get(`http://127.0.0.1:${PORT}/api/ping`, () => {}).on('error', () => {}); } catch (e) {}
}, 2 * 60 * 1000);

setInterval(async () => {
    for (const [, sock] of activeSessions.entries()) {
        try { if (sock?.ws?.readyState === 1) await sock.sendPresenceUpdate('available'); } catch (e) {}
    }
}, 60 * 1000);

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

function saveContact(senderJid, pushName) {
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
            contacts[phone] = { name: pushName || `Pote ${phone}`, jid: senderJid, savedAt: new Date().toISOString() };
            fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));
        }
    } catch (e) {}
}

const streetInsults = [
    "Wesh frérot, t'as cru que la vie c'était un jeu ? Reste poli avant que je te remette à ta place.",
    "T'as autant de charisme qu'une batterie à 1%, va brancher ton cerveau un peu !",
    "Franchement même avec une loupe j'arrive pas à voir ton niveau. Circule !",
    "Tu parles trop mais tu dis rien. Va faire un tour et reviens quand t'auras du flow !",
    "T'es comme les pubs sur YouTube : tout le monde veut te skip direct !"
];

const streetFlirts = [
    "T'es tellement fraîche que même l'hiver a froid à côté de toi. Dis-moi, on signe où pour ton 06 ?",
    "J'ai demandé à l'IA la définition de la perfection, elle m'a direct renvoyé ta photo.",
    "Si la beauté était un crime, tu prendrais perpétuité direct sans procès.",
    "Même le bot a buggé sur ton charme, c'est quoi ton secret pour être aussi piquante ?",
    "Arrête de me regarder à travers l'écran comme ça, tu vas faire cramer mes serveurs !"
];

async function callKnightAPI(endpoint, params = {}) {
    try {
        params.apikey = KNIGHT_API_KEY;
        const res = await axios.get(`${KNIGHT_API_BASE}${endpoint}`, { params, timeout: 45000 });
        if (res.data && res.data.success) return res.data.result;
        return null;
    } catch (e) {
        return null;
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
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.public = true;

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {};
            return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
        }
        return jid;
    };

    sock.ev.on('creds.update', async () => await saveCreds());

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            sessionStatuses.set(phone, { status: 'connected', connectedAt: new Date().toISOString(), registered: true });
            console.log(`[SESSION] +${phone} connecté avec succès !`);

            setTimeout(async () => {
                try {
                    const rawId = sock.user?.id || '';
                    const userJid = rawId ? rawId.split(':')[0] + '@s.whatsapp.net' : `${phone}@s.whatsapp.net`;
                    await sock.sendMessage(userJid, {
                        text: `⚡ *REVOLUTION MD — POTE DE RUE* 🧢\n\n👑 *Boss :* Mr Christ X (+50937081286)\n🔥 *Statut :* Actif 24h/24 sans mise en veille.\n\n💬 *Tape :* .menu pour sortir l'arsenal.`
                    });
                } catch (e) {}
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
            const m = messages[0];
            if (!m.message) return;

            const fromJid = m.key?.remoteJid;

            // Statuts WhatsApp
            if (fromJid === 'status@broadcast') {
                if (botConfig.autoViewStatus) await sock.readMessages([m.key]).catch(() => {});
                if (botConfig.autoLikeStatus && m.key.participant) {
                    await sock.sendMessage('status@broadcast', {
                        react: { text: botConfig.autoLikeStatusEmoji || '🔥', key: m.key }
                    }, { statusJidList: [m.key.participant] }).catch(() => {});
                }
                return;
            }

            if (botConfig.autoSaveContact && fromJid && !fromJid.endsWith('@g.us') && !m.key.fromMe) {
                saveContact(fromJid, m.pushName);
            }

            const textMessage = m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                m.message?.imageMessage?.caption ||
                m.message?.videoMessage?.caption || '';

            const prefix = botConfig.prefix || '.';
            const isCommand = textMessage.startsWith(prefix);
            const args = isCommand ? textMessage.slice(prefix.length).trim().split(/\s+/) : textMessage.trim().split(/\s+/);
            const cmd = isCommand ? args.shift().toLowerCase() : '';
            const fullQuery = args.join(' ');
            const userName = m.pushName || 'Poto';

            // 💘 MODE FLIRT AUTOMATIQUE (DANS LE CHAT DÉDIÉ)
            if (!isCommand && botConfig.flirtChats.includes(fromJid) && !m.key.fromMe) {
                await sock.sendPresenceUpdate('composing', fromJid);
                const promptFlirt = `Tu es un charmeur de rue, dragueur plein d'assurance, d'esprit et de punchlines séduisantes. Réponds avec charme et audace à ce message : "${textMessage}"`;
                const aiReply = await callKnightAPI('/api/ai/chat', { q: promptFlirt });
                const replyText = aiReply || streetFlirts[Math.floor(Math.random() * streetFlirts.length)];
                return await sock.sendMessage(fromJid, { text: replyText }, { quoted: m });
            }

            if (!isCommand) return;

            // ==========================================
            // 🎯 ROUTEUR DE COMMANDES PROPRIÉTAIRE & FIABLE
            // ==========================================
            switch (cmd) {
                case 'menu':
                case 'help': {
                    const menuTxt = `┏━━━ ⚡ *REVOLUTION MD* ⚡ ━━━❍
┃ 🧢 *Style :* Pote de rue & Provocateur
┃ 👑 *Boss :* Mr Christ X (+50937081286)
┃ 👤 *Frérot :* ${userName}
┃ ⚡ *Préfixe :* [ ${prefix} ]
┗━━━━━━━━━━━━━━━━━━━━━━━❍

🔥 *PROVOCATION & RUE :*
│𖥟╾ ${prefix}insult [@tag] : Punchline sèche
│𖥟╾ ${prefix}roast [@tag] : Cuisiner un pote sans pitié
│𖥟╾ ${prefix}blague : Vanne de rue
│𖥟╾ ${prefix}compliment : Pour lui donner de l'espoir

💘 *DRAGUE & SÉDUCTION (COTISER) :*
│𖥟╾ ${prefix}flirt [nom/@tag] : Phrase de drague ciblée
│𖥟╾ ${prefix}flirt on : Active la drague automatique dans ce chat
│𖥟╾ ${prefix}flirt off : Désactive la drague automatique
│𖥟╾ ${prefix}drague <question> : Coaching drague par l'IA

📥 *TÉLÉCHARGEMENT (KNIGHT API) :*
│𖥟╾ ${prefix}tiktok <lien> : Vidéo TikTok sans watermark
│𖥟╾ ${prefix}play <titre> : Télécharger audio YouTube (MP3)
│𖥟╾ ${prefix}video <titre> : Télécharger vidéo YouTube (MP4)
│𖥟╾ ${prefix}ig <lien> : Instagram Reel / Post
│𖥟╾ ${prefix}fb <lien> : Vidéo Facebook
│𖥟╾ ${prefix}twitter <lien> : Vidéo Twitter / X
│𖥟╾ ${prefix}pinterest <lien> : Média Pinterest

🧠 *IA & ASSISTANT :*
│𖥟╾ ${prefix}ai <texte> : Poser une question à Knight Chat
│𖥟╾ ${prefix}gpt <texte> : Modèle GPT
│𖥟╾ ${prefix}gemini <texte> : Modèle Gemini

🛠️ *OUTILS & STATUT :*
│𖥟╾ ${prefix}ss <url> : Capture d'écran de site
│𖥟╾ ${prefix}tts <texte> : Synthèse vocale
│𖥟╾ ${prefix}qr <texte> : Générer un QR Code
│𖥟╾ ${prefix}tagall : Mentionner tout le monde
│𖥟╾ ${prefix}ping : Vitesse de frappe du bot
│𖥟╾ ${prefix}alive : Vérification 24h/24

> *Propulsé par Mr Christ X — Fais pas le malin.*`;
                    return await sock.sendMessage(fromJid, { text: menuTxt }, { quoted: m });
                }

                case 'insult': {
                    const insultApi = await callKnightAPI('/api/fun/insult');
                    const chosen = insultApi || streetInsults[Math.floor(Math.random() * streetInsults.length)];
                    return await sock.sendMessage(fromJid, { text: `🗣️ *Écoute bien :*\n\n${chosen}` }, { quoted: m });
                }

                case 'roast': {
                    const roastApi = await callKnightAPI('/api/fun/roast');
                    const chosen = roastApi || "T'as tellement zéro repartie que même Siri te laisse en vu !";
                    return await sock.sendMessage(fromJid, { text: `🔥 *Cuisiné bien saignant :*\n\n${chosen}` }, { quoted: m });
                }

                case 'blague':
                case 'joke': {
                    const jokeApi = await callKnightAPI('/api/fun/blague') || await callKnightAPI('/api/fun/joke');
                    return await sock.sendMessage(fromJid, { text: `😂 *Tiens, rigole :*\n\n${jokeApi || "Pourquoi les plongeurs plongent en arrière ? Parce que sinon ils tombent dans le bateau !"}` }, { quoted: m });
                }

                case 'compliment': {
                    const compApi = await callKnightAPI('/api/fun/compliment');
                    return await sock.sendMessage(fromJid, { text: `✨ *Prends pas la grosse tête :*\n\n${compApi || "T'es le seul ici qui relève un peu le niveau."}` }, { quoted: m });
                }

                case 'flirt': {
                    if (args[0] === 'on') {
                        if (!botConfig.flirtChats.includes(fromJid)) {
                            botConfig.flirtChats.push(fromJid);
                            fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
                        }
                        return await sock.sendMessage(fromJid, { text: "💘 *Mode Drague activé ici !* Parle normalement, le bot répond avec charme et assurance." }, { quoted: m });
                    }
                    if (args[0] === 'off') {
                        botConfig.flirtChats = botConfig.flirtChats.filter(id => id !== fromJid);
                        fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2));
                        return await sock.sendMessage(fromJid, { text: "🚫 *Mode Drague désactivé.*" }, { quoted: m });
                    }

                    const target = fullQuery ? `pour ${fullQuery}` : '';
                    const flirtApi = await callKnightAPI('/api/fun/flirt');
                    const disquette = flirtApi || streetFlirts[Math.floor(Math.random() * streetFlirts.length)];
                    return await sock.sendMessage(fromJid, { text: `💘 *Disquette de séduction ${target} :*\n\n${disquette}` }, { quoted: m });
                }

                case 'drague': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Pose ta question de drague (ex: .drague comment relancer une fille qui me laisse en vu ?)" }, { quoted: m });
                    const resDrague = await callKnightAPI('/api/ai/chat', { q: `Donne une stratégie de séduction directe, efficace, avec du charisme de rue pour : ${fullQuery}` });
                    return await sock.sendMessage(fromJid, { text: `🕶️ *Conseil du Boss :*\n\n${resDrague || "La règle d'or : garde ton calme, montre de l'assurance et ne sois jamais en demande."}` }, { quoted: m });
                }

                case 'tiktok': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Mets le lien TikTok frérot !" }, { quoted: m });
                    await sock.sendMessage(fromJid, { react: { text: '⏳', key: m.key } });
                    const resTk = await callKnightAPI('/api/download/tiktok', { url: fullQuery });
                    if (resTk && (resTk.download || resTk.url || resTk.video)) {
                        const dlUrl = resTk.download || resTk.url || resTk.video;
                        await sock.sendMessage(fromJid, { video: { url: dlUrl }, caption: "🎬 *TikTok sans filigrane servi.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Lien invalide ou vidéo inaccessible." }, { quoted: m });
                    }
                    break;
                }

                case 'play':
                case 'ytmp3': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le titre du son ou le lien YouTube !" }, { quoted: m });
                    await sock.sendMessage(fromJid, { react: { text: '🎵', key: m.key } });
                    const resYt = await callKnightAPI('/api/ytmp3', { query: fullQuery }) || await callKnightAPI('/api/download/ytaudio', { url: fullQuery });
                    if (resYt && (resYt.download || resYt.url)) {
                        await sock.sendMessage(fromJid, { audio: { url: resYt.download || resYt.url }, mimetype: 'audio/mpeg' }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Son introuvable !" }, { quoted: m });
                    }
                    break;
                }

                case 'video':
                case 'ytmp4': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le titre ou le lien vidéo !" }, { quoted: m });
                    await sock.sendMessage(fromJid, { react: { text: '📽️', key: m.key } });
                    const resYtv = await callKnightAPI('/api/ytmp4', { query: fullQuery }) || await callKnightAPI('/api/download/ytmp4', { url: fullQuery });
                    if (resYtv && (resYtv.download || resYtv.url)) {
                        await sock.sendMessage(fromJid, { video: { url: resYtv.download || resYtv.url }, caption: "🎬 *Vidéo téléchargée.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Vidéo introuvable !" }, { quoted: m });
                    }
                    break;
                }

                case 'ig':
                case 'instagram': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le lien Instagram !" }, { quoted: m });
                    const resIg = await callKnightAPI('/api/download/instagram', { url: fullQuery });
                    if (resIg && (resIg.download || resIg.url)) {
                        await sock.sendMessage(fromJid, { video: { url: resIg.download || resIg.url }, caption: "📸 *Instagram envoyé.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Impossible de récupérer le post Instagram." }, { quoted: m });
                    }
                    break;
                }

                case 'fb':
                case 'facebook': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le lien Facebook !" }, { quoted: m });
                    const resFb = await callKnightAPI('/api/download/facebook', { url: fullQuery });
                    if (resFb && (resFb.download || resFb.url)) {
                        await sock.sendMessage(fromJid, { video: { url: resFb.download || resFb.url }, caption: "📹 *Vidéo Facebook livrée.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Lien Facebook non supporté." }, { quoted: m });
                    }
                    break;
                }

                case 'twitter':
                case 'x': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le lien Twitter / X !" }, { quoted: m });
                    const resTw = await callKnightAPI('/api/download/twitter', { url: fullQuery });
                    if (resTw && (resTw.download || resTw.url)) {
                        await sock.sendMessage(fromJid, { video: { url: resTw.download || resTw.url }, caption: "🐦 *Vidéo Twitter envoyée.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Échec de téléchargement Twitter." }, { quoted: m });
                    }
                    break;
                }

                case 'pinterest': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le lien Pinterest !" }, { quoted: m });
                    const resPin = await callKnightAPI('/api/download/pinterest', { url: fullQuery });
                    if (resPin && (resPin.download || resPin.url)) {
                        await sock.sendMessage(fromJid, { image: { url: resPin.download || resPin.url }, caption: "📌 *Média Pinterest.*" }, { quoted: m });
                    } else {
                        await sock.sendMessage(fromJid, { text: "❌ Rien trouvé sur Pinterest." }, { quoted: m });
                    }
                    break;
                }

                case 'ai':
                case 'gpt':
                case 'gemini': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Pose ta question frérot !" }, { quoted: m });
                    await sock.sendPresenceUpdate('composing', fromJid);
                    const ep = cmd === 'gemini' ? '/api/ai/gemini' : (cmd === 'gpt' ? '/api/ai/gpt' : '/api/ai/chat');
                    const rep = await callKnightAPI(ep, { q: fullQuery });
                    return await sock.sendMessage(fromJid, { text: rep || "J'ai réfléchi mais ta question est trop bizarre !" }, { quoted: m });
                }

                case 'ss':
                case 'ssweb': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne l'URL à capturer !" }, { quoted: m });
                    const resSs = await callKnightAPI('/api/ssweb', { url: fullQuery });
                    if (resSs && (resSs.download || resSs.url)) {
                        await sock.sendMessage(fromJid, { image: { url: resSs.download || resSs.url }, caption: "📸 *Capture web.*" }, { quoted: m });
                    }
                    break;
                }

                case 'tts': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Écris le texte à vocaliser !" }, { quoted: m });
                    const resTts = await callKnightAPI('/api/tts', { text: fullQuery, lang: 'fr' });
                    if (resTts && (resTts.download || resTts.url)) {
                        await sock.sendMessage(fromJid, { audio: { url: resTts.download || resTts.url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: m });
                    }
                    break;
                }

                case 'qr': {
                    if (!fullQuery) return await sock.sendMessage(fromJid, { text: "Donne le texte à convertir en QR Code !" }, { quoted: m });
                    const resQr = await callKnightAPI('/api/qr', { text: fullQuery });
                    if (resQr && (resQr.download || resQr.url)) {
                        await sock.sendMessage(fromJid, { image: { url: resQr.download || resQr.url }, caption: "🏁 *QR Code généré.*" }, { quoted: m });
                    }
                    break;
                }

                case 'tagall': {
                    if (!fromJid.endsWith('@g.us')) return await sock.sendMessage(fromJid, { text: "C'est pour les groupes ça !" }, { quoted: m });
                    const meta = await sock.groupMetadata(fromJid);
                    const members = meta.participants.map(u => u.id);
                    let tagText = `📢 *APPEL DU QUARTIER :*\n\n`;
                    for (const mem of members) tagText += `👉 @${mem.split('@')[0]}\n`;
                    return await sock.sendMessage(fromJid, { text: tagText, mentions: members }, { quoted: m });
                }

                case 'ping': {
                    return await sock.sendMessage(fromJid, { text: `⚡ *PONG !* 0.2ms. Réponse instantanée.` }, { quoted: m });
                }

                case 'alive': {
                    return await sock.sendMessage(fromJid, { text: `🩸 *REVOLUTION MD EST CONNECTÉ !*\nBoss : Mr Christ X (+50937081286)\nSystème en ligne 24h/24.` }, { quoted: m });
                }

                default: {
                    // Fallback d'exécution si la commande existe dans le dossier commands/
                    if (loadedCommands.has(cmd)) {
                        const commandHandler = loadedCommands.get(cmd);
                        const fn = commandHandler[`${cmd}Command`] || commandHandler.default || commandHandler;
                        if (typeof fn === 'function') {
                            try {
                                await fn(sock, fromJid, m);
                            } catch (e) {
                                console.error(`Erreur exécution module ${cmd}:`, e.message);
                            }
                        }
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('[DISPATCH ERROR] :', err.message);
        }
    });

    activeSessions.set(phone, sock);
    sessionStatuses.set(phone, { status: sock.authState.creds.registered ? 'connected' : 'waiting_auth', registered: sock.authState.creds.registered });
    return sock;
}

// 📱 API PAIRING & GESTION SESSIONS
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

app.listen(PORT, '0.0.0.0', () => console.log(`[✓] Revolution MD (Knight Engine) lancé avec succès sur le port ${PORT}`));
