/**
 * Synthesics2 - Database Module
 * Gestion des utilisateurs, sessions, messages et annonces
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class Database {
    constructor(config) {
        this.config = config;
        this.dbPath = path.resolve(config.storage?.database || './storage/database');
        this.usersFile = path.join(this.dbPath, 'users.json');
        this.sessionsFile = path.join(this.dbPath, 'sessions.json');
        this.logsFile = path.join(this.dbPath, 'auth_logs.json');
        this.messagesFile = path.join(this.dbPath, 'messages.json');
        this.announcementsFile = path.join(this.dbPath, 'announcements.json');

        this.users = [];
        this.sessions = {};
        this.authLogs = [];
        this.messages = [];
        this.announcements = [];

        this.init();
    }

    init() {
        // Créer le dossier database
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(this.dbPath, { recursive: true });
        }

        // Charger les données existantes
        this.loadData();

        // Créer l'admin par défaut si aucun utilisateur
        if (this.users.length === 0) {
            this.createDefaultAdmin();
        }

        console.log('[Database] Initialisée avec', this.users.length, 'utilisateur(s)');
    }

    loadData() {
        try {
            if (fs.existsSync(this.usersFile)) {
                this.users = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
            }
        } catch (err) {
            console.error('[Database] Erreur chargement users:', err.message);
            this.users = [];
        }

        try {
            if (fs.existsSync(this.sessionsFile)) {
                this.sessions = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
                this.cleanExpiredSessions();
            }
        } catch (err) {
            console.error('[Database] Erreur chargement sessions:', err.message);
            this.sessions = {};
        }

        try {
            if (fs.existsSync(this.logsFile)) {
                this.authLogs = JSON.parse(fs.readFileSync(this.logsFile, 'utf8'));
            }
        } catch (err) {
            this.authLogs = [];
        }

        try {
            if (fs.existsSync(this.messagesFile)) {
                this.messages = JSON.parse(fs.readFileSync(this.messagesFile, 'utf8'));
            }
        } catch (err) {
            this.messages = [];
        }

        try {
            if (fs.existsSync(this.announcementsFile)) {
                this.announcements = JSON.parse(fs.readFileSync(this.announcementsFile, 'utf8'));
            }
        } catch (err) {
            this.announcements = [];
        }
    }

    saveUsers() {
        fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
    }

    saveSessions() {
        fs.writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
    }

    saveLogs() {
        if (this.authLogs.length > 1000) {
            this.authLogs = this.authLogs.slice(-1000);
        }
        fs.writeFileSync(this.logsFile, JSON.stringify(this.authLogs, null, 2));
    }

    saveMessages() {
        fs.writeFileSync(this.messagesFile, JSON.stringify(this.messages, null, 2));
    }

    saveAnnouncements() {
        fs.writeFileSync(this.announcementsFile, JSON.stringify(this.announcements, null, 2));
    }

    createDefaultAdmin() {
        const defaultPassword = 'admin123';
        const user = {
            id: this.generateId(),
            username: 'admin',
            email: 'admin@synthesics.local',
            password: this.hashPassword(defaultPassword),
            role: 'admin',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            lastLogout: null,
            isOnline: false
        };

        this.users.push(user);
        this.saveUsers();

        console.log('[Database] Admin par défaut créé:');
        console.log('           Username: admin');
        console.log('           Password: admin123');
        console.log('           (Changez ce mot de passe!)');
    }

    generateId() {
        return crypto.randomBytes(16).toString('hex');
    }

    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
        return `${salt}:${hash}`;
    }

    verifyPassword(password, stored) {
        const [salt, hash] = stored.split(':');
        const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
        return hash === verifyHash;
    }

    cleanExpiredSessions() {
        const now = Date.now();
        const sessionDuration = (this.config.auth?.sessionDuration || 24) * 60 * 60 * 1000;

        for (const token in this.sessions) {
            const session = this.sessions[token];
            if (now - new Date(session.createdAt).getTime() > sessionDuration) {
                delete this.sessions[token];
            }
        }

        this.saveSessions();
    }

    addLog(action, userId, username, ip, details = {}) {
        this.authLogs.push({
            id: this.generateId(),
            action,
            userId,
            username,
            ip,
            details,
            timestamp: new Date().toISOString()
        });
        this.saveLogs();
    }

    // === USER OPERATIONS ===

    register(username, email, password) {
        if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error('Ce nom d\'utilisateur existe déjà');
        }

        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            throw new Error('Cet email est déjà utilisé');
        }

        if (username.length < 3) {
            throw new Error('Le nom d\'utilisateur doit contenir au moins 3 caractères');
        }
        if (password.length < 6) {
            throw new Error('Le mot de passe doit contenir au moins 6 caractères');
        }
        if (!email.includes('@')) {
            throw new Error('Email invalide');
        }

        const user = {
            id: this.generateId(),
            username,
            email: email.toLowerCase(),
            password: this.hashPassword(password),
            role: 'user',
            createdAt: new Date().toISOString(),
            lastLogin: null,
            lastLogout: null,
            isOnline: false
        };

        this.users.push(user);
        this.saveUsers();

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt
        };
    }

    login(username, password, ip = 'unknown') {
        const user = this.users.find(u =>
            u.username.toLowerCase() === username.toLowerCase() ||
            u.email.toLowerCase() === username.toLowerCase()
        );

        if (!user) {
            this.addLog('login_failed', null, username, ip, { reason: 'user_not_found' });
            throw new Error('Identifiants incorrects');
        }

        if (!this.verifyPassword(password, user.password)) {
            this.addLog('login_failed', user.id, username, ip, { reason: 'wrong_password' });
            throw new Error('Identifiants incorrects');
        }

        // Créer la session
        const token = this.generateToken();
        this.sessions[token] = {
            userId: user.id,
            createdAt: new Date().toISOString(),
            ip
        };
        this.saveSessions();

        // Mettre à jour lastLogin et isOnline
        user.lastLogin = new Date().toISOString();
        user.isOnline = true;
        this.saveUsers();

        this.addLog('login_success', user.id, user.username, ip);

        return {
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        };
    }

    logout(token) {
        if (this.sessions[token]) {
            const session = this.sessions[token];
            const user = this.users.find(u => u.id === session.userId);

            if (user) {
                user.lastLogout = new Date().toISOString();
                user.isOnline = false;
                this.saveUsers();
                this.addLog('logout', session.userId, user.username, session.ip);
            }

            delete this.sessions[token];
            this.saveSessions();
            return true;
        }
        return false;
    }

    getSession(token) {
        this.cleanExpiredSessions();

        const session = this.sessions[token];
        if (!session) {
            return null;
        }

        const user = this.users.find(u => u.id === session.userId);
        if (!user) {
            delete this.sessions[token];
            this.saveSessions();
            return null;
        }

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        };
    }

    // === ADMIN OPERATIONS ===

    getAllUsers() {
        return this.users.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
            lastLogin: u.lastLogin,
            lastLogout: u.lastLogout,
            isOnline: u.isOnline || false
        }));
    }

    getUser(id) {
        const user = this.users.find(u => u.id === id);
        if (!user) return null;

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            lastLogout: user.lastLogout,
            isOnline: user.isOnline || false
        };
    }

    getUserActivity(userId) {
        const logs = this.authLogs.filter(l => l.userId === userId);
        return logs.slice(-50).reverse();
    }

    updateUserRole(id, role, adminId) {
        const user = this.users.find(u => u.id === id);
        if (!user) {
            throw new Error('Utilisateur non trouvé');
        }

        if (!['user', 'admin'].includes(role)) {
            throw new Error('Rôle invalide');
        }

        if (user.id === adminId && role !== 'admin') {
            throw new Error('Vous ne pouvez pas retirer vos propres droits admin');
        }

        const oldRole = user.role;
        user.role = role;
        this.saveUsers();

        const admin = this.users.find(u => u.id === adminId);
        this.addLog('role_change', user.id, user.username, 'admin', {
            oldRole,
            newRole: role,
            changedBy: admin?.username
        });

        return this.getUser(id);
    }

    deleteUser(id, adminId) {
        const userIndex = this.users.findIndex(u => u.id === id);
        if (userIndex === -1) {
            throw new Error('Utilisateur non trouvé');
        }

        const user = this.users[userIndex];

        if (user.id === adminId) {
            throw new Error('Vous ne pouvez pas supprimer votre propre compte');
        }

        // Supprimer les sessions de l'utilisateur
        for (const token in this.sessions) {
            if (this.sessions[token].userId === id) {
                delete this.sessions[token];
            }
        }
        this.saveSessions();

        // Supprimer les messages de l'utilisateur
        this.messages = this.messages.filter(m => m.fromId !== id && m.toId !== id);
        this.saveMessages();

        this.users.splice(userIndex, 1);
        this.saveUsers();

        const admin = this.users.find(u => u.id === adminId);
        this.addLog('user_deleted', id, user.username, 'admin', {
            deletedBy: admin?.username
        });

        return true;
    }

    changePassword(userId, oldPassword, newPassword) {
        const user = this.users.find(u => u.id === userId);
        if (!user) {
            throw new Error('Utilisateur non trouvé');
        }

        if (!this.verifyPassword(oldPassword, user.password)) {
            throw new Error('Ancien mot de passe incorrect');
        }

        if (newPassword.length < 6) {
            throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères');
        }

        user.password = this.hashPassword(newPassword);
        this.saveUsers();

        this.addLog('password_change', userId, user.username, 'user');

        return true;
    }

    // === MESSAGES ===

    sendMessage(fromId, toId, content) {
        const from = this.users.find(u => u.id === fromId);
        const to = this.users.find(u => u.id === toId);

        if (!from || !to) {
            throw new Error('Utilisateur non trouvé');
        }

        const message = {
            id: this.generateId(),
            fromId,
            fromUsername: from.username,
            toId,
            toUsername: to.username,
            content,
            read: false,
            createdAt: new Date().toISOString()
        };

        this.messages.push(message);
        this.saveMessages();

        return message;
    }

    getMessages(userId, otherUserId = null) {
        let msgs = this.messages.filter(m =>
            m.fromId === userId || m.toId === userId
        );

        if (otherUserId) {
            msgs = msgs.filter(m =>
                (m.fromId === userId && m.toId === otherUserId) ||
                (m.fromId === otherUserId && m.toId === userId)
            );
        }

        return msgs.slice(-100);
    }

    getUnreadCount(userId) {
        return this.messages.filter(m => m.toId === userId && !m.read).length;
    }

    markAsRead(userId, messageIds) {
        this.messages.forEach(m => {
            if (m.toId === userId && messageIds.includes(m.id)) {
                m.read = true;
            }
        });
        this.saveMessages();
    }

    getConversations(userId) {
        const conversations = {};

        this.messages.forEach(m => {
            if (m.fromId === userId || m.toId === userId) {
                const otherId = m.fromId === userId ? m.toId : m.fromId;
                const otherUsername = m.fromId === userId ? m.toUsername : m.fromUsername;

                if (!conversations[otherId]) {
                    conversations[otherId] = {
                        userId: otherId,
                        username: otherUsername,
                        lastMessage: m,
                        unread: 0
                    };
                } else {
                    conversations[otherId].lastMessage = m;
                }

                if (m.toId === userId && !m.read) {
                    conversations[otherId].unread++;
                }
            }
        });

        return Object.values(conversations).sort((a, b) =>
            new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt)
        );
    }

    // === ANNOUNCEMENTS ===

    createAnnouncement(adminId, title, content, type = 'info') {
        const admin = this.users.find(u => u.id === adminId);
        if (!admin || admin.role !== 'admin') {
            throw new Error('Non autorisé');
        }

        const announcement = {
            id: this.generateId(),
            title,
            content,
            type, // info, warning, success, danger
            authorId: adminId,
            authorUsername: admin.username,
            active: true,
            createdAt: new Date().toISOString()
        };

        this.announcements.push(announcement);
        this.saveAnnouncements();

        return announcement;
    }

    getAnnouncements(activeOnly = true) {
        let result = [...this.announcements].reverse();
        if (activeOnly) {
            result = result.filter(a => a.active);
        }
        return result;
    }

    deleteAnnouncement(id, adminId) {
        const index = this.announcements.findIndex(a => a.id === id);
        if (index === -1) {
            throw new Error('Annonce non trouvée');
        }

        this.announcements.splice(index, 1);
        this.saveAnnouncements();
        return true;
    }

    toggleAnnouncement(id, adminId) {
        const announcement = this.announcements.find(a => a.id === id);
        if (!announcement) {
            throw new Error('Annonce non trouvée');
        }

        announcement.active = !announcement.active;
        this.saveAnnouncements();
        return announcement;
    }

    // === LOGS ===

    getLogs(options = {}) {
        const { limit = 100, offset = 0, action, userId } = options;

        let logs = [...this.authLogs].reverse();

        if (action) {
            logs = logs.filter(l => l.action === action);
        }
        if (userId) {
            logs = logs.filter(l => l.userId === userId);
        }

        return {
            logs: logs.slice(offset, offset + limit),
            total: logs.length
        };
    }

    clearLogs() {
        this.authLogs = [];
        this.saveLogs();
        return true;
    }

    // === SYSTEM MONITORING ===

    getSystemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // Calculer l'utilisation CPU moyenne
        let totalIdle = 0;
        let totalTick = 0;

        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });

        const cpuUsage = 100 - Math.round(100 * totalIdle / totalTick);

        return {
            cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
                usage: cpuUsage
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usagePercent: Math.round((usedMem / totalMem) * 100)
            },
            os: {
                platform: os.platform(),
                release: os.release(),
                hostname: os.hostname(),
                uptime: os.uptime()
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage()
            }
        };
    }

    // === STORAGE STATS ===

    getStorageStats() {
        const storageDir = path.resolve(this.config.storage?.builds || './storage');

        const getDirSize = (dirPath) => {
            if (!fs.existsSync(dirPath)) return 0;

            let size = 0;
            const files = fs.readdirSync(dirPath);

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);

                if (stat.isDirectory()) {
                    size += getDirSize(filePath);
                } else {
                    size += stat.size;
                }
            }

            return size;
        };

        const countFiles = (dirPath) => {
            if (!fs.existsSync(dirPath)) return 0;

            let count = 0;
            const files = fs.readdirSync(dirPath);

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);

                if (stat.isDirectory()) {
                    count += countFiles(filePath);
                } else {
                    count++;
                }
            }

            return count;
        };

        const apksDir = path.resolve(this.config.storage?.apks || './storage/apks');
        const logsDir = path.resolve(this.config.storage?.logs || './storage/logs');
        const reposDir = path.resolve(this.config.storage?.repos || './storage/repos');

        return {
            apks: {
                size: getDirSize(apksDir),
                count: countFiles(apksDir)
            },
            logs: {
                size: getDirSize(logsDir),
                count: countFiles(logsDir)
            },
            repos: {
                size: getDirSize(reposDir),
                count: countFiles(reposDir)
            },
            database: {
                size: getDirSize(this.dbPath),
                users: this.users.length,
                sessions: Object.keys(this.sessions).length,
                messages: this.messages.length,
                announcements: this.announcements.length
            }
        };
    }

    clearStorage(type) {
        const dirs = {
            apks: path.resolve(this.config.storage?.apks || './storage/apks'),
            logs: path.resolve(this.config.storage?.logs || './storage/logs'),
            repos: path.resolve(this.config.storage?.repos || './storage/repos')
        };

        const dirPath = dirs[type];
        if (!dirPath || !fs.existsSync(dirPath)) {
            throw new Error('Type de stockage invalide');
        }

        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            fs.rmSync(filePath, { recursive: true, force: true });
        }

        return true;
    }
}

module.exports = Database;
