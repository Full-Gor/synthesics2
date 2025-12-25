/**
 * Synthesics2 - NexusTunnel Client
 * Client WebSocket pour exposer le serveur local via le VPS
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class TunnelClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config.tunnel;
        this.localPort = config.server?.port || 3001;
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.pendingRequests = new Map();
    }

    /**
     * Génère un ID unique pour les messages
     */
    _generateId() {
        return crypto.randomUUID();
    }

    /**
     * Crée un message au format NexusTunnel
     */
    _createMessage(type, payload = {}) {
        return {
            type,
            id: this._generateId(),
            timestamp: Date.now(),
            payload
        };
    }

    /**
     * Envoie un message au serveur
     */
    _send(type, payload = {}, requestId = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log(`[Tunnel] ERREUR: WebSocket non ouvert, impossible d'envoyer ${type}`);
            return;
        }

        // Pour les réponses HTTP, utiliser le MÊME id que la requête
        const message = {
            type,
            id: requestId || this._generateId(),
            timestamp: Date.now(),
            payload
        };

        if (type.startsWith('http_')) {
            console.log(`[Tunnel] Envoi ${type} (${message.id.substring(0,12)})`);
        }
        this.ws.send(JSON.stringify(message));
    }

    /**
     * Établit la connexion WebSocket
     */
    connect() {
        if (!this.config?.enabled) {
            console.log('[Tunnel] Tunnel désactivé dans la config');
            return;
        }

        const { host, port } = this.config.server;
        const protocol = this.config.server.tls !== false ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${host}:${port}/tunnel`;

        console.log(`[Tunnel] Connexion à ${wsUrl}...`);

        this.ws = new WebSocket(wsUrl, {
            rejectUnauthorized: this.config.server.rejectUnauthorized !== false
        });

        this.ws.on('open', () => {
            console.log('[Tunnel] WebSocket connecté, attente du challenge...');
            this.connected = true;
            this.reconnectAttempts = 0;
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this._handleMessage(message);
            } catch (err) {
                console.error('[Tunnel] Erreur parsing message:', err.message);
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(`[Tunnel] Connexion fermée (${code}): ${reason || 'pas de raison'}`);
            this.connected = false;
            this.authenticated = false;
            this._stopPing();
            this._scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error('[Tunnel] Erreur WebSocket:', err.message);
        });
    }

    /**
     * Gère les messages reçus
     */
    _handleMessage(message) {
        const { type, id, payload } = message;

        // Debug: afficher tous les messages reçus
        console.log('[Tunnel] Message reçu:', type, id ? `(${id.substring(0,8)})` : '');

        switch (type) {
            case 'auth_challenge':
                this._handleAuthChallenge(payload);
                break;

            case 'auth_result':
            case 'auth_response':
                // Le serveur peut répondre avec auth_result ou auth_response
                if (payload.success !== undefined) {
                    this._handleAuthResult(payload);
                }
                break;

            case 'tunnel_registered':
                console.log('[Tunnel] Tunnels enregistrés:', payload.domains?.join(', '));
                this.emit('registered', payload);
                break;

            case 'tunnel_error':
                console.error('[Tunnel] Erreur tunnel:', payload.message);
                break;

            case 'http_request':
                this._handleHttpRequest(id, payload);
                break;

            case 'http_data':
                this._handleHttpData(id, payload);
                break;

            case 'http_end':
                this._handleHttpEnd(id);
                break;

            case 'pong':
                // Réponse au ping
                break;

            default:
                console.log('[Tunnel] Message inconnu:', type);
        }
    }

    /**
     * Gère le challenge d'authentification
     */
    _handleAuthChallenge(payload) {
        const { challenge } = payload;
        const clientId = this.config.auth.id;
        const psk = this.config.auth.key;

        console.log('[Tunnel] Challenge reçu, envoi de la réponse...');

        // Calcul HMAC: challenge + clientId
        const hmac = crypto.createHmac('sha256', psk);
        hmac.update(challenge + clientId);
        const response = hmac.digest('hex');

        this._send('auth_response', {
            clientId,
            response
        });
    }

    /**
     * Gère le résultat de l'authentification
     */
    _handleAuthResult(payload) {
        if (payload.success) {
            console.log('[Tunnel] Authentification réussie');
            this.authenticated = true;
            this._startPing();
            this._registerTunnels();
            this.emit('authenticated');
        } else {
            console.error('[Tunnel] Authentification échouée:', payload.message);
            this.ws.close();
        }
    }

    /**
     * Enregistre les tunnels
     */
    _registerTunnels() {
        const domains = this.config.tunnels.map(t => t.domain);
        console.log('[Tunnel] Enregistrement des domaines:', domains.join(', '));

        this._send('tunnel_register', { domains });
    }

    /**
     * Gère une requête HTTP entrante
     */
    _handleHttpRequest(requestId, payload) {
        const { method, url, headers, hasBody } = payload;

        console.log(`[Tunnel] HTTP ${method} ${url}`);
        console.log(`[Tunnel] Headers reçus:`, JSON.stringify(headers, null, 2));

        // Trouver le tunnel correspondant (le VPS envoie x-forwarded-host)
        const host = headers.host || headers.Host || headers['x-forwarded-host'];
        const tunnel = this.config.tunnels.find(t => t.domain === host);
        const localHost = tunnel?.localHost || 'localhost';
        const localPort = tunnel?.localPort || this.localPort;

        console.log(`[Tunnel] Proxy vers ${localHost}:${localPort}`);

        // Créer la requête locale
        const options = {
            hostname: localHost,
            port: localPort,
            method,
            path: url,
            headers: { ...headers, host: `${localHost}:${localPort}` }
        };

        const proxyReq = http.request(options, (proxyRes) => {
            console.log(`[Tunnel] Réponse locale: ${proxyRes.statusCode}`);
            // Envoyer la réponse HTTP avec le MÊME requestId
            this._send('http_response', {
                statusCode: proxyRes.statusCode,
                statusMessage: proxyRes.statusMessage,
                headers: proxyRes.headers
            }, requestId);

            // Streamer le body de la réponse
            proxyRes.on('data', (chunk) => {
                this._send('http_data', {
                    data: chunk.toString('base64')
                }, requestId);
            });

            proxyRes.on('end', () => {
                this._send('http_end', {}, requestId);
            });
        });

        proxyReq.on('error', (err) => {
            console.error(`[Tunnel] Erreur proxy (${requestId}):`, err.message);
            this._send('http_error', {
                message: err.message
            }, requestId);
        });

        // Stocker la requête pour recevoir le body
        if (hasBody) {
            this.pendingRequests.set(requestId, proxyReq);
        } else {
            proxyReq.end();
        }
    }

    /**
     * Gère les données HTTP entrantes
     */
    _handleHttpData(requestId, payload) {
        const proxyReq = this.pendingRequests.get(requestId);
        if (proxyReq && payload.data) {
            proxyReq.write(Buffer.from(payload.data, 'base64'));
        }
    }

    /**
     * Gère la fin des données HTTP
     */
    _handleHttpEnd(requestId) {
        const proxyReq = this.pendingRequests.get(requestId);
        if (proxyReq) {
            proxyReq.end();
            this.pendingRequests.delete(requestId);
        }
    }

    /**
     * Démarre le ping périodique
     */
    _startPing() {
        this._stopPing();
        this.pingInterval = setInterval(() => {
            if (this.connected && this.authenticated) {
                this._send('ping', {});
            }
        }, 30000);
    }

    /**
     * Arrête le ping
     */
    _stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Planifie une reconnexion
     */
    _scheduleReconnect() {
        if (!this.config?.reconnect?.enabled) return;

        const { delay, maxDelay, multiplier } = this.config.reconnect;
        const waitTime = Math.min(
            delay * Math.pow(multiplier || 2, this.reconnectAttempts),
            maxDelay || 30000
        );

        this.reconnectAttempts++;

        console.log(`[Tunnel] Reconnexion dans ${waitTime / 1000}s (tentative ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, waitTime);
    }

    /**
     * Déconnecte le tunnel
     */
    disconnect() {
        this._stopPing();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this._send('disconnect', {});
            this.ws.close();
            this.ws = null;
        }

        this.connected = false;
        this.authenticated = false;
        console.log('[Tunnel] Déconnecté');
    }

    /**
     * Retourne le statut du tunnel
     */
    getStatus() {
        return {
            enabled: this.config?.enabled || false,
            connected: this.connected,
            authenticated: this.authenticated,
            server: this.config?.server?.host || null,
            domains: this.config?.tunnels?.map(t => t.domain) || [],
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

module.exports = TunnelClient;
