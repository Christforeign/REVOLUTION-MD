try { require('dotenv').config(); } catch (e) {}
const fs = require('fs');

// Paramètres de contact & identité
global.sessionid = process.env.SESSION_ID || '';
global.dbSite = process.env.DB_SITE || '';
global.ytname = process.env.YT_NAME || "Revolution MD";
global.socialm = process.env.SOCIAL_M || "Owner: Mr Christ X";
global.location = process.env.LOCATION || "Haiti";

// Paramètres Créateur / Owner
global.prefix = process.env.PREFIX || '.';
global.ownername = process.env.OWNER_NAME || 'Mr Christ X';
global.ownernumber = process.env.OWNER_NUMBER || '50937081286';
global.botname = process.env.BOT_NAME || 'Revolution MD';

// Automatisations
global.autoRecording = process.env.AUTO_RECORDING === 'true';
global.autoTyping = process.env.AUTO_TYPING === 'true';
global.autorecordtype = process.env.AUTO_RECORD_TYPE === 'true';
global.autoread = process.env.AUTO_READ === 'true';
global.autobio = process.env.AUTO_BIO !== 'false';
global.autoviewstatus = process.env.AUTO_VIEW_STATUS !== 'false';
global.autoreactstatus = process.env.AUTO_REACT_STATUS !== 'false';
global.statusreactemojis = ['🔥', '⚡', '👑', '😎', '🩸', '💀'];

// Pack stickers
global.packname = 'Revolution MD';
global.author = 'Mr Christ X';
global.footer = '© Revolution MD - Mr Christ X';

global.themeemoji = '🩸';
global.wm = 'Revolution MD';

global.prefa = ['.'];

// Messages par défaut
global.mess = {
    done: '🩸 *Opération terminée avec succès !*',
    success: '💀 *Revolution MD : Requête effectuée !*',
    owner: '❌ *Cette commande est réservée au boss : Mr Christ X !*',
    group: '❌ *Cette commande est utilisable uniquement dans un groupe !*',
    admin: '❌ *Tu dois être administrateur du groupe pour faire ça !*',
    botAdmin: '❌ *Donne-moi les privilèges administrateur d\'abord !*'
};
