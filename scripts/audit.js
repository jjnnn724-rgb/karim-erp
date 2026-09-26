#!/usr/bin/env node
/**
 * scripts/audit.js — مدقق النظام الشامل (CLI)
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام:
 *   node scripts/audit.js                 فحص فقط (تقرير ملوّن + حفظ JSON/HTML)
 *   node scripts/audit.js --dry-run       محاكاة الإصلاحات بلا تنفيذ
 *   node scripts/audit.js --fix           تطبيق الإصلاحات الآمنة (بعد نسخة احتياطية)
 *   node scripts/audit.js --domain=security,database
 *   node scripts/audit.js --severity=HIGH   عرض المشاكل ذات الخطورة ≥ HIGH فقط
 *   node scripts/audit.js --json          إخراج JSON خام (للتكامل/CI)
 *   node scripts/audit.js --no-save       عدم حفظ التقارير على القرص
 *
 * رمز الخروج: 0 إن كان النظام سليمًا، 1 إن وُجدت مشاكل حرجة/فشل.
 */
'use strict';

const path = require('path');

// تحميل .env إن وُجد (لضمان قراءة الإعدادات كما يراها الخادم) — quiet لكتم شعار dotenv
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true }); } catch (_) {}

// كتم شعار dotenvx الذي تطبعه بعض الوحدات عند التحميل (shared-pool) حتى يبقى --json نظيفًا
(function muteDotenvBanner() {
    const _w = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
        const s = typeof chunk === 'string' ? chunk : String(chunk);
        if (/injected env|dotenvx\.com|◇|⌘ multiple files/.test(s)) {return true;}
        // سجلّات pino سطرية ({"level":..,"time":..}) — تُفسد إخراج --json
        if (/^\{"level":/.test(s)) {return true;}
        return _w(chunk, ...rest);
    };
})();

const { runSystemAudit, report, engine } = require('../backend/audit-engine');

const SEV_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

function parseArgs(argv) {
    const o = { fix: false, dryRun: false, json: false, save: true, domains: null, minSeverity: null };
    for (const a of argv) {
        if (a === '--fix') {o.fix = true;}
        else if (a === '--dry-run' || a === '--dry') {o.dryRun = true;}
        else if (a === '--json') {o.json = true;}
        else if (a === '--no-save') {o.save = false;}
        else if (a.startsWith('--domain=')) {o.domains = a.slice(9).split(',').map((s) => s.trim()).filter(Boolean);}
        else if (a.startsWith('--severity=')) {o.minSeverity = a.slice(11).trim().toUpperCase();}
        else if (a === '--help' || a === '-h') {o.help = true;}
    }
    return o;
}

function printHelp() {
    console.log(`مدقق النظام الشامل — Karim ERP
  node scripts/audit.js [--fix] [--dry-run] [--json] [--no-save] [--domain=a,b] [--severity=HIGH]`);
}

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {printHelp(); process.exit(0);}

    let result;
    try {
        result = await runSystemAudit({
            fix: o.fix, dryRun: o.dryRun, domains: o.domains, save: o.save,
            onProgress: o.json ? null : (f) => {
                const mark = { pass: '✓', info: 'ℹ', warn: '⚠', fail: '✗', error: '!', fixed: '✔', skipped: '–' }[f.status] || '·';
                process.stdout.write(`  ${mark} [${f.severity}] ${f.id}\n`);
            },
        });
    } catch (e) {
        console.error('[audit] فشل تشغيل المدقق: ' + String(e && e.message || e));
        process.exit(2);
    }

    // تصفية حسب الخطورة للعرض فقط (لا يؤثر على النتيجة المحسوبة)
    let view = result;
    if (o.minSeverity && SEV_RANK[o.minSeverity]) {
        const min = SEV_RANK[o.minSeverity];
        view = Object.assign({}, result, {
            findings: result.findings.filter((f) => (SEV_RANK[f.severity] || 0) >= min && (f.status === 'fail' || f.status === 'warn' || f.status === 'error')),
        });
    }

    if (o.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
        console.log('');
        report.toConsole(view, { onlyProblems: Boolean(o.minSeverity) });
        if (result.backups && (result.backups.env || result.backups.db)) {
            console.log(`\nنسخ احتياطية قبل الإصلاح: .env=${result.backups.env || '—'} | DB=${result.backups.db || result.backups.skipped || '—'}`);
        }
        if (result.reports) {
            console.log(`\nالتقارير: ${result.reports.jsonPath}\n         ${result.reports.htmlPath}`);
        }
    }

    // إنهاء الاتصالات المفتوحة حتى تنتهي العملية
    try { const { pool } = require('../backend/shared-pool'); await pool.end(); } catch (_) {}

    process.exit(result.ok ? 0 : 1);
}

main();
