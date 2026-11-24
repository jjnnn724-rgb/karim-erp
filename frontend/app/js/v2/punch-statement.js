/**
 * v2/punch-statement.js — كشف البصمات: دخل امتى وخرج امتى وكم ساعة
 * ═══════════════════════════════════════════════════════════════════════
 * تابع لصفحة «أجهزة بصمة الحضور» (تبويب جديد). لا يقرأ الوردية ولا التأخير
 * ولا أي سماحية: كل الأرقام من البصمات نفسها، والساعات من الفرق بين
 * بصمتين متتاليتين. الأوقات بتوقيت النظام المعتمد (توقيت مكة) — نفس ساعة
 * بقية الشاشات، بلا استثناء.
 * المبدأ: بصمة ناقصة = خانة فارغة + علامة «يحتاج توقيع»، لا وقت مُختلَق.
 */

const PSSTATE = { from: '', to: '', data: null, loading: false };

function psToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// غلاف التطبيق المعتمد (main.js) — بوابة الأمان لا تقبل سواه في innerHTML
const esc = window.esc || ((v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

/** 'HH:MM' → '1 س 17 د' — بلا قسمة على مدة وردية. */
function psHoursText(minutes) {
    if (minutes === null || minutes === undefined) {return '—';}
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? `${h} س ${m ? `${m} د` : ''}`.trim() : `${m} د`;
}

async function psLoad() {
    const body = document.getElementById('psBody');
    if (!body) {return;}
    const from = document.getElementById('psFrom')?.value || PSSTATE.from;
    const to = document.getElementById('psTo')?.value || PSSTATE.to;
    PSSTATE.from = from; PSSTATE.to = to;
    body.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
    PSSTATE.loading = true;
    try {
        PSSTATE.data = await apiFetch(`/attendance/punches?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        psRenderBody(body);
    } catch (e) {
        body.innerHTML = `<div class="mcard u-empty"><div style="color:#c0392b">${esc(e.message || 'تعذر جلب كشف البصمات')}</div></div>`;
    } finally { PSSTATE.loading = false; }
}

function psRenderRows(data) {
    return (data.employees || []).map(emp => {
        if (!emp.rows.length) {return '';}
        const head = `<tr style="background:#f1f5f9"><td colspan="6" style="text-align:right;font-weight:800;color:#0f172a">${esc(emp.employee.name)} <small style="color:#64748b;font-weight:400">(${esc(emp.employee.employeeId)} • ${esc(emp.employee.department || '—')} • ${emp.totals.hoursWorked} س)</small></td></tr>`;
        const rows = emp.rows.map(r => `<tr>
            <td dir="ltr">${esc(r.date)}</td>
            <td dir="ltr">${esc(r.entryTime || '—')}${r.entrySource ? ` <small style="color:#94a3b8">${r.entrySource === 'device' ? 'بصمة' : 'تطبيق'}</small>` : ''}</td>
            <td dir="ltr">${r.exitTime ? `${esc(r.exitTime)} <small style="color:#94a3b8">${r.exitSource === 'device' ? 'بصمة' : 'تطبيق'}</small>` : '<span style="color:#f59e0b;font-weight:700">بلا بصمة خروج</span>'}</td>
            <td>${psHoursText(r.minutesWorked)}</td>
            <td dir="ltr" style="color:#64748b;font-size:11px">${r.exitAt ? `${esc(String(r.entryAt).slice(0, 16))} → ${esc(String(r.exitAt).slice(0, 16))}` : '—'}</td>
            <td style="text-align:right;font-size:11px;color:${(r.flags || []).length ? '#9a7417' : '#27ae60'}">${(r.flags || []).length ? esc(r.flags.join(' • ')) : 'سليمة'}</td>
        </tr>`).join('');
        return head + rows;
    }).join('') || '<tr><td colspan="6">لا بصمات في هذه الفترة</td></tr>';
}

function psRenderBody(el) {
    const d = PSSTATE.data;
    if (!d) {return;}
    el.innerHTML = `
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
  <label>من <input type="date" id="psFrom" value="${esc(PSSTATE.from)}" class="input input-sm"></label>
  <label>إلى <input type="date" id="psTo" value="${esc(PSSTATE.to)}" class="input input-sm"></label>
  <button class="btn btn-gold btn-sm" data-karim-action="psLoad"><i class=ji data-i=search></i> عرض البصمات</button>
  <button class="btn btn-blue btn-sm" data-karim-action="psPrint"><i class=ji data-i=printer></i> طباعة الكشف</button>
  <span style="color:#64748b;font-size:12px">الساعة: ${esc(d.timezone)} (${esc(d.offsetLabel)}) • أساس الكشف: ${d.basis === 'raw-punches-only' ? 'البصمات فقط — لا وردية ولا سماحية' : esc(d.basis)}</span>
</div>
<div class="summary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">
  <div class="mcard" style="padding:12px;text-align:center"><small>موظفون ببصمات</small><div style="font-size:20px;font-weight:800">${d.totals.employeesWithPunches}</div></div>
  <div class="mcard" style="padding:12px;text-align:center"><small>إجمالي الساعات</small><div style="font-size:20px;font-weight:800;color:#9a7417">${d.totals.hoursWorked}</div></div>
  <div class="mcard" style="padding:12px;text-align:center"><small>بلا بصمة خروج</small><div style="font-size:20px;font-weight:800;color:#f59e0b">${d.totals.openSegments}</div></div>
  <div class="mcard" style="padding:12px;text-align:center"><small>يحتاج مراجعة</small><div style="font-size:20px;font-weight:800;color:#c0392b">${d.totals.reviewRows}</div></div>
</div>
<table><thead><tr><th>التاريخ</th><th>دخول</th><th>خروج</th><th>الساعات</th><th>اللحظتان (UTC)</th><th>ملاحظة</th></tr></thead>
<tbody>${psRenderRows(d)}</tbody></table>`;
}

/** نسخة الطباعة — نفس الأرقام، بلا ألوان الشاشة. */
async function psPrint() {
    const d = PSSTATE.data;
    if (!d) {toast('اعرض الكشف أولًا', 'warning'); return;}
    const win = window.openInAppReport ? window.openInAppReport('كشف البصمات') : window.open('', '_blank');
    if (!win) {toast('اسمح بالنوافذ المنبثقة لطباعة الكشف', 'warning'); return;}
    let logoSrc = '';
    try { logoSrc = window.printLogoDataUrl ? await window.printLogoDataUrl() : ''; } catch (_) { /* الشعار تزيين — كشفٌ بلا شعار أفضل من لا كشف */ }
    win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>كشف البصمات ${esc(d.from)} — ${esc(d.to)}</title><style>
body{font-family:'IBM Plex Sans Arabic','Tajawal',Tahoma,sans-serif;margin:0;color:#1a1a2e;background:#fff}
.header{background:#0f172a;color:#fff;padding:18px 24px;display:flex;gap:14px;align-items:center}
.header img{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:10px;padding:4px}
.header h1{margin:0;font-size:20px}.header p{margin:4px 0 0;color:#cbd5e1;font-size:12px}
.container{padding:18px 24px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{background:#0f172a;color:#dcede4;padding:8px;font-size:11px}
td{padding:7px;border-bottom:1px solid #eef2f1;text-align:center;font-size:12px}
tr.grp td{text-align:right;font-weight:800;background:#f1f5f9;color:#0f172a}
.warn{color:#9a7417;font-size:11px}.ok{color:#27ae60;font-size:11px}
.footer{margin-top:16px;border-top:1px solid #e2e8f0;padding-top:8px;color:#94a3b8;font-size:11px;text-align:center}
@media print{.header{print-color-adjust:exact;-webkit-print-color-adjust:exact}th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="header">${logoSrc ? `<img src="${esc(logoSrc)}" alt="logo" data-karim-imgerror="hide">` : ''}<div><h1>${esc((window.STATE && window.STATE.settings && window.STATE.settings.name) || 'كشف البصمات')}</h1><p>كشف البصمات الخام — ${esc(d.from)} → ${esc(d.to)} • الساعة ${esc(d.timezone)} (${esc(d.offsetLabel)})</p></div></div>
<div class="container">
<p style="font-size:12px;color:#475569">كل سطرٍ بصمتان متتاليتان للموظف نفسه: دخولٌ ثم خروجٌ، والساعات فرقُهما الحقيقي. لا وقتٌ يُنسَب إلى وردية، ولا خروجٌ يُختلق حين تنقص البصمة — الصف الناقص يظهر «بلا بصمة خروج» ويوقّعه المسؤول.</p>
<table><thead><tr><th>التاريخ</th><th>دخول</th><th>خروج</th><th>الساعات</th><th>ملاحظة</th></tr></thead><tbody>
${(d.employees || []).map(emp => emp.rows.length ? `<tr class="grp"><td colspan="5">${esc(emp.employee.name)} • ${esc(emp.employee.employeeId)} • ${emp.totals.hoursWorked} س</td></tr>` + emp.rows.map(r => `<tr><td dir="ltr">${esc(r.date)}</td><td dir="ltr">${esc(r.entryTime || '—')}</td><td dir="ltr">${esc(r.exitTime || 'بلا بصمة خروج')}</td><td>${psHoursText(r.minutesWorked)}</td><td class="${(r.flags || []).length ? 'warn' : 'ok'}">${esc((r.flags || []).join(' • ') || 'سليمة')}</td></tr>`).join('') : '').join('')}
</tbody></table>
<div class="footer">إجمالي الساعات ${d.totals.hoursWorked} • بلا بصمة خروج ${d.totals.openSegments} • يحتاج مراجعة ${d.totals.reviewRows} • تم التوليد ${new Date().toLocaleString('ar-EG')}</div>
</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    win.document.close();
}

async function psRenderInto(el) {
    el.innerHTML = `
<div class="mcard" style="padding:14px">
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
  <strong>من</strong><input type="date" id="psFrom" class="input input-sm">
  <strong>إلى</strong><input type="date" id="psTo" class="input input-sm">
  <button class="btn btn-gold btn-sm" data-karim-action="psLoad"><i class=ji data-i=search></i> عرض البصمات</button>
  <span style="font-size:12px;color:#64748b">دخل/خرج/كم ساعة — من البصمة نفسها، لكل الموظفين النشطين.</span>
</div>
<div id="psBody"><div class="mcard u-empty"><div class="spinner"></div></div></div>
</div>`;
    const first = document.getElementById('psFrom'), last = document.getElementById('psTo');
    const today = psToday();
    if (first && !first.value) {first.value = PSSTATE.from || `${today.slice(0, 8)}01`;}
    if (last && !last.value) {last.value = PSSTATE.to || today;}
    PSSTATE.from = first ? first.value : PSSTATE.from;
    PSSTATE.to = last ? last.value : PSSTATE.to;
    await psLoad();
}

export { PSSTATE, psToday, psLoad, psPrint, psRenderInto, psRenderBody, psRenderRows, psHoursText };
