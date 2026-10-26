/**
 * pos-path-routes.js — سياسة توحيد مسار واجهة POS (Phase 4.2)
 * ══════════════════════════════════════════════════════════════════════════
 * GET /api/pos/path-policy → { mode, path, label }
 *
 * لماذا عام (بلا JWT): صفحة الكاشير القديمة تعرض التنبيه/التوجيه **قبل**
 * تسجيل الدخول — والمستخدم ما زال على الشاشة القديمة. المحتوى لا يحوي
 * أي سر: وضع (off/banner/redirect) + مسار داخلي + نص تنبيه.
 *
 * fail-open بالكامل: أي خطأ ⇒ off (لا تغيير في السلوك).
 */
const { pool } = require('./shared-pool');

const MODES = new Set(['off', 'banner', 'redirect']);
const DEFAULT_LABEL = 'هذه الشاشة ستُوقف قريبًا — الرجاء استخدام واجهة الكاشير المعتمدة.';

function normalizeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return MODES.has(mode) ? mode : 'off';
}

function normalizePath(value) {
    const p = String(value || '').trim();
    // مسار داخلي فقط — لا URL خارجي ولا تحويل مفتوح
    if (!p || !p.startsWith('/') || p.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(p)) {return '';}
    return p.slice(0, 255);
}

function register(app) {
    app.get('/api/pos/path-policy', asyncHandler(async (req, res) => {
        const policy = { mode: 'off', path: '', label: DEFAULT_LABEL };
        try {
            const r = await pool.query(
                `SELECT pos_legacy_mode, pos_official_path FROM settings WHERE id = 'main_settings' LIMIT 1`);
            const row = r.rows[0] || {};
            policy.mode = normalizeMode(row.pos_legacy_mode);
            policy.path = normalizePath(row.pos_official_path);
        } catch (_) {
            // قبل الـmigration 104 أو خطأ في القاعدة ⇒ off (لا تغيير)
        }
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, policy });
    }));
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { register, normalizeMode, normalizePath, MODES, DEFAULT_LABEL };
