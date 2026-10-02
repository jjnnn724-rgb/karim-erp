/**
 * features/roster.js — جدول دوامات القسم (2026-10)
 * رئيس القسم يكتب دوامات رجاله (بداية + مدة + راحة) → حفظ واحد → تسمع فورًا
 * في أعمدة الدوام الثابت (مصدر المحرك). بلا مسودات ولا اعتماد. التاريخ القديم
 * لا يُمس. الضم: صف بلا قسم يُسند لقسمك عند الحفظ.
 */

const ROSTER_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function renderRoster() {
    if (!checkMenuAccessLocal('roster')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
    const tm = new Date(Date.now() + 3 * 3600 * 1000 + 86400000);
    const tomorrow = `${tm.getUTCFullYear()}-${String(tm.getUTCMonth() + 1).padStart(2, '0')}-${String(tm.getUTCDate()).padStart(2, '0')}`;
    if (!window._rosterEff) {window._rosterEff = tomorrow;}
    const html = '<div class="u-row-between"><div>'
        + '<h3 class="u-gold-strong"><i class=ji data-i=calendar-clock></i> دوامات قسمي</h3>'
        + '<small class="text-muted">اكتب دوام كل موظف وحدد <strong>تاريخ السريان</strong> ثم <strong>حفظ الجدول</strong> — الماضي محمي دائمًا، والمستقبل المرتب يطبق تلقائيًا. التغيير والرجوع حران.</small></div>'
        + '<div class="u-row-wrap"><label class="text-muted">يسري من: <input type="date" id="rosterEff" class="inp" value="' + esc(window._rosterEff) + '" onchange="window._rosterEff=this.value"></label>'
        + '<span id="rosterDeptWrap"></span><button class="btn btn-sm" onclick="loadRoster()"><i class=ji data-i=refresh></i> تحديث</button></div></div>'
        + '<div id="rosterNotice" style="margin-top:10px"></div>'
        + '<div id="rosterBody" style="margin-top:14px"><div class="mcard u-empty"><div class="spinner"></div></div></div>'
        + '<div id="rosterLog" style="margin-top:14px"></div>';
    setTimeout(() => { loadRoster(); }, 0);
    return html;
}

async function loadRoster() {
    const box = document.getElementById('rosterBody');
    if (!box) {return;}
    const role = STATE.currentUser?.role;
    try {
        const qs = window._rosterDept ? '?dept=' + encodeURIComponent(window._rosterDept) : '';
        const d = await apiFetch('/hr/dept-roster' + qs);
        const mine = Array.isArray(d.mine) ? d.mine : [];
        const unassigned = Array.isArray(d.unassigned) ? d.unassigned : [];
        const myDepts = Array.isArray(d.depts) ? d.depts : (d.dept ? [d.dept] : []);
        const deptName = myDepts.length
            ? myDepts.map((c) => deptNameByCode(c) || c).join(' + ')
            : 'كل الأقسام';
        // منتقي القسم للمخوّلين فقط (الثابتون على قسمهم إجباريًا)
        const wrap = document.getElementById('rosterDeptWrap');
        if (wrap) {
            if (!d.fixed && ['admin', 'hr', 'manager', 'accountant'].includes(role)) {
                const depts = Array.isArray(d.validDepts) ? d.validDepts : [];
                const cur = window._rosterDept || '';
                let opts = '<option value="">كل الأقسام</option>'
                    + '<option value="ADMIN,WAREHOUSE"' + (cur === 'ADMIN,WAREHOUSE' ? ' selected' : '') + '>الحسابات والمخازن</option>';
                for (const c of depts) {
                    opts += '<option value="' + esc(c) + '"' + (cur === c ? ' selected' : '') + '>' + esc(deptNameByCode(c) || c) + '</option>';
                }
                wrap.innerHTML = '<select id="rosterDeptSel" class="inp" onchange="window._rosterDept=this.value;loadRoster()">' + opts + '</select>';
            } else {
                wrap.innerHTML = '<span class="badge bdg-blue">قسمك: ' + esc(deptName) + '</span>';
            }
        }
        const dayOpts = (v) => {
            let o = '<option value="">بلا</option>';
            for (let i = 0; i < 7; i++) {o += '<option value="' + i + '"' + (String(v) === String(i) ? ' selected' : '') + '>' + ROSTER_DAYS[i] + '</option>';}
            return o;
        };
        const rowHtml = (r, claim) => {
            const att = r.todayIn || r.todayOut
                ? '<span class="badge bdg-green">حاضر ' + esc(r.todayIn || '—') + '</span>'
                : '<span class="badge bdg-gray">لم يبصم اليوم</span>';
            return '<tr data-emp="' + esc(String(r.id)) + '">'
                + '<td class="fw-bold">' + esc(r.name) + '<br><small style="color:var(--text3)">' + esc(r.employeeId || '') + '</small></td>'
                + '<td class="text-muted">' + esc(r.position || '—') + '</td>'
                + '<td style="width:110px"><input type="time" class="inp rsStart" value="' + esc(String(r.shift_start || '09:00').slice(0, 5)) + '" style="width:100px;padding:6px"></td>'
                + '<td style="width:100px"><input type="number" class="inp rsHours" value="' + (Number(r.shift_karim) || 10) + '" min="1" max="24" step="0.5" style="width:80px;padding:6px"></td>'
                + '<td style="width:120px"><select class="inp rsOff" style="padding:6px">' + dayOpts(r.day_off) + '</select></td>'
                + '<td>' + att + '</td>'
                + (claim ? '<td><span class="badge bdg-orange">بلا قسم — سيُضم لقسمك</span></td>' : '')
                + '</tr>';
        };
        let tables = '<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=users></i> رجالك (' + mine.length + ') — ' + esc(deptName) + '</h3></div>'
            + '<div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>بداية الدوام</th><th>المدة (ساعة)</th><th>الراحة الأسبوعية</th><th>حضور اليوم</th></tr></thead><tbody>'
            + (mine.map((r) => rowHtml(r, false)).join('') || '<tr><td colspan="6" class="u-empty">لا موظفون مربوطون بهذا القسم بعد' + (d.canSeeUnassigned ? ' — ضم من «بلا قسم» أدناه' : ' — راجع شؤون العاملين للتصنيف') + '</td></tr>')
            + '</tbody></table></div></div>';
        if (unassigned.length) {
            tables += '<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=user-plus></i> بلا قسم (' + unassigned.length + ') — حدد دوامه ليُضم لقسمك عند الحفظ</h3></div>'
                + '<div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>بداية الدوام</th><th>المدة (ساعة)</th><th>الراحة الأسبوعية</th><th>حضور اليوم</th><th>الضم</th></tr></thead><tbody>'
                + unassigned.map((r) => rowHtml(r, true)).join('')
                + '</tbody></table></div></div>';
        }
        box.innerHTML = tables
            + '<div class="u-row-wrap" style="margin-top:14px"><button class="btn btn-gold" onclick="saveRoster()"><i class=ji data-i=save></i> حفظ الجدول</button>'
            + '<small class="text-muted">يسري من <strong>' + esc(document.getElementById('rosterEff')?.value || window._rosterEff || '') + '</strong>. سجلات الحضور السابقة وحساباتها لا تتغير أبدًا.</small></div>';
        const notice = document.getElementById('rosterNotice');
        if (notice) {
            const pf = Array.isArray(d.pendingFuture) ? d.pendingFuture : [];
            notice.innerHTML = pf.length
                ? '<div class="workflow-banner"><i class=ji data-i=hourglass></i> تغييرات مجدولة (' + pf.length + '): '
                + pf.slice(0, 5).map((p) => esc(p.name || '') + ' ← ' + esc(String(p.shift_start || '')) + '/' + esc(String(p.shift_karim || '')) + 'س من ' + esc(p.effective_from || '')).join(' • ')
                + (pf.length > 5 ? ' …' : '') + '</div>'
                : '';
        }
        const logBox = document.getElementById('rosterLog');
        if (logBox) {
            const rl = Array.isArray(d.recentLog) ? d.recentLog : [];
            logBox.innerHTML = rl.length
                ? '<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=history></i> سجل تغييرات الدوام</h3></div>'
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

async function saveRoster() {
    const trs = Array.from(document.querySelectorAll('#rosterBody tr[data-emp]'));
    if (!trs.length) {toast('لا صفوف للحفظ', 'warning');return;}
    const rows = [];
    for (const tr of trs) {
        const id = Number(tr.dataset.emp);
        if (!Number.isInteger(id)) {continue;}
        const start = tr.querySelector('.rsStart')?.value || '09:00';
        const hours = parseFloat(tr.querySelector('.rsHours')?.value) || 10;
        const off = tr.querySelector('.rsOff')?.value;
        rows.push({ id, shift_start: start, shift_karim: hours, day_off: off === '' ? null : Number(off) });
    }
    showLoad();
    try {
        const eff = document.getElementById('rosterEff')?.value || window._rosterEff || '';
        window._rosterEff = eff;
        const r = await apiFetch('/hr/dept-roster', {
            method: 'POST',
            body: JSON.stringify({ dept: window._rosterDept || undefined, effective_from: eff, rows }),
        });
        for (const u of (r.rows || [])) {
            const local = (STATE.employees || []).find((e) => Number(e.id) === Number(u.id));
            if (local) {
                local.shift_start = u.shift_start;
                local.shift_karim = u.shift_karim;
                local.day_off = u.day_off;
                local.department = u.department;
            }
        }
        toast(r.appliedNow
            ? `حُفظ ${r.updated || 0} دوامًا — مطبق الآن في الحضور والرواتب`
            : `حُفظ ${r.updated || 0} دوامًا — يسري من ${r.effective_from || ''} تلقائيًا`, 'success');
        loadRoster();
    } catch (e) {
        toast(e.message || 'تعذر الحفظ', 'error');
    } finally {
        hideLoad();
    }
}

export { renderRoster, loadRoster, saveRoster };
