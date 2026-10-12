/**
 * network-routes.js — معلومات الشبكة والعملاء المتصلون (مُستخلص من server.js)
 * SECURITY: طوبولوجيا الشبكة (كل عناوين LAN) وأسماء الأجهزة خلف JWT —
 * كان يُقرأ بمفتاح التطبيق وحده، والمفتاح يوزع على كل عميل بعد تسجيل الدخول.
 * عميل الاكتشاف (EXE) يقرأ /api/server/info العامة — لا يحتاج هذه المسارات.
 */
const os = require('os');
const { jwtAuth } = require('./cashier-module/jwt-middleware');

function register(app, opts = {}) {
    const { connectedClients, PORT } = opts;

    app.get('/api/network-info', jwtAuth, (req, res) => {
        const nets = os.networkInterfaces();
        const results = {};
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    if (!results[name]) {results[name] = [];}
                    results[name].push(net.address);
                }
            }
        }
        res.json({
            ips: results,
            port: PORT,
            urls: Object.values(results).flat().map(ip => `http://${ip}:${PORT}`),
            connectedClients: connectedClients.size,
        });
    });

    app.get('/api/clients', jwtAuth, (req, res) => {
        res.json({
            count: connectedClients.size,
            clients: Array.from(connectedClients.values()).map(c => ({
                deviceName: c.deviceName,
                ip: c.ip,
                joinedAt: c.joinedAt,
            })),
        });
    });
}

module.exports = { register };
