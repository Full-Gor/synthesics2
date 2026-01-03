/**
 * Synthesics2 - Build Executor
 * Exécute les builds Android pour React Native, Expo et Flutter
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PowerManager = require('./power-manager');

class Builder {
    constructor(config, queue) {
        this.config = config;
        this.queue = queue;
        this.isWindows = process.platform === 'win32';

        // Initialiser le Power Manager pour optimiser la consommation
        this.powerManager = new PowerManager(config.powerManager || {
            enabled: true,
            idleMode: 'balanced',
            buildMode: 'high-performance',
            idleTimeout: 60000, // 1 minute après le dernier build
            cpuPriority: 'high'
        });

        // Chemins par défaut Windows
        this.paths = {
            androidSdk: this._resolvePath(config.paths?.androidSdk ||
                (this.isWindows
                    ? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')
                    : path.join(os.homedir(), 'Android', 'Sdk'))),
            flutterSdk: this._resolvePath(config.paths?.flutterSdk ||
                (this.isWindows
                    ? path.join(os.homedir(), 'flutter')
                    : '/opt/flutter')),
            javaHome: this._resolvePath(config.paths?.javaHome ||
                (this.isWindows
                    ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.17.10-hotspot'
                    : '/usr/lib/jvm/java-17-openjdk'))
        };

        this.reposDir = path.resolve(config.storage?.repos || './storage/repos');
        this.apksDir = path.resolve(config.storage?.apks || './storage/apks');
        this.logsDir = path.resolve(config.storage?.logs || './storage/logs');

        // Écouter les événements de build
        this.queue.on('build:start', (build) => this._executeBuild(build));
    }

    /**
     * Résout un chemin avec les variables d'environnement
     */
    _resolvePath(p) {
        if (!p) return p;
        // Remplacer %VAR% par process.env.VAR (Windows)
        return p.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
    }

    /**
     * Construit les variables d'environnement pour le build
     */
    _buildEnv() {
        const env = { ...process.env };
        const sep = this.isWindows ? ';' : ':';

        env.ANDROID_HOME = this.paths.androidSdk;
        env.ANDROID_SDK_ROOT = this.paths.androidSdk;
        env.JAVA_HOME = this.paths.javaHome;

        // Java bin en PREMIER pour forcer l'utilisation de Java 17
        const javaBin = path.join(this.paths.javaHome, 'bin');

        // Ajouter au PATH (Java en premier pour override le système)
        const pathAdditions = [
            javaBin, // Java 17 en premier!
            path.join(this.paths.androidSdk, 'platform-tools'),
            path.join(this.paths.androidSdk, 'cmdline-tools', 'latest', 'bin'),
            path.join(this.paths.androidSdk, 'build-tools'),
            path.join(this.paths.flutterSdk, 'bin')
        ];

        env.PATH = pathAdditions.join(sep) + sep + (env.PATH || '');

        return env;
    }

    /**
     * Exécute une commande shell
     */
    _exec(command, args, options = {}) {
        return new Promise((resolve, reject) => {
            const cwd = options.cwd || process.cwd();
            const env = options.env || this._buildEnv();
            const buildId = options.buildId;

            const proc = spawn(command, args, {
                cwd,
                env,
                shell: true,
                windowsHide: true
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                if (buildId) {
                    this._log(buildId, text.trim(), 'stdout');
                }
            });

            proc.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                if (buildId) {
                    this._log(buildId, text.trim(), 'stderr');
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr, code });
                } else {
                    const error = new Error(`Commande échouée avec code ${code}`);
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.code = code;
                    reject(error);
                }
            });

            // Timeout
            if (options.timeout) {
                setTimeout(() => {
                    proc.kill('SIGTERM');
                    reject(new Error('Timeout dépassé'));
                }, options.timeout);
            }
        });
    }

    /**
     * Ajoute un log au build
     */
    _log(buildId, message, type = 'info') {
        if (!message) return;

        // Filtrer les lignes vides
        const lines = message.split('\n').filter(l => l.trim());
        for (const line of lines) {
            this.queue.addLog(buildId, line, type);
        }

        // Écrire aussi dans un fichier log
        const logFile = path.join(this.logsDir, `${buildId}.log`);
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] [${type}] ${message}\n`);
    }

    /**
     * Clone un dépôt Git
     */
    async _cloneRepo(build) {
        const repoDir = path.join(this.reposDir, build.id);

        this._log(build.id, `Clonage de ${build.repoUrl} (branche: ${build.branch})...`);

        // Supprimer le dossier s'il existe
        if (fs.existsSync(repoDir)) {
            fs.rmSync(repoDir, { recursive: true, force: true });
        }

        await this._exec('git', [
            'clone',
            '--depth', '1',
            '--branch', build.branch,
            build.repoUrl,
            repoDir
        ], { buildId: build.id, timeout: 300000 });

        this._log(build.id, 'Clonage terminé');
        return repoDir;
    }

    /**
     * Détecte le framework du projet
     */
    _detectFramework(projectDir) {
        // Flutter: pubspec.yaml
        if (fs.existsSync(path.join(projectDir, 'pubspec.yaml'))) {
            return 'flutter';
        }

        // Vérifier package.json
        const packagePath = path.join(projectDir, 'package.json');
        if (fs.existsSync(packagePath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

                // Expo: dependency "expo" ou app.json avec "expo"
                if (pkg.dependencies?.expo) {
                    return 'expo';
                }

                const appJsonPath = path.join(projectDir, 'app.json');
                if (fs.existsSync(appJsonPath)) {
                    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
                    if (appJson.expo) {
                        return 'expo';
                    }
                }

                // React Native
                if (pkg.dependencies?.['react-native']) {
                    return 'react-native';
                }
            } catch (err) {
                // Ignorer les erreurs de parsing
            }
        }

        return null;
    }

    /**
     * Détecte les versions des dépendances du projet
     */
    _detectVersions(projectDir, framework) {
        const versions = {
            framework: null,
            reactNative: null,
            expo: null,
            expoSdk: null,
            flutter: null,
            dart: null,
            node: null,
            gradle: null,
            agp: null
        };

        try {
            if (framework === 'flutter') {
                // Lire pubspec.yaml pour Flutter
                const pubspecPath = path.join(projectDir, 'pubspec.yaml');
                if (fs.existsSync(pubspecPath)) {
                    const pubspec = fs.readFileSync(pubspecPath, 'utf8');

                    // Extraire SDK version
                    const sdkMatch = pubspec.match(/sdk:\s*['"]?>=?(\d+\.\d+\.\d+)/);
                    if (sdkMatch) {
                        versions.dart = sdkMatch[1];
                    }

                    // Extraire Flutter version depuis environment
                    const flutterMatch = pubspec.match(/flutter:\s*['"]?>=?(\d+\.\d+\.\d+)/);
                    if (flutterMatch) {
                        versions.flutter = flutterMatch[1];
                    }
                }
            } else {
                // React Native / Expo
                const packagePath = path.join(projectDir, 'package.json');
                if (fs.existsSync(packagePath)) {
                    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

                    // React Native version
                    if (pkg.dependencies?.['react-native']) {
                        versions.reactNative = pkg.dependencies['react-native'].replace(/[\^~]/g, '');
                    }

                    // Expo version
                    if (pkg.dependencies?.expo) {
                        versions.expo = pkg.dependencies.expo.replace(/[\^~]/g, '');
                    }

                    // Node engine
                    if (pkg.engines?.node) {
                        versions.node = pkg.engines.node;
                    }
                }

                // Expo SDK version depuis app.json
                const appJsonPath = path.join(projectDir, 'app.json');
                if (fs.existsSync(appJsonPath)) {
                    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
                    if (appJson.expo?.sdkVersion) {
                        versions.expoSdk = appJson.expo.sdkVersion;
                    }
                }

                // Gradle version
                const gradleWrapperPath = path.join(projectDir, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
                if (fs.existsSync(gradleWrapperPath)) {
                    const gradleWrapper = fs.readFileSync(gradleWrapperPath, 'utf8');
                    const gradleMatch = gradleWrapper.match(/gradle-(\d+\.\d+(?:\.\d+)?)/);
                    if (gradleMatch) {
                        versions.gradle = gradleMatch[1];
                    }
                }

                // Android Gradle Plugin version
                const buildGradlePath = path.join(projectDir, 'android', 'build.gradle');
                if (fs.existsSync(buildGradlePath)) {
                    const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
                    const agpMatch = buildGradle.match(/com\.android\.tools\.build:gradle:(\d+\.\d+\.\d+)/);
                    if (agpMatch) {
                        versions.agp = agpMatch[1];
                    }
                }
            }
        } catch (err) {
            // Ignorer les erreurs de parsing
        }

        return versions;
    }

    /**
     * Vérifie la compatibilité des versions
     */
    _checkCompatibility(versions, buildId) {
        const compatibility = this.config.compatibility || {};
        const warnings = [];

        // Vérifier Expo SDK
        if (versions.expoSdk && compatibility.expo?.versions) {
            if (!compatibility.expo.versions.includes(versions.expoSdk)) {
                warnings.push(`Expo SDK ${versions.expoSdk} n'est pas dans la liste des versions testées`);
            }
        }

        // Vérifier React Native
        if (versions.reactNative && compatibility.reactNative?.versions) {
            const rnVersion = versions.reactNative.split('.').slice(0, 2).join('.');
            if (!compatibility.reactNative.versions.includes(rnVersion)) {
                warnings.push(`React Native ${versions.reactNative} n'est pas dans la liste des versions testées`);
            }
        }

        // Vérifier Flutter
        if (versions.flutter && compatibility.flutter?.versions) {
            const flutterMajorMinor = versions.flutter.split('.').slice(0, 2).join('.');
            if (!compatibility.flutter.versions.includes(flutterMajorMinor)) {
                warnings.push(`Flutter ${versions.flutter} n'est pas dans la liste des versions testées`);
            }
        }

        // Logger les warnings
        for (const warning of warnings) {
            this._log(buildId, `⚠️ ATTENTION: ${warning}`, 'warning');
        }

        return warnings;
    }

    /**
     * Recherche récursive du projet dans les sous-dossiers
     */
    _findProject(baseDir, maxDepth = 3) {
        const queue = [{ dir: baseDir, depth: 0 }];
        const ignoreDirs = ['node_modules', '.git', 'build', 'dist', '.gradle', '.idea'];

        while (queue.length > 0) {
            const { dir, depth } = queue.shift();

            // Vérifier si c'est un projet
            const framework = this._detectFramework(dir);
            if (framework) {
                return { path: dir, framework };
            }

            // Ne pas aller plus profond
            if (depth >= maxDepth) continue;

            // Explorer les sous-dossiers
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() &&
                        !entry.name.startsWith('.') &&
                        !ignoreDirs.includes(entry.name)) {
                        queue.push({
                            dir: path.join(dir, entry.name),
                            depth: depth + 1
                        });
                    }
                }
            } catch (err) {
                // Ignorer les erreurs d'accès
            }
        }

        return null;
    }

    /**
     * Installe les dépendances npm
     */
    async _npmInstall(projectDir, buildId) {
        this._log(buildId, 'Installation des dépendances npm (avec devDependencies)...');

        const npmCmd = this.isWindows ? 'npm.cmd' : 'npm';
        await this._exec(npmCmd, ['install', '--include=dev', '--legacy-peer-deps'], {
            cwd: projectDir,
            buildId,
            timeout: 600000
        });

        // Ensure critical Expo dependencies are installed
        await this._ensureExpoDependencies(projectDir, buildId);

        this._log(buildId, 'Dépendances installées');
    }

    /**
     * Ensure critical Expo dependencies are installed
     */
    async _ensureExpoDependencies(projectDir, buildId) {
        const packagePath = path.join(projectDir, 'package.json');
        if (!fs.existsSync(packagePath)) return;

        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            const allDeps = {
                ...pkg.dependencies,
                ...pkg.devDependencies
            };

            // Critical Expo dependencies that must be present for builds
            const criticalDeps = ['babel-preset-expo'];
            const missingDeps = criticalDeps.filter(dep => !allDeps[dep]);

            if (missingDeps.length > 0) {
                this._log(buildId, `[Auto-fix] Installation des dépendances Expo manquantes: ${missingDeps.join(', ')}`);
                const npmCmd = this.isWindows ? 'npm.cmd' : 'npm';
                await this._exec(npmCmd, ['install', '--save-dev', ...missingDeps], {
                    cwd: projectDir,
                    buildId,
                    timeout: 300000
                });
            }
        } catch (err) {
            this._log(buildId, `[Auto-fix] Avertissement: Impossible de vérifier les dépendances Expo: ${err.message}`, 'warning');
        }
    }

    /**
     * Auto-fix app.json for Expo projects
     * Ensures android.package is set
     */
    _fixAppJson(projectDir, buildId) {
        const appJsonPath = path.join(projectDir, 'app.json');

        if (!fs.existsSync(appJsonPath)) {
            this._log(buildId, '[Auto-fix] Pas de app.json trouvé, création...');
            const defaultAppJson = {
                expo: {
                    name: 'NexusBuildApp',
                    slug: 'nexusbuild-app',
                    version: '1.0.0',
                    android: {
                        package: 'com.nexusbuild.app'
                    }
                }
            };
            fs.writeFileSync(appJsonPath, JSON.stringify(defaultAppJson, null, 2));
            this._log(buildId, '[Auto-fix] app.json créé avec android.package par défaut');
            return;
        }

        try {
            const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
            let modified = false;

            if (!appJson.expo) {
                appJson.expo = {};
                modified = true;
            }

            if (!appJson.expo.android) {
                appJson.expo.android = {};
                modified = true;
            }

            if (!appJson.expo.android.package) {
                const slug = appJson.expo.slug || appJson.expo.name || 'myapp';
                const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
                appJson.expo.android.package = `com.nexusbuild.${cleanSlug}`;
                modified = true;
                this._log(buildId, `[Auto-fix] Ajouté android.package: ${appJson.expo.android.package}`);
            }

            if (modified) {
                fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
                this._log(buildId, '[Auto-fix] app.json mis à jour');
            }
        } catch (err) {
            this._log(buildId, `[Auto-fix] Avertissement: Impossible de parser app.json: ${err.message}`, 'warning');
        }
    }

    /**
     * Auto-fix Gradle/Kotlin compatibility issues
     */
    _fixGradleKotlinCompat(projectDir, buildId) {
        const androidDir = path.join(projectDir, 'android');
        const gradlePropsPath = path.join(androidDir, 'gradle.properties');

        if (!fs.existsSync(androidDir)) {
            return;
        }

        this._log(buildId, '[Auto-fix] Application des corrections Kotlin/Compose...');

        const compatProperties = [
            '# NexusBuild Auto-fix: Kotlin/Compose compatibility',
            'kotlin.jvm.target.validation.mode=IGNORE',
            'android.suppressKotlinVersionCompatibilityCheck=true',
            'org.gradle.jvmargs=-Xmx4g -XX:+HeapDumpOnOutOfMemoryError',
            'org.gradle.parallel=true',
            'org.gradle.caching=true',
            'expo.modules.core.publishing.disabled=true'
        ];

        let existingContent = '';
        if (fs.existsSync(gradlePropsPath)) {
            existingContent = fs.readFileSync(gradlePropsPath, 'utf8');
        }

        let modified = false;
        let newContent = existingContent;

        for (const prop of compatProperties) {
            if (prop.startsWith('#')) {
                if (!existingContent.includes('NexusBuild Auto-fix')) {
                    newContent += '\n' + prop;
                    modified = true;
                }
                continue;
            }

            const propKey = prop.split('=')[0];
            if (!existingContent.includes(propKey)) {
                newContent += '\n' + prop;
                modified = true;
                this._log(buildId, `[Auto-fix] Ajouté: ${prop}`);
            }
        }

        if (modified) {
            fs.writeFileSync(gradlePropsPath, newContent.trim() + '\n');
            this._log(buildId, '[Auto-fix] gradle.properties mis à jour');
        }
    }

    /**
     * Create local.properties with SDK paths
     */
    _createLocalProperties(projectDir, buildId) {
        const androidDir = path.join(projectDir, 'android');
        const localPropsPath = path.join(androidDir, 'local.properties');

        if (!fs.existsSync(androidDir)) {
            return;
        }

        this._log(buildId, '[Auto-fix] Création de local.properties...');

        // Échapper les backslashes pour Windows
        const sdkPath = this.paths.androidSdk.replace(/\\/g, '\\\\');
        const content = `# Auto-generated by NexusBuild
sdk.dir=${sdkPath}
`;

        fs.writeFileSync(localPropsPath, content);
        this._log(buildId, `[Auto-fix] local.properties créé avec sdk.dir`);
    }

    /**
     * Exécute expo prebuild
     */
    async _expoPrebuild(projectDir, buildId) {
        const androidDir = path.join(projectDir, 'android');

        if (fs.existsSync(androidDir)) {
            this._log(buildId, 'Dossier android/ déjà présent, skip prebuild');
            // Appliquer les fixes même si android/ existe déjà
            this._createLocalProperties(projectDir, buildId);
            this._fixGradleKotlinCompat(projectDir, buildId);
            return;
        }

        // Auto-fix app.json avant prebuild
        this._fixAppJson(projectDir, buildId);

        this._log(buildId, 'Exécution de expo prebuild...');

        const npxCmd = this.isWindows ? 'npx.cmd' : 'npx';

        // Définir CI=1 pour le mode non-interactif
        const env = { ...this._buildEnv(), CI: '1' };

        await this._exec(npxCmd, [
            'expo', 'prebuild',
            '--platform', 'android',
            '--non-interactive'
        ], {
            cwd: projectDir,
            buildId,
            timeout: 600000,
            env
        });

        // Appliquer les fixes après prebuild
        this._createLocalProperties(projectDir, buildId);
        this._fixGradleKotlinCompat(projectDir, buildId);

        this._log(buildId, 'Expo prebuild terminé');
    }

    /**
     * Exécute le build Gradle
     */
    async _gradleBuild(projectDir, buildType, buildId) {
        const androidDir = path.join(projectDir, 'android');

        if (!fs.existsSync(androidDir)) {
            throw new Error('Dossier android/ non trouvé');
        }

        const gradlePath = path.join(androidDir, this.isWindows ? 'gradlew.bat' : 'gradlew');

        // Vérifier que gradlew existe
        if (!fs.existsSync(gradlePath)) {
            throw new Error(`gradlew non trouvé: ${gradlePath}`);
        }

        // Rendre gradlew exécutable sur Linux
        if (!this.isWindows) {
            fs.chmodSync(gradlePath, '755');
        }

        const task = buildType === 'debug' ? 'assembleDebug' : 'assembleRelease';
        this._log(buildId, `Exécution de Gradle ${task}...`);
        this._log(buildId, `JAVA_HOME: ${this.paths.javaHome}`);

        // Sur Windows, utiliser le chemin complet vers gradlew.bat
        const gradleCmd = this.isWindows ? gradlePath : './gradlew';

        // Utiliser gradle.properties pour éviter les problèmes de chemins avec espaces
        const gradlePropsPath = path.join(androidDir, 'gradle.properties');
        let gradleProps = '';
        if (fs.existsSync(gradlePropsPath)) {
            gradleProps = fs.readFileSync(gradlePropsPath, 'utf8');
        }

        // Ajouter/remplacer org.gradle.java.home (échapper les backslashes pour Windows)
        const javaHomeEscaped = this.paths.javaHome.replace(/\\/g, '\\\\');
        if (gradleProps.includes('org.gradle.java.home=')) {
            gradleProps = gradleProps.replace(/org\.gradle\.java\.home=.*/g, `org.gradle.java.home=${javaHomeEscaped}`);
        } else {
            gradleProps += `\norg.gradle.java.home=${javaHomeEscaped}\n`;
        }
        fs.writeFileSync(gradlePropsPath, gradleProps);
        this._log(buildId, 'gradle.properties mis à jour avec JAVA_HOME');

        const gradleArgs = [
            task,
            '--no-daemon'
        ];

        await this._exec(gradleCmd, gradleArgs, {
            cwd: androidDir,
            buildId,
            timeout: this.config.build?.timeout || 1800000
        });

        this._log(buildId, 'Build Gradle terminé');
    }

    /**
     * Exécute le build Flutter
     */
    async _flutterBuild(projectDir, buildType, buildId) {
        this._log(buildId, 'Installation des dépendances Flutter...');

        const flutterCmd = this.isWindows ? 'flutter.bat' : 'flutter';

        await this._exec(flutterCmd, ['pub', 'get'], {
            cwd: projectDir,
            buildId,
            timeout: 300000
        });

        this._log(buildId, `Build Flutter APK ${buildType}...`);

        const buildArgs = ['build', 'apk'];
        if (buildType === 'release') {
            buildArgs.push('--release');
        } else {
            buildArgs.push('--debug');
        }

        await this._exec(flutterCmd, buildArgs, {
            cwd: projectDir,
            buildId,
            timeout: this.config.build?.timeout || 1800000
        });

        this._log(buildId, 'Build Flutter terminé');
    }

    /**
     * Trouve et copie l'APK généré
     */
    _findAndCopyApk(projectDir, framework, buildType, buildId) {
        const apkPatterns = [];

        if (framework === 'flutter') {
            apkPatterns.push(
                path.join(projectDir, 'build', 'app', 'outputs', 'flutter-apk', `app-${buildType}.apk`),
                path.join(projectDir, 'build', 'app', 'outputs', 'apk', buildType, `app-${buildType}.apk`)
            );
        } else {
            // React Native / Expo
            apkPatterns.push(
                path.join(projectDir, 'android', 'app', 'build', 'outputs', 'apk', buildType, `app-${buildType}.apk`),
                path.join(projectDir, 'android', 'app', 'build', 'outputs', 'apk', buildType, `app-${buildType}-unsigned.apk`)
            );
        }

        // Trouver le premier APK existant
        let apkSource = null;
        for (const pattern of apkPatterns) {
            if (fs.existsSync(pattern)) {
                apkSource = pattern;
                break;
            }
        }

        // Recherche récursive si non trouvé
        if (!apkSource) {
            apkSource = this._findApkRecursive(projectDir);
        }

        if (!apkSource) {
            throw new Error('APK non trouvé après le build');
        }

        // Copier vers storage/apks
        const apkFilename = `${buildId}.apk`;
        const apkDest = path.join(this.apksDir, apkFilename);
        fs.copyFileSync(apkSource, apkDest);

        const stats = fs.statSync(apkDest);

        this._log(buildId, `APK copié: ${apkFilename} (${this._formatSize(stats.size)})`);

        return {
            path: apkDest,
            filename: apkFilename,
            size: stats.size
        };
    }

    /**
     * Recherche récursive d'un fichier APK
     */
    _findApkRecursive(dir, maxDepth = 5, currentDepth = 0) {
        if (currentDepth > maxDepth) return null;

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            // Chercher les APK d'abord
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.apk')) {
                    return path.join(dir, entry.name);
                }
            }

            // Puis explorer les sous-dossiers
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const result = this._findApkRecursive(
                        path.join(dir, entry.name),
                        maxDepth,
                        currentDepth + 1
                    );
                    if (result) return result;
                }
            }
        } catch (err) {
            // Ignorer les erreurs d'accès
        }

        return null;
    }

    /**
     * Formate une taille en bytes
     */
    _formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Nettoie les fichiers temporaires du build
     */
    _cleanup(buildId) {
        if (!this.config.build?.cleanupAfterBuild) return;

        const repoDir = path.join(this.reposDir, buildId);

        try {
            if (fs.existsSync(repoDir)) {
                fs.rmSync(repoDir, { recursive: true, force: true });
                this._log(buildId, 'Fichiers temporaires nettoyés');
            }
        } catch (err) {
            this._log(buildId, `Erreur nettoyage: ${err.message}`, 'error');
        }
    }

    /**
     * Exécute un build complet
     */
    async _executeBuild(build) {
        const buildId = build.id;

        try {
            // Activer le mode haute performance
            await this.powerManager.onBuildStart(buildId);
            await this.powerManager.optimizeForBuild();

            this._log(buildId, '='.repeat(60));
            this._log(buildId, `Démarrage du build ${buildId}`);
            this._log(buildId, `Repo: ${build.repoUrl}`);
            this._log(buildId, `Branche: ${build.branch}`);
            this._log(buildId, `Type: ${build.buildType}`);
            this._log(buildId, `Mode alimentation: HAUTE PERFORMANCE`);
            this._log(buildId, '='.repeat(60));

            // 1. Cloner le repo
            const repoDir = await this._cloneRepo(build);

            // 2. Trouver le projet
            let projectDir = repoDir;
            let framework = null;

            if (build.subdir) {
                projectDir = path.join(repoDir, build.subdir);
                if (!fs.existsSync(projectDir)) {
                    throw new Error(`Sous-dossier non trouvé: ${build.subdir}`);
                }
            }

            // Détection du framework
            if (build.framework === 'auto') {
                this._log(buildId, 'Détection automatique du framework...');
                const result = this._findProject(projectDir);

                if (!result) {
                    throw new Error('Aucun projet mobile détecté (React Native, Expo, Flutter)');
                }

                projectDir = result.path;
                framework = result.framework;
                this._log(buildId, `Framework détecté: ${framework}`);
                this._log(buildId, `Chemin du projet: ${projectDir}`);
            } else {
                framework = build.framework;
                this._log(buildId, `Framework spécifié: ${framework}`);
            }

            // Détecter les versions
            const versions = this._detectVersions(projectDir, framework);
            versions.framework = framework;

            this._log(buildId, '─'.repeat(50));
            this._log(buildId, 'VERSIONS DÉTECTÉES:');
            if (versions.reactNative) this._log(buildId, `  React Native: ${versions.reactNative}`);
            if (versions.expo) this._log(buildId, `  Expo: ${versions.expo}`);
            if (versions.expoSdk) this._log(buildId, `  Expo SDK: ${versions.expoSdk}`);
            if (versions.flutter) this._log(buildId, `  Flutter: ${versions.flutter}`);
            if (versions.dart) this._log(buildId, `  Dart: ${versions.dart}`);
            if (versions.gradle) this._log(buildId, `  Gradle: ${versions.gradle}`);
            if (versions.agp) this._log(buildId, `  Android Gradle Plugin: ${versions.agp}`);
            if (versions.node) this._log(buildId, `  Node.js requis: ${versions.node}`);
            this._log(buildId, `  JAVA_HOME: ${this.paths.javaHome}`);
            this._log(buildId, '─'.repeat(50));

            // Vérifier la compatibilité
            this._checkCompatibility(versions, buildId);

            // Mettre à jour le build avec les infos détectées
            this.queue.update(buildId, {
                detectedFramework: framework,
                projectPath: projectDir,
                detectedVersions: versions
            });

            // 3. Build selon le framework
            if (framework === 'flutter') {
                await this._flutterBuild(projectDir, build.buildType, buildId);
            } else {
                // React Native ou Expo
                await this._npmInstall(projectDir, buildId);

                if (framework === 'expo') {
                    await this._expoPrebuild(projectDir, buildId);
                }

                await this._gradleBuild(projectDir, build.buildType, buildId);
            }

            // 4. Trouver et copier l'APK
            const apk = this._findAndCopyApk(projectDir, framework, build.buildType, buildId);

            // 5. Nettoyer
            this._cleanup(buildId);

            // 6. Marquer comme succès
            this._log(buildId, '='.repeat(60));
            this._log(buildId, 'BUILD RÉUSSI');
            this._log(buildId, '='.repeat(60));

            // Notifier le power manager (retour en mode économie si plus de builds)
            await this.powerManager.onBuildEnd(buildId);

            this.queue.complete(buildId, true, {
                apkPath: apk.filename,
                apkSize: apk.size,
                detectedFramework: framework,
                projectPath: projectDir,
                detectedVersions: versions,
                powerStats: this.powerManager.getStats()
            });

        } catch (err) {
            this._log(buildId, '='.repeat(60), 'error');
            this._log(buildId, `BUILD ÉCHOUÉ: ${err.message}`, 'error');
            this._log(buildId, '='.repeat(60), 'error');

            // Nettoyer même en cas d'erreur
            this._cleanup(buildId);

            // Notifier le power manager même en cas d'erreur
            await this.powerManager.onBuildEnd(buildId);

            this.queue.complete(buildId, false, {
                error: err.message
            });
        }
    }

    /**
     * Vérifie la disponibilité des outils
     */
    async checkTools() {
        const tools = {
            node: { available: false, version: null },
            npm: { available: false, version: null },
            git: { available: false, version: null },
            java: { available: false, version: null },
            gradle: { available: false, version: null },
            androidSdk: { available: false, path: null },
            flutter: { available: false, version: null }
        };

        // Node.js
        try {
            const result = await this._exec('node', ['--version']);
            tools.node.available = true;
            tools.node.version = result.stdout.trim();
        } catch (err) { /* ignore */ }

        // npm
        try {
            const npmCmd = this.isWindows ? 'npm.cmd' : 'npm';
            const result = await this._exec(npmCmd, ['--version']);
            tools.npm.available = true;
            tools.npm.version = result.stdout.trim();
        } catch (err) { /* ignore */ }

        // Git
        try {
            const result = await this._exec('git', ['--version']);
            tools.git.available = true;
            tools.git.version = result.stdout.trim().replace('git version ', '');
        } catch (err) { /* ignore */ }

        // Java
        try {
            const result = await this._exec('java', ['-version']);
            tools.java.available = true;
            // La version Java est sur stderr
            const match = result.stderr.match(/version "(.+?)"/);
            tools.java.version = match ? match[1] : 'Unknown';
        } catch (err) { /* ignore */ }

        // Android SDK
        try {
            if (fs.existsSync(this.paths.androidSdk)) {
                tools.androidSdk.available = true;
                tools.androidSdk.path = this.paths.androidSdk;
            }
        } catch (err) { /* ignore */ }

        // Flutter
        try {
            const flutterCmd = this.isWindows ? 'flutter.bat' : 'flutter';
            const result = await this._exec(flutterCmd, ['--version']);
            tools.flutter.available = true;
            const match = result.stdout.match(/Flutter (\d+\.\d+\.\d+)/);
            tools.flutter.version = match ? match[1] : 'Unknown';
        } catch (err) { /* ignore */ }

        return tools;
    }

    /**
     * Obtient les statistiques du power manager
     */
    getPowerStats() {
        return this.powerManager.getStats();
    }

    /**
     * Force le mode d'alimentation
     */
    async forcePowerMode(mode) {
        return await this.powerManager.forceMode(mode);
    }

    /**
     * Active/désactive le power manager
     */
    setPowerEnabled(enabled) {
        this.powerManager.setEnabled(enabled);
    }

    /**
     * Nettoie proprement le builder
     */
    async shutdown() {
        await this.powerManager.restore();
    }
}

module.exports = Builder;
