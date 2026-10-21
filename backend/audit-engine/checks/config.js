/**
 * audit-engine/checks/config.js — فحوصات الإعدادات والبيئة
 * ────────────────────────────────────────────────────────────────────────────
 * تركّز على: اكتمال المتغيرات المطلوبة، توثيق كل مفاتيح .env في .env.example،
 * صلاحية المسارات، وضع التشغيل، ومساحة القرص.
 */
'use strict';

const fs = require('fs');

const REQUIRED_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'];

function exampleKeys(file) {
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const set = new Set();
        for (const line of raw.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
            if (m) {set.add(m[1]);}
        }
        return set;
    } catch (_) { return null; }
}

module.exports = [
    {
        id: 'config.required_present',
        domain: 'config',
        title: 'المتغيرات المطلوبة مُعيّنة',
        description: 'DB_HOST/DB_PORT/DB_USER/DB_NAME يجب أن تكون موجودة في .env.',
        severity: 'HIGH',
        detect: (ctx) => {
            const missing = REQUIRED_KEYS.filter((k) => !ctx.isSet(k));
            if (!missing.length) {return { status: 'pass', detail: 'كل المتغيرات المطلوبة مُعيّنة' };}
            return { status: 'fail', severity: 'HIGH', detail: 'متغيرات مطلوبة ناقصة: ' + missing.join(', '), evidence: { missing }, remediation: 'أضف القيم الناقصة إلى .env' };
        },
    },

    {
        id: 'config.env_example_parity',
        domain: 'config',
        title: 'توثيق مفاتيح .env في .env.example',
        description: 'كل مفتاح مستخدم في .env يجب أن يكون موثّقًا في .env.example حتى لا يفقده نشر جديد.',
        severity: 'LOW',
        detect: (ctx) => {
            const ex = exampleKeys(ctx.paths.envExample);
            if (ex === null) {return { status: 'warn', severity: 'LOW', detail: 'لا يوجد .env.example', remediation: 'أنشئ .env.example يوثّق كل المفاتيح' };}
            const used = Object.keys(ctx.env || {});
            const undocumented = used.filter((k) => !ex.has(k));
            if (!undocumented.length) {return { status: 'pass', detail: 'كل مفاتيح .env موثّقة في المثال' };}
            return {
                status: 'warn', severity: 'LOW',
                detail: `${undocumented.length} مفتاحًا غير موثّق في .env.example (${undocumented.slice(0, 8).join(', ')}${undocumented.length > 8 ? '…' : ''})`,
                evidence: { undocumented },
                remediation: 'أضف المفاتيح الناقصة (بلا قيم) إلى .env.example',
            };
        },
        remediate: (ctx) => {
            const ex = exampleKeys(ctx.paths.envExample);
            if (ex === null) {return { ok: false, message: 'لا يوجد .env.example للتحديث' };}
            const used = Object.keys(ctx.env || {});
            const missing = used.filter((k) => !ex.has(k));
            if (!missing.length) {return { ok: true, message: 'لا مفاتيح ناقصة' };}
            ctx.backupFile(ctx.paths.envExample, 'audit');
            const block = '\n# ─── مفاتيح أُضيفت تلقائيًا بواسطة مدقق النظام ───\n' +
                missing.map((k) => `${k}=`).join('\n') + '\n';
            fs.appendFileSync(ctx.paths.envExample, block, 'utf8');
            return { ok: true, message: `تم توثيق ${missing.length} مفتاحًا في .env.example`, changed: true };
        },
    },

    {
        id: 'config.node_env',
        domain: 'config',
        title: 'وضع التشغيل (NODE_ENV)',
        description: 'يجب أن يكون NODE_ENV مضبوطًا صراحة (production للخادم الحي).',
        severity: 'INFO',
        detect: (ctx) => {
            const v = ctx.envValue('NODE_ENV');
            if (!v) {return { status: 'warn', severity: 'LOW', detail: 'NODE_ENV غير مُعيّن — سيعتبره Node development', remediation: 'عيّن NODE_ENV=production في .env' };}
            if (v === 'production') {return { status: 'pass', detail: 'NODE_ENV=production' };}
            return { status: 'info', detail: `NODE_ENV=${v}` };
        },
    },

    {
        id: 'config.paths_valid',
        domain: 'config',
        title: 'صلاحية المسارات الحيوية',
        description: 'مجلد البيانات ومجلد جلسات واتساب ومجلد النسخ الاحتياطي يجب أن تكون موجودة وقابلة للكتابة.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const targets = [
                ['dataDir', ctx.paths.dataDir],
                ['whatsappSessionDir', ctx.paths.whatsappSessionDir],
                ['reportDir', ctx.paths.reportDir],
            ];
            const problems = [];
            for (const [name, p] of targets) {
                if (!p) {continue;}
                try {
                    if (!fs.existsSync(p)) {problems.push(`${name} غير موجود (${p})`); continue;}
                    fs.accessSync(p, fs.constants.W_OK);
                } catch (_) {
                    problems.push(`${name} غير قابل للكتابة (${p})`);
                }
            }
            if (!problems.length) {return { status: 'pass', detail: 'كل المسارات الحيوية موجودة وقابلة للكتابة' };}
            return { status: 'warn', severity: 'MEDIUM', detail: problems.join('؛ '), evidence: { problems }, remediation: 'أنشئ المجلدات الناقصة أو صحّح الصلاحيات' };
        },
        remediate: (ctx) => {
            const made = [];
            for (const p of [ctx.paths.dataDir, ctx.paths.whatsappSessionDir, ctx.paths.reportDir, ctx.paths.backupDir]) {
                try { if (p && !fs.existsSync(p)) {fs.mkdirSync(p, { recursive: true }); made.push(p);} } catch (_) {}
            }
            return { ok: true, message: made.length ? `تم إنشاء ${made.length} مجلدًا` : 'لا مجلدات ناقصة', changed: made.length > 0 };
        },
    },

    {
        id: 'config.disk_space',
        domain: 'config',
        title: 'مساحة القرص الحرة',
        description: 'مساحة حرة كافية على قرص البيانات تمنع فشل الكتابة/النسخ الاحتياطي.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            try {
                const target = ctx.paths.dataDir || ctx.root;
                const st = fs.statfsSync(target);
                const freeGb = (st.bavail * st.bsize) / (1024 ** 3);
                const totalGb = (st.blocks * st.bsize) / (1024 ** 3);
                if (freeGb < 1) {return { status: 'fail', severity: 'HIGH', detail: `مساحة حرة حرجة: ${freeGb.toFixed(2)}GB متبقية`, evidence: { freeGb, totalGb }, remediation: 'حرّر مساحة أو انقل مجلد البيانات' };}
                if (freeGb < 5) {return { status: 'warn', severity: 'MEDIUM', detail: `مساحة حرة منخفضة: ${freeGb.toFixed(2)}GB`, evidence: { freeGb, totalGb } };}
                return { status: 'pass', detail: `مساحة حرة ${freeGb.toFixed(1)}GB من ${totalGb.toFixed(0)}GB` };
            } catch (_) {
                return { status: 'info', detail: 'تعذّر قياس مساحة القرص على هذا النظام' };
            }
        },
    },
];
