/**
 * features/roster.js — شبكة دوامات القسم الأسبوعية (2026-10 UPGRADE)
 * رئيس القسم يتحرك في أي أسبوع ويغير أي موظف × أي يوم × أي دوام بفاعلية كاملة.
 * كل خلية محفوظة = تغيير مجدول بتاريخ سريانه (employee_shift_history) —
 * ووظيفة rollover تطبّقه في أعمدة المحرك يومه تلقائيًا. الماضي محمي دائمًا.
 * الطباعة: تقرير أسبوعي أفقي A4 ببطاقات الراحة وتوقيعات الاعتماد.
 */

// الأسبوع يبدأ السبت (طلب المالك 2026-10-04) — الترتيب يطابق weekday: 0..6 من السيرفر
const ROSTER_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

function rosterWeekStart(offset){
    const t = new Date(Date.now() + 3 * 3600 * 1000);
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    // بداية الأسبوع = السبت: (رقم اليوم + 1) % 7 = الأيام منذ السبت — يطابق مرجع السيرفر
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7) + (Number(offset) || 0) * 7);
    return d.toISOString().slice(0, 10);
}
function rosterFmtDate(iso){
    const d = new Date(String(iso) + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) {return String(iso || '');}
    return `${d.getUTCDate()} ${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][d.getUTCMonth()]}`;
}

function renderRoster() {
    if (!checkMenuAccessLocal('roster')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
    if (window._rosterWeekOffset == null) {window._rosterWeekOffset = 0;}
    const html = '<div class="u-row-between"><div>'
        + '<h3 class="u-gold-strong"><i class=ji data-i=calendar-clock></i> شبكة دوامات القسم</h3>'
        + '<small class="text-muted">غيّر أي موظف في أي يوم وأي دوام — اضغط <strong>حفظ الأسبوع</strong> فيتطبق كل خلية في تاريخها تلقائيًا. الماضي محمي ولا يُمس أبدًا.</small></div>'
        + '<div class="u-row-wrap"><span id="rosterDeptWrap"></span>'
        + '<button class="btn btn-sm" data-karim-action="loadRosterWeek"><i class=ji data-i=refresh></i> تحديث</button>'
        + '<button class="btn btn-sm btn-blue" data-karim-action="printRoster"><i class=ji data-i=printer></i> طباعة الأسبوع</button></div></div>'
        + '<div class="u-row-between" style="margin-top:12px;flex-wrap:wrap;gap:8px">'
        + '<div class="u-row-wrap"><button class="btn btn-sm" data-karim-action="rosterWeekNav" data-karim-args="[-1]" title="الأسبوع السابق"><i class=ji data-i=arrow-right></i></button>'
        + '<b id="rosterWeekLabel" style="min-width:230px;text-align:center"></b>'
        + '<button class="btn btn-sm" data-karim-action="rosterWeekNav" data-karim-args="[1]" title="الأسبوع التالي"><i class=ji data-i=arrow-left></i></button>'
        + '<button class="btn btn-sm btn-gold" data-karim-action="rosterWeekNav" data-karim-args="[0]">هذا الأسبوع</button></div>'
        + '<div class="u-row-wrap"><button class="btn btn-sm" data-karim-action="rosterCopyPrevWeek" title="اجلب قيم الأسبوع الماضي كأساس لهذا الأسبوع"><i class=ji data-i=copy></i> نسخ من الأسبوع السابق</button>'
        + '<button class="btn btn-gold" id="rosterSaveBtn" data-karim-action="saveRosterWeek" disabled><i class=ji data-i=save></i> حفظ الأسبوع</button></div>'
        + '</div>'
        + '<div id="rosterNotice" style="margin-top:10px"></div>'
        + '<div id="rosterApprovalBox" style="margin-top:10px"></div>'
        + '<div id="rosterBody" style="margin-top:14px"><div class="mcard u-empty"><div class="spinner"></div></div></div>'
        + '<div id="rosterApprovalPending"></div>'
        + '<div id="rosterLog" style="margin-top:14px"></div>';
    setTimeout(() => { loadRosterWeek(); }, 0);
    return html;
}

async function loadRosterWeek(){
    const box = document.getElementById('rosterBody');
    if (!box) {return;}
    const role = STATE.currentUser?.role;
    const isHR = ['hr', 'admin'].includes(role);
    try {
        const ws = rosterWeekStart(window._rosterWeekOffset || 0);
        const qs = '?week=' + encodeURIComponent(ws) + (window._rosterDept ? '&dept=' + encodeURIComponent(window._rosterDept) : '');
        const d = await apiFetch('/hr/dept-roster-week' + qs);
        window._rosterWeekData = d;
        // شارة القسم + منتقي القسم للمخوّلين
        const myDepts = Array.isArray(d.depts) ? d.depts : [];
        const deptName = myDepts.length ? myDepts.map((c) => deptNameByCode(c) || c).join(' + ') : 'كل الأقسام';
        const wrap = document.getElementById('rosterDeptWrap');
        if (wrap) {
            if (!d.fixed && ['admin', 'hr', 'manager', 'accountant'].includes(role)) {
                const depts = Array.isArray(d.validDepts) ? d.validDepts : [];
                const cur = window._rosterDept || '';
                let opts = '<option value="">كل الأقسام</option>';
                for (const c of depts) {opts += '<option value="' + esc(c) + '"' + (cur === c ? ' selected' : '') + '>' + esc(deptNameByCode(c) || c) + '</option>';}
                wrap.innerHTML = '<select id="rosterDeptSel" class="inp" onchange="window._rosterDept=this.value;loadRosterWeek()">' + opts + '</select>';
            } else {
                wrap.innerHTML = '<span class="badge bdg-blue">القسم: ' + esc(deptName) + '</span>';
            }
        }
        const wl = document.getElementById('rosterWeekLabel');
        if (wl) {wl.textContent = 'الأسبوع: ' + rosterFmtDate(d.weekStart) + ' — ' + rosterFmtDate(d.days[6].date) + ' ' + d.weekStart.slice(0, 4);}
        // رأس الأعمدة
        let thead = '<thead><tr><th style="min-width:190px;position:sticky;right:0;background:#0f172a;z-index:2">الموظف</th>';
        for (const day of d.days) {
            thead += '<th style="text-align:center;' + (day.isToday ? 'color:#f5d76e;' : day.isPast ? 'color:#94a3b8;' : '') + '">'
                + ROSTER_DAYS[day.weekday] + '<br><small style="font-weight:400">' + rosterFmtDate(day.date)
                + (day.isToday ? ' • اليوم' : '') + (day.isPast ? ' • مقفل' : '') + '</small></th>';
        }
        thead += '<th style="text-align:center">أدوات</th></tr></thead>';
        // الصفوف
        let tbody = '<tbody>';
        for (const row of d.grid) {
            tbody += '<tr data-emp="' + esc(String(row.id)) + '">'
                + '<td style="position:sticky;right:0;background:var(--bg);z-index:1"><div class="fw-bold">' + esc(row.name) + '</div>'
                + '<small style="color:var(--text3)">' + esc(row.employeeId || '') + (row.position ? ' · ' + esc(row.position) : '') + '</small></td>';
            for (let i = 0; i < 7; i++) {
                const day = d.days[i];
                const cell = row.cells[i];
                const off = cell.day_off != null && Number(cell.day_off) === Number(day.weekday);
                const onLeave = Boolean(cell.onLeave);
                tbody += '<td class="rs-cell" data-date="' + esc(day.date) + '" style="text-align:center;' + (day.isToday ? 'background:rgba(212,168,67,.08);' : '') + (onLeave ? 'background:rgba(245,158,11,.15);' : off ? 'background:rgba(148,163,184,.12);' : '') + '">';
                if (onLeave) {
                    tbody += '<div style="font-size:11px;color:#b45309;font-weight:800">🏖 إجازة</div><div style="font-size:10px;color:#b45309">' + esc(cell.leaveType || '') + '</div>';
                } else if (!cell.editable) {
                    tbody += '<div style="font-size:11px;color:' + (off ? 'var(--text3)' : 'var(--text)') + '">' + (off ? 'راحة' : esc(cell.shift_start) + '<br><small>' + esc(String(cell.shift_hours)) + 'س</small>') + '</div>';
                } else {
                    tbody += '<div style="display:flex;flex-direction:column;gap:3px;align-items:center">'
                        + '<input type="time" class="inp rsW-start" value="' + esc(cell.shift_start) + '" style="width:82px;padding:3px 4px;font-size:11px" onchange="rosterMarkDirty(this)"' + (off ? ' disabled' : '') + '>'
                        + '<input type="number" class="inp rsW-hours" value="' + esc(String(cell.shift_hours)) + '" min="1" max="24" step="0.5" style="width:60px;padding:3px 4px;font-size:11px" onchange="rosterMarkDirty(this)"' + (off ? ' disabled' : '') + '>'
                        + '<label style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="rsW-off" ' + (off ? 'checked' : '') + ' onchange="rosterToggleOff(this)">راحة</label>'
                        + '</div>';
                }
                tbody += '</td>';
            }
            tbody += '<td style="text-align:center"><button class="btn btn-sm" title="انسخ قيم أول يوم متاح لبقية أيام الأسبوع" onclick="rosterCopyRow(this)"><i class=ji data-i=copy></i></button></td></tr>';
        }
        if (!d.grid.length) {tbody += '<tr><td colspan="9" class="u-empty">لا موظفون في نطاق هذا القسم بعد</td></tr>';}
        tbody += '</tbody>';
        box.innerHTML = '<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=users></i> الموظفون (' + d.grid.length + ') — ' + esc(deptName) + '</h3>'
            + '<small class="text-muted">الخلايا الرمادية = راحة · البرتقالية = إجازة معتمدة · العمود الذهبي = اليوم</small></div>'
            + '<div class="tbl-scroll" style="max-height:60vh"><table>' + thead + tbody + '</table></div></div>'
            + '<div class="u-row-wrap" style="margin-top:12px"><small class="text-muted"><i class=ji data-i=info></i> كل خلية تُطبق في تاريخها تلقائيًا عبر مجدول المحرك (كل 5 دقائق)، وآخر يوم محفوظ يظل الدوام المستمر بعد الأسبوع حتى تغيّره.</small></div>';
        const saveBtn = document.getElementById('rosterSaveBtn');
        if (saveBtn) {saveBtn.disabled = true;}
        // ─── حالة اعتماد شؤون العاملين ───
        const apBox = document.getElementById('rosterApprovalBox');
        if (apBox) {
            const ap = d.approval;
            if (ap && ap.approved_name) {
                apBox.innerHTML = '<div class="workflow-banner" style="border-right:4px solid #16a34a"><i class=ji data-i=circle-check></i> <b>معتمدة من شؤون العاملين:</b> ' + esc(ap.approved_name) + ' — ' + esc(String(ap.approved_at || '').replace('T', ' ').slice(0, 16)) + ' — الطباعة ستخرج معتمدة</div>';
            } else if (ap && ap.requested_name) {
                apBox.innerHTML = '<div class="workflow-banner"><i class=ji data-i=hourglass></i> <b>مُرسلة لاعتماد شؤون العاملين</b> — بواسطة ' + esc(ap.requested_name || '—') + ' (بانتظار التوقيع)'
                    + (isHR ? ' <button class="btn btn-green btn-sm" onclick="rosterApprove(\'' + esc(rosterApKey(d)) + '\')"><i class=ji data-i=pen-line></i> توقيع واعتماد الآن</button>' : '') + '</div>';
            } else {
                apBox.innerHTML = '<button class="btn btn-sm btn-blue" data-karim-action="rosterRequestApproval"><i class=ji data-i=pen-line></i> إرسال لاعتماد شؤون العاملين</button><small class="text-muted"> — بعد اعتمادهم تُطبع النسخة موقّعة ومعتمدة</small>';
            }
        }
        if (isHR) {rosterLoadPending();}
        const logBox = document.getElementById('rosterLog');
        if (logBox) {
            const rl = Array.isArray(d.recentLog) ? d.recentLog : [];
            logBox.innerHTML = rl.length
                ? '<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=history></i> آخر تغييرات الدوام</h3></div>'
                + '<div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>الدوام</th><th>يسري من</th><th>بواسطة</th><th>وقت التسجيل</th></tr></thead><tbody>'
                + rl.map((r) => '<tr><td class="fw-bold">' + esc(r.name || '') + ' <small class="text-muted">' + esc(r.emp_no || '') + '</small></td>'
                    + '<td dir="ltr">' + esc(String(r.shift_start || '')) + ' / ' + esc(String(r.shift_karim || '')) + 'س</td>'
                    + '<td>' + esc(r.effective_from || '') + '</td>'
                    + '<td class="text-muted">' + esc(r.by_name || '—') + '</td>'
                    + '<td class="text-muted">' + esc(String(r.created_at || '').replace('T', ' ').slice(0, 16)) + '</td></tr>').join('')
                + '</tbody></table></div></div>'
                : '';
        }
    } catch (e) {
        box.innerHTML = '<div class="mcard u-empty">تعذر التحميل: ' + esc(e.message || e) + '</div>';
    }
}

function rosterWeekNav(delta){
    window._rosterWeekOffset = (Number(window._rosterWeekOffset) || 0) + (Number(delta) || 0);
    loadRosterWeek();
}
function rosterApKey(d){
    const role = STATE.currentUser?.role;
    if (['hr','admin'].includes(role)) {return String(window._rosterDept || '*').toLowerCase();}
    return String((d.depts && d.depts.length) ? d.depts.join(',') : '*').toLowerCase();
}
async function rosterRequestApproval(){
    const d = window._rosterWeekData; if (!d) {return;}
    showLoad();
    try{
        await apiFetch('/hr/dept-roster-approval/request', {method:'POST', body: JSON.stringify({ dept: window._rosterDept || undefined, week_start: d.weekStart })});
        toast('أُرسل طلب الاعتماد إلى شؤون العاملين','success');
        loadRosterWeek();
    }catch(e){ toast(e.message || 'تعذر الإرسال','error'); }
    finally{ hideLoad(); }
}
async function rosterApprove(deptKey){
    const d = window._rosterWeekData; if (!d) {return;}
    showLoad();
    try{
        const r = await apiFetch('/hr/dept-roster-approval/approve', {method:'POST', body: JSON.stringify({ dept_key: deptKey, week_start: d.weekStart })});
        toast('اعتُمدت الدوامات — توقيع: ' + (r.approval?.approved_name || ''), 'success');
        loadRosterWeek();
    }catch(e){ toast(e.message || 'تعذر الاعتماد','error'); }
    finally{ hideLoad(); }
}
async function rosterLoadPending(){
    const d = window._rosterWeekData; if (!d) {return;}
    const box = document.getElementById('rosterApprovalPending'); if (!box) {return;}
    try{
        const p = await apiFetch('/hr/dept-roster-approval/pending?week=' + encodeURIComponent(d.weekStart));
        const rows = Array.isArray(p.pending) ? p.pending : [];
        box.innerHTML = rows.length
            ? '<div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=pen-line></i> طلبات اعتماد دوامات بانتظار توقيع شؤون العاملين (' + rows.length + ')</h3></div><table style="width:100%"><thead><tr><th>القسم</th><th>الطالب</th><th>الوقت</th><th>إجراء</th></tr></thead><tbody>'
            + rows.map((r) => '<tr><td class="fw-bold">' + esc(String(r.dept_key).split(',').map((c) => deptNameByCode(c) || c).join(' + ')) + '</td><td>' + esc(r.requested_name || '—') + '</td><td class="text-muted">' + esc(String(r.requested_at || '').replace('T', ' ').slice(0, 16)) + '</td><td><button class="btn btn-green btn-sm" onclick="rosterApprove(\'' + esc(r.dept_key) + '\')"><i class=ji data-i=pen-line></i> توقيع واعتماد</button></td></tr>').join('')
            + '</tbody></table></div>'
            : '';
    }catch(_){ box.innerHTML = ''; }
}

function rosterRowOf(el){ return el.closest('tr[data-emp]'); }
function rosterMarkDirty(el){
    const tr = rosterRowOf(el);
    if (tr) {tr.dataset.dirty = '1';}
    const btn = document.getElementById('rosterSaveBtn');
    if (btn) {btn.disabled = false;}
}
function rosterToggleOff(cb){
    const td = cb.closest('td');
    if (td) {
        td.querySelectorAll('.rsW-start,.rsW-hours').forEach((i) => {i.disabled = cb.checked;});
        if (cb.checked) {td.style.background = 'rgba(148,163,184,.12)';}
        else {td.style.background = '';}
    }
    rosterMarkDirty(cb);
}
function rosterCopyRow(btn){
    const tr = rosterRowOf(btn);
    if (!tr) {return;}
    const first = tr.querySelector('td.rs-cell .rsW-start');
    if (!first) {toast('لا يوم قابل للتعديل في هذا الأسبوع', 'warning');return;}
    const srcTd = first.closest('td');
    const sStart = srcTd.querySelector('.rsW-start')?.value;
    const sHours = srcTd.querySelector('.rsW-hours')?.value;
    const sOff = srcTd.querySelector('.rsW-off')?.checked;
    tr.querySelectorAll('td.rs-cell').forEach((td) => {
        const st = td.querySelector('.rsW-start');
        if (!st || st.disabled) {return;}
        st.value = sStart;
        const hr = td.querySelector('.rsW-hours');
        if (hr) {hr.value = sHours;}
        const off = td.querySelector('.rsW-off');
        if (off) {off.checked = sOff; if (sOff) {td.style.background = 'rgba(148,163,184,.12)';} else {td.style.background = '';}}
        td.querySelectorAll('.rsW-start,.rsW-hours').forEach((i) => {i.disabled = sOff;});
    });
    tr.dataset.dirty = '1';
    const b = document.getElementById('rosterSaveBtn');
    if (b) {b.disabled = false;}
    toast('نُسخت قيم أول يوم لبقية الأسبوع — اضغط حفظ', 'info');
}
async function rosterCopyPrevWeek(){
    try{
        const ws = rosterWeekStart((Number(window._rosterWeekOffset) || 0) - 1);
        const qs = '?week=' + encodeURIComponent(ws) + (window._rosterDept ? '&dept=' + encodeURIComponent(window._rosterDept) : '');
        const d = await apiFetch('/hr/dept-roster-week' + qs);
        const prev = new Map((d.grid || []).map((r) => [String(r.id), r]));
        const trs = document.querySelectorAll('#rosterBody tr[data-emp]');
        let n = 0;
        trs.forEach((tr) => {
            const src = prev.get(String(tr.dataset.emp));
            if (!src) {return;}
            const tds = tr.querySelectorAll('td.rs-cell');
            tds.forEach((td, i) => {
                const st = td.querySelector('.rsW-start');
                if (!st) {return;}
                const cell = src.cells[i];
                const off = cell.day_off != null && Number(cell.day_off) === Number(cell.date && new Date(cell.date + 'T12:00:00Z').getUTCDay());
                st.value = cell.shift_start;
                const hr = td.querySelector('.rsW-hours');
                if (hr) {hr.value = String(cell.shift_hours);}
                const cb = td.querySelector('.rsW-off');
                if (cb) {cb.checked = off; td.style.background = off ? 'rgba(148,163,184,.12)' : '';}
                td.querySelectorAll('.rsW-start,.rsW-hours').forEach((x) => {x.disabled = off;});
                n++;
            });
            tr.dataset.dirty = '1';
        });
        const b = document.getElementById('rosterSaveBtn');
        if (b) {b.disabled = n === 0;}
        toast(n ? `نُسخ ${n} يوم من الأسبوع السابق — راجع ثم اضغط حفظ` : 'لا بيانات في الأسبوع السابق', n ? 'info' : 'warning');
    }catch(e){ toast(e.message || 'تعذر النسخ', 'error'); }
}
async function saveRosterWeek(){
    const d = window._rosterWeekData;
    if (!d) {return;}
    const trs = Array.from(document.querySelectorAll('#rosterBody tr[data-emp][data-dirty]'));
    if (!trs.length) {toast('لا تعديلات للحفظ', 'warning');return;}
    const dayMeta = d.days;
    const cells = [];
    for (const tr of trs) {
        const id = Number(tr.dataset.emp);
        for (let i = 0; i < 7; i++) {
            const td = tr.querySelectorAll('td.rs-cell')[i];
            if (!td) {continue;}
            const day = dayMeta[i];
            const off = td.querySelector('.rsW-off');
            const isOff = off ? off.checked : false;
            const start = td.querySelector('.rsW-start')?.value || '09:00';
            const hours = parseFloat(td.querySelector('.rsW-hours')?.value) || 10;
            cells.push({ id, date: day.date, shift_start: start, shift_hours: hours, day_off: isOff ? day.weekday : null });
        }
    }
    showLoad();
    try{
        const r = await apiFetch('/hr/dept-roster-week', {
            method: 'POST',
            body: JSON.stringify({ dept: window._rosterDept || undefined, week_start: rosterWeekStart(window._rosterWeekOffset || 0), cells }),
        });
        toast(`حُفظت ${r.updated} خلية دوام — كل خلية ستُطبق في تاريخها تلقائيًا`, 'success');
        loadRosterWeek();
    } catch (e) {
        toast(e.message || 'تعذر الحفظ', 'error');
    } finally { hideLoad(); }
}

// ─── طباعة أسبوعية احترافية (A4 أفقي) — شبكة الموظفين × الأيام ───
async function printRoster(){
    try{
        let d = window._rosterWeekData;
        const ws = rosterWeekStart(window._rosterWeekOffset || 0);
        if (!d || d.weekStart !== ws) {
            const qs = '?week=' + encodeURIComponent(ws) + (window._rosterDept ? '&dept=' + encodeURIComponent(window._rosterDept) : '');
            d = await apiFetch('/hr/dept-roster-week' + qs);
        }
        const grid = Array.isArray(d.grid) ? d.grid : [];
        if (!grid.length) {toast('لا يوجد موظفون لطباعتهم', 'warning');return;}
        const myDepts = Array.isArray(d.depts) ? d.depts : [];
        const deptName = myDepts.length ? myDepts.map((c) => deptNameByCode(c) || c).join(' + ') : 'كل الأقسام';
        const now = new Date();
        const printedAt = now.toISOString().slice(0, 10) + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        const ap = d.approval;
        const approved = !!(ap && ap.approved_name);
        const hrSig = approved
            ? '<span style="color:#16a34a;font-weight:700">توقيع شؤون العاملين: ' + esc(ap.approved_name) + ' — ' + esc(String(ap.approved_at || '').replace('T', ' ').slice(0, 16)) + ' ✓</span>'
            : '<span>توقيع شؤون العاملين: ........................</span>';
        let tbody = '<tbody>';
        for (const row of grid) {
            tbody += '<tr><td class="emp"><b>' + esc(row.name) + '</b><br><small>' + esc(row.employeeId || '') + (row.position ? ' · ' + esc(row.position) : '') + '</small></td>';
            for (let i = 0; i < 7; i++) {
                const cell = row.cells[i];
                const day = d.days[i];
                const off = cell.day_off != null && Number(cell.day_off) === Number(day.weekday);
                const onLeave = Boolean(cell.onLeave);
                tbody += '<td class="' + (onLeave ? 'leave' : off ? 'off' : '') + (day.isToday ? ' today' : '') + '">'
                    + (onLeave
                        ? '<span class="lv">🏖 إجازة</span><br><small class="lvtype">' + esc(cell.leaveType || '') + '</small>'
                        : off
                            ? '<span class="rest">راحة</span>'
                            : '<b dir="ltr">' + esc(String(cell.shift_start).slice(0, 5)) + '</b>')
                    + '</td>';
            }
            tbody += '</tr>';
        }
        tbody += '</tbody>';
        const printWin = (window.openInAppReport ? window.openInAppReport('دوامات القسم') : window.open('', '_blank'));
        if (!printWin) {toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning');return;}
        printWin.document.write('<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>دوامات القسم — ' + esc(deptName) + '</title><style>'
            + '@page{size:A4 landscape;margin:10mm}'
            + 'body{font-family:\'Cairo\',\'Segoe UI\',Tahoma,sans-serif;margin:0;color:#1a1a2e;background:#fff}'
            + '.hdr{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:14px 22px;display:flex;align-items:center;justify-content:space-between}'
            + '.hdr h1{margin:0;font-size:19px;color:#f5d76e}.hdr .sub{margin:3px 0 0;font-size:11px;color:#cbd5e1}'
            + '.hdr .meta{text-align:left;font-size:11px;color:#cbd5e1;line-height:1.7}'
            + '.wrap{padding:12px 18px}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px}'
            + 'th{background:#0f172a;color:#fff;padding:8px 6px;text-align:center;font-size:12px;border:1.5px solid #0f172a}'
            + 'th.emp{width:170px;text-align:right}'
            + 'td{padding:7px 6px;border:1.5px solid #334155;text-align:center;vertical-align:middle;font-weight:600}'
            + 'tbody tr:nth-child(even) td{background:#f8fafc}'
            + 'td.emp{background:#eef2f7 !important;text-align:right;border-right:2.5px solid #0f172a;font-weight:700}'
            + 'td small{color:#64748b;display:block;font-size:10px}'
            + 'td.off{background:#f1f5f9}td.off .rest{color:#94a3b8;font-weight:800;font-size:11px}'
            + 'td.leave{background:#fef3c7}td.leave .lv{color:#b45309;font-weight:900;font-size:11.5px}td.leave .lvtype{color:#b45309;font-weight:700;font-size:10px}'
            + 'td.today{outline:2.5px solid #d4a843;outline-offset:-2.5px}'
            + '.legend{display:flex;gap:18px;align-items:center;margin-top:10px;font-size:11px;color:#334155;font-weight:600}'
            + '.legend .k{display:inline-block;width:14px;height:14px;border:1.5px solid #334155;vertical-align:-2px;margin-left:5px}'
            + '.foot{margin-top:12px;display:flex;justify-content:space-between;font-size:11px;color:#334155;border-top:2px solid #0f172a;padding-top:8px}'
            + '</style></head><body>'
            + '<div class="hdr"><div><h1>شبكة دوامات القسم — ' + esc(deptName) + (approved ? ' <span style="background:#16a34a;color:#fff;padding:2px 10px;border-radius:6px;font-size:12px">معتمدة ✓</span>' : '') + '</h1><div class="sub">مطاعم الشرفه العالمي — الأسبوع ' + esc(rosterFmtDate(d.weekStart)) + ' إلى ' + esc(rosterFmtDate(d.days[6].date)) + ' ' + esc(String(d.weekStart).slice(0, 4)) + '</div></div>'
            + '<div class="meta">الطباعة: ' + esc(printedAt) + '<br>عدد الموظفين: <b>' + grid.length + '</b>' + (approved ? '<br>اعتماد شؤون العاملين: <b>' + esc(ap.approved_name) + '</b>' : '') + '</div></div>'
            + '<div class="wrap"><table><thead><tr><th class="emp">الموظف</th>'
            + d.days.map((day) => '<th>' + ROSTER_DAYS[day.weekday] + '<br><small style="font-weight:400">' + rosterFmtDate(day.date) + (day.isToday ? ' • اليوم' : '') + '</small></th>').join('')
            + '</tr></thead>' + tbody + '</table>'
            + '<div class="legend"><span><span class="k" style="background:#fef3c7"></span> إجازة معتمدة</span><span><span class="k" style="background:#f1f5f9"></span> راحة أسبوعية</span><span><span class="k" style="background:#fff;outline:2px solid #d4a843;outline-offset:-2px"></span> اليوم</span><span><span class="k" style="background:#fff"></span> دوام — يظهر وقت البداية</span></div>'
            + '<div class="foot"><span>توقيع مسؤول القسم: ........................</span>' + hrSig + '<span>اعتماد المدير: ........................</span></div></div>'
            + '<script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script>'
            + '</body></html>');
        printWin.document.close();
    }catch(e){
        toast(e.message || 'تعذر الطباعة', 'error');
    }
}

export { renderRoster, loadRosterWeek, saveRosterWeek, printRoster, rosterWeekNav, rosterMarkDirty, rosterToggleOff, rosterCopyRow, rosterCopyPrevWeek, rosterRequestApproval, rosterApprove, rosterLoadPending };
