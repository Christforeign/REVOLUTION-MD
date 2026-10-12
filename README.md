# MR SOLARYS MD

Bot WhatsApp — Owner : **MR SOLARYS-Dev.cl** — Contact : +50940008268

## Variables d'environnement
`SESSION_ID`, `OWNER_NUMBER=50940008268`, `OWNER_NAME=MR SOLARYS-Dev.cl`, `BOT_NAME=MR SOLARYS MD`, `PREFIX=.`

## Déploiement
- **Koyeb** : New Service → GitHub (ou Docker) → Builder *Dockerfile* → type **Worker** (ou Web, port 8000) → ajoute les variables ci-dessus.
- **Katabump** : crée un serveur Node.js, upload le dossier `bot/` (ou clone ton repo), commande de démarrage `npm start`, ajoute `SESSION_ID` dans les variables.
- **Heroku** : `app.json` + `Procfile` inclus.
- **Render / Railway / VPS** : `Dockerfile` ou `render.yaml` inclus (`npm install && npm start`).
- **Termux / VPS** : `npm install && npm start`.

## Premier démarrage (jumelage)
Sans `SESSION_ID`, le bot demande un code de jumelage pour `PAIR_NUMBER` (50940008268) et l'affiche dans la console. Dans WhatsApp : Paramètres → Appareils connectés → Connecter un appareil → Connecter avec le numéro de téléphone.
