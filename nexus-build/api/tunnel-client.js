/**
 * Synthesics2 - NexusTunnel Client
 * Client WebSocket pour exposer le serveur local via le VPS
 */

const https = require('https');
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
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.pendingRequests = new Map();
    }

    /**
     * Génère la signature HMAC pour l'authentification
     */
    _generateAuth() {
        const timestamp = Date.now().toString();
        const clientId = this.config.auth.id;
        const key = this.config.auth.key;

        const hmac = crypto.createHmac('sha256', key);
        hmac.update(`${clientId}:${timestamp}`);
        const signature = hmac.digest('hex');

        return {
            clientId,
            timestamp,
            signature
        };
    }

    /**
     * Établit la connexion WebSocket
     */
    connect() {
        if (!this.config?.enabled) {
            console.log('[Tunnel] Tunnel désactivé dans la config');
            return;
        }

        const { host, port, tls } = this.config.server;
        const protocol = tls ? 'wss' : 'ws';
        const auth = this._generateAuth();

        // Construire l'URL avec les paramètres d'auth
        const tunnelDomains = this.config.tunnels.map(t => t.domain).join(',');
        const wsUrl = `${protocol}://${host}:${port}/tunnel?` +
            `clientId=${encodeURIComponent(auth.clientId)}` +
            `&timestamp=${auth.timestamp}` +
            `&signature=${auth.signature}` +
            `&domains=${encodeURIComponent(tunnelDomains)}`;

        console.log(`[Tunnel] Connexion à ${host}:${port}...`);

        // Utiliser le module WebSocket natif via une implémentation simple
        this._connectWebSocket(wsUrl);
    }

    /**
     * Implémentation WebSocket simple avec les modules natifs
     */
    _connectWebSocket(url) {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'wss:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
                'Sec-WebSocket-Version': '13'
            },
            rejectUnauthorized: this.config.server.rejectUnauthorized !== false
        };

        const protocol = parsedUrl.protocol === 'wss:' ? https : http;

        const req = protocol.request(options);

        req.on('upgrade', (res, socket, head) => {
            console.log('[Tunnel] Connexion WebSocket établie');
            this.connected = true;
            this.reconnectAttempts = 0;
            this.ws = socket;

            // Configurer le socket
            socket.setKeepAlive(true, 30000);

            // Buffer pour les données partielles
            let buffer = Buffer.alloc(0);

            socket.on('data', (data) => {
                buffer = Buffer.concat([buffer, data]);
                this._processBuffer(buffer, (remaining) => {
                    buffer = remaining;
                });
            });

            socket.on('close', () => {
                console.log('[Tunnel] Connexion fermée');
                this.connected = false;
                this._scheduleReconnect();
            });

            socket.on('error', (err) => {
                console.error('[Tunnel] Erreur socket:', err.message);
                this.connected = false;
                this._scheduleReconnect();
            });

            // Démarrer le ping
            this._startPing();

            // Envoyer le message d'enregistrement
            this._sendMessage({
                type: 'register',
                clientId: this.config.auth.id,
                tunnels: this.config.tunnels
            });

            this.emit('connected');
        });

        req.on('error', (err) => {
            console.error('[Tunnel] Erreur connexion:', err.message);
            this._scheduleReconnect();
        });

        req.on('response', (res) => {
            console.error(`[Tunnel] Échec upgrade HTTP: ${res.statusCode}`);
            this._scheduleReconnect();
        });

        req.end();
    }

    /**
     * Traite le buffer de données reçues
     */
    _processBuffer(buffer, callback) {
        // Format simple: 4 bytes de longueur + données JSON
        while (buffer.length >= 4) {
            const length = buffer.readUInt32BE(0);

            if (buffer.length < 4 + length) {
                break; // Données incomplètes
            }

            const data = buffer.slice(4, 4 + length);
            buffer = buffer.slice(4 + length);

            try {
                const message = JSON.parse(data.toString('utf8'));
                this._handleMessage(message);
            } catch (err) {
                console.error('[Tunnel] Erreur parsing message:', err.message);
            }
        }

        callback(buffer);
    }

    /**
     * Envoie un message WebSocket
     */
    _sendMessage(data) {
        if (!this.ws || !this.connected) return;

        try {
            const json = JSON.stringify(data);
            const payload = Buffer.from(json, 'utf8');
            const header = Buffer.alloc(4);
            header.writeUInt32BE(payload.length, 0);

            // Encoder en frame WebSocket
            const frame = this._encodeWebSocketFrame(Buffer.concat([header, payload]));
            this.ws.write(frame);
        } catch (err) {
            console.error('[Tunnel] Erreur envoi:', err.message);
        }
    }

    /**
     * Encode une frame WebSocket
     */
    _encodeWebSocketFrame(data) {
        const length = data.length;
        let header;

        if (length < 126) {
            header = Buffer.alloc(6);
            header[0] = 0x82; // Binary frame, FIN
            header[1] = 0x80 | length; // Masked
        } else if (length < 65536) {
            header = Buffer.alloc(8);
            header[0] = 0x82;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(length, 2);
        } else {
            header = Buffer.alloc(14);
            header[0] = 0x82;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(length), 2);
        }

        // Masque
        const mask = crypto.randomBytes(4);
        const maskedData = Buffer.alloc(length);

        for (let i = 0; i < length; i++) {
            maskedData[i] = data[i] ^ mask[i % 4];
        }

        // Position du masque
        const maskOffset = header[1] === (0x80 | 126) ? 4 :
            header[1] === (0x80 | 127) ? 10 : 2;
        mask.copy(header, maskOffset);

        return Buffer.concat([header, maskedData]);
    }

    /**
     * Gère les messages reçus
     */
    _handleMessage(message) {
        switch (message.type) {
            case 'registered':
                console.log('[Tunnel] Enregistré avec succès');
                console.log(`[Tunnel] Domaines: ${message.domains?.join(', ')}`);
                this.emit('registered', message);
                break;

            case 'request':
                this._handleHttpRequest(message);
                break;

            case 'pong':
                // Réponse au ping
                break;

            case 'error':
                console.error('[Tunnel] Erreur serveur:', message.message);
                break;

            default:
                console.log('[Tunnel] Message inconnu:', message.type);
        }
    }

    /**
     * Gère une requête HTTP tunnelée
     */
    _handleHttpRequest(message) {
        const { requestId, method, path, headers, body } = message;

        const tunnel = this.config.tunnels.find(t => t.domain === message.host);
        const localHost = tunnel?.localHost || 'localhost';
        const localPort = tunnel?.localPort || this.localPort;

        const options = {
            hostname: localHost,
            port: localPort,
            method: method,
            path: path,
            headers: headers
        };

        const req = http.request(options, (res) => {
            let responseBody = [];

            res.on('data', (chunk) => {
                responseBody.push(chunk);
            });

            res.on('end', () => {
                this._sendMessage({
                    type: 'response',
                    requestId,
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(responseBody).toString('base64')
                });
            });
        });

        req.on('error', (err) => {
            console.error(`[Tunnel] Erreur requête locale: ${err.message}`);
            this._sendMessage({
                type: 'response',
                requestId,
                statusCode: 502,
                headers: { 'Content-Type': 'text/plain' },
                body: Buffer.from(`Bad Gateway: ${err.message}`).toString('base64')
            });
        });

        if (body) {
            req.write(Buffer.from(body, 'base64'));
        }

        req.end();
    }

    /**
     * Démarre le ping périodique
     */
    _startPing() {
        this._stopPing();

        this.pingInterval = setInterval(() => {
            if (this.connected) {
                this._sendMessage({ type: 'ping' });
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

        this._stopPing();

        const { delay, maxDelay, multiplier } = this.config.reconnect;
        const waitTime = Math.min(
            delay * Math.pow(multiplier, this.reconnectAttempts),
            maxDelay
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
            this.ws.destroy();
            this.ws = null;
        }

        this.connected = false;
        console.log('[Tunnel] Déconnecté');
    }

    /**
     * Retourne le statut du tunnel
     */
    getStatus() {
        return {
            enabled: this.config?.enabled || false,
            connected: this.connected,
            server: this.config?.server?.host || null,
            domains: this.config?.tunnels?.map(t => t.domain) || [],
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

module.exports = TunnelClient;
