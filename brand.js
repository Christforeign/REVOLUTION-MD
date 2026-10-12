'use strict';

const BOT_NAME = process.env.BOT_NAME || 'Revolution MD';
const OWNER_NAME = process.env.OWNER_NAME || 'Mr Christ X';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '50937081286';

function rebrandText(s) {
  if (typeof s !== 'string' || s.length < 3) return s;
  return s
    .replace(/mr[\s_.-]*solarys(?:[\s_.-]*dev(?:\.cl)?)?/gi, OWNER_NAME)
    .replace(/elite[\s_.-]*pro(?:[\s_.-]*techs?)?/gi, BOT_NAME)
    .replace(/ᴍʀ[\s_.-]*ꜱᴏʟᴀʀʏꜱ[\s_.-]*ᴍᴅ/gi, 'ʀᴇᴠᴏʟᴜᴛɪᴏɴ ᴍᴅ')
    .replace(/ᴇʟɪᴛᴇ[-\s]?ᴘʀᴏ(?:[-\s]?ᴠ[1ɪ])?(?:[-\s]?ᴛᴇᴄʜꜱ?)?/gi, 'ʀᴇᴠᴏʟᴜᴛɪᴏɴ ᴍᴅ')
    .replace(/50940008268/g, OWNER_NUMBER)
    .replace(/2347047504860/g, OWNER_NUMBER);
}

function hookWASocket(sock) {
  if (!sock || !sock.sendMessage) return sock;
  const originalSend = sock.sendMessage.bind(sock);
  sock.sendMessage = function (jid, content, options) {
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') content.text = rebrandText(content.text);
      if (typeof content.caption === 'string') content.caption = rebrandText(content.caption);
    }
    return originalSend(jid, content, options);
  };
  return sock;
}

module.exports = { rebrandText, hookWASocket };
