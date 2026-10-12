module.exports = {
    name: 'customping',
    category: 'custom',
    description: 'Exemple de commande custom ajoutée depuis le panel admin',
    requiredApi: '',
    async execute(sock, m, args, { config, apis }) {
        const jid = m.key.remoteJid;
        await sock.sendMessage(jid, { text: '⚡ Réponse instantanée de la commande custom !' }, { quoted: m });
    }
};
