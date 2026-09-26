/**
 * yarasoft/config.js — إعدادات تكامل Yarasoft POS (من متغيرات البيئة فقط)
 * ────────────────────────────────────────────────────────────────────────────
 * لا بيانات اعتماد في الكود إطلاقًا — كل شيء من .env كما تطلب المواصفة.
 * القيم الافتراضية آمنة: YARASOFT_ENABLED=false و YARASOFT_DRY_RUN=true
 * حتى تُؤكَّد صيغة الملفات الفعلية بأداة التشخيص قبل التشغيل الفعلي.
 */

'use strict';

const path = require('path');

function intEnv(name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {return def;}
    const n = Number(raw);
    if (!Number.isFinite(n)) {return def;}
    return Math.min(max, Math.max(min, Math.round(n)));
}

function boolEnv(name, def) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {return def;}
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).trim().toLowerCase());
}

function listEnv(name, def) {
    const raw = process.env[name];
    if (!raw || !String(raw).trim()) {return def;}
    return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** خريطة "مفتاح=قيمة,..." من البيئة — لأسماء الأجهزة وأقسامها */
function parseMapEnv(name) {
    const map = {};
    String(process.env[name] || '').split(',').forEach(pair => {
        const i = pair.indexOf('=');
        if (i < 0) {return;}
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (k && v) {map[k] = v;}
    });
    return map;
}

function loadConfig() {
    return Object.freeze({
        // ─── التشغيل ───
        enabled: boolEnv('YARASOFT_ENABLED', false),
        dryRun: boolEnv('YARASOFT_DRY_RUN', true),

        // ─── المسارات (حد التكامل: مشاركة الشبكة فقط) ───
        shareRoot: process.env.YARASOFT_SHARE || '\\\\server\\Yarasoft\\pos',
        invoicesDir: process.env.YARASOFT_INVOICES_DIR || 'Invoices',
        processingDir: process.env.YARASOFT_PROCESSING_DIR || 'Invoices_Processing',
        archiveDir: process.env.YARASOFT_ARCHIVE_DIR || 'Invoices_Archive',
        failedDir: process.env.YARASOFT_FAILED_DIR || 'Invoices_Failed',

        // ─── الاستقرار (لا نقرأ ملفًا قد يكون ما زال يُكتب) ───
        stabilityDelayMs: intEnv('FILE_STABILITY_DELAY', 2000, { min: 0, max: 300000 }),
        stabilityChecks: intEnv('FILE_STABILITY_CHECKS', 3, { min: 2, max: 10 }),

        // ─── الشبكة والدوران ───
        networkRetryIntervalSec: intEnv('NETWORK_RETRY_INTERVAL', 30, { min: 5, max: 3600 }),
        scanIntervalSec: intEnv('YARASOFT_SCAN_INTERVAL', 10, { min: 3, max: 3600 }),
        maxRetries: intEnv('YARASOFT_MAX_RETRIES', 5, { min: 1, max: 100 }),
        maxFileSizeMB: intEnv('YARASOFT_MAX_FILE_MB', 10, { min: 1, max: 512 }),

        // ─── أنماط ملفات الفواتير المعالجة ───
        filePatterns: listEnv('YARASOFT_FILE_PATTERNS', []), // فارغة = كل الملفات غير المخفية

        // ─── المحاسبة ───
        defaultDeptCode: process.env.YARASOFT_DEPT_CODE || 'yarasoft_pos',
        defaultDeptName: process.env.YARASOFT_DEPT_NAME || 'مبيعات نقاط البيع (Yarasoft)',
        locationCode: process.env.YARASOFT_LOCATION_CODE || 'MAIN-WAREHOUSE',
        locationIdOverride: process.env.YARASOFT_LOCATION_ID ? Number(process.env.YARASOFT_LOCATION_ID) : null,
        sourceName: process.env.YARASOFT_SOURCE_NAME || 'Yarasoft POS',

        // ─── الأجهزة (مجلد فرعي لكل كاشير داخل Invoices) ───
        // Cashier1 → «كاشير 1» تلقائيًا؛ تجاوز اختياري:
        // YARASOFT_DEVICE_NAMES="Cashier1=كاشير الصالة,Cashier2=كاشير الخارجي"
        // YARASOFT_DEVICE_DEPTS="Cashier1=main,Cashier2=branch"
        deviceNames: parseMapEnv('YARASOFT_DEVICE_NAMES'),
        deviceDepts: parseMapEnv('YARASOFT_DEVICE_DEPTS'),

        // ─── ملف تعريف الصيغة (يُملأ بعد تقرير التشخيص) ───
        profilePath: process.env.YARASOFT_PROFILE || path.join(__dirname, 'format-profile.json'),

        // ─── سجل التشغيل ───
        logRetentionDays: intEnv('YARASOFT_LOG_RETENTION_DAYS', 180, { min: 7, max: 3650 }),
    });
}

/** المسار الكامل لمجلد داخل المشاركة — يدعم UNC ويندوز والمسارات المحلية */
function joinShare(config, ...parts) {
    const root = String(config.shareRoot || '').trim();
    if (!root) {throw new Error('YARASOFT_SHARE_NOT_CONFIGURED');}
    const cleaned = parts.filter(Boolean).map(p => String(p).replace(/^[\\/]+|[\\/]+$/g, ''));
    return path.join(root, ...cleaned);
}

/** مفتاح الجهاز من مسار الملف (المجلد الفرعي الأول داخل Invoices) — '' للجذر */
function deviceKeyFromPath(config, filePath) {
    try {
        const base = joinShare(config, config.invoicesDir);
        const rel = path.relative(base, path.dirname(String(filePath)));
        if (!rel || rel === '.' || rel.startsWith('..')) {return '';}
        return rel.split(path.sep)[0];
    } catch (err) {
        return '';
    }
}

/** حلّ اسم المصدر والقسم لجهاز: Cashier1 → «كاشير 1» + قسمه (أو الافتراضي) */
function resolveDevice(config, deviceKey) {
    const key = String(deviceKey || '').trim();
    let sourceName = config.sourceName;
    if (key) {
        if (config.deviceNames && config.deviceNames[key]) {
            sourceName = config.deviceNames[key];
        } else {
            const m = key.match(/^cashier\s*(\d+)$/i);
            sourceName = m ? `كاشير ${m[1]}` : key;
        }
    }
    const deptCode = (key && config.deviceDepts && config.deviceDepts[key]) || config.defaultDeptCode;
    return { key, sourceName, deptCode };
}

module.exports = { loadConfig, joinShare, parseMapEnv, deviceKeyFromPath, resolveDevice };
