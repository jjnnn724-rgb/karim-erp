/**
 * features/dept-employees.js — إدارة موظفي القسم لرئيس القسم (UPGRADE 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────
 * رئيس القسم يضيف/يعدل/يعطّل موظفي قسمه حصرًا عبر المسارات المحصورة
 * /hr/dept-employees (نفس نطاق rosterScope: dept_code بقائمة فواصل).
 * حقول آمنة فقط: الاسم/الرقم الوظيفي/الوظيفة/الهاتف — الراتب والحالة والقسم
 * والحسابات من صلاحيات hr/admin.
 */
async function deptEmpFetch(path, options = {}) {
    return window.apiFetch('/hr/dept-employees' + path, options);
}

function renderDeptEmployeesPage() {
    const box = document.getElementById('content');
    if (!box) {return;}
    box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div> جارٍ تحميل موظفي القسم…</div>';
    deptEmpLoad();
}

async function deptEmpLoad() {
    const box = document.getElementById('content');
    if (!box) {return;}
    try {
        const d = await deptEmpFetch('');
        const emps = d.employees || [];
        const deptNames = (d.depts || []).map(c => (window.deptNameByCode ? deptNameByCode(c) : c)).join(' + ');
        box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <h3 class="u-gold-strong"><i class=ji data-i=users></i> موظفو القسم: ${esc(deptNames)}</h3>
        <button class="btn btn-gold" data-karim-action="deptEmpAddModal"><i class=ji data-i=plus></i> إضافة موظف للقسم</button>
        </div>
        <div id="deptEmpList">
        ${emps.length ? emps.map(e => `
        <div class="mcard" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="width:44px;height:44px;border-radius:50%;background:var(--gold-d);display:flex;align-items:center;justify-content:center;font-size:18px"><i class=ji data-i=user></i></div>
            <div class="u-flex1">
              <div class="fw-bold">${esc(e.name)}</div>
              <div class="text-muted" style="font-size:12px">${esc(e.employeeId)} · ${esc(e.position || 'بدون وظيفة')} · ${esc(e.phone || 'بلا هاتف')}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm" data-karim-action="deptEmpEditModal" data-karim-arg0="${e.id}"><i class=ji data-i=pencil></i> تعديل</button>
              <button class="btn btn-red btn-sm" data-karim-action="deptEmpDeactivate" data-karim-arg0="${e.id}" data-karim-arg1="${esc(e.name)}"><i class=ji data-i=x-circle></i> تعطيل</button>
            </div>
          </div>
        </div>`).join('') : '<div class="mcard u-empty">لا يوجد موظفون في قسمك بعد — أضف أول موظف من الزر الأعلى</div>'}
        </div>`;
    } catch (e) {
        box.innerHTML = `<div class="mcard u-empty">تعذر التحميل: ${esc(e.message || '')}</div>`;
    }
}

function deptEmpModal(title, fieldsHtml, saveFn) {
    window.showModal(`<h3 style="margin-top:0">${title}</h3>
        <div class="fg"><label>الاسم <b style="color:#e74c3c">*</b></label><input id="deptEmpName" value="${fieldsHtml.name || ''}"></div>
        <div class="fr"><div class="fg"><label>الرقم الوظيفي <b style="color:#e74c3c">*</b></label><input id="deptEmpId" value="${fieldsHtml.employeeId || ''}" ${fieldsHtml.lockId ? 'readonly' : ''} placeholder="مثال: EMP-101"></div>
        <div class="fg"><label>الوظيفة</label><input id="deptEmpPos" value="${fieldsHtml.position || ''}" placeholder="مثال: أمين مخزن مساعد"></div></div>
        <div class="fg"><label>الهاتف</label><input id="deptEmpPhone" value="${fieldsHtml.phone || ''}" placeholder="05xxxxxxxx"></div>
        <div id="deptEmpErr" class="form-error" role="alert"></div>
        <div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" onclick="${saveFn}"><i class=ji data-i=save></i> حفظ</button></div>`);
}

function deptEmpAddModal() {
    deptEmpModal('<i class=ji data-i=plus></i> إضافة موظف جديد للقسم', {}, 'deptEmpSaveNew');
}

function deptEmpEditModal(id) {
    deptEmpFetch('').then(r => {
        const emp = (r.employees || []).find(x => String(x.id) === String(id));
        if (!emp) {window.toast && toast('الموظف غير موجود في قسمك', 'error'); return;}
        deptEmpModal('<i class=ji data-i=pencil></i> تعديل موظف القسم', { name: emp.name, employeeId: emp.employeeId, position: emp.position, phone: emp.phone, lockId: true }, `deptEmpSaveEdit('${id}')`);
    }).catch(e => { window.toast && toast(e.message || 'خطأ', 'error'); });
}

function deptEmpRead() {
    return {
        name: document.getElementById('deptEmpName')?.value.trim() || '',
        employeeId: document.getElementById('deptEmpId')?.value.trim() || '',
        position: document.getElementById('deptEmpPos')?.value.trim() || '',
        phone: document.getElementById('deptEmpPhone')?.value.trim() || '',
    };
}

async function deptEmpSaveNew() {
    const f = deptEmpRead();
    try {
        const r = await deptEmpFetch('', { method: 'POST', body: JSON.stringify(f) });
        const j = await r.json();
        if (!j.ok) {throw new Error(j.message || 'فشل الحفظ');}
        window.closeModal(); window.toast && toast('تمت إضافة الموظف للقسم', 'success'); deptEmpLoad();
    } catch (e) {
        const box = document.getElementById('deptEmpErr');
        if (box) {box.textContent = e.message || 'فشل الحفظ';}
    }
}

async function deptEmpSaveEdit(id) {
    const f = deptEmpRead();
    try {
        const r = await deptEmpFetch('/' + id, { method: 'PUT', body: JSON.stringify(f) });
        const j = await r.json();
        if (!j.ok) {throw new Error(j.message || 'فشل الحفظ');}
        window.closeModal(); window.toast && toast('تم تعديل بيانات الموظف', 'success'); deptEmpLoad();
    } catch (e) {
        const box = document.getElementById('deptEmpErr');
        if (box) {box.textContent = e.message || 'فشل الحفظ';}
    }
}

async function deptEmpDeactivate(id, name) {
    if (!confirm('تعطيل الموظف «' + name + '»؟ سيختفي من القسم (سجلاته التاريخية تبقى محفوظة).')) {return;}
    try {
        const r = await deptEmpFetch('/' + id, { method: 'DELETE' });
        const j = await r.json();
        if (!j.ok) {throw new Error(j.message || 'فشل التعطيل');}
        window.toast && toast('تم تعطيل الموظف', 'success'); deptEmpLoad();
    } catch (e) { window.toast && toast(e.message || 'فشل التعطيل', 'error'); }
}

export { renderDeptEmployeesPage, deptEmpLoad, deptEmpAddModal, deptEmpEditModal, deptEmpSaveNew, deptEmpSaveEdit, deptEmpDeactivate };
