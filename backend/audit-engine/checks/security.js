/**
 * audit-engine/checks/security.js — فحوصات الوضع الأمني
 * ────────────────────────────────────────────────────────────────────────────
 * تركّز على الأسرار الفعلية المستخدمة في التوقيع (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET)
 * لا المتغيرات القديمة، وعلى قوة كلمات المرور والأسرار المكشوفة.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER_RE = /^(replace-me|changeme|change-me|your-|xxx|test|dummy|dev-secret)/i;

function secretStatus(v) {
    if (!v || !String(v).trim()) {return { ok: false, reason: 'غير مُعيّن' };}
    const s = String(v).trim();
    if (PLACEHOLDER_RE.test(s)) {return { ok: false, reason: 'قيمة placeholder مكشوفة' };}
    if (s.length < 32) {return { ok: false, reason: `قصير (${s.length} حرفًا) — المطلوب ≥32` };}
    return { ok: true, len: s.length };
}

function secretCheck(key, title, severity) {
    return {
        id: `sec.${key.toLowerCase()}`,
        domain: 'security',
        title,
        description: `التأكد أن ${key} سرّ عشوائي قوي (≥32 حرفًا) وليس قيمة افتراضية/مكشوفة.`,
        severity,
        detect: (ctx) => {
            const v = ctx.envValue(key);
            const st = secretStatus(v);
            if (st.ok) {return { status: 'pass', detail: `${key} مُعيّن وقوي (${st.len} حرفًا)` };}
            return {
                status: 'fail', severity,
                detail: `${key}: ${st.reason}`,
                evidence: { key, set: Boolean(v) },
                remediation: `ولّد سرًا عشوائيًا (64 hex) وضعه في .env كـ ${key}=... ثم أعد تشغيل الخدمة`,
            };
        },
        remediate: (ctx) => {
            const before = ctx.envValue(key);
            const st = secretStatus(before);
            if (st.ok) {return { ok: true, message: 'لا حاجة — السرّ قوي بالفعل' };}
            const val = ctx.generateSecret(48);
            ctx.upsertEnvKey(ctx.envFile, key, val);
            return { ok: true, message: `تم توليد ${key} قوي وكتابته في .env (يسري بعد إعادة تشغيل الخدمة)`, changed: true };
        },
    };
}

module.exports = [
    secretCheck('JWT_ACCESS_SECRET', 'سرّ توقيع Access Token (JWT_ACCESS_SECRET)', 'CRITICAL'),
    secretCheck('JWT_REFRESH_SECRET', 'سرّ توقيع Refresh Token (JWT_REFRESH_SECRET)', 'CRITICAL'),
    secretCheck('EMPLOYEE_QR_SECRET', 'سرّ توقيع QR الموظفين (EMPLOYEE_QR_SECRET)', 'HIGH'),

    {
        id: 'sec.boot_validator_targets',
        domain: 'security',
        title: 'مدقق الإقلاع يستهدف الأسرار الفعلية (لا JWT_SECRET القديم)',
        description: 'startup.js يجب أن يتحقق من JWT_ACCESS_SECRET/JWT_REFRESH_SECRET المستخدمة فعلًا في التوقيع، لا متغير JWT_SECRET القديم (احتياطي QR فقط) الذي يُنتج إنذارًا كاذبًا.',
        severity: 'HIGH',
        fixRisk: 'review',
        detect: (ctx) => {
            try {
                const startupPath = path.join(ctx.root, 'backend', 'startup.js');
                const src = fs.readFileSync(startupPath, 'utf8');
                const validatesAccess = /JWT_ACCESS_SECRET/.test(src);
                const validatesLegacy = /(^|[^_])JWT_SECRET\b/m.test(src);
                const reportPath = path.join(ctx.root, 'logs', 'startup-report.json');
                let falseFatal = false;
                try {
                    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                    falseFatal = Array.isArray(rep.fatalErrors) && rep.fatalErrors.some((e) => e.key === 'JWT_SECRET') && secretStatus(ctx.envValue('JWT_ACCESS_SECRET')).ok;
                } catch (_) {}
                if (validatesAccess && !falseFatal) {
                    return { status: 'pass', detail: 'المدقق يستهدف الأسرار الفعلية' };
                }
                return {
                    status: 'warn', severity: 'HIGH',
                    detail: validatesLegacy && !validatesAccess
                        ? 'startup.js يتحقق من JWT_SECRET القديم ويتجاهل JWT_ACCESS_SECRET/JWT_REFRESH_SECRET الحقيقية'
                        : 'يوجد إنذار FATAL كاذب بخصوص JWT_SECRET في startup-report.json رغم أن سرّ التوقيع الفعلي قوي',
                    evidence: { validatesAccess, validatesLegacy, falseFatal },
                    remediation: 'عدّل قاعدة startup.js لتتحقق من JWT_ACCESS_SECRET و JWT_REFRESH_SECRET (≥32) بدل JWT_SECRET القديم',
                };
            } catch (e) {
                return { status: 'error', detail: 'تعذّر فحص startup.js: ' + String(e.message).slice(0, 120) };
            }
        },
    },

    {
        id: 'sec.db_password_strength',
        domain: 'security',
        title: 'قوة كلمة مرور قاعدة البيانات',
        description: 'كلمة مرور PostgreSQL يجب أن تكون ≥12 حرفًا وتحتوي حروفًا وأرقامًا.',
        severity: 'MEDIUM',
        fixRisk: 'review',
        detect: (ctx) => {
            const v = ctx.envValue('DB_PASSWORD') || '';
            const strong = v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v);
            if (strong) {return { status: 'pass', detail: 'كلمة مرور القاعدة قوية' };}
            return {
                status: 'warn', severity: 'MEDIUM',
                detail: `DB_PASSWORD ضعيفة (${v.length} حرفًا) — يُنصح بـ ≥12 حرفًا مع حروف وأرقام`,
                remediation: 'غيّر كلمة مرور مستخدم postgres ثم حدّث DB_PASSWORD في .env (يتطلب إعادة تشغيل)',
            };
        },
    },

    {
        id: 'sec.no_placeholder_secrets',
        domain: 'security',
        title: 'لا أسرار placeholder في .env',
        description: 'مسح .env بحثًا عن قيم placeholder مكشوفة (replace-me...) لأي مفتاح يحوي SECRET/KEY/TOKEN/PASSWORD.',
        severity: 'HIGH',
        detect: (ctx) => {
            const bad = [];
            for (const [k, v] of Object.entries(ctx.env)) {
                if (!/SECRET|KEY|TOKEN|PASSWORD/i.test(k)) {continue;}
                if (PLACEHOLDER_RE.test(String(v || ''))) {bad.push(k);}
            }
            if (!bad.length) {return { status: 'pass', detail: 'لا أسرار placeholder' };}
            return { status: 'fail', severity: 'HIGH', detail: 'أسرار placeholder مكشوفة: ' + bad.join(', '), evidence: { keys: bad }, remediation: 'استبدل كل قيمة placeholder بسرّ عشوائي قوي' };
        },
    },

    {
        id: 'sec.env_gitignored',
        domain: 'security',
        title: 'ملف .env مستثنى من git',
        description: 'التأكد أن .env مُدرج في .gitignore حتى لا تُرفع الأسرار للمستودع.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            try {
                const gi = fs.readFileSync(path.join(ctx.root, '.gitignore'), 'utf8');
                const ok = /(^|\n)\s*\.env(\s|$|\/)/.test(gi) || /(^|\n)\.env\b/.test(gi);
                if (ok) {return { status: 'pass', detail: '.env مستثنى في .gitignore' };}
                return { status: 'warn', severity: 'MEDIUM', detail: '.env غير مُدرج صراحة في .gitignore', remediation: 'أضف سطر ".env" إلى .gitignore' };
            } catch (_) {
                return { status: 'info', detail: 'لا يوجد .gitignore (المشروع خارج git حاليًا)' };
            }
        },
    },

    {
        id: 'sec.api_key_posture',
        domain: 'security',
        title: 'حماية /api بمفتاح (API_KEY)',
        description: 'إن لم يكن API_KEY مُعيّنًا فكل نقاط /api متاحة بلا ترويسة x-api-key (مقبول على LAN موثوقة فقط).',
        severity: 'LOW',
        fixRisk: 'review',
        detect: (ctx) => {
            if (ctx.isSet('API_KEY')) {return { status: 'pass', detail: 'API_KEY مُعيّن — نقاط /api محمية بترويسة' };}
            return {
                status: 'info',
                detail: 'API_KEY غير مُعيّن — /api بلا طبقة مفتاح إضافية (مقبول على شبكة محلية موثوقة؛ فعّله إن كانت الشبكة غير موثوقة)',
                remediation: 'عيّن API_KEY=<32+ حرفًا> في .env — تنبيه: يتطلب أن يرسل كل عميل ترويسة x-api-key',
            };
        },
    },
];
