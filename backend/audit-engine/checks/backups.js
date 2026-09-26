/**
 * audit-engine/checks/backups.js — فحوصات النسخ الاحتياطي
 * ────────────────────────────────────────────────────────────────────────────
 * حداثة نسخ قاعدة البيانات، سلامة checksum، ونسخ جلسات واتساب، وقابلية الكتابة.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dbBackupsDir(ctx) {
    // مطابق لـ BACKUPS_DIR في scripts/shared.js دون استيراده (يتجنب شعار dotenvx)
    return path.join(ctx.root, 'database', 'backups');
}

function newest(dir, filterRe) {
    try {
        const files = fs.readdirSync(dir).filter((f) => filterRe.test(f));
        if (!files.length) {return null;}
        let best = null;
        for (const f of files) {
            const st = fs.statSync(path.join(dir, f));
            if (!best || st.mtimeMs > best.mtimeMs) {best = { file: f, mtimeMs: st.mtimeMs, size: st.size };}
        }
        return best;
    } catch (_) { return null; }
}

function ageDays(ms) { return (Date.now() - ms) / 86400000; }

module.exports = [
    {
        id: 'backup.db_freshness',
        domain: 'backups',
        title: 'حداثة نسخة قاعدة البيانات',
        description: 'أحدث ملف .sql في مجلد النسخ — يجب ألا يتجاوز 7 أيام.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const dir = dbBackupsDir(ctx);
            const latest = newest(dir, /\.sql$/i);
            if (!latest) {return { status: 'fail', severity: 'HIGH', detail: `لا نسخ احتياطية في ${dir}`, evidence: { dir }, remediation: 'شغّل نسخة احتياطية: scripts/backup-full.ps1 أو جدولة يومية' };}
            const days = ageDays(latest.mtimeMs);
            const ev = { file: latest.file, days: Number(days.toFixed(1)), sizeKb: Math.round(latest.size / 1024) };
            if (days > 30) {return { status: 'fail', severity: 'HIGH', detail: `أحدث نسخة عمرها ${days.toFixed(0)} يومًا (${latest.file})`, evidence: ev, remediation: 'أنتج نسخة جديدة فورًا وفعّل جدولة تلقائية' };}
            if (days > 7) {return { status: 'warn', severity: 'MEDIUM', detail: `أحدث نسخة عمرها ${days.toFixed(1)} يومًا (${latest.file})`, evidence: ev, remediation: 'جدوِل نسخًا يوميًا' };}
            return { status: 'pass', detail: `نسخة حديثة (${days.toFixed(1)} يوم) — ${latest.file}` };
        },
    },

    {
        id: 'backup.sha256_integrity',
        domain: 'backups',
        title: 'سلامة checksum لأحدث نسخة',
        description: 'إن وُجد ملف .sha256 بجوار أحدث نسخة، يُتحقق من تطابق البصمة (كشف التلف/العبث).',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const dir = dbBackupsDir(ctx);
            const latest = newest(dir, /\.sql$/i);
            if (!latest) {return { status: 'info', detail: 'لا نسخة للتحقق' };}
            const sumFile = path.join(dir, latest.file + '.sha256');
            if (!fs.existsSync(sumFile)) {return { status: 'info', detail: `لا checksum لأحدث نسخة (${latest.file})` };}
            try {
                const expected = (fs.readFileSync(sumFile, 'utf8').match(/[a-f0-9]{64}/i) || [''])[0].toLowerCase();
                if (!expected) {return { status: 'info', detail: 'ملف checksum غير صالح' };}
                const data = fs.readFileSync(path.join(dir, latest.file));
                const actual = crypto.createHash('sha256').update(data).digest('hex');
                if (actual === expected) {return { status: 'pass', detail: `checksum سليم لـ ${latest.file}` };}
                return { status: 'fail', severity: 'HIGH', detail: `checksum غير مطابق لـ ${latest.file} — النسخة تالفة أو عُدّلت`, evidence: { expected: expected.slice(0, 12), actual: actual.slice(0, 12) }, remediation: 'أعد إنتاج نسخة احتياطية سليمة' };
            } catch (e) {
                return { status: 'info', detail: 'تعذّر التحقق من checksum: ' + String(e.message).slice(0, 100) };
            }
        },
    },

    {
        id: 'backup.whatsapp_session',
        domain: 'backups',
        title: 'نسخ جلسات واتساب الاحتياطية',
        description: 'فقدان creds.json يعني إعادة ربط كل الأجهزة — يجب وجود نسخ حديثة.',
        severity: 'LOW',
        detect: (ctx) => {
            const dir = ctx.paths.whatsappBackupDir;
            const latest = newest(dir, /^creds-\d{8}-\d{6}\.json$/);
            if (!latest) {return { status: 'warn', severity: 'LOW', detail: `لا نسخ جلسات واتساب في ${dir}`, evidence: { dir }, remediation: 'يربط المحرك نسخة تلقائية عند كل CONNECTED — تحقق من WHATSAPP_BACKUP_DIR' };}
            const days = ageDays(latest.mtimeMs);
            if (days > 3) {return { status: 'warn', severity: 'LOW', detail: `أحدث نسخة جلسة عمرها ${days.toFixed(1)} يوم`, evidence: { file: latest.file, days: Number(days.toFixed(1)) } };}
            return { status: 'pass', detail: `نسخة جلسة حديثة (${latest.file})` };
        },
    },

    {
        id: 'backup.dir_writable',
        domain: 'backups',
        title: 'قابلية كتابة مجلد النسخ الاحتياطي',
        description: 'يجب أن يكون مجلد نسخ القاعدة قابلًا للكتابة وإلا فشلت كل النسخ.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const dir = dbBackupsDir(ctx);
            try {
                if (!fs.existsSync(dir)) {return { status: 'fail', severity: 'MEDIUM', detail: `مجلد النسخ غير موجود (${dir})`, remediation: 'أنشئ المجلد أو صحّح BACKUPS_DIR' };}
                const probe = path.join(dir, `.audit-write-${Date.now()}.tmp`);
                fs.writeFileSync(probe, 'ok');
                fs.unlinkSync(probe);
                return { status: 'pass', detail: 'مجلد النسخ قابل للكتابة' };
            } catch (e) {
                return { status: 'fail', severity: 'MEDIUM', detail: 'مجلد النسخ غير قابل للكتابة: ' + String(e.message).slice(0, 100), remediation: 'صحّح صلاحيات المجلد' };
            }
        },
    },
];
