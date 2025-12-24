/**
 * Synthesics2 - Frontend Application
 * Dashboard vanilla JavaScript
 */

// === API Client ===
const API = {
    baseUrl: '',

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error(`API Error: ${endpoint}`, error);
            throw error;
        }
    },

    // Builds
    getBuilds(params = {}) {
        const query = new URLSearchParams(params).toString();
        return this.request(`/api/builds${query ? '?' + query : ''}`);
    },

    getBuild(id) {
        return this.request(`/api/builds/${id}`);
    },

    createBuild(data) {
        return this.request('/api/builds', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    deleteBuild(id) {
        return this.request(`/api/builds/${id}`, {
            method: 'DELETE'
        });
    },

    // Stats
    getStats() {
        return this.request('/api/stats');
    },

    // Health
    getHealth() {
        return this.request('/api/health');
    },

    // Tunnel
    getTunnelStatus() {
        return this.request('/api/tunnel/status');
    }
};

// === State ===
const state = {
    builds: [],
    stats: {},
    filter: 'all',
    selectedBuild: null,
    refreshInterval: null
};

// === DOM Elements ===
const elements = {
    // Stats
    statQueued: document.getElementById('statQueued'),
    statBuilding: document.getElementById('statBuilding'),
    statSuccess: document.getElementById('statSuccess'),
    statFailed: document.getElementById('statFailed'),
    statAvgTime: document.getElementById('statAvgTime'),

    // Tunnel
    tunnelStatus: document.getElementById('tunnelStatus'),

    // Builds
    buildsList: document.getElementById('buildsList'),

    // Modals
    newBuildModal: document.getElementById('newBuildModal'),
    buildDetailsModal: document.getElementById('buildDetailsModal'),
    healthModal: document.getElementById('healthModal'),

    // Forms
    newBuildForm: document.getElementById('newBuildForm'),

    // Buttons
    newBuildBtn: document.getElementById('newBuildBtn'),
    closeNewBuildModal: document.getElementById('closeNewBuildModal'),
    cancelNewBuild: document.getElementById('cancelNewBuild'),
    closeBuildDetailsModal: document.getElementById('closeBuildDetailsModal'),
    healthCheckBtn: document.getElementById('healthCheckBtn'),
    closeHealthModal: document.getElementById('closeHealthModal'),

    // Content
    buildDetails: document.getElementById('buildDetails'),
    healthContent: document.getElementById('healthContent'),

    // Toast
    toastContainer: document.getElementById('toastContainer')
};

// === Utils ===
function formatDuration(ms) {
    if (!ms) return '--';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '--';

    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than 1 minute
    if (diff < 60000) {
        return 'Il y a quelques secondes';
    }

    // Less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `Il y a ${minutes} min`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `Il y a ${hours}h`;
    }

    // More than 24 hours
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatSize(bytes) {
    if (!bytes) return '--';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function extractRepoName(url) {
    if (!url) return 'Unknown';

    try {
        const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
        return match ? match[1] : url;
    } catch {
        return url;
    }
}

function getFrameworkBadge(framework) {
    const badges = {
        expo: '<span class="badge badge-expo">Expo</span>',
        'react-native': '<span class="badge badge-react-native">React Native</span>',
        flutter: '<span class="badge badge-flutter">Flutter</span>'
    };
    return badges[framework] || '';
}

function getBuildTypeBadge(type) {
    return type === 'release'
        ? '<span class="badge badge-release">Release</span>'
        : '<span class="badge badge-debug">Debug</span>';
}

// === Toast ===
function showToast(message, type = 'info') {
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// === Modal Management ===
function openModal(modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// === Stats ===
async function updateStats() {
    try {
        const stats = await API.getStats();
        state.stats = stats;

        elements.statQueued.textContent = stats.queued || 0;
        elements.statBuilding.textContent = stats.building || 0;
        elements.statSuccess.textContent = stats.success || 0;
        elements.statFailed.textContent = stats.failed || 0;
        elements.statAvgTime.textContent = formatDuration(stats.avgDuration);
    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

// === Tunnel Status ===
async function updateTunnelStatus() {
    try {
        const status = await API.getTunnelStatus();

        elements.tunnelStatus.classList.remove('connected', 'disconnected');

        if (status.connected) {
            elements.tunnelStatus.classList.add('connected');
            elements.tunnelStatus.querySelector('.status-text').textContent =
                `Tunnel: ${status.domains?.[0] || 'Connected'}`;
        } else if (status.enabled) {
            elements.tunnelStatus.classList.add('disconnected');
            elements.tunnelStatus.querySelector('.status-text').textContent = 'Tunnel: Déconnecté';
        } else {
            elements.tunnelStatus.querySelector('.status-text').textContent = 'Tunnel: Désactivé';
        }
    } catch (error) {
        elements.tunnelStatus.querySelector('.status-text').textContent = 'Tunnel: --';
    }
}

// === Builds List ===
async function loadBuilds() {
    try {
        const params = {};
        if (state.filter !== 'all') {
            params.status = state.filter;
        }

        const result = await API.getBuilds(params);
        state.builds = result.builds || [];

        renderBuilds();
    } catch (error) {
        console.error('Failed to load builds:', error);
        elements.buildsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <p>Erreur de chargement des builds</p>
            </div>
        `;
    }
}

function renderBuilds() {
    if (state.builds.length === 0) {
        elements.buildsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📱</div>
                <p>Aucun build pour le moment</p>
                <p style="font-size: 12px; margin-top: 8px;">Cliquez sur "Nouveau Build" pour commencer</p>
            </div>
        `;
        return;
    }

    elements.buildsList.innerHTML = state.builds.map(build => `
        <div class="build-item" data-id="${build.id}">
            <div class="build-status ${build.status}"></div>
            <div class="build-info">
                <div class="build-repo">${extractRepoName(build.repoUrl)}</div>
                <div class="build-meta">
                    <span>📂 ${build.branch}</span>
                    <span>🕐 ${formatDate(build.createdAt)}</span>
                    ${build.duration ? `<span>⏱️ ${formatDuration(build.duration)}</span>` : ''}
                </div>
            </div>
            <div class="build-badges">
                ${getFrameworkBadge(build.detectedFramework || build.framework)}
                ${getBuildTypeBadge(build.buildType)}
            </div>
            <div class="build-actions">
                ${build.status === 'success' && build.apkPath ? `
                    <a href="/api/apks/${build.id}/${build.apkPath}" class="btn btn-sm btn-success"
                       onclick="event.stopPropagation();">
                        ⬇️ APK
                    </a>
                ` : ''}
                ${build.status !== 'building' ? `
                    <button class="btn btn-sm btn-danger" onclick="deleteBuild('${build.id}', event)">
                        🗑️
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.build-item').forEach(item => {
        item.addEventListener('click', () => {
            showBuildDetails(item.dataset.id);
        });
    });
}

// === Build Details ===
async function showBuildDetails(id) {
    try {
        const build = await API.getBuild(id);
        state.selectedBuild = build;

        elements.buildDetails.innerHTML = `
            <div class="build-details-header">
                <div class="build-details-info">
                    <h3>${extractRepoName(build.repoUrl)}</h3>
                    <div class="build-details-meta">
                        <span>📂 ${build.branch}</span>
                        <span>🔗 ${build.repoUrl}</span>
                        ${build.subdir ? `<span>📁 ${build.subdir}</span>` : ''}
                    </div>
                </div>
                <div class="build-details-actions">
                    ${getFrameworkBadge(build.detectedFramework || build.framework)}
                    ${getBuildTypeBadge(build.buildType)}
                </div>
            </div>

            <div class="build-details-meta" style="margin-bottom: 20px;">
                <span>📊 Statut: <strong style="color: ${getStatusColor(build.status)}">${getStatusLabel(build.status)}</strong></span>
                <span>🕐 Créé: ${formatDate(build.createdAt)}</span>
                ${build.startedAt ? `<span>▶️ Démarré: ${formatDate(build.startedAt)}</span>` : ''}
                ${build.completedAt ? `<span>✓ Terminé: ${formatDate(build.completedAt)}</span>` : ''}
                ${build.duration ? `<span>⏱️ Durée: ${formatDuration(build.duration)}</span>` : ''}
                ${build.apkSize ? `<span>📦 Taille: ${formatSize(build.apkSize)}</span>` : ''}
            </div>

            ${build.error ? `
                <div style="padding: 12px; background: rgba(255, 71, 87, 0.1); border: 1px solid var(--accent-red); border-radius: var(--radius-md); margin-bottom: 20px;">
                    <strong style="color: var(--accent-red);">Erreur:</strong>
                    <p style="margin-top: 8px; color: var(--accent-red);">${build.error}</p>
                </div>
            ` : ''}

            ${build.status === 'success' && build.apkPath ? `
                <div style="margin-bottom: 20px;">
                    <a href="/api/apks/${build.id}/${build.apkPath}" class="btn btn-success">
                        ⬇️ Télécharger l'APK (${formatSize(build.apkSize)})
                    </a>
                </div>
            ` : ''}

            <div class="logs-viewer">
                <div class="logs-header">
                    <h4>📜 Logs</h4>
                    <span>${build.logs?.length || 0} lignes</span>
                </div>
                <div class="logs-content">
                    ${build.logs?.length ? build.logs.map(log => `
                        <div class="log-line ${log.type}">
                            <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span class="log-message">${escapeHtml(log.message)}</span>
                        </div>
                    `).join('') : '<p style="color: var(--text-muted);">Aucun log disponible</p>'}
                </div>
            </div>
        `;

        openModal(elements.buildDetailsModal);

        // Auto-refresh for building status
        if (build.status === 'building') {
            setTimeout(() => {
                if (elements.buildDetailsModal.classList.contains('active')) {
                    showBuildDetails(id);
                }
            }, 3000);
        }
    } catch (error) {
        showToast('Erreur lors du chargement des détails', 'error');
    }
}

function getStatusColor(status) {
    const colors = {
        queued: 'var(--accent-yellow)',
        building: 'var(--accent-cyan)',
        success: 'var(--accent-green)',
        failed: 'var(--accent-red)'
    };
    return colors[status] || 'var(--text-secondary)';
}

function getStatusLabel(status) {
    const labels = {
        queued: 'En attente',
        building: 'En cours',
        success: 'Réussi',
        failed: 'Échoué'
    };
    return labels[status] || status;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// === Delete Build ===
async function deleteBuild(id, event) {
    event.stopPropagation();

    if (!confirm('Supprimer ce build ?')) {
        return;
    }

    try {
        await API.deleteBuild(id);
        showToast('Build supprimé', 'success');
        loadBuilds();
        updateStats();
    } catch (error) {
        showToast('Erreur lors de la suppression', 'error');
    }
}

// === Create Build ===
async function createBuild(formData) {
    try {
        const data = {
            repoUrl: formData.get('repoUrl'),
            branch: formData.get('branch') || 'main',
            subdir: formData.get('subdir') || '',
            framework: formData.get('framework') || 'auto',
            buildType: formData.get('buildType') || 'release'
        };

        await API.createBuild(data);
        showToast('Build créé avec succès', 'success');
        closeModal(elements.newBuildModal);
        elements.newBuildForm.reset();
        loadBuilds();
        updateStats();
    } catch (error) {
        showToast(`Erreur: ${error.message}`, 'error');
    }
}

// === Health Check ===
async function showHealthCheck() {
    openModal(elements.healthModal);
    elements.healthContent.innerHTML = '<div class="loading">Vérification en cours...</div>';

    try {
        const health = await API.getHealth();

        const toolsHtml = Object.entries(health.tools).map(([name, info]) => {
            const available = info.available;
            const version = info.version || info.path || (available ? 'OK' : 'Non disponible');

            return `
                <div class="health-item ${available ? 'available' : 'unavailable'}">
                    <div class="health-item-icon">${getToolIcon(name)}</div>
                    <div class="health-item-info">
                        <div class="health-item-name">${formatToolName(name)}</div>
                        <div class="health-item-version">${version}</div>
                    </div>
                    <div class="health-item-status"></div>
                </div>
            `;
        }).join('');

        elements.healthContent.innerHTML = `
            <div style="margin-bottom: 20px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md);">
                <p><strong>Version:</strong> ${health.version}</p>
                <p><strong>Uptime:</strong> ${formatDuration(health.uptime * 1000)}</p>
                <p><strong>Platform:</strong> ${health.platform}</p>
                <p><strong>Node.js:</strong> ${health.nodeVersion}</p>
            </div>
            <h4 style="margin-bottom: 12px;">Outils disponibles</h4>
            <div class="health-grid">${toolsHtml}</div>
        `;
    } catch (error) {
        elements.healthContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <p>Erreur lors de la vérification</p>
                <p style="font-size: 12px;">${error.message}</p>
            </div>
        `;
    }
}

function getToolIcon(name) {
    const icons = {
        node: '🟢',
        npm: '📦',
        git: '🔀',
        java: '☕',
        gradle: '🐘',
        androidSdk: '🤖',
        flutter: '🐦'
    };
    return icons[name] || '🔧';
}

function formatToolName(name) {
    const names = {
        node: 'Node.js',
        npm: 'npm',
        git: 'Git',
        java: 'Java',
        gradle: 'Gradle',
        androidSdk: 'Android SDK',
        flutter: 'Flutter'
    };
    return names[name] || name;
}

// === Filter Buttons ===
function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.filter = btn.dataset.status;
            loadBuilds();
        });
    });
}

// === Event Listeners ===
function setupEventListeners() {
    // New Build Modal
    elements.newBuildBtn.addEventListener('click', () => openModal(elements.newBuildModal));
    elements.closeNewBuildModal.addEventListener('click', () => closeModal(elements.newBuildModal));
    elements.cancelNewBuild.addEventListener('click', () => closeModal(elements.newBuildModal));

    // New Build Form
    elements.newBuildForm.addEventListener('submit', (e) => {
        e.preventDefault();
        createBuild(new FormData(elements.newBuildForm));
    });

    // Build Details Modal
    elements.closeBuildDetailsModal.addEventListener('click', () => closeModal(elements.buildDetailsModal));

    // Health Modal
    elements.healthCheckBtn.addEventListener('click', showHealthCheck);
    elements.closeHealthModal.addEventListener('click', () => closeModal(elements.healthModal));

    // Close modals on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', () => {
            closeModal(backdrop.parentElement);
        });
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                closeModal(modal);
            });
        }
    });
}

// === Auto Refresh ===
function startAutoRefresh() {
    // Refresh every 5 seconds
    state.refreshInterval = setInterval(() => {
        loadBuilds();
        updateStats();
        updateTunnelStatus();
    }, 5000);
}

// === Initialize ===
async function init() {
    console.log('Synthesics2 - Initializing...');

    setupEventListeners();
    setupFilters();

    // Initial load
    await Promise.all([
        loadBuilds(),
        updateStats(),
        updateTunnelStatus()
    ]);

    // Start auto refresh
    startAutoRefresh();

    console.log('Synthesics2 - Ready!');
}

// Expose deleteBuild globally for inline onclick
window.deleteBuild = deleteBuild;

// Start the app
document.addEventListener('DOMContentLoaded', init);
