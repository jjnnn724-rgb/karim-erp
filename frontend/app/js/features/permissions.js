/**
 * features/permissions.js — User permission grants (admin assigns).
 * Grants are additive over roles. Admin role implies everything.
 */
const PERM = { userId: null, catalog: [], grants: [], denies: [], audit: [], loading: false, targetRole: '' };

function renderPermissionsPage() {
    if (STATE.currentUser?.role !== 'admin') {
        return '<div class="mcard"><i class=ji data-i=lock></i> صفحة الصلاحيات للمدير العام فقط</div>';
    }
    if (!PERM.catalog.length && !PERM.loading) { setTimeout(() => permLoadCatalog(), 0); }
    const users = (STATE.users || []).filter(u => u.active !== false)
        .sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username), 'ar'));
    const target = users.find(u => String(u.id) === String(PERM.userId));
    const groups = [];
    for (const p of PERM.catalog) {
        let g = groups.find(x => x.name === p.group);
        if (!g) { g = { name: p.group, items: [] }; groups.push(g); }
        g.items.push(p);
    }
    const granted = new Set(PERM.grants || []);
    const denied = new Set(PERM.denies || []);
    // FIX: كان بلا حماية — أول فتح للصفحة (PERM.userId=null) كان يرمي TypeError
    // ويُبقي الصفحة بيضاء تمامًا (تعذر الرندر). الحماية تمنع الانهيار،
    // والقالب أدناه يعرض "اختر مستخدمًا" كما هو مصمم.
    const isAdminTarget = target?.role === 'admin';
    return `
<div class="tbl-wrap"><div class="tbl-hd">
<h3><i class=ji data-i=key></i> ${t('pg.permissions')} — منح فردية فوق الدور</h3>
<div class="u-row-wrap">
<select class="inp" style="max-width:260px" data-karim-action="permSelectUser" data-karim-event="change" data-karim-pass="value" aria-label="اختر المستخدم">
<option value="">— اختر المستخدم —</option>
${users.map(u => `<option value="${esc(String(u.id))}" ${String(PERM.userId) === String(u.id) ? 'selected' : ''}>${esc(u.name || u.username)} (${esc(u.role || '')})${u.role === 'admin' ? ' — الكل' : ''}</option>`).join('')}
</select>
</div></div>
${!target ? '<div class="u-empty">اختر مستخدمًا لعرض صلاحياته ومنح صلاحيات إضافية لدوره الحالي</div>' : `
<div style="padding:10px 14px" class="text-muted u-t13">المستخدم: <b>${esc(target.name || target.username)}</b> — الدور: <b>${esc(target.role || '')}</b>${target.role === 'admin' ? ' (يملك كل الصلاحيات — لا حاجة لمنح)' : ''}</div>
${groups.map(g => `
<div class="tbl-hd" style="border-top:1px solid var(--border)"><h3>${esc(g.name)}</h3></div>
<div style="padding:6px 14px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
${g.items.map(p => {
const mode = denied.has(p.key) ? 'deny' : (granted.has(p.key) ? 'grant' : 'inherit');
return `
<label class="mcard" style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;margin:0;cursor:${isAdminTarget ? 'not-allowed' : 'pointer'};${mode === 'deny' ? 'border-color:var(--red);' : ''}">
<span style="flex:1"><b>${esc(p.ar)}</b><br><small class="text-muted">${esc(p.key)}</small></span>
<select data-perm="${esc(p.key)}" ${isAdminTarget ? 'disabled' : ''} data-karim-action="permSet" data-karim-event="change" data-karim-arg0="${esc(p.key)}" data-karim-pass="value" aria-label="حالة ${esc(p.ar)}" style="max-width:110px" class="inp">
<option value="inherit" ${mode === 'inherit' ? 'selected' : ''}>وراثة الدور</option>
<option value="grant" ${mode === 'grant' ? 'selected' : ''}>منح</option>
<option value="deny" ${mode === 'deny' ? 'selected' : ''}>سحب</option>
</select>
</label>`;}).join('')}
</div>`).join('')}
${target.role === 'admin' ? '' : `
<div class="fr" style="padding:0 14px 14px;align-items:end">
<div class="fg" style="max-width:320px"><label>سبب المنح/السحب (يُسجَّل في التدقيق)</label><input type="text" id="permReason" class="inp" placeholder="اختياري"></div>
<button class="btn btn-gold" data-karim-action="permSave"><i class=ji data-i=save></i> حفظ الصلاحيات</button>
</div>`}
${(PERM.audit || []).length ? `
<div class="tbl-hd"><h3><i class=ji data-i=history></i> سجل التدقيق (آخر 50)</h3></div>
<div class="tbl-scroll"><table><thead><tr><th>التاريخ</th><th>الصلاحية</th><th>الإجراء</th><th>بواسطة</th><th>السبب</th></tr></thead><tbody>
${PERM.audit.map(a => { const lbl = a.action === 'grant' ? ['منح', 'bdg-green'] : a.action === 'deny' ? ['سحب', 'bdg-red'] : a.action === 'undeny' ? ['إلغاء سحب', 'bdg-blue'] : ['سحب منح', 'bdg-red']; return `<tr><td class="u-t12">${esc(String(a.created_at || '').slice(0, 19).replace('T', ' '))}</td><td dir="ltr" class="u-t12">${esc(a.perm_key)}</td><td><span class="badge ${lbl[1]}">${lbl[0]}</span></td><td>${esc(a.acted_by || '—')}</td><td>${esc(a.reason || '—')}</td></tr>`; }).join('')}
</tbody></table></div>` : ''}
`}
</div>`;
}

async function permLoadCatalog() {
    if (PERM.loading) {return;}
    PERM.loading = true;
    try { PERM.catalog = await apiFetch('/permissions/catalog'); }
    catch (e) { toast(e.message || 'تعذر جلب الكتالوج', 'error'); }
    finally { PERM.loading = false; }
    if (STATE.page === 'permissions') {renderPage();}
}

async function permSelectUser(id) {
    PERM.userId = id || null;
    PERM.grants = [];
    PERM.denies = [];
    PERM.audit = [];
    if (!id) {renderPage();return;}
    try {
        const r = await apiFetch(`/permissions/users/${encodeURIComponent(id)}`);
        PERM.grants = r.grants || [];
        PERM.denies = r.denies || [];
        PERM.audit = r.audit || [];
        PERM.targetRole = r.user?.role || '';
    } catch (e) { toast(e.message || 'تعذر جلب صلاحيات المستخدم', 'error'); }
    renderPage();
}

function permSet(key, mode) {
    const g = new Set(PERM.grants || []);
    const d = new Set(PERM.denies || []);
    g.delete(key); d.delete(key);
    if (mode === 'grant') {g.add(key);}
    else if (mode === 'deny') {d.add(key);}
    PERM.grants = [...g];
    PERM.denies = [...d];
}

async function permSave() {
    if (!PERM.userId) {return;}
    const reason = document.getElementById('permReason')?.value.trim() || '';
    try {
        const r = await apiFetch(`/permissions/users/${encodeURIComponent(PERM.userId)}`, {
            method: 'PUT', body: JSON.stringify({ grants: PERM.grants || [], denies: PERM.denies || [], reason }),
        });
        PERM.grants = r.grants || [];
        PERM.denies = r.denies || [];
        toast('حُفظت الصلاحيات (منح وسحب)', 'success');
        permSelectUser(PERM.userId);
    } catch (e) { toast(e.message || 'تعذر الحفظ', 'error'); }
}

export { renderPermissionsPage, permLoadCatalog, permSelectUser, permSet, permSave, PERM };
