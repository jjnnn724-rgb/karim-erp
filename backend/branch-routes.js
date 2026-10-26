/**
 * branch-routes.js — إدارة الفروع /api/branches (migration 102).
 * القراءة لأي مستخدم مصادق (الفروع النشطة)، والكتابة للأدمن فقط.
 * الحذف ليّن (is_active=FALSE) — لا بتر لصفوف قد يشير إليها branch_id.
 */
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { invalidateBranchCache } = require('./branch-context');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

function register(app) {

    app.get('/api/branches', jwtAuth, asyncHandler(async (req, res) => {
        const showAll = req.query.all === '1' && req.user?.role === 'admin';
        const result = showAll
            ? await pool.query('SELECT * FROM branches ORDER BY id')
            : await pool.query('SELECT * FROM branches WHERE is_active = TRUE ORDER BY id');
        res.json({ ok: true, data: result.rows });
    }));

    app.post('/api/branches', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
        const b = req.body || {};
        const code = String(b.code || '').trim();
        const nameAr = String(b.name_ar || '').trim();
        const nameEn = b.name_en ? String(b.name_en).trim() : null;
        const currency = String(b.currency || 'SAR').trim().toUpperCase();
        const timezone = String(b.timezone || 'Asia/Riyadh').trim();
        if (!CODE_RE.test(code)) {return res.status(422).json({ error: 'BRANCH_CODE_INVALID', message: 'كود الفرع: 1-20 حرفًا لاتينيًا/أرقامًا/_- فقط' });}
        if (!nameAr) {return res.status(422).json({ error: 'BRANCH_NAME_REQUIRED', message: 'اسم الفرع بالعربية مطلوب' });}
        if (!CURRENCY_RE.test(currency)) {return res.status(422).json({ error: 'BRANCH_CURRENCY_INVALID', message: 'العملة يجب أن تكون رمز ISO من 3 حروف (SAR/EGP/…)' });}
        const exists = (await pool.query('SELECT 1 FROM branches WHERE UPPER(code) = UPPER($1)', [code])).rowCount;
        if (exists) {return res.status(409).json({ error: 'BRANCH_CODE_EXISTS', message: `كود الفرع «${code}» مستخدم بالفعل` });}
        const row = (await pool.query(
            `INSERT INTO branches (code, name_ar, name_en, currency, timezone, address, phone)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [code, nameAr, nameEn, currency, timezone, b.address || null, b.phone || null])).rows[0];
        invalidateBranchCache();
        res.status(201).json({ ok: true, data: row });
    }));

    app.patch('/api/branches/:id', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {return res.status(400).json({ error: 'INVALID_BRANCH_ID' });}
        const allowed = { name_ar: 'text', name_en: 'text', currency: 'currency', timezone: 'text', address: 'text', phone: 'text', is_active: 'bool' };
        const sets = [];
        const params = [];
        for (const [key, kind] of Object.entries(allowed)) {
            if (!(key in (req.body || {}))) {continue;}
            let v = req.body[key];
            if (kind === 'currency') {
                v = String(v || '').trim().toUpperCase();
                if (!CURRENCY_RE.test(v)) {return res.status(422).json({ error: 'BRANCH_CURRENCY_INVALID', message: 'العملة يجب أن تكون رمز ISO من 3 حروف' });}
            }
            if (kind === 'bool') {v = v === true || v === 'true';}
            if (kind === 'text') {v = v == null ? null : String(v).trim() || null;}
            params.push(v);
            sets.push(`"${key}" = $${params.length}`);
        }
        if (!sets.length) {return res.status(400).json({ error: 'NO_UPDATABLE_FIELDS' });}
        params.push(id);
        const row = (await pool.query(
            `UPDATE branches SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING *`,
            params)).rows[0];
        if (!row) {return res.status(404).json({ error: 'BRANCH_NOT_FOUND' });}
        invalidateBranchCache();
        res.json({ ok: true, data: row });
    }));

    // حذف ليّن — MAIN محمي، والسجلات المرتبطة به عبر branch_id تبقى سليمة
    app.delete('/api/branches/:id', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {return res.status(400).json({ error: 'INVALID_BRANCH_ID' });}
        const row = (await pool.query(`UPDATE branches SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
                                       WHERE id = $1 AND code <> 'MAIN' RETURNING *`, [id])).rows[0];
        if (!row) {
            return res.status(422).json({ error: 'BRANCH_NOT_DEACTIVABLE', message: 'الفرع غير قابل للإيقاف (غير موجود أو هو الفرع الرئيسي)' });
        }
        invalidateBranchCache();
        res.json({ ok: true, data: row });
    }));
}

module.exports = { register };
