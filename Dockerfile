FROM node:20-alpine

# Dépendances système pour les modules multimédia (FFmpeg, Sharp, Git)
RUN apk add --no-cache ffmpeg git python3 make g++

WORKDIR /workspace

# Copie des fichiers de configuration
COPY package*.json ./

# Installation propre et complète des dépendances
RUN npm install

# Copie de tout le reste du bot
COPY . .

# Expose le port de ton bot
EXPOSE 30600

# Commande de lancement
CMD ["node", "server.js"]
