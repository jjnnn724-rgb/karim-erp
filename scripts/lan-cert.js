/**
 * scripts/lan-cert.js — شهادة HTTPS تلقائية لأي جهاز يشغّل النظام
 * ────────────────────────────────────────────────────────────────────
 * عند الإقلاع: يقرأ اسم الجهاز وعناوين الشبكة — إن كانت الشهادة الحالية
 * لا تغطيها يعيد توليدها فورًا بـ mkcert المضمّن في المشروع (بلا إنترنت،
 * بلا صلاحيات أدمن) موقّعة بـ CA المشروع نفسه، ويحدّث شهادة العملاء.
 * الاستخدام: require('./lan-cert').ensure()  |  node scripts/lan-cert.js
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { logger } = require('../backend/logger');

const ROOT = path.resolve(__dirname, '..');
const MKCERT = path.join(ROOT, 'tools', 'mkcert', 'mkcert.exe');
const CAROOT = path.join(ROOT, 'tools', 'mkcert', 'CA');
const CERT_DIR = 'C:/HorusData/certs';
const CERT = path.join(CERT_DIR, 'karim-erp-lan.pem');
const KEY = path.join(CERT_DIR, 'karim-erp-lan-key.pem');
const META = path.join(CERT_DIR, 'karim-erp-lan.meta.json');
const CLIENT_CA = path.join(CERT_DIR, 'Karim-Local-CA.crt');

function lanIPv4s() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)) {
                out.push({ name, addr: i.address });
            }
        }
    }
    return out;
}

function requiredSans() {
    const host = (os.hostname() || 'pc').toLowerCase();
    const sans = ['localhost', '127.0.0.1', '::1', host, `${host}.local`, 'karim-erp.local'];
    for (const { addr } of lanIPv4s()) {sans.push(addr);}
    return [...new Set(sans)];
}

function currentCertSans() {
    try {
        const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
        return Array.isArray(meta.sans) ? meta.sans : null;
    } catch (_) {return null;}
}

function sameSet(a, b) {
    if (!a || !b || a.length !== b.length) {return false;}
    const sa = [...a].sort(), sb = [...b].sort();
    return sa.every((x, i) => x === sb[i]);
}

function ensure() {
    if (!fs.existsSync(MKCERT)) {
        logger.warn('[LAN-CERT] mkcert.exe غير مضمّن في tools/mkcert — تخطي توليد الشهادة');
        return { skipped: 'no-mkcert' };
    }
    if (!fs.existsSync(path.join(CAROOT, 'rootCA.pem')) || !fs.existsSync(path.join(CAROOT, 'rootCA-key.pem'))) {
        logger.warn('[LAN-CERT] ملفات CA المشروع غير موجودة — تخطي');
        return { skipped: 'no-ca' };
    }
    fs.mkdirSync(CERT_DIR, { recursive: true });

    // شهادة العملاء تُحدَّث دائمًا من CA المشروع (توزيع متسق)
    try { fs.copyFileSync(path.join(CAROOT, 'rootCA.pem'), CLIENT_CA); } catch (_) {}

    const sans = requiredSans();
    const prev = currentCertSans();
    const need = !fs.existsSync(CERT) || !fs.existsSync(KEY) || !prev || !sameSet(prev, sans);
    if (!need) {return { ok: true, reused: true, sans };}

    const args = ['-cert-file', CERT, '-key-file', KEY, ...sans];
    const env = { ...process.env, CAROOT };
    try {
        execFileSync(MKCERT, args, { env, stdio: 'pipe', timeout: 30000 });
        fs.writeFileSync(META, JSON.stringify({ sans, generatedAt: new Date().toISOString(), host: os.hostname() }, null, 1));
        logger.info(`[LAN-CERT] شهادة جديدة لأسماء/عناوين هذا الجهاز: ${sans.join(', ')}`);
        return { ok: true, regenerated: true, sans };
    } catch (e) {
        logger.warn('[LAN-CERT] فشل توليد الشهادة: ' + e.message.slice(0, 150));
        return { ok: false, error: e.message.slice(0, 150) };
    }
}

/** محاولة فتح منفذ الجدار الناري (تعمل فقط عند تشغيل السيرفر كمسؤول) */
function ensureFirewall(port) {
    try {
        execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule',
            `name=Karim ERP HTTPS ${port}`, 'dir=in', 'action=allow',
            'protocol=TCP', `localport=${port}`], { stdio: 'pipe', timeout: 20000 });
        return true;
    } catch (_) {return false;}
}

module.exports = { ensure, ensureFirewall, requiredSans, lanIPv4s };

if (require.main === module) {
    const r = ensure();
    console.log(JSON.stringify(r, null, 1));
    const port = (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^PORT=(\d+)/m) || [])[1] || 5000;
    const fw = ensureFirewall(port);
    console.log('firewall rule:', fw ? 'added' : 'skipped (run as administrator once)');
}
