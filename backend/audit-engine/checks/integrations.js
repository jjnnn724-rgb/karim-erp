/**
 * audit-engine/checks/integrations.js — فحوصات التكاملات الخارجية
 * ────────────────────────────────────────────────────────────────────────────
 * واتساب (من سجل wa_events الحي)، Oracle/Yarasoft، ZATCA، والبصمة.
 * هذه فحوصات سياقية: تُبلّغ عن الحالة الفعلية دون افتراض أن كل تكامل مُفعّل.
 */
'use strict';

async function q(ctx, sql, params) {
    if (!ctx.pool) {throw new Error('لا pool');}
    return (await ctx.pool.query(sql, params || [])).rows;
}

module.exports = [
    {
        id: 'integ.whatsapp_state',
        domain: 'integrations',
        title: 'حالة اتصال واتساب (من السجل الحي)',
        description: 'يقرأ آخر حالة مسجّلة في wa_events ويصنّفها: متصل/بانتظار QR/خروج (جلسة مرفوضة)/خامل.',
        severity: 'MEDIUM',
        detect: async (ctx) => {
            const enabled = String(ctx.envValue('WHATSAPP_ENABLED') || '').toLowerCase() === 'true';
            if (!enabled) {return { status: 'info', detail: 'واتساب معطّل (WHATSAPP_ENABLED≠true)' };}
            try {
                const rows = await q(ctx, "SELECT ref, detail, created_at FROM wa_events WHERE kind='state' ORDER BY created_at DESC LIMIT 1");
                if (!rows.length) {return { status: 'info', detail: 'واتساب مُفعّل لكن لا أحداث حالة مسجّلة بعد' };}
                const last = rows[0];
                const ageMin = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);
                const state = String(last.ref || '').toUpperCase();
                const ev = { state, ageMin, detail: String(last.detail || '').slice(0, 80) };
                if (state === 'CONNECTED') {return { status: 'pass', detail: `واتساب متصل (قبل ${ageMin} د)`, evidence: ev };}
                if (state === 'QR_REQUIRED') {return { status: 'info', detail: `بانتظار مسح رمز QR (قبل ${ageMin} د)`, evidence: ev };}
                if (state === 'LOGGED_OUT') {
                    return { status: 'warn', severity: 'MEDIUM', detail: `جلسة واتساب مرفوضة/خروج (LOGGED_OUT قبل ${ageMin} د) — يلزم إعادة ربط`, evidence: ev, remediation: 'بعد تطبيق إصلاح حلقة 401: أعد تشغيل الخدمة ثم امسح QR الجديد من صفحة واتساب' };
                }
                return { status: 'warn', severity: 'LOW', detail: `حالة واتساب: ${state} (قبل ${ageMin} د)`, evidence: ev };
            } catch (e) {
                return { status: 'info', detail: 'تعذّر قراءة سجل واتساب: ' + String(e.message).slice(0, 100) };
            }
        },
    },

    {
        id: 'integ.yarasoft_oracle',
        domain: 'integrations',
        title: 'اتصال قاعدة الكاشير (إن كان مُفعّلًا)',
        description: 'عند تفعيل الربط المباشر يجب توفّر Host/Service/User/Password.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const on = String(ctx.envValue('YARASOFT_ORACLE_ENABLED') || '').toLowerCase() === 'true';
            if (!on) {return { status: 'info', detail: 'الربط المباشر بقاعدة الكاشير معطّل' };}
            const need = ['YARASOFT_ORACLE_HOST', 'YARASOFT_ORACLE_SERVICE', 'YARASOFT_ORACLE_USER', 'YARASOFT_ORACLE_PASSWORD'];
            const missing = need.filter((k) => !ctx.isSet(k));
            if (!missing.length) {return { status: 'pass', detail: 'إعدادات الاتصال مكتملة' };}
            return { status: 'warn', severity: 'MEDIUM', detail: `الربط مُفعّل لكن ينقص: ${missing.join(', ')}`, evidence: { missing }, remediation: 'أكمل بيانات الاتصال في .env أو عطّل مزامنة قاعدة الكاشير' };
        },
    },

    {
        id: 'integ.zatca',
        domain: 'integrations',
        title: 'مفاتيح ZATCA (الفوترة الإلكترونية السعودية)',
        description: 'سياقي: إن كان النظام يُصدر فواتير ZATCA يلزم وجود المفتاح الخاص والشهادة.',
        severity: 'INFO',
        detect: (ctx) => {
            const hasKey = ctx.isSet('ZATCA_PRIVATE_KEY');
            const hasCert = ctx.isSet('ZATCA_CERTIFICATE') || ctx.isSet('ZATCA_PUBLIC_KEY');
            if (hasKey && hasCert) {return { status: 'pass', detail: 'مفاتيح ZATCA موجودة' };}
            if (!hasKey && !hasCert) {return { status: 'info', detail: 'ZATCA غير مُعدّ (لا مفاتيح) — مطلوب فقط إن كنت تُصدر فواتير ضريبية سعودية', remediation: 'إن لزم: أضف ZATCA_PRIVATE_KEY و ZATCA_CERTIFICATE من بوابة فتح' };}
            return { status: 'warn', severity: 'LOW', detail: 'إعداد ZATCA ناقص (مفتاح أو شهادة)', remediation: 'أكمل ZATCA_PRIVATE_KEY و ZATCA_CERTIFICATE معًا' };
        },
    },

    {
        id: 'integ.attendance_device',
        domain: 'integrations',
        title: 'جهاز البصمة (ZKTeco)',
        description: 'سياقي: يتحقق من ضبط إعدادات جهاز الحضور إن كان مُفعّلًا.',
        severity: 'INFO',
        detect: (ctx) => {
            const host = ctx.envValue('ZKTECO_HOST') || ctx.envValue('ATTENDANCE_DEVICE_IP');
            const enabled = String(ctx.envValue('ZKTECO_ENABLED') || '').toLowerCase() === 'true';
            if (!enabled && !host) {return { status: 'info', detail: 'جهاز البصمة غير مُفعّل/غير مُعدّ' };}
            if (enabled && !host) {return { status: 'warn', severity: 'LOW', detail: 'البصمة مُفعّلة لكن لا عنوان جهاز', remediation: 'عيّن ZKTECO_HOST' };}
            return { status: 'pass', detail: `جهاز البصمة مُعدّ (${host})` };
        },
    },
];
