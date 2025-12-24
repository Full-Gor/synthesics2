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

// Charger la configuration
const configPath = path.join(__dirname, '..', 'config.json');
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('[Server] Configuration chargée');
} catch (err) {
    console.error('[Server] Erreur chargement config:', err.message);
    console.log('[Server] Utilisation des valeurs par défaut');
    config = {
        server: { port: 3001, host: '0.0.0.0' },
        storage: {
            builds: './storage/builds',
            apks: './storage/apks',
            logs: './storage/logs',
            repos: './storage/repos'
        },
        build: { maxConcurrent: 6 }
    };
}

// Initialiser les composants
const queue = new BuildQueue(config);
const builder = new Builder(config, queue);
const tunnel = new TunnelClient(config);

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

/**
 * Parse le body d'une requête
 */
function parseBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        req.on('data', (chunk) => {
            chunks.push(chunk);
        });

        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');

            if (req.headers['content-type']?.includes('application/json')) {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error('Invalid JSON'));
                }
            } else {
                resolve(body);
            }
        });

        req.on('error', reject);
    });
}

/**
 * Envoie une réponse JSON
 */
function sendJson(res, data, statusCode = 200) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(json);
}

/**
 * Envoie une erreur
 */
function sendError(res, message, statusCode = 500) {
    sendJson(res, { error: message }, statusCode);
}

/**
 * Sert un fichier statique
 */
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

/**
 * Extrait les paramètres d'URL
 */
function matchRoute(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) {
        return null;
    }

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

/**
 * Vérifie l'authentification
 */
function checkAuth(req) {
    if (!config.auth?.enabled) {
        return true;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return false;
    }

    const token = authHeader.replace('Bearer ', '');
    return token === config.auth.token;
}

/**
 * Router principal
 */
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    // Vérifier l'authentification pour les routes API
    if (pathname.startsWith('/api/') && !checkAuth(req)) {
        sendError(res, 'Unauthorized', 401);
        return;
    }

    try {
        // === API ROUTES ===

        // POST /api/builds - Créer un build
        if (method === 'POST' && pathname === '/api/builds') {
            const body = await parseBody(req);

            if (!body.repoUrl) {
                sendError(res, 'repoUrl is required', 400);
                return;
            }

            const build = queue.add({
                repoUrl: body.repoUrl,
                branch: body.branch || 'main',
                subdir: body.subdir || '',
                framework: body.framework || 'auto',
                buildType: body.buildType || 'release'
            });

            sendJson(res, build, 201);
            return;
        }

        // GET /api/builds - Lister les builds
        if (method === 'GET' && pathname === '/api/builds') {
            const { status, limit, offset } = parsedUrl.query;
            const result = queue.list({
                status,
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0
            });
            sendJson(res, result);
            return;
        }

        // GET /api/builds/:id - Détails d'un build
        let params = matchRoute('/api/builds/:id', pathname);
        if (method === 'GET' && params) {
            const build = queue.get(params.id);
            if (!build) {
                sendError(res, 'Build not found', 404);
                return;
            }
            sendJson(res, build);
            return;
        }

        // GET /api/builds/:id/logs - Logs d'un build
        params = matchRoute('/api/builds/:id/logs', pathname);
        if (method === 'GET' && params) {
            const build = queue.get(params.id);
            if (!build) {
                sendError(res, 'Build not found', 404);
                return;
            }
            sendJson(res, { logs: build.logs });
            return;
        }

        // DELETE /api/builds/:id - Supprimer un build
        params = matchRoute('/api/builds/:id', pathname);
        if (method === 'DELETE' && params) {
            const deleted = queue.delete(params.id);
            if (!deleted) {
                sendError(res, 'Build not found or in progress', 404);
                return;
            }
            sendJson(res, { success: true });
            return;
        }

        // GET /api/apks/:id/:filename - Télécharger APK
        params = matchRoute('/api/apks/:id/:filename', pathname);
        if (method === 'GET' && params) {
            const apksDir = path.resolve(config.storage?.apks || './storage/apks');
            const apkPath = path.join(apksDir, `${params.id}.apk`);

            if (!fs.existsSync(apkPath)) {
                sendError(res, 'APK not found', 404);
                return;
            }

            const stats = fs.statSync(apkPath);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.android.package-archive',
                'Content-Length': stats.size,
                'Content-Disposition': `attachment; filename="${params.filename}"`,
                'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(apkPath).pipe(res);
            return;
        }

        // POST /api/webhooks/git - Webhook GitHub/GitLab/Gitea
        if (method === 'POST' && pathname === '/api/webhooks/git') {
            const body = await parseBody(req);

            // Vérifier le secret si configuré
            if (config.webhooks?.secret) {
                const signature = req.headers['x-hub-signature-256'] ||
                    req.headers['x-gitlab-token'] ||
                    req.headers['x-gitea-signature'];

                if (!signature) {
                    sendError(res, 'Missing webhook signature', 401);
                    return;
                }

                // Vérification HMAC pour GitHub
                if (req.headers['x-hub-signature-256']) {
                    const expectedSig = 'sha256=' + crypto
                        .createHmac('sha256', config.webhooks.secret)
                        .update(JSON.stringify(body))
                        .digest('hex');

                    if (signature !== expectedSig) {
                        sendError(res, 'Invalid signature', 401);
                        return;
                    }
                }
            }

            if (!config.webhooks?.autoTrigger) {
                sendJson(res, { message: 'Webhook received but auto-trigger disabled' });
                return;
            }

            // Extraire les informations du webhook
            let repoUrl = null;
            let branch = 'main';

            // GitHub
            if (body.repository?.clone_url) {
                repoUrl = body.repository.clone_url;
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            }
            // GitLab
            else if (body.project?.git_http_url) {
                repoUrl = body.project.git_http_url;
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            }
            // Gitea
            else if (body.repository?.html_url) {
                repoUrl = body.repository.html_url + '.git';
                branch = body.ref?.replace('refs/heads/', '') || 'main';
            }

            if (!repoUrl) {
                sendError(res, 'Could not extract repository URL', 400);
                return;
            }

            const build = queue.add({
                repoUrl,
                branch,
                framework: 'auto',
                buildType: 'release'
            });

            sendJson(res, { message: 'Build triggered', build }, 201);
            return;
        }

        // GET /api/stats - Statistiques
        if (method === 'GET' && pathname === '/api/stats') {
            const stats = queue.getStats();
            sendJson(res, stats);
            return;
        }

        // GET /api/health - Santé + vérification outils
        if (method === 'GET' && pathname === '/api/health') {
            const tools = await builder.checkTools();
            const tunnelStatus = tunnel.getStatus();

            sendJson(res, {
                status: 'ok',
                version: '1.0.0',
                uptime: process.uptime(),
                platform: process.platform,
                nodeVersion: process.version,
                tools,
                tunnel: tunnelStatus
            });
            return;
        }

        // GET /api/tunnel/status - Statut du tunnel
        if (method === 'GET' && pathname === '/api/tunnel/status') {
            sendJson(res, tunnel.getStatus());
            return;
        }

        // POST /api/tunnel/reconnect - Reconnecter le tunnel
        if (method === 'POST' && pathname === '/api/tunnel/reconnect') {
            tunnel.disconnect();
            tunnel.connect();
            sendJson(res, { message: 'Reconnection initiated' });
            return;
        }

        // === FICHIERS STATIQUES ===

        const webDir = path.join(__dirname, '..', 'web');
        let filePath = pathname === '/' ? '/index.html' : pathname;
        filePath = path.join(webDir, filePath);

        // Sécurité: empêcher la traversée de répertoire
        if (!filePath.startsWith(webDir)) {
            sendError(res, 'Forbidden', 403);
            return;
        }

        serveStatic(req, res, filePath);

    } catch (err) {
        console.error('[Server] Erreur:', err.message);
        sendError(res, err.message, 500);
    }
}

// Créer le serveur
const server = http.createServer(handleRequest);

// Démarrer le serveur
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

    // Connecter le tunnel si activé
    if (config.tunnel?.enabled) {
        tunnel.connect();
    }
});

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
    console.log('\n[Server] Arrêt en cours...');
    tunnel.disconnect();
    server.close(() => {
        console.log('[Server] Arrêté');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    tunnel.disconnect();
    server.close(() => {
        process.exit(0);
    });
});
