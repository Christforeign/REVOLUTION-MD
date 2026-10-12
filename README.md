# ☣️ REVOLUTION MD - HORROR & BIOHAZARD EDITION ☣️

> **Développé et propulsé exclusivement par : Mr Christ X (+50937081286)**  
> *Architecture WhatsApp Multi-Device (Baileys) • Multi-Sessions Web Pairing • Moteur Hybride 330+ Commandes & Hot-Reload Plugins*

---

## 🩸 Présentation du Projet

**Revolution MD** est un bot WhatsApp nouvelle génération doté d'une interface web sombre inspirée des films d'horreur et de l'apocalypse zombie. Il combine :
- **Un moteur complet de plus de 330 commandes natives** (Téléchargements TikTok/YouTube, stickers, retouche HD/Remini, modération de groupes, divertissement, outils système).
- **Une passerelle d'appairage web sécurisée** permettant à n'importe quel utilisateur d'obtenir son Pairing Code à 8 chiffres sans jamais taper de numéro dans la console du serveur.
- **Un studio d'administration complet (`/christechadmin`)** avec éditeur de code JavaScript en temps réel pour créer, modifier et supprimer des commandes sans redémarrage.
- **4 zones d'intégration publicitaire prêtes pour Monetag** (Popunder, Bannières, Direct SmartLink).

---

## 🛠️ Accès Rapide aux Interfaces

Une fois votre serveur Botkeep lancé :

| Interface | URL d'accès | Description |
| :--- | :--- | :--- |
| **🧟 Interface Publique (Pairing & Ads)** | `http://<VOTRE_IP_OU_DOMAINE>:30600/` | Génération du code de jumelage WhatsApp WhatsApp + Monétisation Monetag |
| **⚙️ Studio Admin (Command Center)** | `http://<VOTRE_IP_OU_DOMAINE>:30600/christechadmin` | **Mot de passe :** `@#xbot#@` • Éditeur de code, gestionnaire de sessions, médias et APIs |

---

## 📦 Fonctionnalités du Studio Administrateur (`/christechadmin`)

1. **Éditeur de Code JS en direct (2 colonnes) :**
   - **Explorateur :** Liste filtrable de toutes les commandes avec leur catégorie et leur type (*Native Core* ou *Custom Plugin*).
   - **Création & Modification :** Créez des commandes personnalisées en choisissant le nom, la catégorie (`general`, `ai`, `download`, `tools`, `fun`, `owner`) et la clé API requise.
   - **Templates inclus :** Modèles prêts à l'emploi (Message simple, Appel d'API IA, Envoi d'image/sticker, Action de groupe).
   - **Injection à chaud (Hot-Reload) :** La commande est enregistrée dans `plugins/custom/` et devient immédiatement fonctionnelle sur WhatsApp sans interruption de service.

2. **Gestionnaire Multi-Sessions :**
   - Suivi en temps réel de tous les numéros WhatsApp connectés, de leur état de synchronisation et de leur date d'enregistrement.

3. **Gestion des Médias du Menu (`.menu`) :**
   - Basculez le mode d'affichage des bannières du menu en mode **Fixe** ou **Aléatoire (Random rotation)**.
   - Modifiez dynamiquement la liste d'URLs des images et vidéos.

4. **Diffusion Statut en Masse (Broadcast) :**
   - Rédigez un message et publiez-le simultanément comme Statut WhatsApp (Story) sur l'ensemble des comptes reliés au bot.

5. **Gestionnaire de Clés d'APIs :**
   - Configuration centralisée des clés d'APIs tierces (`gemini`, `openai`, `removebg`) transmises automatiquement aux plugins personnalisés.

---

## 🚀 Guide de Déploiement sur Botkeep

1. Décompressez l'archive à la racine de votre serveur :
   ```bash
   unzip -o revolution-md-ultimate-horror-v2.zip
