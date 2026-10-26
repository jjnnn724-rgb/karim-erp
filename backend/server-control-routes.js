'use strict';
/**
 * server-control-routes.js — بروكسي ERP المحروس إلى خدمة التحكم المرافقة.
 * المستخدم يُصادَق بجلسة ERP العادية (JWT + دور admin + مفتاح التطبيق)،
 * ثم يُوقَّع الطلب داخليًا بسر الخدمة على 127.0.0.1 فقط. لا أسرار ولا أوامر
 * تمر إلى المتصفح. إيقاف الخدمة يقطع ERP نفسه، لذا تُقبل العملية وتُنفَّذ
 * بعد مهلة قصيرة كي يصل الرد إلى المتصفح أولًا.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { CONFIRM_PHRASE, validAction } = require('./server-control');

const ROOT = path.join(__dirname, '..');
const CONTROL_HOST = '127.0.0.1';
const CONTROL_PORT = Number(process.env.CONTROL_PORT) || 5011;
const CONTROL_URL = process.env.CONTROL_PUBLIC_URL || `http://${CONTROL_HOST}:${CONTROL_PORT}/`;
const RUNTIME_DIR = process.env.KARIM_RUNTIME_DIR || path.join(ROOT, 'runtime');
const SECRET_FILE = path.join(RUNTIME_DIR, 'control-secret');
const ACTION_LIMIT = 4;
const ACTION_WINDOW_MS = 2 * 60 * 1000;

let secretCache = { value: '', at: 0 };
function readSecret() {
    if (Date.now() - secretCache.at < 5000) {return secretCache.value;}
    let value = '';
    try {
        const raw = fs.readFileSync(SECRET_FILE, 'utf8').trim();
        if (/^[a-f0-9]{64}$/i.test(raw)) {value = raw;}
    } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    secretCache = { value, at: Date.now() };
    return value;
}

function callControl(method, pathname, body, timeoutMs) {
    const secret = readSecret();
    if (!secret) {return Promise.resolve({ ok: false, notInstalled: true });}
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            host: CONTROL_HOST,
            port: CONTROL_PORT,
            path: pathname,
            method,
            timeout: timeoutMs,
            headers: {
                accept: 'application/json',
                'x-control-service': secret,
                ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; if (raw.length > 256 * 1024) {req.destroy();} });
            res.on('end', () => {
                let data = null;
                try {data = raw ? JSON.parse(raw) : null;} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
                resolve({ ok: true, status: res.statusCode || 502, data });
            });
        });
        req.on('timeout', () => { try { req.destroy(); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ } resolve({ ok: false, timeout: true }); });
        req.on('error', () => resolve({ ok: false, offline: true }));
        if (payload) {req.write(payload);}
        req.end();
    });
}

const actionHits = new Map();
function actionAllowed(userKey) {
    const now = Date.now();
    const list = (actionHits.get(userKey) || []).filter((at) => now - at < ACTION_WINDOW_MS);
    if (list.length >= ACTION_LIMIT) {return false;}
    list.push(now);
    actionHits.set(userKey, list);
    if (actionHits.size > 500) {
        for (const [key, hits] of actionHits) {
            if (!hits.some((at) => now - at < ACTION_WINDOW_MS)) {actionHits.delete(key);}
        }
    }
    return true;
}

function unavailable(res, reason, status = 200) {
    const messages = {
        not_installed: 'لوحة التحكم المستقلة غير مثبّتة بعد على جهاز السيرفر.',
        offline: 'خدمة التحكم المرافقة لا تستجيب — تحقق من خدمة KarimERP-Control.',
        timeout: 'خدمة التحكم لم ترد خلال المهلة.',
    };
    return res.status(status).json({
        available: false,
        reason,
        message: messages[reason] || 'خدمة التحكم غير متاحة.',
        controlUrl: CONTROL_URL,
    });
}

function register(app) {
    const router = require('express').Router();
    router.use(jwtAuth, requireRole('admin'));

    router.get('/status', async (req, res) => {
        const result = await callControl('GET', '/internal/status', null, 4500);
        if (!result.ok) {return unavailable(res, result.notInstalled ? 'not_installed' : result.timeout ? 'timeout' : 'offline');}
        if (result.status !== 200 || !result.data || result.data.ok !== true) {
            return res.status(200).json({
                available: false,
                reason: 'protocol',
                message: 'رد غير متوقع من خدمة التحكم.',
                controlUrl: CONTROL_URL,
            });
        }
        return res.json({ ...result.data, available: true, controlUrl: CONTROL_URL });
    });

    router.post('/actions', async (req, res) => {
        const action = validAction(req.body && req.body.action);
        if (!action) {
            return res.status(400).json({ error: 'INVALID_ACTION', message: 'الإجراء غير مسموح.' });
        }
        const phrase = CONFIRM_PHRASE[action];
        const confirm = String((req.body && req.body.confirm) || '').trim().toUpperCase();
        if (phrase && confirm !== phrase) {
            return res.status(400).json({ error: 'CONFIRM_REQUIRED', message: `اكتب ${phrase} للتأكيد.` });
        }
        const userKey = String(req.user && (req.user.sub || req.user.username) || 'admin');
        if (!actionAllowed(userKey)) {
            return res.status(429).json({ error: 'RATE_LIMITED', message: 'أوامر كثيرة — انتظر دقيقتين.' });
        }
        const actor = String((req.user && (req.user.name || req.user.username)) || userKey).slice(0, 64);
        const result = await callControl('POST', '/internal/actions', { action, confirm, actor }, 5000);
        if (!result.ok) {return unavailable(res, result.notInstalled ? 'not_installed' : result.timeout ? 'timeout' : 'offline', 503);}
        if (!result.data) {
            return res.status(502).json({ error: 'CONTROL_PROTOCOL', message: 'رد غير مفهوم من خدمة التحكم.' });
        }
        return res.status(result.status).json({ ...result.data, controlUrl: CONTROL_URL });
    });

    app.use('/api/server-control', router);
}

module.exports = { register, readSecret, callControl, CONTROL_URL };
