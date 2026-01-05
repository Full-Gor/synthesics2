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
- **Gestion intelligente de l'énergie** - Optimise la consommation du PC

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

## Versions supportées

### Expo SDK

| Version | React Native | Architecture | Status |
|---------|--------------|--------------|--------|
| **SDK 50** | 0.73 | Legacy | Stable |
| **SDK 51** | 0.74 | Legacy | Stable |
| **SDK 52** | 0.76 | New Architecture (default) | **Recommandé** |
| **SDK 53** | 0.77+ | New Architecture | Stable |
| **SDK 54** | 0.79+ | New Architecture | Latest |

### React Native

| Version | Architecture | Expo SDK | Status |
|---------|--------------|----------|--------|
| 0.72 | Legacy | - | Stable |
| 0.73 | Legacy | SDK 50 | Stable |
| 0.74 | Legacy | SDK 51 | Stable |
| 0.75 | New (opt-in) | - | Stable |
| **0.76** | New (default) | SDK 52 | **Recommandé** |
| 0.77 | New | SDK 53 | Stable |
| 0.78 | New | - | Stable |
| 0.79 | New | SDK 54 | Stable |
| 0.80 | New | - | Stable |
| 0.81 | New | - | Stable |
| 0.82 | New (only) | - | Hermes V1 |
| 0.83 | New (only) | - | Latest |

### Flutter

| Version | Dart | Features | Status |
|---------|------|----------|--------|
| 3.16 | 3.2 | Baseline stable | Legacy |
| 3.19 | 3.3 | Improved DevTools | Stable |
| 3.22 | 3.4 | WebAssembly support | Stable |
| 3.24 | 3.5 | Enhanced performance | Stable |
| **3.27** | 3.6 | Pub workspaces, AI Toolkit | **Recommandé** |

### Node.js LTS

| Version | Codename | End of Life | Status |
|---------|----------|-------------|--------|
| 18.x | Hydrogen | Avril 2025 | Maintenance |
| 20.x | Iron | Avril 2026 | Maintenance |
| **22.x** | Jod | Avril 2027 | **Active LTS** |

### Java JDK

| Version | AGP Compatible | Status |
|---------|----------------|--------|
| 11 | AGP 7.x | Legacy |
| **17** | AGP 8.x+ | **Recommandé** |
| 21 | AGP 8.x+ | Latest LTS |

### Android Gradle Plugin (AGP)

| Version | Gradle | Java | Status |
|---------|--------|------|--------|
| 7.4 | 7.5+ | 11+ | Legacy |
| 8.0 | 8.0+ | 17+ | Stable |
| 8.1 | 8.0+ | 17+ | Stable |
| **8.2** | 8.2+ | 17+ | **Recommandé** |
| 8.3 | 8.4+ | 17+ | Stable |
| 8.4 | 8.6+ | 17+ | Latest |
| 8.5 | 8.7+ | 17+ | Kotlin 2.0 |
| 8.7 | 8.9+ | 17+ | Cutting edge |

### Android SDK

| Composant | Versions supportées | Recommandé |
|-----------|---------------------|------------|
| Compile SDK | 33, 34, 35 | **34** |
| Target SDK | 33, 34, 35 | **34** |
| Min SDK | 21, 23, 24, 26 | **24** |
| Build Tools | 33.0.2, 34.0.0, 35.0.0 | **34.0.0** |

### Matrice de compatibilité

```
┌─────────────────────────────────────────────────────────────────┐
│                    MATRICE DE COMPATIBILITÉ                      │
├─────────────────────────────────────────────────────────────────┤
│  Expo SDK 50  ←→  RN 0.73  ←→  Node 18/20/22  ←→  Java 17      │
│  Expo SDK 51  ←→  RN 0.74  ←→  Node 18/20/22  ←→  Java 17      │
│  Expo SDK 52  ←→  RN 0.76  ←→  Node 20/22     ←→  Java 17      │
│  Expo SDK 53  ←→  RN 0.77  ←→  Node 20/22     ←→  Java 17/21   │
│  Expo SDK 54  ←→  RN 0.79  ←→  Node 22        ←→  Java 17/21   │
├─────────────────────────────────────────────────────────────────┤
│  Flutter 3.16-3.27  ←→  Dart 3.2-3.6  ←→  Java 11/17/21        │
└─────────────────────────────────────────────────────────────────┘
```

## Gestion intelligente de l'énergie

Synthesics2 optimise automatiquement la consommation d'énergie de votre PC :

- **Mode Idle** : Quand aucun build n'est en cours, le PC passe en mode économie d'énergie
- **Mode Build** : Pendant les builds, le PC passe en mode haute performance
- **Transition automatique** : 1 minute après le dernier build, retour en mode économie

### Configuration

Dans `config.json` :

```json
{
  "powerManager": {
    "enabled": true,
    "idleMode": "balanced",
    "buildMode": "high-performance",
    "idleTimeout": 60000,
    "cpuPriority": "high"
  }
}
```

| Option | Description | Valeurs |
|--------|-------------|---------|
| `enabled` | Active/désactive la gestion | `true`, `false` |
| `idleMode` | Mode quand inactif | `balanced`, `power-saver` |
| `buildMode` | Mode pendant les builds | `high-performance`, `ultimate` |
| `idleTimeout` | Délai avant mode idle (ms) | `60000` (1 min) |
| `cpuPriority` | Priorité des processus | `normal`, `high`, `realtime` |

### API REST

```bash
# Obtenir les statistiques d'énergie
curl http://localhost:3001/api/power/stats

# Forcer un mode (admin)
curl -X POST http://localhost:3001/api/power/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "high-performance"}'

# Activer/désactiver (admin)
curl -X POST http://localhost:3001/api/power/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

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
