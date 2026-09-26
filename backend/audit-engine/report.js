/**
 * audit-engine/report.js — عرض تقرير الفحص (console / JSON / HTML)
 * ────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const fs = require('fs');
const path = require('path');

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

const SEV_COLOR = { CRITICAL: C.red, HIGH: C.magenta, MEDIUM: C.yellow, LOW: C.blue, INFO: C.gray };
const STATUS_ICON = { pass: '✓', info: 'ℹ', warn: '⚠', fail: '✗', error: '!', fixed: '✔', skipped: '–' };
const STATUS_COLOR = { pass: C.green, info: C.gray, warn: C.yellow, fail: C.red, error: C.magenta, fixed: C.cyan, skipped: C.gray };
const DOMAIN_AR = {
    security: 'الأمان', database: 'قاعدة البيانات', config: 'الإعدادات',
    resilience: 'الصلابة', integrations: 'التكاملات', backups: 'النسخ الاحتياطي', endpoints: 'النقاط',
};

function line(ch = '─', n = 74) { return ch.repeat(n); }

function toConsole(report, opts = {}) {
    const out = [];
    const g = report.grade;
    const gColor = g === 'A' ? C.green : g === 'B' ? C.cyan : g === 'C' ? C.yellow : g === 'D' ? C.yellow : C.red;
    out.push('');
    out.push(`${C.bold}${C.cyan}${line('═')}${C.reset}`);
    out.push(`${C.bold}  KARIM ERP — محرك الفحص الشامل للنظام (System Audit Engine)${C.reset}`);
    out.push(`${C.bold}${C.cyan}${line('═')}${C.reset}`);
    out.push(`  ${C.gray}التوقيت:${C.reset} ${report.generatedAt}   ${C.gray}الإصلاح:${C.reset} ${report.fix ? (report.dryRun ? 'محاكاة (dry-run)' : 'مُفعّل') : 'معطّل'}`);
    out.push('');
    out.push(`  ${C.bold}نتيجة الصحة:${C.reset} ${gColor}${C.bold} ${report.score}/100 (تقدير ${g}) ${C.reset}`);
    const c = report.counts;
    out.push(`  ${C.green}ناجح ${c.pass || 0}${C.reset}  ${C.cyan}مُصلح ${c.fixed || 0}${C.reset}  ${C.yellow}تحذير ${c.warn || 0}${C.reset}  ${C.red}فشل ${c.fail || 0}${C.reset}  ${C.magenta}خطأ فحص ${c.error || 0}${C.reset}  ${C.gray}معلومات ${c.info || 0}${C.reset}`);
    out.push('');

    const domains = [...new Set(report.findings.map((f) => f.domain))];
    for (const d of domains) {
        const items = report.findings.filter((f) => f.domain === d);
        if (opts.onlyProblems) {
            const prob = items.filter((f) => ['fail', 'warn', 'error'].includes(f.status));
            if (!prob.length) {continue;}
        }
        out.push(`${C.bold}${C.blue}▌ ${DOMAIN_AR[d] || d} (${d})${C.reset}`);
        for (const f of items) {
            if (opts.onlyProblems && !['fail', 'warn', 'error', 'fixed'].includes(f.status)) {continue;}
            const icon = STATUS_ICON[f.status] || '•';
            const sc = STATUS_COLOR[f.status] || C.gray;
            const sev = f.status === 'fail' || f.status === 'warn' ? `${SEV_COLOR[f.severity] || ''}[${f.severity}]${C.reset} ` : '';
            out.push(`  ${sc}${icon}${C.reset} ${sev}${f.title}`);
            if (f.detail && f.status !== 'pass') {out.push(`     ${C.gray}${f.detail}${C.reset}`);}
            if (f.fixMessage) {out.push(`     ${C.cyan}→ ${f.fixMessage}${C.reset}`);}
            else if ((f.status === 'fail' || f.status === 'warn') && f.remediation) {out.push(`     ${C.yellow}↳ الإصلاح: ${f.remediation}${C.reset}`);}
        }
        out.push('');
    }

    out.push(`${C.bold}${line('═')}${C.reset}`);
    const verdict = report.ok ? `${C.green}${C.bold}النظام سليم — لا مشاكل حرجة${C.reset}` : `${C.red}${C.bold}توجد مشاكل تحتاج معالجة${C.reset}`;
    out.push(`  ${verdict}   ${C.gray}(نتيجة ${report.score}/100)${C.reset}`);
    out.push(`${C.bold}${line('═')}${C.reset}`);
    out.push('');
    return out.join('\n');
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function toHTML(report) {
    const g = report.grade;
    const scoreColor = report.score >= 90 ? '#16a34a' : report.score >= 80 ? '#0891b2' : report.score >= 70 ? '#ca8a04' : report.score >= 60 ? '#ea580c' : '#dc2626';
    const c = report.counts;
    const domains = [...new Set(report.findings.map((f) => f.domain))];
    const badge = (status, sev) => {
        const map = { pass: ['#dcfce7', '#166534', 'سليم'], info: ['#f1f5f9', '#475569', 'معلومة'], warn: ['#fef9c3', '#854d0e', 'تحذير'], fail: ['#fee2e2', '#991b1b', 'فشل'], error: ['#fae8ff', '#86198f', 'خطأ فحص'], fixed: ['#cffafe', '#155e75', 'تم الإصلاح'], skipped: ['#f1f5f9', '#94a3b8', 'تخطي'] };
        const [bg, fg, txt] = map[status] || map.info;
        const sevTxt = (status === 'fail' || status === 'warn') && sev ? ` · ${sev}` : '';
        return `<span style="background:${bg};color:${fg};padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700">${txt}${sevTxt}</span>`;
    };
    const rows = domains.map((d) => {
        const items = report.findings.filter((f) => f.domain === d);
        const body = items.map((f) => `
            <tr>
              <td style="padding:10px;border-bottom:1px solid #eef2f7;white-space:nowrap">${badge(f.status, f.severity)}</td>
              <td style="padding:10px;border-bottom:1px solid #eef2f7;font-weight:600">${esc(f.title)}</td>
              <td style="padding:10px;border-bottom:1px solid #eef2f7;color:#475569">${esc(f.detail || '')}${f.fixMessage ? `<div style="color:#0e7490;margin-top:4px">→ ${esc(f.fixMessage)}</div>` : (f.remediation && (f.status === 'fail' || f.status === 'warn') ? `<div style="color:#854d0e;margin-top:4px">↳ ${esc(f.remediation)}</div>` : '')}</td>
            </tr>`).join('');
        return `<div style="margin-bottom:22px">
            <h3 style="margin:0 0 8px;font-size:16px;color:#0f172a;border-inline-start:4px solid #2563eb;padding-inline-start:10px">${esc(DOMAIN_AR[d] || d)} <span style="color:#94a3b8;font-weight:400;font-size:13px">(${esc(d)})</span></h3>
            <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eef2f7;border-radius:10px;overflow:hidden"><tbody>${body}</tbody></table>
          </div>`;
    }).join('');

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير الفحص الشامل — Karim ERP</title>
<style>body{font-family:'Segoe UI',Tahoma,system-ui,sans-serif;background:#f6f8fb;color:#0f172a;margin:0;padding:24px}
.wrap{max-width:1000px;margin:0 auto}.card{background:#fff;border:1px solid #e6ebf2;border-radius:14px;padding:20px 24px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.gauge{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.ring{width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#fff}
.kpi{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.kpi span{background:#f1f5f9;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600}</style></head>
<body><div class="wrap">
<div class="card" style="margin-bottom:18px">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <h1 style="font-size:20px;margin:0">تقرير الفحص الشامل للنظام</h1>
    <div style="color:#64748b;font-size:13px">${esc(report.generatedAt)}</div>
  </div>
  <div class="gauge" style="margin-top:16px">
    <div class="ring" style="background:${scoreColor}"><div style="font-size:34px;font-weight:800;line-height:1">${report.score}</div><div style="font-size:12px;opacity:.9">/ 100 · تقدير ${esc(g)}</div></div>
    <div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">${report.ok ? 'النظام سليم — لا مشاكل حرجة' : 'توجد مشاكل تحتاج معالجة'}</div>
      <div class="kpi">
        <span style="background:#dcfce7;color:#166534">ناجح ${c.pass || 0}</span>
        <span style="background:#cffafe;color:#155e75">مُصلح ${c.fixed || 0}</span>
        <span style="background:#fef9c3;color:#854d0e">تحذير ${c.warn || 0}</span>
        <span style="background:#fee2e2;color:#991b1b">فشل ${c.fail || 0}</span>
        <span style="background:#fae8ff;color:#86198f">خطأ فحص ${c.error || 0}</span>
        <span style="background:#f1f5f9;color:#475569">معلومات ${c.info || 0}</span>
      </div>
      <div style="color:#64748b;font-size:12px;margin-top:8px">الإصلاح: ${report.fix ? (report.dryRun ? 'محاكاة (dry-run)' : 'مُفعّل') : 'معطّل'}</div>
    </div>
  </div>
</div>
<div class="card">${rows}</div>
<div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">Karim ERP — System Audit Engine</div>
</div></body></html>`;
}

function saveReports(report, dir, tag = 'audit') {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const jsonPath = path.join(dir, `${tag}-${ts}.json`);
        const htmlPath = path.join(dir, `${tag}-${ts}.html`);
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
        fs.writeFileSync(htmlPath, toHTML(report), 'utf8');
        const latestJson = path.join(dir, `${tag}-latest.json`);
        const latestHtml = path.join(dir, `${tag}-latest.html`);
        try { fs.copyFileSync(jsonPath, latestJson); fs.copyFileSync(htmlPath, latestHtml); } catch (_) {}
        return { jsonPath, htmlPath, latestJson, latestHtml };
    } catch (_) { return null; }
}

module.exports = { toConsole, toHTML, saveReports, DOMAIN_AR };
