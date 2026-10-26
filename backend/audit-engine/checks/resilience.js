/**
 * audit-engine/checks/resilience.js — فحوصات الصلابة والمرونة
 * ────────────────────────────────────────────────────────────────────────────
 * تتحقق من مهلات اتصال القاعدة، تشبّع الـ pool، وجود وحدات الحماية
 * (circuit-breaker / graceful-shutdown / health) التي تمنع السقوط المتسلسل.
 */
'use strict';

const path = require('path');
const fs = require('fs');

module.exports = [
    {
        id: 'resil.pool_timeouts',
        domain: 'resilience',
        title: 'مهلات اتصال قاعدة البيانات مضبوطة',
        description: 'connectionTimeoutMillis و statement_timeout يمنعان تعليق الطلبات إلى الأبد عند بطء القاعدة.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            const opts = (ctx.pool && ctx.pool.options) || {};
            const conn = opts.connectionTimeoutMillis;
            const stmt = opts.statement_timeout || opts.query_timeout;
            const problems = [];
            if (!conn) {problems.push('connectionTimeoutMillis غير مضبوط');}
            if (!stmt) {problems.push('statement_timeout غير مضبوط');}
            if (!problems.length) {return { status: 'pass', detail: `المهلات مضبوطة (conn=${conn}ms, stmt=${stmt}ms)` };}
            return { status: 'warn', severity: 'MEDIUM', detail: problems.join('؛ '), evidence: { conn, stmt }, remediation: 'اضبط connectionTimeoutMillis و statement_timeout في إعدادات الـ Pool' };
        },
    },

    {
        id: 'resil.pool_saturation',
        domain: 'resilience',
        title: 'تشبّع مجموعة الاتصالات (pool)',
        description: 'وجود طلبات منتظرة (waiting) يعني أن الـ pool وصل للحد الأقصى وقد يسبب بطئًا.',
        severity: 'MEDIUM',
        detect: (ctx) => {
            if (!ctx.pool) {return { status: 'info', detail: 'لا pool متاح للفحص' };}
            const waiting = ctx.pool.waitingCount || 0;
            const total = ctx.pool.totalCount || 0;
            const max = (ctx.pool.options && ctx.pool.options.max) || 0;
            if (waiting > 0) {
                return { status: 'warn', severity: 'MEDIUM', detail: `${waiting} طلبًا بانتظار اتصال (total=${total}/${max})`, evidence: { waiting, total, max }, remediation: 'ارفع DB_POOL_MAX أو قلّل الاستعلامات الطويلة' };
            }
            return { status: 'pass', detail: `لا طلبات منتظرة (total=${total}/${max})` };
        },
    },

    {
        id: 'resil.circuit_breaker',
        domain: 'resilience',
        title: 'وحدة قاطع الدائرة (circuit-breaker) متاحة',
        description: 'قاطع الدائرة يحمي النظام من السقوط المتسلسل عند فشل التكاملات الخارجية.',
        severity: 'LOW',
        detect: (ctx) => {
            try {
                const c = require(path.join(ctx.root, 'backend', 'middleware', 'circuit'));
                const ok = typeof c.protect === 'function' && typeof c.withRetry === 'function' && typeof c.getCircuitSnapshot === 'function';
                if (ok) {return { status: 'pass', detail: 'قاطع الدائرة + إعادة المحاولة متاحان' };}
                return { status: 'warn', severity: 'LOW', detail: 'وحدة circuit.js ناقصة بعض الدوال', remediation: 'راجع backend/middleware/circuit.js' };
            } catch (e) {
                return { status: 'fail', severity: 'MEDIUM', detail: 'تعذّر تحميل circuit.js: ' + String(e.message).slice(0, 120) };
            }
        },
    },

    {
        id: 'resil.graceful_shutdown',
        domain: 'resilience',
        title: 'الإيقاف الآمن (graceful-shutdown)',
        description: 'وحدة الإيقاف الآمن تغلق الاتصالات والخوادم بنظافة عند SIGTERM/SIGINT لمنع تلف البيانات.',
        severity: 'LOW',
        detect: (ctx) => {
            const p = path.join(ctx.root, 'backend', 'graceful-shutdown.js');
            if (fs.existsSync(p)) {return { status: 'pass', detail: 'graceful-shutdown.js موجود' };}
            return { status: 'warn', severity: 'LOW', detail: 'لا توجد وحدة إيقاف آمن', remediation: 'أضف معالج SIGTERM/SIGINT يغلق الخادم والـ pool' };
        },
    },

    {
        id: 'resil.health_endpoints',
        domain: 'resilience',
        title: 'نقاط الفحص الصحي (health)',
        description: 'middleware/health.js يوفّر /live /ready لمراقبة جاهزية الخدمة.',
        severity: 'LOW',
        detect: (ctx) => {
            try {
                const h = require(path.join(ctx.root, 'backend', 'middleware', 'health'));
                const ok = typeof h.registerCheck === 'function' || typeof h.healthRouter !== 'undefined' || typeof h.router !== 'undefined';
                if (ok) {return { status: 'pass', detail: 'وحدة الفحص الصحي متاحة' };}
                return { status: 'info', detail: 'وحدة health محمّلة لكن واجهتها غير معتادة' };
            } catch (e) {
                return { status: 'warn', severity: 'LOW', detail: 'تعذّر تحميل middleware/health.js: ' + String(e.message).slice(0, 120) };
            }
        },
    },
];
