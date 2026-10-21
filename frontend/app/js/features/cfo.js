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
    <input type="date" id="cfoFrom" value="${CFO_STATE.from}" data-karim-action="kdAct" data-karim-event="change" data-karim-pass="value">
    <input type="date" id="cfoTo" value="${CFO_STATE.to}" data-karim-action="kdAct4" data-karim-event="change" data-karim-pass="value">
    <button class="btn btn-blue btn-sm" data-karim-action="renderCfoPage"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button>
    <button class="btn btn-sm" data-karim-action="cfoPrintSummary"><i class=ji data-i=printer></i> ${t('cfo.printSum')}</button>
    ${canWrite ? `<button class="btn btn-gold btn-sm" data-karim-action="cfoJournalModal"><i class=ji data-i=plus></i> ${t('cfo.manual')}</button>
    <button class="btn btn-green btn-sm" data-karim-action="cfoPostPayroll"><i class=ji data-i=banknote></i> ${t('cfo.postPayroll')}</button>` : ''}
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
  <div class="u-row-wrap"><button class="btn btn-sm" data-karim-action="cfoPrintTB"><i class=ji data-i=printer></i> ${t('cfo.printTB')}</button><button class="btn btn-blue btn-sm" data-karim-action="cfoExportTB"><i class=ji data-i=inbox></i> ${t('cfo.excel')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.code')}</th><th>${t('cfo.account')}</th><th>${t('cfo.type')}</th><th>${t('cfo.debit')}</th><th>${t('cfo.credit')}</th><th>${t('cfo.balance')}</th></tr></thead><tbody>
  ${tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).map(a => {
    const bal = Number(a.debit) - Number(a.credit);
    return `<tr><td class="mono">${esc(a.code)}</td><td class="fw-bold">${esc(a.name_ar)}</td><td>${esc(a.type)}</td><td>${fC(a.debit)}</td><td>${fC(a.credit)}</td><td class="fw-bold">${fC(bal)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="u-empty-sm">لا حركات في الفترة — رحّل المبيعات تلقائيًا من الكاشير أو أدخل قيدًا يدويًا</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=book></i> ${t('cfo.journalTitle')}</h3>
  <div class="u-row-wrap"><button class="btn btn-sm" data-karim-action="cfoPrintJournal"><i class=ji data-i=printer></i> ${t('cfo.printJ')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.entryNo')}</th><th>${t('cfo.date')}</th><th>${t('cfo.memo')}</th><th>${t('cfo.source')}</th><th>${t('cfo.lines')}</th><th>${t('cfo.st')}</th><th></th></tr></thead><tbody>
  ${(CFO_STATE.journal || []).map(j => `<tr${j.status !== 'posted' ? ' style="opacity:.55"' : ''}><td class="mono">${esc(j.entry_no)}</td><td>${fD(j.date)}</td><td>${esc(j.memo || '—')}${j.created_by_name ? `<br><small class="text-muted">${t('cfo.by')} @${esc(j.created_by_name)}</small>` : ''}</td><td><span class="badge bdg-blue">${esc(j.source_type)}${j.source_id ? ' #' + esc(j.source_id) : ''}</span></td><td>${(j.lines || []).map(l => `<div><span class="mono">${esc(l.account_code)}</span> ${Number(l.debit) ? `<span class="c-green">${t('cfo.debit')} ${fC(l.debit)}</span>` : `<span class="c-red">${t('cfo.credit')} ${fC(l.credit)}</span>`}</div>`).join('')}</td><td>${j.status === 'posted' ? `<span class="badge bdg-green">${t('cfo.posted')}</span>` : j.status === 'draft' ? `<span class="badge bdg-orange">مسودة</span>` : `<span class="badge bdg-gray">${t('cfo.voided')}</span>`}</td><td>${(typeof cfoCanWrite === 'function' && cfoCanWrite()) ? (j.status === 'draft' ? `<button class="btn btn-green btn-sm" data-karim-action="cfoApproveEntry" data-karim-arg0="${j.id}">اعتماد</button> ` : '') + (j.status === 'posted' ? `<button class="btn btn-red btn-sm" data-karim-action="cfoVoidEntry" data-karim-arg0="${j.id}">${t('cfo.voidBtn')}</button>` : '') : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="u-empty-sm">لا قيود بعد</td></tr>'}
  </tbody></table></div>
  <div class="tbl-wrap" style="margin-top:16px"><div class="tbl-hd"><h3><i class=ji data-i=lock></i> الإغلاق الشهري (قفل الفترات)</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="cfoLoadPeriods"><i class=ji data-i=refresh></i> تحديث</button></div></div>
  <div style="padding:16px 24px" id="cfoPeriodsBody"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>
  <div class="tbl-wrap" style="margin-top:16px"><div class="tbl-hd"><h3><i class=ji data-i=scale></i> القوائم الختامية</h3>
  <div class="u-row-wrap"><input type="date" id="cfoStmtDate" value="${CFO_STATE.to}"><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadBalance">الميزانية العمومية</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadCashflow">التدفق النقدي</button></div></div>
  <div style="padding:16px 24px" id="cfoStmtBody"><div class="mcard u-empty">اختر التاريخ ثم اعرض القائمة — تُطبع من زر الطباعة بالمتصفح.</div></div></div>
  <div class="tbl-wrap" style="margin-top:16px"><div class="tbl-hd"><h3><i class=ji data-i=users></i> إغلاق ورديات الكاشير مركزيًا (بدون المرور على الأجهزة)</h3>
  <div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="cfoLoadOpenShifts"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-gold btn-sm" data-karim-action="cfoExecDayClose">إقفال اليوم Z</button></div></div>
  <div style="padding:16px 24px" id="cfoShiftsBody"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>
  <div class="tbl-wrap" style="margin-top:16px"><div class="tbl-hd"><h3><i class=ji data-i=trending-up></i> النمو المحاسبي</h3>
  <div class="u-row-wrap"><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadCC">ربحية المراكز</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadAging">أعمار الذمم</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadBank">التسوية البنكية</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadAssets">الأصول والإهلاك</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadCustody">العهد</button><button class="btn btn-gold btn-sm" data-karim-action="cfoLoadBudgets">الموازنات</button><button class="btn btn-blue btn-sm" data-karim-action="cfoAlertsLog">سجل التنبيهات</button></div></div>
  <div style="padding:16px 24px" id="cfoGrowthBody"><div class="mcard u-empty">اختر تقريرًا من الأزرار أعلاه.</div></div></div></div>`;
  setTimeout(cfoLoadPeriods, 0);
  setTimeout(cfoLoadOpenShifts, 0);
}
function cfoJournalModal(){
  const opts = (CFO_STATE.chart || []).filter(c => c.is_postable && c.is_active).map(c => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name_ar)}</option>`).join('');
  const row = (i) => `<tr><td><select id="jlAcc${i}" style="width:100%">${opts}</select></td><td><input type="number" id="jlDr${i}" min="0" step="0.01" style="width:100%"></td><td><input type="number" id="jlCr${i}" min="0" step="0.01" style="width:100%"></td></tr>`;
  showModal(`<h3><i class=ji data-i=plus></i> قيد يدوي متوازن</h3>
  <div class="fr"><div class="fg"><label>التاريخ</label><input type="date" id="jlDate" value="${today()}"></div>
  <div class="fg"><label>البيان</label><input type="text" id="jlMemo" placeholder="شرح القيد"></div></div>
  <table style="width:100%"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${row(0)}${row(1)}${row(2)}${row(3)}</tbody></table>
  <div class="text-muted" style="font-size:12px;margin-top:8px">اترك السطور الزائدة فارغة — يجب تساوي المدين والدائن.</div>
  <div class="modal-footer"><button class="btn" data-karim-action="closeModal">${t('act.cancel')}</button><button class="btn" data-karim-action="cfoSaveJournal" data-karim-args="[true]">حفظ كمسودة</button><button class="btn btn-gold" data-karim-action="cfoSaveJournal" data-karim-args="[false]"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`, 'modal-wide');
}
async function cfoSaveJournal(asDraft){
  const lines = [];
  for(let i = 0; i < 4; i++){
    const account_code = document.getElementById('jlAcc' + i)?.value;
    const debit = parseFloat(document.getElementById('jlDr' + i)?.value) || 0;
    const credit = parseFloat(document.getElementById('jlCr' + i)?.value) || 0;
    if(account_code && (debit > 0 || credit > 0)) {lines.push({ account_code, debit, credit });}
  }
  showLoad();
  try{
    await apiFetch('/accounting/journal', { method: 'POST', body: JSON.stringify({ date: document.getElementById('jlDate')?.value, memo: document.getElementById('jlMemo')?.value, lines, status: asDraft ? 'draft' : 'posted' }) });
    closeModal(); toast(asDraft ? 'حُفظت المسودة — بانتظار الاعتماد' : 'تم ترحيل القيد', 'success'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر حفظ القيد', 'error'); }
  finally{ hideLoad(); }
}
async function cfoApproveEntry(id){
  if(!confirm('اعتماد هذا القيد وترحيله نهائيًا؟')) {return;}
  showLoad();
  try{ await apiFetch(`/accounting/journal/${encodeURIComponent(id)}/approve`, { method: 'POST' }); toast('اعتُمد القيد ورُحّل', 'success'); await renderCfoPage(); }
  catch(e){ toast(e.message || 'تعذر الاعتماد', 'error'); }
  finally{ hideLoad(); }
}
async function cfoLoadPeriods(){
  const box = document.getElementById('cfoPeriodsBody'); if(!box) {return;}
  box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
  try{
    const d = await apiFetch('/accounting/periods');
    const rows = (d.periods || []).slice(0, 12).map(p => `<tr>
      <td class="mono fw-bold">${esc(p.period)}</td>
      <td>${p.closed ? '<span class="badge bdg-gray">مقفلة 🔒</span>' : '<span class="badge bdg-green">مفتوحة</span>'}</td>
      <td class="text-muted">${Number(p.posted) || 0} مرحّل / ${Number(p.drafts) || 0} مسودة</td>
      <td class="text-muted">${p.closed ? `أقفلها @${esc(p.closed_by_name || '—')}` : '—'}</td>
      <td>${!p.closed ? `<button class="btn btn-gold btn-sm" data-karim-action="cfoClosePeriod" data-karim-arg0="${esc(p.period)}">قفل</button>` : `<button class="btn btn-sm" data-karim-action="cfoOpenPeriod" data-karim-arg0="${esc(p.period)}">إعادة فتح</button>`}</td>
    </tr>`).join('');
    box.innerHTML = `<div class="tbl-scroll"><table><thead><tr><th>الفترة</th><th>الحالة</th><th>القيود</th><th>القفل</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <small class="text-muted">القفل يمنع أي ترحيل/إلغاء على الشهر — وإعادة الفتح للمدير فقط ومسجلة باسمه.</small>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoClosePeriod(period){
  const note = prompt(`قفل فترة ${period}؟ (ملاحظة اختيارية)`, '') || '';
  if(note === null) {return;}
  if(!confirm(`تأكيد قفل ${period} — لن يُقبل أي قيد عليها بعد الآن؟`)) {return;}
  showLoad();
  try{ await apiFetch(`/accounting/periods/${encodeURIComponent(period)}/close`, { method: 'POST', body: JSON.stringify({ note }) }); toast(`أُقفلت ${period}`, 'success'); await cfoLoadPeriods(); }
  catch(e){ toast(e.message || 'تعذر القفل', 'error'); }
  finally{ hideLoad(); }
}
async function cfoOpenPeriod(period){
  if(!confirm(`إعادة فتح ${period}؟ سيُسجل اسمك على هذا الإجراء.`)) {return;}
  showLoad();
  try{ await apiFetch(`/accounting/periods/${encodeURIComponent(period)}/open`, { method: 'POST', body: JSON.stringify({}) }); toast(`أُعيد فتح ${period}`, 'success'); await cfoLoadPeriods(); }
  catch(e){ toast(e.message || 'تعذر الفتح', 'error'); }
  finally{ hideLoad(); }
}
async function cfoLoadBalance(){
  const box = document.getElementById('cfoStmtBody'); if(!box) {return;}
  const asOf = document.getElementById('cfoStmtDate')?.value || CFO_STATE.to;
  box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
  try{
    const d = await apiFetch(`/accounting/balance-sheet?as_of=${encodeURIComponent(asOf)}`);
    const t = d.totals || {};
    const rows = (arr) => (arr || []).filter(a => Math.abs(Number(a.balance)) > 0.005).map(a => `<tr><td class="mono">${esc(a.code)}</td><td>${esc(a.name_ar)}</td><td class="c-gold">${fC(a.balance)}</td></tr>`).join('') || '<tr><td colspan="3" class="u-empty-sm">—</td></tr>';
    box.innerHTML = `<h4>الميزانية العمومية — حتى ${esc(d.as_of)} ${t.balanced ? '<span class="badge bdg-green">متوازنة ✓</span>' : '<span class="badge bdg-red">غير متوازنة!</span>'}</h4>
    <div class="tbl-scroll"><table><thead><tr><th>الكود</th><th>الأصول</th><th>الرصيد</th></tr></thead><tbody>${rows(d.assets)}</tbody></table></div>
    <div class="tbl-scroll"><table><thead><tr><th>الكود</th><th>الالتزامات</th><th>الرصيد</th></tr></thead><tbody>${rows(d.liabilities)}</tbody></table></div>
    <div class="tbl-scroll"><table><thead><tr><th>الكود</th><th>حقوق الملكية (+ ربح الفترة ${fC(t.currentProfit)})</th><th>الرصيد</th></tr></thead><tbody>${rows(d.equity)}</tbody></table></div>
    <div class="mcard">الأصول ${fC(t.assets)} = الالتزامات ${fC(t.liabilities)} + الملكية ${fC(t.equity)}</div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoLoadCashflow(){
  const box = document.getElementById('cfoStmtBody'); if(!box) {return;}
  const to = document.getElementById('cfoStmtDate')?.value || CFO_STATE.to;
  const from = `${String(to).slice(0, 7)}-01`;
  box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
  try{
    const d = await apiFetch(`/accounting/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const rows = (d.byCounterparty || []).map(c => `<tr><td>${esc(c.account)}</td><td class="${c.net >= 0 ? 'c-green' : 'c-red'}">${fC(c.net)}</td></tr>`).join('') || '<tr><td colspan="2" class="u-empty-sm">لا حركة نقدية</td></tr>';
    box.innerHTML = `<h4>التدفق النقدي (الطريقة المباشرة) — ${esc(d.from)} → ${esc(d.to)}</h4>
    <div class="metrics-grid">
    <div class="mcard"><div class="mcard-label">رصيد أول الفترة (صندوق+بنك)</div><div class="mcard-val">${fC(d.opening)}</div></div>
    <div class="mcard"><div class="mcard-label">مقبوضات</div><div class="mcard-val c-green">${fC(d.inflow)}</div></div>
    <div class="mcard"><div class="mcard-label">مدفوعات</div><div class="mcard-val c-red">${fC(d.outflow)}</div></div>
    <div class="mcard"><div class="mcard-label">الصافي / الختامي</div><div class="mcard-val c-gold">${fC(d.net)} / ${fC(d.closing)}</div></div>
    </div>
    <div class="tbl-scroll"><table><thead><tr><th>الطرف المقابل</th><th>الصافي</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
// ─── الموازنات والتنبيهات ───────────────────────────────────────────────────
async function cfoLoadBudgets(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const period = (document.getElementById('cfoStmtDate')?.value || CFO_STATE.to).slice(0, 7);
    const d = await apiFetch(`/accounting/budget-vs-actual?period=${encodeURIComponent(period)}`);
    const rows = (d.rows || []).map(r => `<tr><td class="fw-bold">${esc(r.label || r.account_name || r.account_code || '—')}</td>
      <td class="mono">${esc(r.account_code || '—')}</td><td>${fC(r.budget)}</td><td>${fC(r.actual)}</td>
      <td class="${r.over ? 'c-red fw-bold' : 'c-green'}">${fC(r.variance)}${r.over ? ' ⚠' : ''}</td>
      <td>${r.pct === null || r.pct === undefined ? '—' : fN(r.pct) + '%'}</td>
      <td><button class="btn btn-red btn-sm" data-karim-action="cfoDelBudget" data-karim-arg0="${r.id}">حذف</button></td></tr>`).join('');
    box.innerHTML = `<div class="u-row-wrap" style="margin-bottom:8px"><button class="btn btn-green btn-sm" data-karim-action="cfoAddBudget">موازنة جديدة</button>
    <span class="text-muted">${esc(period)} — التجاوز يُنبه تلقائيًا (جرس + واتساب).</span></div>
    <div class="tbl-scroll"><table><thead><tr><th>البند</th><th>الحساب</th><th>الموازنة</th><th>الفعلي</th><th>الانحراف</th><th>النسبة</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="u-empty-sm">لا موازنات — أضف سقوف المصروفات هنا.</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoAddBudget(){
  const label = prompt('اسم البند (مثال: الرواتب):', ''); if(label === null) {return;}
  const code = prompt('كود الحساب (مثال: 6000) — اتركه فارغًا لسقف عام:', '') || '';
  const amt = parseFloat(prompt('المبلغ الشهري:', '')); if(!Number.isFinite(amt) || amt < 0) { toast('مبلغ غير صالح', 'error'); return; }
  const period = ((document.getElementById('cfoStmtDate')?.value || CFO_STATE.to)).slice(0, 7);
  showLoad();
  try{ await apiFetch('/accounting/budgets', { method: 'POST', body: JSON.stringify({ period, label, account_code: code.trim() || null, amount: amt }) }); toast('أُضيفت الموازنة', 'success'); await cfoLoadBudgets(); }
  catch(e){ toast(e.message || 'تعذر الإضافة', 'error'); }
  finally{ hideLoad(); }
}
async function cfoDelBudget(id){
  if(!confirm('حذف هذه الموازنة؟')) {return;}
  showLoad();
  try{ await apiFetch(`/accounting/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('حُذفت', 'success'); await cfoLoadBudgets(); }
  catch(e){ toast(e.message || 'تعذر الحذف', 'error'); }
  finally{ hideLoad(); }
}
async function cfoAlertsLog(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const d = await apiFetch('/accounting/alerts/log');
    const rows = (d.log || []).map(a => `<tr><td class="mono">${esc(a.key)}</td><td>${esc(a.last_title || '—')}</td>
      <td class="text-muted">${esc(String(a.last_sent_at || '').replace('T', ' ').slice(0, 19))}</td><td>${a.times_sent}×</td></tr>`).join('');
    box.innerHTML = `<div class="u-row-wrap" style="margin-bottom:8px"><button class="btn btn-blue btn-sm" data-karim-action="cfoRunAlerts">فحص الآن</button>
    <span class="text-muted">الفحص التلقائي كل 30 دقيقة — التنبيه الواحد يُرسل مرة كل 24 ساعة (جرس + واتساب المديرين إن فُعّل).</span></div>
    <div class="tbl-scroll"><table><thead><tr><th>القاعدة</th><th>آخر تنبيه</th><th>الوقت</th><th>المرات</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="u-empty-sm">لا تنبيهات مرسلة — الوضع هادئ ✓</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoRunAlerts(){
  showLoad();
  try{ const r = await apiFetch('/accounting/alerts/run', { method: 'POST' }); toast(r.sent.length ? `أُرسل ${r.sent.length} تنبيه` : 'لا جديد — كل القواعد سليمة ✓', r.sent.length ? 'warning' : 'success'); await cfoAlertsLog(); }
  catch(e){ toast(e.message || 'تعذر الفحص', 'error'); }
  finally{ hideLoad(); }
}
function cfoGrowthBox(html){ const box = document.getElementById('cfoGrowthBody'); if(box) {box.innerHTML = html;} return box; }
async function cfoLoadCC(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const to = document.getElementById('cfoStmtDate')?.value || CFO_STATE.to;
    const d = await apiFetch(`/accounting/profit-by-cost-center?from=${encodeURIComponent(String(to).slice(0, 7) + '-01')}&to=${encodeURIComponent(to)}`);
    const rows = (d.centers || []).map(c => `<tr><td class="fw-bold">${esc(c.cc)}<br><small class="text-muted">${esc(c.cc_name || '')}</small></td>
      <td class="c-green">${fC(c.revenue)}</td><td class="c-red">${fC(c.cogs)}</td><td class="c-red">${fC(c.expense)}</td>
      <td class="fw-bold ${c.net >= 0 ? 'c-green' : 'c-red'}">${fC(c.net)}</td></tr>`).join('');
    box.innerHTML = `<h4>ربحية مراكز التكلفة — ${esc(d.from)} → ${esc(d.to)}</h4>
    <div class="tbl-scroll"><table><thead><tr><th>المركز</th><th>إيراد</th><th>تكلفة</th><th>مصروف</th><th>الصافي</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="u-empty-sm">لا حركة — وزّع القيود على المراكز من نافذة القيد (حقل اختياري).</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoLoadAging(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const d = await apiFetch('/accounting/ap-aging');
    const rows = (d.aging || []).map(a => `<tr><td class="fw-bold">${esc(a.supplier)}</td>
      <td class="c-gold">${fC(a.total)}</td><td>${fC(a.current)}</td><td>${fC(a.d30)}</td><td>${fC(a.d60)}</td>
      <td class="${a.d90 > 0 ? 'c-red' : ''}">${fC(a.d90)}</td><td class="${a.over90 > 0 ? 'c-red fw-bold' : ''}">${fC(a.over90)}</td></tr>`).join('');
    box.innerHTML = `<h4>أعمار ذمم الموردين — الإجمالي ${fC(d.total)} (متأخر +90: تنبيه واتساب مقترح)</h4>
    <div class="tbl-scroll"><table><thead><tr><th>المورد</th><th>الإجمالي</th><th>غير مؤرخ</th><th>0-30</th><th>31-60</th><th>61-90</th><th>+90 ⚠</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="u-empty-sm">لا ذمم مستحقة ✓</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoLoadBank(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const to = document.getElementById('cfoStmtDate')?.value || CFO_STATE.to;
    const from = String(to).slice(0, 7) + '-01';
    const d = await apiFetch(`/accounting/bank-rec?account=1010&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const rows = (d.unmatched || []).map(s => `<tr><td>${esc(String(s.stmt_date).slice(0, 10))}</td><td>${esc(s.description || '—')}</td>
      <td class="${Number(s.amount) >= 0 ? 'c-green' : 'c-red'}">${fC(s.amount)}</td></tr>`).join('');
    box.innerHTML = `<h4>التسوية البنكية (1010) — ${esc(d.from)} → ${esc(d.to)}</h4>
    <div class="metrics-grid"><div class="mcard"><div class="mcard-label">الدفتر</div><div class="mcard-val">${fC(d.book)}</div></div>
    <div class="mcard"><div class="mcard-label">الكشف</div><div class="mcard-val">${fC(d.statement)}</div></div>
    <div class="mcard"><div class="mcard-label">الفرق</div><div class="mcard-val ${d.diff === 0 ? 'c-green' : 'c-red'}">${fC(d.diff)}</div></div></div>
    <div class="u-row-wrap" style="margin-bottom:8px"><button class="btn btn-blue btn-sm" data-karim-action="cfoAutoMatch">مطابقة تلقائية</button>
    <button class="btn btn-sm" data-karim-action="cfoAddStmt">إضافة سطر كشف</button></div>
    <div class="tbl-scroll"><table><thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="u-empty-sm">لا بنود معلقة — التسوية نظيفة ✓</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoAutoMatch(){
  showLoad();
  try{ const r = await apiFetch('/accounting/bank-rec/auto-match', { method: 'POST', body: JSON.stringify({ account: '1010' }) }); toast(`طُابق ${r.matched} من ${r.scanned}`, 'success'); await cfoLoadBank(); }
  catch(e){ toast(e.message || 'تعذر المطابقة', 'error'); }
  finally{ hideLoad(); }
}
async function cfoAddStmt(){
  const d = prompt('التاريخ (YYYY-MM-DD):', today()); if(!d) {return;}
  const amt = parseFloat(prompt('المبلغ (موجب داخل/سالب خارج):', '')); if(!Number.isFinite(amt) || amt === 0) { toast('مبلغ غير صالح', 'error'); return; }
  const desc = prompt('البيان:', '') || '';
  showLoad();
  try{ await apiFetch('/accounting/bank-statements', { method: 'POST', body: JSON.stringify({ rows: [{ account_code: '1010', stmt_date: d, amount: amt, description: desc }] }) }); toast('أُضيف سطر الكشف', 'success'); await cfoLoadBank(); }
  catch(e){ toast(e.message || 'تعذر الإضافة', 'error'); }
  finally{ hideLoad(); }
}
async function cfoLoadAssets(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const d = await apiFetch('/accounting/fixed-assets');
    const rows = (d.assets || []).filter(a => a.status === 'active').map(a => `<tr><td class="fw-bold">${esc(a.name)}</td>
      <td>${fC(a.cost)}</td><td>${fC(a.monthly)}/شهر</td><td>${fC(a.accumulated)}</td><td class="c-gold">${fC(a.remaining)}</td>
      <td class="text-muted">${esc(a.last_month || '—')}</td>
      <td><button class="btn btn-red btn-sm" data-karim-action="cfoDisposeAsset" data-karim-arg0="${a.id}">استبعاد</button></td></tr>`).join('');
    box.innerHTML = `<div class="u-row-wrap" style="margin-bottom:8px"><button class="btn btn-green btn-sm" data-karim-action="cfoAddAsset">أصل جديد</button>
    <button class="btn btn-gold btn-sm" data-karim-action="cfoRunDepreciation">تشغيل إهلاك الشهر</button></div>
    <div class="tbl-scroll"><table><thead><tr><th>الأصل</th><th>التكلفة</th><th>الشهري</th><th>المتراكم</th><th>المتبقي</th><th>آخر إهلاك</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="u-empty-sm">لا أصول — سجل معدات المطبخ والتجهيزات هنا.</td></tr>'}</tbody></table></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoAddAsset(){
  const name = prompt('اسم الأصل:', ''); if(!name) {return;}
  const cost = parseFloat(prompt('التكلفة:', '')); if(!Number.isFinite(cost) || cost <= 0) { toast('تكلفة غير صالحة', 'error'); return; }
  const life = parseInt(prompt('العمر بالشهور:', '60'), 10); if(!Number.isInteger(life) || life <= 0) { toast('عمر غير صالح', 'error'); return; }
  showLoad();
  try{ await apiFetch('/accounting/fixed-assets', { method: 'POST', body: JSON.stringify({ name, cost, life_months: life }) }); toast('سُجل الأصل', 'success'); await cfoLoadAssets(); }
  catch(e){ toast(e.message || 'تعذر التسجيل', 'error'); }
  finally{ hideLoad(); }
}
async function cfoDisposeAsset(id){
  if(!confirm('استبعاد هذا الأصل نهائيًا؟')) {return;}
  showLoad();
  try{ await apiFetch(`/accounting/fixed-assets/${encodeURIComponent(id)}/dispose`, { method: 'POST' }); toast('استُبعد الأصل', 'success'); await cfoLoadAssets(); }
  catch(e){ toast(e.message || 'تعذر الاستبعاد', 'error'); }
  finally{ hideLoad(); }
}
async function cfoRunDepreciation(){
  if(!confirm('ترحيل الإهلاك الشهري (6600 / 1520)؟')) {return;}
  showLoad();
  try{
    const r = await apiFetch('/accounting/depreciation/run', { method: 'POST', body: JSON.stringify({}) });
    toast(r.total > 0 ? `رُحل إهلاك ${r.month}: ${fC(r.total)} (${r.posted} أصل)` : 'لا أصول مستحقة هذا الشهر', 'success');
    await cfoLoadAssets();
  }catch(e){ toast(e.message || 'تعذر الترحيل', 'error'); }
  finally{ hideLoad(); }
}
async function cfoLoadCustody(){
  const box = cfoGrowthBox('<div class="mcard u-empty"><div class="spinner"></div></div>'); if(!box) {return;}
  try{
    const d = await apiFetch('/accounting/cash-custody');
    const rows = (d.rows || []).map(c => `<tr><td>@${esc(c.from_name)}</td><td>@${esc(c.to_name)}</td>
      <td class="c-gold">${fC(c.amount)}</td><td>${esc(c.note || '—')}</td>
      <td>${c.ack_at ? '<span class="badge bdg-green">مُستلمة ✓</span>' : '<span class="badge bdg-orange">معلقة</span>'}</td></tr>`).join('');
    box.innerHTML = `<div class="u-row-wrap" style="margin-bottom:8px"><button class="btn btn-gold btn-sm" data-karim-action="cfoHandCustody">تسليم عهدة</button>
    <span class="text-muted">لديك ${d.myPending} عهدة معلقة بانتظار إقرارك.</span></div>
    <div class="tbl-scroll"><table><thead><tr><th>من</th><th>إلى</th><th>المبلغ</th><th>ملاحظة</th><th>الحالة</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="u-empty-sm">لا عهد اليوم.</td></tr>'}</tbody></table></div>
    <div class="u-row-wrap"><input id="cfoAckId" placeholder="رقم العهدة للإقرار" style="width:160px"><button class="btn btn-green btn-sm" data-karim-action="cfoAckCustody">إقرار استلام</button></div>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoHandCustody(){
  const toId = prompt('رقم المستخدم المستلم (ID):', ''); if(!toId) {return;}
  const amt = parseFloat(prompt('المبلغ:', '')); if(!Number.isFinite(amt) || amt <= 0) { toast('مبلغ غير صالح', 'error'); return; }
  showLoad();
  try{ await apiFetch('/accounting/cash-custody', { method: 'POST', body: JSON.stringify({ to_cashier: Number(toId), amount: amt }) }); toast('سُلمت العهدة بانتظار الإقرار', 'success'); await cfoLoadCustody(); }
  catch(e){ toast(e.message || 'تعذر التسليم', 'error'); }
  finally{ hideLoad(); }
}
async function cfoAckCustody(){
  const id = document.getElementById('cfoAckId')?.value; if(!id) { toast('أدخل رقم العهدة', 'error'); return; }
  showLoad();
  try{ await apiFetch(`/accounting/cash-custody/${encodeURIComponent(id)}/ack`, { method: 'POST' }); toast('تم إقرار الاستلام ✓', 'success'); await cfoLoadCustody(); }
  catch(e){ toast(e.message || 'تعذر الإقرار', 'error'); }
  finally{ hideLoad(); }
}
async function cfoLoadOpenShifts(){
  const box = document.getElementById('cfoShiftsBody'); if(!box) {return;}
  box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
  try{
    const d = await apiFetch('/pos/shifts/open');
    const rows = (d.shifts || []).map(s => {
      const stale = s.biz_date !== s.today;
      return `<tr${stale ? ' style="background:rgba(255,0,0,.06)"' : ''}>
      <td class="mono">#${s.id}</td>
      <td>${esc(s.cashier_name || '—')}</td>
      <td>${esc(s.dept_name || '—')}</td>
      <td class="mono">${esc(s.biz_date)}${stale ? ' ⚠ يوم سابق' : ''}</td>
      <td>${fC(s.opening_balance)}</td>
      <td class="c-gold">${fC(s.expected_cash)}</td>
      <td class="text-muted">${s.invoice_count} فاتورة</td>
      <td><input type="number" id="cfo-shift-actual-${s.id}" min="0" step="0.01" placeholder="الجرد الفعلي" style="width:120px"></td>
      <td><button class="btn btn-red btn-sm" data-karim-action="cfoCloseShiftRemote" data-karim-arg0="${s.id}">إغلاق</button></td>
    </tr>`; }).join('');
    box.innerHTML = `<div class="tbl-scroll"><table><thead><tr><th>وردية</th><th>الكاشير</th><th>القسم</th><th>اليوم</th><th>العهدة</th><th>المتوقع</th><th>الحركة</th><th>الجرد الفعلي</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9" class="u-empty-sm">لا ورديات مفتوحة — كل الكاشيرية مغلقة ✓</td></tr>'}</tbody></table></div>
    <small class="text-muted">الإغلاق عن بُعد بصلاحية المدير — يُسجل باسمك في التدقيق. الورديات المظللة من أيام سابقة ويجب إغلاقها أولًا.</small>`;
  }catch(e){ box.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر الجلب')}</div>`; }
}
async function cfoCloseShiftRemote(id){
  const v = parseFloat(document.getElementById(`cfo-shift-actual-${id}`)?.value);
  if(!Number.isFinite(v) || v < 0) { toast(`أدخل الجرد الفعلي للوردية #${id}`, 'error'); return; }
  if(!confirm(`إغلاق الوردية #${id} عن بُعد بالجرد ${v}؟`)) {return;}
  showLoad();
  try{
    const r = await apiFetch(`/pos/shifts/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ actual_cash: v, notes: 'إغلاق مركزي من المحاسبة' }) });
    toast(`أُغلقت #${id} — الفرق ${fC(r.cash_variance)}`, Number(r.cash_variance) === 0 ? 'success' : 'warning');
    await cfoLoadOpenShifts();
  }catch(e){ toast(e.message || 'تعذر الإغلاق', 'error'); }
  finally{ hideLoad(); }
}
async function cfoExecDayClose(){
  if(!confirm('تنفيذ الإقفال اليومي Z ليوم العمل الحالي؟')) {return;}
  showLoad();
  try{
    const st = await apiFetch('/pos/day-close/status');
    if(st.existing_z) { toast(`اليوم مقفل مسبقًا (${st.existing_z.z_number})`, 'warning'); return; }
    if((st.open || []).length) { toast(`أغلق ${st.open.length} وردية مفتوحة أولًا من الجدول أعلاه`, 'error'); await cfoLoadOpenShifts(); return; }
    const r = await apiFetch('/pos/day-close', { method: 'POST', body: JSON.stringify({ date: st.today, counts: {}, manager_approve: true }) });
    toast(`تم الإقفال ${r.z.z_number} — الفرق ${fC(r.z.total_variance)}`, 'success');
  }catch(e){ toast(e.message || 'فشل الإقفال', 'error'); }
  finally{ hideLoad(); }
}
async function cfoPostPayroll(){
  showModal(`<h3><i class=ji data-i=banknote></i> ${t('cfo.payTitle')}</h3>
  <div class="fg"><label>${t('cfo.month')} (YYYY-MM)</label><input type="month" id="cfoPayMonth" value="${new Date().toISOString().slice(0, 7)}"></div>
  <div class="modal-footer"><button class="btn" data-karim-action="closeModal">${t('act.cancel')}</button><button class="btn btn-gold" data-karim-action="cfoConfirmPostPayroll"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
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
  const w = (window.openInAppReport ? window.openInAppReport('قيد اليومية') : window.open('', '_blank'));
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
  <div class="controls"><button class="btn-print" data-karim-action="print">طباعة</button><button class="btn-close" data-karim-action="closeWindow">إغلاق</button></div>
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
/* ─── إجراءات مولَّدة (تفويض بدل معالجات سطرية) ─── */
function kdAct(p0) {
    CFO_STATE.from = p0;
}

function kdAct4(p0) {
    CFO_STATE.to = p0;
}


export {CFO_STATE, cfoCanWrite, renderCfoPage, cfoJournalModal, cfoSaveJournal, cfoApproveEntry, cfoLoadPeriods, cfoClosePeriod, cfoOpenPeriod, cfoLoadBalance, cfoLoadCashflow, cfoLoadOpenShifts, cfoCloseShiftRemote, cfoExecDayClose, cfoLoadCC, cfoLoadAging, cfoLoadBank, cfoAutoMatch, cfoAddStmt, cfoLoadAssets, cfoAddAsset, cfoDisposeAsset, cfoRunDepreciation, cfoLoadCustody, cfoHandCustody, cfoAckCustody, cfoLoadBudgets, cfoAddBudget, cfoDelBudget, cfoAlertsLog, cfoRunAlerts, cfoPostPayroll, cfoConfirmPostPayroll, cfoVoidEntry, cfoPrintShell, cfoPrintTB, cfoPrintJournal, cfoPrintSummary, cfoExportTB, kdAct, kdAct4 };;
