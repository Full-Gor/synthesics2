/**
 * Synthesics2 - Power Manager
 * Gère les modes d'alimentation Windows pour optimiser les performances de build
 */

const { exec, execSync } = require('child_process');

class PowerManager {
    constructor(config = {}) {
        this.config = {
            enabled: config.enabled !== false,
            idleMode: config.idleMode || 'balanced',
            buildMode: config.buildMode || 'high-performance',
            idleTimeout: config.idleTimeout || 60000,
            cpuPriority: config.cpuPriority || 'high',
            ...config
        };

        this.isWindows = process.platform === 'win32';
        this.currentMode = 'idle';
        this.activeBuilds = new Set();
        this.idleTimer = null;
        this.originalGuid = null;
        this.stats = {
            modeChanges: 0,
            lastModeChange: null,
            totalBuildTime: 0,
            buildsCompleted: 0
        };

        // GUIDs des plans d'alimentation Windows standard
        this.powerPlans = {
            'high-performance': '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
            'balanced': '381b4222-f694-41f0-9685-ff5bb260df2e',
            'power-saver': 'a1841308-3541-4fab-bc81-f71556f20b4a'
        };

        if (this.isWindows && this.config.enabled) {
            this._saveOriginalPlan();
        }
    }

    /**
     * Sauvegarde le plan d'alimentation actuel
     */
    _saveOriginalPlan() {
        if (!this.isWindows) return;

        try {
            const output = execSync('powercfg /getactivescheme', { encoding: 'utf8' });
            const match = output.match(/GUID.*:\s*([a-f0-9-]+)/i);
            if (match) {
                this.originalGuid = match[1];
                console.log(`[Power] Plan original sauvegardé: ${this.originalGuid}`);
            }
        } catch (err) {
            console.error('[Power] Erreur lecture plan actuel:', err.message);
        }
    }

    /**
     * Change le plan d'alimentation
     */
    async _setPowerPlan(mode) {
        if (!this.isWindows || !this.config.enabled) return mode;

        const guid = this.powerPlans[mode];
        if (!guid) {
            console.log(`[Power] Mode inconnu: ${mode}, utilisation de balanced`);
            return 'balanced';
        }

        return new Promise((resolve) => {
            exec(`powercfg /setactive ${guid}`, (error) => {
                if (error) {
                    console.error(`[Power] Erreur changement plan: ${error.message}`);
                    resolve(this.currentMode);
                } else {
                    console.log(`[Power] Plan changé: ${mode}`);
                    this.currentMode = mode;
                    this.stats.modeChanges++;
                    this.stats.lastModeChange = new Date().toISOString();
                    resolve(mode);
                }
            });
        });
    }

    /**
     * Optimise pour le build (haute performance)
     */
    async optimizeForBuild() {
        if (!this.config.enabled) return;

        // Annuler le timer idle si actif
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        if (this.currentMode !== this.config.buildMode) {
            console.log(`[Power] Activation mode build: ${this.config.buildMode}`);
            await this._setPowerPlan(this.config.buildMode);
        }
    }

    /**
     * Retour en mode économie (après délai)
     */
    async switchToIdle() {
        if (!this.config.enabled) return;

        // Si des builds sont encore actifs, ne pas passer en idle
        if (this.activeBuilds.size > 0) return;

        // Délai avant passage en idle
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        this.idleTimer = setTimeout(async () => {
            if (this.activeBuilds.size === 0 && this.currentMode !== this.config.idleMode) {
                console.log(`[Power] Passage en mode idle: ${this.config.idleMode}`);
                await this._setPowerPlan(this.config.idleMode);
            }
        }, this.config.idleTimeout);
    }

    /**
     * Appelé quand un build démarre
     */
    async onBuildStart(buildId) {
        this.activeBuilds.add(buildId);
        await this.optimizeForBuild();
    }

    /**
     * Appelé quand un build se termine
     */
    async onBuildEnd(buildId) {
        this.activeBuilds.delete(buildId);
        this.stats.buildsCompleted++;

        if (this.activeBuilds.size === 0) {
            await this.switchToIdle();
        }
    }

    /**
     * Force un mode spécifique
     */
    async forceMode(mode) {
        if (!this.config.enabled) return this.currentMode;

        // Annuler le timer idle
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        return await this._setPowerPlan(mode);
    }

    /**
     * Active/désactive le power manager
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
        console.log(`[Power] Power manager ${enabled ? 'activé' : 'désactivé'}`);
    }

    /**
     * Restaure le plan d'alimentation original
     */
    async restore() {
        if (!this.isWindows || !this.originalGuid) return;

        return new Promise((resolve) => {
            exec(`powercfg /setactive ${this.originalGuid}`, (error) => {
                if (error) {
                    console.error(`[Power] Erreur restauration: ${error.message}`);
                } else {
                    console.log('[Power] Plan original restauré');
                }
                resolve();
            });
        });
    }

    /**
     * Retourne les statistiques
     */
    getStats() {
        return {
            enabled: this.config.enabled,
            currentMode: this.currentMode,
            activeBuilds: this.activeBuilds.size,
            platform: this.isWindows ? 'windows' : 'linux',
            ...this.stats
        };
    }
}

module.exports = PowerManager;
