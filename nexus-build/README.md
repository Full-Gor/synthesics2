# Synthesics2

**Self-Hosted Mobile Build System for Windows**

Compilez vos APK (React Native, Expo, Flutter) sans aucun service cloud.

```
   ███████╗██╗   ██╗███╗   ██╗████████╗██╗  ██╗███████╗██████╗
   ██╔════╝╚██╗ ██╔╝████╗  ██║╚══██╔══╝██║  ██║██╔════╝╚════██╗
   ███████╗ ╚████╔╝ ██╔██╗ ██║   ██║   ███████║█████╗   █████╔╝
   ╚════██║  ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══╝  ██╔═══╝
   ███████║   ██║   ██║ ╚████║   ██║   ██║  ██║███████╗███████╗
   ╚══════╝   ╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
```

## Fonctionnalités

- **Zero dépendances npm** - Backend 100% Node.js natif
- **Multi-framework** - React Native, Expo, Flutter
- **Builds parallèles** - Jusqu'à 6 builds simultanés
- **Auto-détection** - Framework et chemin du projet
- **Dashboard cyberpunk** - Interface web moderne
- **Webhooks Git** - GitHub, GitLab, Gitea
- **Tunnel intégré** - Exposition via NexusTunnel
- **100% offline** - Fonctionne sans internet après installation

## Prérequis

- **Windows 10/11**
- **Node.js 18+**
- **Java JDK 17**
- **Android SDK** (via Android Studio ou ligne de commande)
- **Git**

## Installation rapide

```powershell
# Cloner le dépôt
git clone <repo-url> synthesics2
cd synthesics2/nexus-build

# Exécuter le script d'installation
.\scripts\install.ps1

# Démarrer le serveur
cd api
node server.js
```

## Installation du SDK Android (optionnel)

Si vous n'avez pas Android Studio :

```powershell
.\scripts\setup-sdk.ps1
```

Ce script télécharge et configure automatiquement :
- Android SDK Command-line Tools
- Platform Tools (adb)
- Build Tools 34.0.0
- Android Platform 34

## Configuration

Éditez `config.json` pour personnaliser :

```json
{
  "server": {
    "port": 3001,
    "host": "0.0.0.0"
  },
  "paths": {
    "androidSdk": "C:\\Users\\<USER>\\AppData\\Local\\Android\\Sdk",
    "javaHome": "C:\\Program Files\\Java\\jdk-17"
  },
  "build": {
    "maxConcurrent": 6,
    "timeout": 1800000
  },
  "tunnel": {
    "enabled": true,
    "server": {
      "host": "nexuspace.duckdns.org",
      "port": 443
    },
    "auth": {
      "id": "nexusbuild-client-2",
      "key": "YOUR_PSK_KEY"
    }
  }
}
```

## Utilisation

### Dashboard Web

Accédez à `http://localhost:3001` pour :
- Créer des builds
- Voir la progression en temps réel
- Télécharger les APK
- Consulter les logs

### API REST

```bash
# Créer un build
curl -X POST http://localhost:3001/api/builds \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/my-app.git",
    "branch": "main",
    "framework": "auto",
    "buildType": "release"
  }'

# Lister les builds
curl http://localhost:3001/api/builds

# Obtenir les détails d'un build
curl http://localhost:3001/api/builds/{id}

# Télécharger l'APK
curl -O http://localhost:3001/api/apks/{id}/app.apk

# Statistiques
curl http://localhost:3001/api/stats

# Health check
curl http://localhost:3001/api/health
```

### Webhooks Git

Configurez un webhook sur GitHub/GitLab/Gitea pointant vers :
```
https://synthesics2.duckdns.org/api/webhooks/git
```

Les builds seront déclenchés automatiquement à chaque push.

## Architecture avec NexusTunnel

```
                    Internet
                       │
                       ▼
    ┌──────────────────────────────────────┐
    │  VPS (nexuspace.duckdns.org)         │
    │                                      │
    │  Nginx (443) → Tunnel Server (8443)  │
    └──────────────────────────────────────┘
                       │
                       │ WSS
                       ▼
    ┌──────────────────────────────────────┐
    │  Machine locale (Windows)            │
    │                                      │
    │  Synthesics2 (port 3001)             │
    │  → Dashboard + API                   │
    │  → Build Queue                       │
    │  → Gradle/Flutter builds             │
    └──────────────────────────────────────┘
```

## Configuration VPS (pour admin)

### 1. Ajouter le client dans le Tunnel Server

Fichier `/opt/nexus-tunnel/server/config.json` :

```json
{
  "auth": {
    "clients": {
      "nexusbuild-client-2": {
        "key": "<CLÉ_PSK_GÉNÉRÉE>",
        "allowedDomains": ["synthesics2.duckdns.org"]
      }
    }
  }
}
```

### 2. Mettre à jour le certificat SSL

```bash
sudo certbot --nginx -d synthesics2.duckdns.org
```

### 3. Configurer Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name synthesics2.duckdns.org;

    ssl_certificate /etc/letsencrypt/live/synthesics.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/synthesics.duckdns.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## Structure des dossiers

```
nexus-build/
├── api/
│   ├── server.js          # Serveur HTTP natif
│   ├── queue.js           # File d'attente
│   ├── builder.js         # Exécution builds
│   ├── tunnel-client.js   # Client NexusTunnel
│   └── package.json
├── web/
│   ├── index.html         # Dashboard
│   ├── app.js             # Frontend
│   └── styles.css         # Theme cyberpunk
├── scripts/
│   ├── install.ps1        # Installation
│   └── setup-sdk.ps1      # Config Android SDK
├── storage/
│   ├── builds/            # Métadonnées JSON
│   ├── apks/              # APK générés
│   ├── logs/              # Logs de build
│   └── repos/             # Dépôts clonés
├── config.json
└── README.md
```

## Frameworks supportés

| Framework | Détection | Build Command |
|-----------|-----------|---------------|
| **Expo** | `package.json` avec `expo` ou `app.json` | `expo prebuild` + Gradle |
| **React Native** | `package.json` avec `react-native` | Gradle |
| **Flutter** | `pubspec.yaml` | `flutter build apk` |

## Dépannage

### Build échoue avec "ANDROID_HOME not set"

```powershell
# Définir la variable d'environnement
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:USERPROFILE\AppData\Local\Android\Sdk", "User")
```

### Build échoue avec "JAVA_HOME not set"

```powershell
# Définir la variable d'environnement
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Java\jdk-17", "User")
```

### Gradle échoue avec "Could not determine java version"

Assurez-vous que `JAVA_HOME` pointe vers un JDK 17 valide.

### Tunnel ne se connecte pas

1. Vérifiez que le VPS est accessible
2. Vérifiez la clé PSK dans `config.json`
3. Vérifiez les logs du Tunnel Server sur le VPS

## Comparaison Synthesics1 vs Synthesics2

| | Synthesics1 | Synthesics2 |
|---|---|---|
| Domaine | synthesics.duckdns.org | synthesics2.duckdns.org |
| Client ID | nexusbuild-client | nexusbuild-client-2 |
| Port local | 3001 | 3001 |
| Machine | Ancienne | Nouvelle (plus puissante) |

Les deux instances peuvent fonctionner en parallèle pour répartir la charge.

## Licence

MIT

---

**Synthesics2** - Build mobile sans compromis.
