/**
 * Synthesics2 - HTTP Server
 * Serveur HTTP natif Node.js avec API REST
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const BuildQueue = require('./queue');
const Builder = require('./builder');
const TunnelClient = require('./tunnel-client');
const Database = require('./database');

// Charger la configuration
const configPath = path.join(__dirname, '..', 'config.json');
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('[Server] Configuration chargée');
} catch (err) {
    console.error('[Server] Erreur chargement config:', err.message);
    config = {
        server: { port: 3001, host: '0.0.0.0' },
        storage: {
            builds: './storage/builds',
            apks: './storage/apks',
            logs: './storage/logs',
            repos: './storage/repos'
        },
        build: { maxConcurrent: 6 },
        auth: { enabled: true, sessionDuration: 24 }
    };
}

// Initialiser les composants
const queue = new BuildQueue(config);
const builder = new Builder(config, queue);
const tunnel = new TunnelClient(config);
const db = new Database(config);

// Types MIME
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.apk': 'application/vnd.android.package-archive'
};

// Routes publiques
const PUBLIC_ROUTES = ['/api/auth/login', '/api/auth/register', '/api/health', '/api/announcements'];
const ADMIN_ROUTES = ['/api/admin'];

// === HELPERS ===

function parseBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (req.headers['content-type']?.includes('application/json')) {
                try { resolve(JSON.parse(body)); }
                catch { reject(new Error('Invalid JSON')); }
            } else { resolve(body); }
        });
        req.on('error', reject);
    });
}

function sendJson(res, data, statusCode = 200) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true'
    });
    res.end(json);
}

function sendError(res, message, statusCode = 500) {
    sendJson(res, { error: message }, statusCode);
}

function serveStatic(req, res, filePath) {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            sendError(res, 'Not Found', 404);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': stats.size,
            'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

function matchRoute(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) return null;
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
            return null;
        }
    }
    return params;
}

function parseCookies(req) {
    const cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    return cookies;
}

function getAuthToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    return parseCookies(req).session_token;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress || 'unknown';
}

function checkAuth(req) {
    const token = getAuthToken(req);
    if (!token) return null;
    return db.getSession(token);
}

// === MAIN ROUTER ===

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    try {
        let params;

        // ==================== AUTH ROUTES ====================

        if (method === 'POST' && pathname === '/api/auth/register') {
            const body = await parseBody(req);
            if (!body.username || !body.password) {
                return sendError(res, 'Pseudo et mot de passe requis', 400);
            }
            try {
                const user = db.register(body.username, body.password);
                db.addLog('register', user.id, body.username, getClientIP(req));
                return sendJson(res, { message: 'Inscription réussie', user }, 201);
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        if (method === 'POST' && pathname === '/api/auth/login') {
            const body = await parseBody(req);
            if (!body.username || !body.password) {
                return sendError(res, 'Identifiants requis', 400);
            }
            try {
                const result = db.login(body.username, body.password, getClientIP(req));
                res.setHeader('Set-Cookie', `session_token=${result.token}; HttpOnly; Path=/; Max-Age=${24*60*60}; SameSite=Lax`);
                return sendJson(res, { message: 'Connexion réussie', token: result.token, user: result.user });
            } catch (err) {
                return sendError(res, err.message, 401);
            }
        }

        if (method === 'POST' && pathname === '/api/auth/logout') {
            const token = getAuthToken(req);
            if (token) db.logout(token);
            res.setHeader('Set-Cookie', 'session_token=; HttpOnly; Path=/; Max-Age=0');
            return sendJson(res, { message: 'Déconnexion réussie' });
        }

        if (method === 'GET' && pathname === '/api/auth/me') {
            const user = checkAuth(req);
            if (!user) return sendError(res, 'Non authentifié', 401);
            return sendJson(res, { user });
        }

        // ==================== PUBLIC ROUTES ====================

        if (method === 'GET' && pathname === '/api/announcements') {
            const announcements = db.getAnnouncements(true);
            return sendJson(res, { announcements });
        }

        if (method === 'GET' && pathname === '/api/health') {
            const tools = await builder.checkTools();
            const tunnelStatus = tunnel.getStatus();
            const powerStats = builder.getPowerStats();
            return sendJson(res, {
                status: 'ok',
                version: '1.0.0',
                uptime: process.uptime(),
                platform: process.platform,
                nodeVersion: process.version,
                tools,
                tunnel: tunnelStatus,
                power: powerStats
            });
        }

        // ==================== PROTECTED ROUTES ====================

        // Check auth for API routes
        if (pathname.startsWith('/api/') && !PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
            const user = checkAuth(req);
            if (!user) return sendError(res, 'Non authentifié', 401);

            // Check admin for admin routes
            if (ADMIN_ROUTES.some(r => pathname.startsWith(r)) && user.role !== 'admin') {
                return sendError(res, 'Accès interdit', 403);
            }
            req.user = user;
        }

        // ==================== MESSAGES ROUTES ====================

        if (method === 'GET' && pathname === '/api/messages/conversations') {
            const conversations = db.getConversations(req.user.id);
            return sendJson(res, { conversations });
        }

        if (method === 'GET' && pathname === '/api/messages/unread') {
            const count = db.getUnreadCount(req.user.id);
            return sendJson(res, { unread: count });
        }

        params = matchRoute('/api/messages/:userId', pathname);
        if (method === 'GET' && params) {
            const messages = db.getMessages(req.user.id, params.userId);
            // Mark as read
            const unreadIds = messages.filter(m => m.toId === req.user.id && !m.read).map(m => m.id);
            if (unreadIds.length > 0) db.markAsRead(req.user.id, unreadIds);
            return sendJson(res, { messages });
        }

        params = matchRoute('/api/messages/:userId', pathname);
        if (method === 'POST' && params) {
            const body = await parseBody(req);
            if (!body.content) return sendError(res, 'Message requis', 400);
            try {
                const message = db.sendMessage(req.user.id, params.userId, body.content);
                return sendJson(res, { message }, 201);
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        // ==================== ADMIN ROUTES ====================

        // Users
        if (method === 'GET' && pathname === '/api/admin/users') {
            const users = db.getAllUsers();
            return sendJson(res, { users });
        }

        // Utilisateurs en attente de validation
        if (method === 'GET' && pathname === '/api/admin/users/pending') {
            const pending = db.getPendingUsers();
            return sendJson(res, { users: pending });
        }

        params = matchRoute('/api/admin/users/:id', pathname);
        if (method === 'GET' && params) {
            const user = db.getUser(params.id);
            if (!user) return sendError(res, 'Utilisateur non trouvé', 404);
            const activity = db.getUserActivity(params.id);
            const userBuilds = queue.list({ userId: params.id });
            return sendJson(res, { user, activity, builds: userBuilds.builds });
        }

        // Valider un utilisateur
        params = matchRoute('/api/admin/users/:id/validate', pathname);
        if (method === 'PUT' && params) {
            try {
                const user = db.validateUser(params.id, req.user.id);
                return sendJson(res, { message: 'Utilisateur validé', user });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        params = matchRoute('/api/admin/users/:id/role', pathname);
        if (method === 'PUT' && params) {
            const body = await parseBody(req);
            try {
                const user = db.updateUserRole(params.id, body.role, req.user.id);
                return sendJson(res, { message: 'Rôle modifié', user });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        params = matchRoute('/api/admin/users/:id', pathname);
        if (method === 'DELETE' && params) {
            try {
                db.deleteUser(params.id, req.user.id);
                return sendJson(res, { message: 'Utilisateur supprimé' });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        // Logs
        if (method === 'GET' && pathname === '/api/admin/logs') {
            const { limit, offset, action, userId } = parsedUrl.query;
            const result = db.getLogs({
                limit: parseInt(limit) || 100,
                offset: parseInt(offset) || 0,
                action, userId
            });
            return sendJson(res, result);
        }

        if (method === 'DELETE' && pathname === '/api/admin/logs') {
            db.clearLogs();
            return sendJson(res, { message: 'Logs supprimés' });
        }

        // Storage
        if (method === 'GET' && pathname === '/api/admin/storage') {
            const stats = db.getStorageStats();
            return sendJson(res, stats);
        }

        params = matchRoute('/api/admin/storage/:type', pathname);
        if (method === 'DELETE' && params) {
            try {
                db.clearStorage(params.type);
                return sendJson(res, { message: `Stockage ${params.type} vidé` });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        // System monitoring
        if (method === 'GET' && pathname === '/api/admin/system') {
            const systemInfo = db.getSystemInfo();
            return sendJson(res, systemInfo);
        }

        // Announcements (admin)
        if (method === 'POST' && pathname === '/api/admin/announcements') {
            const body = await parseBody(req);
            if (!body.title || !body.content) {
                return sendError(res, 'Titre et contenu requis', 400);
            }
            try {
                const announcement = db.createAnnouncement(req.user.id, body.title, body.content, body.type);
                return sendJson(res, { announcement }, 201);
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        if (method === 'GET' && pathname === '/api/admin/announcements') {
            const announcements = db.getAnnouncements(false);
            return sendJson(res, { announcements });
        }

        params = matchRoute('/api/admin/announcements/:id', pathname);
        if (method === 'DELETE' && params) {
            try {
                db.deleteAnnouncement(params.id, req.user.id);
                return sendJson(res, { message: 'Annonce supprimée' });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        params = matchRoute('/api/admin/announcements/:id/toggle', pathname);
        if (method === 'PUT' && params) {
            try {
                const announcement = db.toggleAnnouncement(params.id, req.user.id);
                return sendJson(res, { announcement });
            } catch (err) {
                return sendError(res, err.message, 400);
            }
        }

        // ==================== BUILDS ROUTES ====================

        if (method === 'POST' && pathname === '/api/builds') {
            const body = await parseBody(req);
            if (!body.repoUrl) return sendError(res, 'repoUrl is required', 400);

            // Vérifier si l'utilisateur a déjà un build en cours
            if (queue.hasActiveBuild(req.user?.id)) {
                return sendError(res, 'Vous avez deja un build en cours. Attendez qu\'il soit termine.', 429);
            }

            const build = queue.add({
                repoUrl: body.repoUrl,
                branch: body.branch || 'main',
                subdir: body.subdir || '',
                framework: body.framework || 'auto',
                buildType: body.buildType || 'release',
                userId: req.user?.id,
                username: req.user?.username
            });
            return sendJson(res, build, 201);
        }

        if (method === 'GET' && pathname === '/api/builds') {
            const { status, limit, offset } = parsedUrl.query;

            // Les admins voient tous les builds, les users voient que les leurs
            const filterUserId = req.user?.role === 'admin' ? null : req.user?.id;

            const result = queue.list({
                status,
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0,
                userId: filterUserId
            });
            return sendJson(res, result);
        }

        params = matchRoute('/api/builds/:id', pathname);
        if (method === 'GET' && params) {
            const build = queue.get(params.id);
            if (!build) return sendError(res, 'Build not found', 404);
            return sendJson(res, build);
        }

        params = matchRoute('/api/builds/:id/logs', pathname);
        if (method === 'GET' && params) {
            const build = queue.get(params.id);
            if (!build) return sendError(res, 'Build not found', 404);
            return sendJson(res, { logs: build.logs });
        }

        params = matchRoute('/api/builds/:id', pathname);
        if (method === 'DELETE' && params) {
            const deleted = queue.delete(params.id);
            if (!deleted) return sendError(res, 'Build not found or in progress', 404);
            return sendJson(res, { success: true });
        }

        // Delete all builds
        if (method === 'DELETE' && pathname === '/api/builds') {
            if (req.user?.role !== 'admin') return sendError(res, 'Admin requis', 403);
            queue.deleteAll();
            return sendJson(res, { message: 'Tous les builds supprimés' });
        }

        // APK download
        params = matchRoute('/api/apks/:id/:filename', pathname);
        if (method === 'GET' && params) {
            const apksDir = path.resolve(config.storage?.apks || './storage/apks');
            const apkPath = path.join(apksDir, `${params.id}.apk`);
            if (!fs.existsSync(apkPath)) return sendError(res, 'APK not found', 404);

            const stats = fs.statSync(apkPath);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Length': stats.size,
                'Content-Disposition': `attachment; filename="${params.filename}"`,
                'Access-Control-Allow-Origin': '*'
            });
            return fs.createReadStream(apkPath).pipe(res);
        }

        // ==================== STATS & OTHER ====================

        if (method === 'GET' && pathname === '/api/stats') {
            // Les admins voient les stats globales, les users voient que les leurs
            const filterUserId = req.user?.role === 'admin' ? null : req.user?.id;
            const stats = queue.getStats(filterUserId);
            return sendJson(res, stats);
        }

        if (method === 'GET' && pathname === '/api/tunnel/status') {
            return sendJson(res, tunnel.getStatus());
        }

        if (method === 'POST' && pathname === '/api/tunnel/reconnect') {
            tunnel.disconnect();
            tunnel.connect();
            return sendJson(res, { message: 'Reconnection initiated' });
        }

        // ==================== POWER MANAGEMENT ====================

        // Obtenir les stats du power manager
        if (method === 'GET' && pathname === '/api/power/stats') {
            const stats = builder.getPowerStats();
            return sendJson(res, stats);
        }

        // Forcer un mode d'alimentation (admin seulement)
        if (method === 'POST' && pathname === '/api/power/mode') {
            if (req.user?.role !== 'admin') return sendError(res, 'Admin requis', 403);
            const body = await parseBody(req);
            if (!body.mode) return sendError(res, 'Mode requis (build, idle, high-performance, balanced)', 400);
            const result = await builder.forcePowerMode(body.mode);
            return sendJson(res, { message: `Mode changé: ${result}`, mode: result });
        }

        // Activer/désactiver le power manager (admin seulement)
        if (method === 'POST' && pathname === '/api/power/toggle') {
            if (req.user?.role !== 'admin') return sendError(res, 'Admin requis', 403);
            const body = await parseBody(req);
            builder.setPowerEnabled(body.enabled !== false);
            return sendJson(res, { message: body.enabled !== false ? 'Power manager activé' : 'Power manager désactivé' });
        }

        // ==================== WEBHOOK ====================

        if (method === 'POST' && pathname === '/api/webhooks/git') {
            const body = await parseBody(req);

            if (config.webhooks?.secret) {
                const signature = req.headers['x-hub-signature-256'] ||
                    req.headers['x-gitlab-token'] ||
                    req.headers['x-gitea-signature'];
                if (!signature) return sendError(res, 'Missing webhook signature', 401);
            }

            if (!config.webhooks?.autoTrigger) {
                return sendJson(res, { message: 'Webhook received but auto-trigger disabled' });
            }

            let repoUrl = null, branch = 'main';
            if (body.repository?.clone_url) {
                repoUrl = body.repository.clone_url;
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            } else if (body.project?.git_http_url) {
                repoUrl = body.project.git_http_url;
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            } else if (body.repository?.html_url) {
                repoUrl = body.repository.html_url + '.git';
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            }

            if (!repoUrl) return sendError(res, 'Could not extract repository URL', 400);

            const build = queue.add({ repoUrl, branch, framework: 'auto', buildType: 'release' });
            return sendJson(res, { message: 'Build triggered', build }, 201);
        }

        // ==================== STATIC FILES ====================

        const webDir = path.join(__dirname, '..', 'web');
        let filePath = pathname === '/' ? '/index.html' : pathname;

        // Redirect to login if not authenticated
        if (filePath === '/index.html' || filePath === '/admin.html') {
            const user = checkAuth(req);
            if (!user) {
                res.writeHead(302, { 'Location': '/login.html' });
                res.end();
                return;
            }
            if (filePath === '/admin.html' && user.role !== 'admin') {
                res.writeHead(302, { 'Location': '/' });
                res.end();
                return;
            }
        }

        filePath = path.join(webDir, filePath);
        if (!filePath.startsWith(webDir)) return sendError(res, 'Forbidden', 403);

        serveStatic(req, res, filePath);

    } catch (err) {
        console.error('[Server] Erreur:', err.message);
        sendError(res, err.message, 500);
    }
}

// Créer et démarrer le serveur
const server = http.createServer(handleRequest);
const port = config.server?.port || 3001;
const host = config.server?.host || '0.0.0.0';

server.listen(port, host, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║   ███████╗██╗   ██╗███╗   ██╗████████╗██╗  ██╗███████╗██████╗║');
    console.log('║   ██╔════╝╚██╗ ██╔╝████╗  ██║╚══██╔══╝██║  ██║██╔════╝╚════██║');
    console.log('║   ███████╗ ╚████╔╝ ██╔██╗ ██║   ██║   ███████║█████╗   █████╔╝║');
    console.log('║   ╚════██║  ╚██╔╝  ██║╚██╗██║   ██║   ██╔══██║██╔══╝  ██╔═══╝ ║');
    console.log('║   ███████║   ██║   ██║ ╚████║   ██║   ██║  ██║███████╗███████╗║');
    console.log('║   ╚══════╝   ╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝║');
    console.log('║                                                              ║');
    console.log('║   Self-Hosted Mobile Build System                            ║');
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`[Server] Démarré sur http://${host}:${port}`);
    console.log(`[Server] Dashboard: http://localhost:${port}`);
    console.log('');

    // Afficher l'état du power manager
    const powerConfig = config.powerManager || {};
    if (powerConfig.enabled !== false) {
        console.log('[Power] Gestion intelligente de l\'alimentation ACTIVE');
        console.log(`[Power] Mode idle: ${powerConfig.idleMode || 'balanced'}`);
        console.log(`[Power] Mode build: ${powerConfig.buildMode || 'high-performance'}`);
        console.log(`[Power] Délai idle: ${(powerConfig.idleTimeout || 60000) / 1000}s`);
        console.log('');
    }

    if (config.tunnel?.enabled) tunnel.connect();
});

process.on('SIGINT', async () => {
    console.log('\n[Server] Arrêt en cours...');
    tunnel.disconnect();
    await builder.shutdown(); // Restaurer le plan d'alimentation original
    server.close(() => {
        console.log('[Server] Arrêté');
        process.exit(0);
    });
});

process.on('SIGTERM', async () => {
    tunnel.disconnect();
    await builder.shutdown();
    server.close(() => process.exit(0));
});
