/**
 * system-routes.js — النسخ الاحتياطي الكامل والاستعادة بزر واحد (مدير فقط)
 * ────────────────────────────────────────────────────────────────────────────
 * GET  /api/system/backups          قائمة النسخ (الملف + الحجم + التاريخ + سلامة البصمة)
 * POST /api/system/backup           نسخة جديدة الآن (قاعدة + .env + بيان) — بحد أدنى 5 دقائق بين النسخ
 * POST /api/system/restore          استعادة نسخة: {file, confirm:'RESTORE', restoreEnv?:boolean}
 *   - يتحقق من SHA-256، يعمل نسخة أمان تلقائية للوضع الحالي أولًا، يفصل باقي
 *     اتصالات القاعدة، ثم يستعيد بسكربت restore.js --yes. بعد الاستعادة يُنصح
 *     بإعادة تشغيل خدمة السيرفر.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { spawn } = require('child_process');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { runSystemAudit, buildContext } = require('./audit-engine');

const router = express.Router();

function backupsDir() {
    return path.resolve(process.env.KARIM_BACKUP_DIR || path.join(__dirname, '..', 'database', 'backups'));
}
function rootDir() { return path.resolve(__dirname, '..'); }
function runNode(script, args, timeoutMs) {
    return new Promise((resolve) => {
        const p = spawn(process.execPath, [script, ...args], { windowsHide: true, timeout: timeoutMs });
        let out = '', err = '';
        p.stdout?.on('data', (d) => { out += String(d); });
        p.stderr?.on('data', (d) => { err += String(d); });
        p.on('error', (e) => resolve({ ok: false, error: e.message, out, err }));
        p.on('close', (code) => resolve({ ok: code === 0, code, out, err }));
    });
}
function shaOk(file) {
    try {
        const side = `${file}.sha256`;
        if (!fs.existsSync(side)) {return null;}
        const [expected] = fs.readFileSync(side, 'utf8').trim().split(/\s+/);
        const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        return expected === actual;
    } catch (_) { return false; }
}
function listBackups() {
    const dir = backupsDir();
    if (!fs.existsSync(dir)) {return { dir, files: [] };}
    const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => {
            const full = path.join(dir, f);
            let st = null;
            try { st = fs.statSync(full); } catch (_) { return null; }
            let manifest = null;
            try {
                const mf = `${full}.json`;
                if (fs.existsSync(mf)) {manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));}
            } catch (_) {}
            return { file: f, bytes: st.size, mtime: st.mtime, shaOk: shaOk(full), manifest };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return { dir, files };
}

let lastBackupAt = 0;
router.get('/backups', jwtAuth, requireRole('admin'), async (req, res) => {
    try { res.json({ ok: true, ...listBackups() }); }
    catch (e) { logger.error('[system/backups]', e.message); res.status(500).json({ error: 'SYS_BACKUP_LIST_FAILED', message: 'تعذر جلب قائمة النسخ' }); }
});

router.post('/backup', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        if (Date.now() - lastBackupAt < 5 * 60 * 1000) {
            return res.status(429).json({ error: 'BACKUP_TOO_SOON', message: 'انتظر 5 دقائق بين النسخة والأخرى' });
        }
        lastBackupAt = Date.now();
        const r = await runNode(path.join(rootDir(), 'database', 'scripts', 'backup.js'), [], 300000);
        if (!r.ok) {return res.status(500).json({ error: 'BACKUP_FAILED', message: 'فشل النسخ الاحتياطي', log: (r.err || r.out || '').slice(-500) });}
        // حزمة الاستعادة الكاملة: نسخة .env + بيان بجانب ملف القاعدة
        try {
            const { files } = listBackups();
            const newest = files[0] ? path.join(backupsDir(), files[0].file) : null;
            if (newest) {
                fs.copyFileSync(path.join(rootDir(), '.env'), `${newest}.env`);
                fs.writeFileSync(`${newest}.json`, JSON.stringify({
                    createdAt: new Date().toISOString(), by: req.user?.name || 'admin',
                    byId: req.user?.id || null, db: process.env.DB_NAME || 'karim_erp',
                    includes: ['database.sql', '.env'], app: 'karim-erp',
                }, null, 1));
            }
        } catch (e) { logger.warn('[system/backup] env snapshot skipped: ' + e.message); }
        res.json({ ok: true, ...listBackups() });
    } catch (e) { logger.error('[system/backup]', e.message); res.status(500).json({ error: 'BACKUP_FAILED', message: 'فشل النسخ الاحتياطي' }); }
});

// ─── رفع نسخة احتياطية خارجية (.sql) لتظهر في القائمة وتكون قابلة للاستعادة ───
const backupUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            try { fs.mkdirSync(backupsDir(), { recursive: true }); cb(null, backupsDir()); }
            catch (e) { cb(e); }
        },
        filename: (req, file, cb) => cb(null, `upload-${Date.now()}.part`),
    }),
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const name = String(file.originalname || '');
        if (/\.sql$/i.test(name)) {return cb(null, true);}
        cb(Object.assign(new Error('ملف غير مدعوم — ارفع نسخة .sql فقط'), { code: 'BAD_TYPE' }));
    },
}).single('file');

router.post('/upload', jwtAuth, requireRole('admin'), (req, res) => {
    backupUpload(req, res, (err) => {
        try {
            if (err) {
                const msg = err.code === 'LIMIT_FILE_SIZE' ? 'الملف أكبر من 1GB' : (err.message || 'فشل الرفع');
                return res.status(422).json({ error: 'UPLOAD_FAILED', message: msg });
            }
            if (!req.file) {return res.status(422).json({ error: 'NO_FILE', message: 'اختر ملف .sql أولًا' });}
            // اسم آمن + منع الكتابة فوق نسخة قائمة
            let base = path.basename(String(req.file.originalname || 'backup.sql')).replace(/[^a-zA-Z0-9_\-\.ء-غف-ي ]/g, '_').slice(0, 120);
            if (!/\.sql$/i.test(base)) {base += '.sql';}
            let full = path.join(backupsDir(), base);
            if (fs.existsSync(full)) {
                const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                base = base.replace(/\.sql$/i, `-${stamp}.sql`);
                full = path.join(backupsDir(), base);
            }
            fs.renameSync(req.file.path, full);
            // بصمة وبيان حتى تمر الاستعادة اللاحقة من نفس فحوص السلامة
            try {
                const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
                fs.writeFileSync(`${full}.sha256`, `${hash}  ${base}\n`);
                fs.writeFileSync(`${full}.json`, JSON.stringify({
                    createdAt: new Date().toISOString(), by: req.user?.name || 'admin',
                    byId: req.user?.id || null, db: process.env.DB_NAME || 'karim_erp',
                    includes: ['database.sql'], app: 'karim-erp', uploaded: path.basename(String(req.file.originalname || '')),
                }, null, 1));
            } catch (e) { logger.warn('[system/upload] sidecar skipped: ' + e.message); }
            logger.info(`[system/upload] ${base} by ${req.user?.name || req.user?.id}`);
            return res.status(201).json({ ok: true, file: base, ...listBackups() });
        } catch (e) {
            try { if (req.file?.path && fs.existsSync(req.file.path)) {fs.unlinkSync(req.file.path);} } catch (_) {}
            logger.error('[system/upload]', e.message);
            return res.status(500).json({ error: 'UPLOAD_FAILED', message: 'فشل حفظ الملف' });
        }
    });
});

router.post('/restore', jwtAuth, requireRole('admin'), async (req, res) => {
    const t0 = Date.now();
    try {
        const file = String(req.body?.file || '').trim();
        if (req.body?.confirm !== 'RESTORE') {
            return res.status(422).json({ error: 'CONFIRM_REQUIRED', message: 'أكّد بكلمة RESTORE — الاستعادة تمسح الوضع الحالي' });
        }
        const full = path.resolve(backupsDir(), path.basename(file));
        if (!file.endsWith('.sql') || !fs.existsSync(full)) {
            return res.status(404).json({ error: 'BACKUP_NOT_FOUND', message: 'ملف النسخة غير موجود' });
        }
        const ok = shaOk(full);
        if (ok === false) {return res.status(422).json({ error: 'SHA_MISMATCH', message: 'بصمة النسخة غير سليمة — لن نستعيد ملفًا تالفًا' });}
        // نسخة أمان تلقائية للوضع الحالي قبل المسح
        const pre = await runNode(path.join(rootDir(), 'database', 'scripts', 'backup.js'),
            [path.join(backupsDir(), `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sql`)], 300000);
        if (!pre.ok) {return res.status(500).json({ error: 'SAFETY_BACKUP_FAILED', message: 'تعذرت نسخة الأمان — أُوقفت الاستعادة لحماية بياناتك' });}
        // فصل باقي اتصالات القاعدة حتى لا تعلق الاستعادة على الأقفال
        try {
            await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`);
        } catch (_) {}
        const r = await runNode(path.join(rootDir(), 'database', 'scripts', 'restore.js'), [full, '--yes'], 600000);
        if (!r.ok) {return res.status(500).json({ error: 'RESTORE_FAILED', message: 'فشلت الاستعادة — نسخة الأمان موجودة', log: (r.err || r.out || '').slice(-800) });}
        // استعادة .env إن طُلبت (تتطلب إعادة تشغيل السيرفر لتُطبق)
        let envRestored = false;
        if (req.body?.restoreEnv === true && fs.existsSync(`${full}.env`)) {
            try {
                fs.copyFileSync(path.join(rootDir(), '.env'), path.join(backupsDir(), `.env.before-restore-${Date.now()}`));
                fs.copyFileSync(`${full}.env`, path.join(rootDir(), '.env'));
                envRestored = true;
            } catch (e) { logger.warn('[system/restore] env restore skipped: ' + e.message); }
        }
        try { if (req.io) {req.io.emit('system:restored', { file, at: new Date().toISOString(), ms: Date.now() - t0 });} } catch (_) {}
        res.json({ ok: true, file, ms: Date.now() - t0, envRestored, restartNeeded: true, message: 'تمت الاستعادة — أعد تشغيل خدمة السيرفر' });
    } catch (e) { logger.error('[system/restore]', e.message); res.status(500).json({ error: 'RESTORE_FAILED', message: 'فشلت الاستعادة' }); }
});

// ─── مدقق النظام الشامل (فحص + إصلاح آمن) — مدير فقط ───
function auditCtx() { return buildContext({ pool, root: rootDir() }); }

// GET /api/system/audit?domain=security,database&severity=HIGH — تقرير للقراءة فقط
router.get('/audit', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const domains = req.query.domain ? String(req.query.domain).split(',').map((s) => s.trim()).filter(Boolean) : null;
        const result = await runSystemAudit({ fix: false, domains, save: true, ctx: auditCtx() });
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('[system/audit]', e.message);
        res.status(500).json({ error: 'AUDIT_FAILED', message: 'تعذر تشغيل مدقق النظام' });
    }
});

// POST /api/system/audit/fix  body:{ dryRun?:boolean, domain?:'a,b' } — تطبيق الإصلاحات الآمنة بعد نسخة احتياطية
router.post('/audit/fix', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const dryRun = req.body?.dryRun === true;
        const domains = req.body?.domain ? String(req.body.domain).split(',').map((s) => s.trim()).filter(Boolean) : null;
        const result = await runSystemAudit({ fix: true, dryRun, domains, save: true, ctx: auditCtx() });
        try { if (req.io) {req.io.emit('system:audited', { score: result.score, grade: result.grade, fix: true, dryRun, at: new Date().toISOString() });} } catch (_) {}
        res.json({ ok: true, ...result });
    } catch (e) {
        logger.error('[system/audit/fix]', e.message);
        res.status(500).json({ error: 'AUDIT_FIX_FAILED', message: 'تعذر تنفيذ إصلاحات المدقق' });
    }
});

module.exports = router;