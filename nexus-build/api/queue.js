/**
 * Synthesics2 - Build Queue Manager
 * Gère la file d'attente des builds avec persistance JSON
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BuildQueue extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.queue = [];
        this.builds = new Map();
        this.activeBuilds = 0;
        this.maxConcurrent = config.build?.maxConcurrent || 6;
        this.buildsDir = path.resolve(config.storage?.builds || './storage/builds');
        this.queueFile = path.join(this.buildsDir, 'queue.json');

        this._ensureDirectories();
        this._loadState();
    }

    /**
     * Crée les dossiers nécessaires
     */
    _ensureDirectories() {
        const dirs = [
            this.buildsDir,
            path.resolve(this.config.storage?.apks || './storage/apks'),
            path.resolve(this.config.storage?.logs || './storage/logs'),
            path.resolve(this.config.storage?.repos || './storage/repos')
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    /**
     * Charge l'état depuis le fichier JSON
     */
    _loadState() {
        try {
            // Charger tous les builds existants
            const files = fs.readdirSync(this.buildsDir).filter(f => f.endsWith('.json') && f !== 'queue.json');

            for (const file of files) {
                try {
                    const buildPath = path.join(this.buildsDir, file);
                    const data = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
                    this.builds.set(data.id, data);

                    // Réinitialiser les builds "building" en "queued" (crash recovery)
                    if (data.status === 'building') {
                        data.status = 'queued';
                        this._saveBuild(data);
                    }

                    // Ajouter à la queue si en attente
                    if (data.status === 'queued') {
                        this.queue.push(data.id);
                    }
                } catch (err) {
                    console.error(`Erreur chargement build ${file}:`, err.message);
                }
            }

            console.log(`[Queue] ${this.builds.size} builds chargés, ${this.queue.length} en attente`);
        } catch (err) {
            console.error('[Queue] Erreur chargement état:', err.message);
        }
    }

    /**
     * Sauvegarde un build dans un fichier JSON
     */
    _saveBuild(build) {
        const filePath = path.join(this.buildsDir, `${build.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(build, null, 2), 'utf8');
    }

    /**
     * Génère un ID unique pour un build
     */
    _generateId() {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(4).toString('hex');
        return `build-${timestamp}-${random}`;
    }

    /**
     * Ajoute un nouveau build à la queue
     */
    add(options) {
        const id = this._generateId();
        const now = new Date().toISOString();

        const build = {
            id,
            status: 'queued',
            repoUrl: options.repoUrl,
            branch: options.branch || 'main',
            subdir: options.subdir || '',
            framework: options.framework || 'auto',
            buildType: options.buildType || 'release',
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
            duration: null,
            apkPath: null,
            apkSize: null,
            error: null,
            logs: [],
            detectedFramework: null,
            projectPath: null
        };

        this.builds.set(id, build);
        this.queue.push(id);
        this._saveBuild(build);

        this.emit('build:added', build);
        console.log(`[Queue] Build ajouté: ${id}`);

        // Tenter de traiter la queue
        this._processQueue();

        return build;
    }

    /**
     * Récupère le prochain build à traiter
     */
    getNext() {
        if (this.queue.length === 0) return null;

        const id = this.queue.shift();
        const build = this.builds.get(id);

        if (build && build.status === 'queued') {
            return build;
        }

        return this.getNext();
    }

    /**
     * Traite la queue - lance les builds en parallèle
     */
    _processQueue() {
        while (this.activeBuilds < this.maxConcurrent && this.queue.length > 0) {
            const build = this.getNext();
            if (build) {
                this.activeBuilds++;
                build.status = 'building';
                build.startedAt = new Date().toISOString();
                build.updatedAt = build.startedAt;
                this._saveBuild(build);
                this.emit('build:start', build);
                console.log(`[Queue] Build démarré: ${build.id} (${this.activeBuilds}/${this.maxConcurrent} actifs)`);
            }
        }
    }

    /**
     * Met à jour un build
     */
    update(id, updates) {
        const build = this.builds.get(id);
        if (!build) return null;

        Object.assign(build, updates, {
            updatedAt: new Date().toISOString()
        });

        this._saveBuild(build);
        this.emit('build:updated', build);

        return build;
    }

    /**
     * Marque un build comme terminé (succès ou échec)
     */
    complete(id, success, result = {}) {
        const build = this.builds.get(id);
        if (!build) return null;

        const now = new Date().toISOString();
        const startTime = new Date(build.startedAt).getTime();
        const duration = Date.now() - startTime;

        Object.assign(build, {
            status: success ? 'success' : 'failed',
            completedAt: now,
            updatedAt: now,
            duration,
            apkPath: result.apkPath || null,
            apkSize: result.apkSize || null,
            error: result.error || null,
            detectedFramework: result.detectedFramework || build.detectedFramework,
            projectPath: result.projectPath || build.projectPath
        });

        this.activeBuilds = Math.max(0, this.activeBuilds - 1);
        this._saveBuild(build);
        this.emit('build:updated', build);

        console.log(`[Queue] Build terminé: ${id} - ${build.status} (${this.activeBuilds}/${this.maxConcurrent} actifs)`);

        // Continuer à traiter la queue
        this._processQueue();

        return build;
    }

    /**
     * Ajoute une ligne de log à un build
     */
    addLog(id, message, type = 'info') {
        const build = this.builds.get(id);
        if (!build) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            type,
            message
        };

        build.logs.push(logEntry);
        build.updatedAt = logEntry.timestamp;

        // Sauvegarder périodiquement (tous les 10 logs)
        if (build.logs.length % 10 === 0) {
            this._saveBuild(build);
        }
    }

    /**
     * Récupère un build par ID
     */
    get(id) {
        return this.builds.get(id) || null;
    }

    /**
     * Liste tous les builds
     */
    list(options = {}) {
        const { status, limit = 50, offset = 0 } = options;

        let builds = Array.from(this.builds.values());

        // Filtrer par statut
        if (status) {
            builds = builds.filter(b => b.status === status);
        }

        // Trier par date de création (plus récent en premier)
        builds.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Pagination
        const total = builds.length;
        builds = builds.slice(offset, offset + limit);

        return { builds, total, limit, offset };
    }

    /**
     * Supprime un build
     */
    delete(id) {
        const build = this.builds.get(id);
        if (!build) return false;

        // Ne pas supprimer un build en cours
        if (build.status === 'building') {
            return false;
        }

        // Supprimer le fichier JSON
        const filePath = path.join(this.buildsDir, `${build.id}.json`);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error(`[Queue] Erreur suppression fichier: ${err.message}`);
        }

        // Supprimer de la map et de la queue
        this.builds.delete(id);
        this.queue = this.queue.filter(qid => qid !== id);

        this.emit('build:deleted', { id });
        console.log(`[Queue] Build supprimé: ${id}`);

        return true;
    }

    /**
     * Retourne les statistiques
     */
    getStats() {
        const builds = Array.from(this.builds.values());

        const stats = {
            total: builds.length,
            queued: 0,
            building: 0,
            success: 0,
            failed: 0,
            activeBuilds: this.activeBuilds,
            maxConcurrent: this.maxConcurrent,
            queueLength: this.queue.length
        };

        for (const build of builds) {
            if (stats[build.status] !== undefined) {
                stats[build.status]++;
            }
        }

        // Calculer le temps moyen des builds réussis
        const successBuilds = builds.filter(b => b.status === 'success' && b.duration);
        if (successBuilds.length > 0) {
            stats.avgDuration = Math.round(
                successBuilds.reduce((sum, b) => sum + b.duration, 0) / successBuilds.length
            );
        } else {
            stats.avgDuration = 0;
        }

        return stats;
    }

    /**
     * Nettoie les anciens builds
     */
    cleanup(keepDays = 7) {
        const cutoff = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
        let deleted = 0;

        for (const [id, build] of this.builds) {
            if (build.status !== 'building' && build.status !== 'queued') {
                const buildDate = new Date(build.createdAt).getTime();
                if (buildDate < cutoff) {
                    this.delete(id);
                    deleted++;
                }
            }
        }

        console.log(`[Queue] Nettoyage: ${deleted} builds supprimés`);
        return deleted;
    }
}

module.exports = BuildQueue;
