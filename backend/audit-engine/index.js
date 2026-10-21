/**
 * audit-engine/index.js — الواجهة العامة لمحرك الفحص والإصلاح الشامل
 * ────────────────────────────────────────────────────────────────────────────
 * runSystemAudit({ fix, dryRun, domains, save }) → يبني السياق، يحمّل الفحوصات،
 * يأخذ نسخة احتياطية آمنة (.env + pg_dump) قبل أي إصلاح مُعدِّل، ثم يشغّل ويحفظ التقارير.
 *
 * يُستخدم من:
 *   - scripts/audit.js              (سطر الأوامر)
 *   - GET /api/system/audit         (نقطة المدير الحية)
 */
'use strict';

const { buildContext } = require('./context');
const { runAudit } = require('./engine');
const { checks, DOMAINS } = require('./checks');
const report = require('./report');

/**
 * @param {object} p
 * @param {boolean}[p.fix]      تطبيق الإصلاحات الآمنة (غير review)
 * @param {boolean}[p.dryRun]   محاكاة بلا تنفيذ
 * @param {string[]}[p.domains] حصر النطاقات
 * @param {boolean}[p.save]     حفظ تقارير JSON/HTML (افتراضي true)
 * @param {object}[p.ctx]       سياق مُجهّز مسبقًا (للاستخدام داخل الخادم)
 * @param {Function}[p.onProgress]
 * @param {number}[p.timeoutMs]
 */
async function runSystemAudit(p = {}) {
    const {
        fix = false, dryRun = false, domains = null, save = true,
        onProgress = null, timeoutMs = 8000,
    } = p;

    const ctx = p.ctx || buildContext({});
    const backups = { env: null, db: null, skipped: null };

    // dry-run يحاكي الإصلاحات: يمرّر fix=true للمحرك لكن بلا تنفيذ فعلي ولا نسخ احتياطية
    const effectiveFix = fix || dryRun;

    // نسخة احتياطية آمنة قبل أي إصلاح مُعدِّل (مرة واحدة لكل تشغيل) — للإصلاح الحقيقي فقط
    if (fix && !dryRun) {
        try { backups.env = ctx.backupFile(ctx.envFile, 'preflight'); } catch (_) {}
        try { backups.db = ctx.pgDumpBackup(ctx, 'preflight-audit'); } catch (_) {}
        if (!backups.db) {
            // لا نُجبر على الفشل إن تعذّر pg_dump (قد لا يكون مثبتًا على PATH) — لكن نوثّقها
            backups.skipped = 'pg_dump غير متاح — تم الاكتفاء بنسخة .env';
        }
    }

    const result = await runAudit({
        checks, ctx, fix: effectiveFix, dryRun, domains, timeoutMs, onProgress,
    });

    result.backups = backups;
    result.domains = DOMAINS;

    if (save) {
        try {
            const saved = report.saveReports(result, ctx.paths.reportDir, 'system-audit');
            if (saved) {result.reports = saved;}
        } catch (_) {}
    }

    return result;
}

module.exports = {
    runSystemAudit,
    buildContext,
    runAudit,
    checks,
    DOMAINS,
    report,
    engine: require('./engine'),
};
