'use strict';
/**
 * backend/saas/onboarding-routes.js — نقطة التسجيل الذاتي
 * ─────────────────────────────────────────────────────────────────────────────
 * SAAS_SIGNUP_ENABLED=false ⇒ المسار غير موجود (404) — لا يغيّر أي سلوك حالي.
 * حماية محلية بسيطة: 5 محاولات/ساعة لكل IP. في الإنتاج يُفضَّل استبدالها
 * بـrate-limiter المشترك مع Redis (موثّق كتحسين لاحق).
 */

const { provisionTenant } = require('./onboarding');
const { pool } = require('../shared-pool');
const { record } = require('./saas-metrics');

const FALSEY = new Set(['false', '0', 'off', 'no', '']);
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const attempts = new Map();

function isEnabled(v) {
    if (v === undefined || v === null) { return false; }
    return !FALSEY.has(String(v).trim().toLowerCase());
}

function allow(ip) {
    const now = Date.now();
    const rec = attempts.get(ip);
    if (!rec || rec.until <= now) {
        attempts.set(ip, { until: now + WINDOW_MS, count: 1 });
        return true;
    }
    if (rec.count >= MAX_PER_IP) { return false; }
    rec.count++;
    return true;
}

function register(app) {
    app.post('/api/saas/signup', async (req, res) => {
        if (!isEnabled(process.env.SAAS_SIGNUP_ENABLED)) {
            return res.status(404).json({ error: 'NOT_FOUND' });
        }
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        record('signup_attempt');
        if (!allow(ip)) {
            record('signup_rate_limited');
            return res.status(429).json({ error: 'SIGNUP_RATE_LIMITED' });
        }
        try {
            const out = await provisionTenant({ pool, input: req.body || {} });
            record('signup_ok', out.tenantId);
            return res.status(201).json(out);
        } catch (err) {
            const status = Number(err.status) || 422;
            return res.status(status).json({ error: err.code || 'SIGNUP_FAILED' });
        }
    });
}

module.exports = { register, isEnabled, allow, MAX_PER_IP };
