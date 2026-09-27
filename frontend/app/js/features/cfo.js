/**
 * features/cfo.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// CFO — لوحة المدير المالي + دفتر القيود + ميزان المراجعة
// ============================================
const CFO_STATE = { summary: null, tb: null, journal: [], chart: [], from: '', to: '' };
function cfoCanWrite(){ return ['admin', 'accountant'].includes(STATE.currentUser?.role); }
async function renderCfoPage(){
  const content = document.getElementById('content');
  const canWrite = cfoCanWrite();
  const now = new Date();
  if(!CFO_STATE.from) {CFO_STATE.from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;}
  if(!CFO_STATE.to) {CFO_STATE.to = today();}
  content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
  try{
    const [summary, tb, journal, chart] = await Promise.all([
      apiFetch(`/accounting/cfo-summary?from=${CFO_STATE.from}&to=${CFO_STATE.to}`),
      apiFetch(`/accounting/trial-balance?from=${CFO_STATE.from}&to=${CFO_STATE.to}`),
      apiFetch('/accounting/journal?limit=30'),
      apiFetch('/accounting/chart'),
    ]);
    CFO_STATE.summary = summary; CFO_STATE.tb = tb; CFO_STATE.journal = journal; CFO_STATE.chart = chart;
  }catch(e){
    content.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر تحميل بيانات المحاسبة')}</div>`;
    return;
  }
  const s = CFO_STATE.summary;
  const tb = CFO_STATE.tb;
  content.innerHTML = `
  <div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=briefcase></i> ${t('pg.cfo')}</h3>
  <div class="u-row-wrap">
    <input type="date" id="cfoFrom" value="${CFO_STATE.from}" onchange="CFO_STATE.from=this.value">
    <input type="date" id="cfoTo" value="${CFO_STATE.to}" onchange="CFO_STATE.to=this.value">
    <button class="btn btn-blue btn-sm" onclick="renderCfoPage()"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button>
    <button class="btn btn-sm" onclick="cfoPrintSummary()"><i class=ji data-i=printer></i> ${t('cfo.printSum')}</button>
    ${canWrite ? `<button class="btn btn-gold btn-sm" onclick="cfoJournalModal()"><i class=ji data-i=plus></i> ${t('cfo.manual')}</button>
    <button class="btn btn-green btn-sm" onclick="cfoPostPayroll()"><i class=ji data-i=banknote></i> ${t('cfo.postPayroll')}</button>` : ''}
  </div></div>
  <div class="metrics-grid">
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('cfo.revenue')}</div><div class="mcard-val c-green">${fC(s.revenue.total)}</div><small class="text-muted">${fN(s.revenue.count)} ${t('cfo.ops')}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> ${t('cfo.expenses')}</div><div class="mcard-val c-red">${fC(s.expenses.total)}</div><small class="text-muted">${fN(s.expenses.count)} ${t('cfo.ops')}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=gem></i> ${t('cfo.net')}</div><div class="mcard-val ${s.net_approx >= 0 ? 'c-green' : 'c-red'}">${fC(s.net_approx)}</div><small class="text-muted">إيراد − مصروف − رواتب مفتوحة ${fC(s.payroll_open)}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('cfo.cash')}</div><div class="mcard-val c-blue">${fC(s.cash_position)}</div><small class="text-muted">${fN(s.journal_entries)} قيدًا مرحّلًا</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=receipt></i> ${t('cfo.invoices')}</div><div class="mcard-val c-gold">${fC(s.pos.total)}</div><small class="text-muted">${fN(s.pos.invoices)} فاتورة</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('cfo.tb')}</div><div class="mcard-val ${tb.balanced ? 'c-green' : 'c-red'}">${tb.balanced ? t('cfo.balanced') : t('cfo.unbalanced')}</div><small class="text-muted">${t('cfo.debit')} ${fC(tb.total_debit)} = ${t('cfo.credit')} ${fC(tb.total_credit)}</small></div>
  </div>
  <div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=scale></i> ${t('cfo.tbTitle')} (${esc(CFO_STATE.from)} → ${esc(CFO_STATE.to)})</h3>
  <div class="u-row-wrap"><button class="btn btn-sm" onclick="cfoPrintTB()"><i class=ji data-i=printer></i> ${t('cfo.printTB')}</button><button class="btn btn-blue btn-sm" onclick="cfoExportTB()"><i class=ji data-i=inbox></i> ${t('cfo.excel')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.code')}</th><th>${t('cfo.account')}</th><th>${t('cfo.type')}</th><th>${t('cfo.debit')}</th><th>${t('cfo.credit')}</th><th>${t('cfo.balance')}</th></tr></thead><tbody>
  ${tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).map(a => {
    const bal = Number(a.debit) - Number(a.credit);
    return `<tr><td class="mono">${esc(a.code)}</td><td class="fw-bold">${esc(a.name_ar)}</td><td>${esc(a.type)}</td><td>${fC(a.debit)}</td><td>${fC(a.credit)}</td><td class="fw-bold">${fC(bal)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="u-empty-sm">لا حركات في الفترة — رحّل المبيعات تلقائيًا من الكاشير أو أدخل قيدًا يدويًا</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=book></i> ${t('cfo.journalTitle')}</h3>
  <div class="u-row-wrap"><button class="btn btn-sm" onclick="cfoPrintJournal()"><i class=ji data-i=printer></i> ${t('cfo.printJ')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.entryNo')}</th><th>${t('cfo.date')}</th><th>${t('cfo.memo')}</th><th>${t('cfo.source')}</th><th>${t('cfo.lines')}</th><th>${t('cfo.st')}</th><th></th></tr></thead><tbody>
  ${(CFO_STATE.journal || []).map(j => `<tr${j.status !== 'posted' ? ' style="opacity:.55"' : ''}><td class="mono">${esc(j.entry_no)}</td><td>${fD(j.date)}</td><td>${esc(j.memo || '—')}${j.created_by_name ? `<br><small class="text-muted">${t('cfo.by')} @${esc(j.created_by_name)}</small>` : ''}</td><td><span class="badge bdg-blue">${esc(j.source_type)}${j.source_id ? ' #' + esc(j.source_id) : ''}</span></td><td>${(j.lines || []).map(l => `<div><span class="mono">${esc(l.account_code)}</span> ${Number(l.debit) ? `<span class="c-green">${t('cfo.debit')} ${fC(l.debit)}</span>` : `<span class="c-red">${t('cfo.credit')} ${fC(l.credit)}</span>`}</div>`).join('')}</td><td>${j.status === 'posted' ? `<span class="badge bdg-green">${t('cfo.posted')}</span>` : `<span class="badge bdg-gray">${t('cfo.voided')}</span>`}</td><td>${(j.status === 'posted' && typeof cfoCanWrite === 'function' && cfoCanWrite()) ? `<button class="btn btn-red btn-sm" onclick="cfoVoidEntry('${j.id}')">${t('cfo.voidBtn')}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="u-empty-sm">لا قيود بعد</td></tr>'}
  </tbody></table></div></div>`;
}
function cfoJournalModal(){
  const opts = (CFO_STATE.chart || []).filter(c => c.is_postable && c.is_active).map(c => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name_ar)}</option>`).join('');
  const row = (i) => `<tr><td><select id="jlAcc${i}" style="width:100%">${opts}</select></td><td><input type="number" id="jlDr${i}" min="0" step="0.01" style="width:100%"></td><td><input type="number" id="jlCr${i}" min="0" step="0.01" style="width:100%"></td></tr>`;
  showModal(`<h3><i class=ji data-i=plus></i> قيد يدوي متوازن</h3>
  <div class="fr"><div class="fg"><label>التاريخ</label><input type="date" id="jlDate" value="${today()}"></div>
  <div class="fg"><label>البيان</label><input type="text" id="jlMemo" placeholder="شرح القيد"></div></div>
  <table style="width:100%"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${row(0)}${row(1)}${row(2)}${row(3)}</tbody></table>
  <div class="text-muted" style="font-size:12px;margin-top:8px">اترك السطور الزائدة فارغة — يجب تساوي المدين والدائن.</div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="cfoSaveJournal()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`, 'modal-wide');
}
async function cfoSaveJournal(){
  const lines = [];
  for(let i = 0; i < 4; i++){
    const account_code = document.getElementById('jlAcc' + i)?.value;
    const debit = parseFloat(document.getElementById('jlDr' + i)?.value) || 0;
    const credit = parseFloat(document.getElementById('jlCr' + i)?.value) || 0;
    if(account_code && (debit > 0 || credit > 0)) {lines.push({ account_code, debit, credit });}
  }
  showLoad();
  try{
    await apiFetch('/accounting/journal', { method: 'POST', body: JSON.stringify({ date: document.getElementById('jlDate')?.value, memo: document.getElementById('jlMemo')?.value, lines }) });
    closeModal(); toast('تم ترحيل القيد', 'success'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر ترحيل القيد', 'error'); }
  finally{ hideLoad(); }
}
async function cfoPostPayroll(){
  showModal(`<h3><i class=ji data-i=banknote></i> ${t('cfo.payTitle')}</h3>
  <div class="fg"><label>${t('cfo.month')} (YYYY-MM)</label><input type="month" id="cfoPayMonth" value="${new Date().toISOString().slice(0, 7)}"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="cfoConfirmPostPayroll()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function cfoConfirmPostPayroll(){
  const m = document.getElementById('cfoPayMonth')?.value || '';
  if(!/^\d{4}-\d{2}$/.test(m)){ toast('الشهر بصيغة YYYY-MM', 'error'); return; }
  showLoad();
  try{
    const r = await apiFetch('/accounting/post-payroll', { method: 'POST', body: JSON.stringify({ month: m }) });
    closeModal(); toast(`رُحّلت رواتب ${m}: ${r.total}`, 'success'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر الترحيل', 'error'); }
  finally{ hideLoad(); }
}
async function cfoVoidEntry(id){
  if(!confirm(t('cfo.confirmVoid'))) {return;}
  showLoad();
  try{
    await apiFetch(`/accounting/journal/${id}/void`, { method: 'POST', body: JSON.stringify({}) });
    toast('أُلغي القيد (يبقى للمراجعة)', 'warning'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر الإلغاء', 'error'); }
  finally{ hideLoad(); }
}
function cfoPrintShell(title, body){
  const w = window.open('', '_blank');
  if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
  w.document.write(`<!DOCTYPE html><html dir="${STATE.lang === 'en' ? 'ltr' : 'rtl'}"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>body{font-family:'Cairo',Arial,sans-serif;padding:28px;color:#1a1a1a}
  .hd{text-align:center;border-bottom:3px solid #b45309;padding-bottom:14px;margin-bottom:18px}
  .hd h1{margin:0 0 4px;color:#b45309;font-size:24px}.hd p{margin:3px 0;color:#555;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:8px;text-align:center;font-size:13px}
  th{background:#f4ead2}.tot td{font-weight:900;background:#fafafa}
  .sig{display:flex;justify-content:space-between;margin-top:48px}.sig div{border-top:1px solid #555;padding-top:6px;width:28%;text-align:center;font-size:12px}
  .controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}
  @media print{.controls{display:none}body{padding:0}}</style></head><body>
  <div class="controls"><button class="btn-print" onclick="window.print()">طباعة</button><button class="btn-close" onclick="window.close()">إغلاق</button></div>
  <div class="hd"><h1>${esc(STATE.settings.name)}</h1><p>${esc(title)}</p><p>${esc(CFO_STATE.from)} → ${esc(CFO_STATE.to)}</p></div>
  ${body}
  <div class="sig"><div>إعداد المحاسب</div><div>مراجعة المدير المالي</div><div>اعتماد الإدارة</div></div>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.focus(), 400);
}
function cfoPrintTB(){
  const tb = CFO_STATE.tb; if(!tb) {return;}
  const rows = tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).map(a =>
    `<tr><td>${esc(a.code)}</td><td>${esc(a.name_ar)}</td><td>${esc(a.type)}</td><td>${fN(a.debit)}</td><td>${fN(a.credit)}</td><td>${fN(Number(a.debit) - Number(a.credit))}</td></tr>`).join('');
  cfoPrintShell(`${t('cfo.tbTitle')} — ${tb.balanced ? t('cfo.balanced') : t('cfo.unbalanced')}`,
    `<table><thead><tr><th>${t('cfo.code')}</th><th>${t('cfo.account')}</th><th>${t('cfo.type')}</th><th>${t('cfo.debit')}</th><th>${t('cfo.credit')}</th><th>${t('cfo.balance')}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="tot"><td colspan="3">${t('rev.total')}</td><td>${fN(tb.total_debit)}</td><td>${fN(tb.total_credit)}</td><td></td></tr></tfoot></table>`);
}
function cfoPrintJournal(){
  const rows = (CFO_STATE.journal || []).map(j =>
    `<tr><td>${esc(j.entry_no)}</td><td>${esc(String(j.date).slice(0, 10))}</td><td>${esc(j.memo || '—')}</td><td>${esc(j.source_type)}${j.source_id ? ' #' + esc(String(j.source_id)).slice(-8) : ''}</td><td>${(j.lines || []).map(l => `${esc(l.account_code)}: ${Number(l.debit) ? 'مدين ' + fN(l.debit) : 'دائن ' + fN(l.credit)}`).join('<br>')}</td><td>${j.status === 'posted' ? t('cfo.posted') : t('cfo.voided')}</td></tr>`).join('');
  cfoPrintShell(t('cfo.journalTitle'), `<table><thead><tr><th>${t('cfo.entryNo')}</th><th>${t('cfo.date')}</th><th>${t('cfo.memo')}</th><th>${t('cfo.source')}</th><th>${t('cfo.lines')}</th><th>${t('cfo.st')}</th></tr></thead><tbody>${rows}</tbody></table>`);
}
function cfoPrintSummary(){
  const s = CFO_STATE.summary; if(!s) {return;}
  const kv = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  cfoPrintShell(t('pg.cfo'), `<table><tbody>
  ${kv(t('cfo.revenue'), fC(s.revenue.total))}${kv(t('cfo.expenses'), fC(s.expenses.total))}
  ${kv(t('cfo.net'), fC(s.net_approx))}${kv(t('cfo.cash'), fC(s.cash_position))}
  ${kv(t('cfo.invoices'), fC(s.pos.total) + ` (${s.pos.invoices})`)}
  ${(s.top_expense_categories || []).map(c => kv('— ' + esc(c.category), fC(c.total))).join('')}
  </tbody></table>`);
}
function cfoExportTB(){
  const tb = CFO_STATE.tb; if(!tb) {return;}
  const data = [[t('cfo.code'), t('cfo.account'), t('cfo.type'), t('cfo.debit'), t('cfo.credit'), t('cfo.balance')]];
  tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).forEach(a =>
    data.push([a.code, a.name_ar, a.type, Number(a.debit), Number(a.credit), Number(a.debit) - Number(a.credit)]));
  data.push(['', '', '', tb.total_debit, tb.total_credit, '']);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TB');
  XLSX.writeFile(wb, `trial-balance_${CFO_STATE.from}_${CFO_STATE.to}.xlsx`);
  toast('تم تحميل ميزان المراجعة', 'success');
}

export { CFO_STATE, cfoCanWrite, renderCfoPage, cfoJournalModal, cfoSaveJournal, cfoPostPayroll, cfoConfirmPostPayroll, cfoVoidEntry, cfoPrintShell, cfoPrintTB, cfoPrintJournal, cfoPrintSummary, cfoExportTB };
