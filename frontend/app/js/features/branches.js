/**
 * features/branches.js — إدارة الفروع (مهمة multi-branch 2026-10-13).
 * خلفية جاهزة منذ migration 102_branches: /api/branches (قراءة لكل مصادق،
 * كتابة للأدمن، حذف ليّن is_active=FALSE مع حماية MAIN).
 * الصفحة للأدمن فقط (بوابة go() عبر ROLES + حارس داخلي هنا).
 * الاستجابة بصيغة {ok,data} — apiFetch يعيد الجسم كاملًا فنقرأ .data.
 */

let _branchesCache = [];
let _branchesShowAll = false;

function brIsAdmin() {
  return STATE.currentUser?.role === 'admin';
}

// صرف نقاء القالب قابل للاختبار بلا DOM: قائمة الفروع → HTML
function brRowsHtml(list, isAdmin) {
  if (!list.length) {
    return '<div class="mcard u-empty">لا توجد فروع بعد — أضف أول فرع من الزر الأعلى</div>';
  }
  return list
    .map(b => {
      const active = b.is_active !== false;
      const cur = esc(String(b.currency || 'SAR').toUpperCase());
      const tz = esc(b.timezone || 'Asia/Riyadh');
      const meta = [cur, tz, b.phone ? esc(b.phone) : null, b.address ? esc(b.address) : null]
        .filter(Boolean)
        .join(' · ');
      const actions = isAdmin
        ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm" data-karim-action="brEditModal" data-karim-arg0="${b.id}"><i class=ji data-i=pencil></i> تعديل</button>
              ${
                b.code !== 'MAIN'
                  ? active
                    ? `<button class="btn btn-red btn-sm" data-karim-action="brDeactivate" data-karim-arg0="${b.id}" data-karim-arg1="${esc(b.name_ar)}"><i class=ji data-i=x-circle></i> إيقاف</button>`
                    : `<button class="btn btn-sm" data-karim-action="brReactivate" data-karim-arg0="${b.id}"><i class=ji data-i=check-circle></i> إعادة تفعيل</button>`
                  : ''
              }
            </div>`
        : '';
      return `
        <div class="mcard" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="width:44px;height:44px;border-radius:12px;background:var(--gold-d);display:flex;align-items:center;justify-content:center;font-size:18px"><i class=ji data-i=building></i></div>
            <div class="u-flex1">
              <div class="fw-bold">${esc(b.name_ar)}${b.name_en ? ` <span class="text-muted" style="font-weight:400;font-size:12px">${esc(b.name_en)}</span>` : ''}
                <span class="badge ${active ? 'bdg-green' : 'bdg-red'}" style="margin-inline-start:8px">${active ? 'نشط' : 'معطّل'}</span>
                ${b.code === 'MAIN' ? '<span class="badge bdg-blue" style="margin-inline-start:4px">رئيسي</span>' : ''}
              </div>
              <div class="text-muted" style="font-size:12px">${esc(b.code)} · ${meta}</div>
            </div>
            ${actions}
          </div>
        </div>`;
    })
    .join('');
}

async function renderBranchesPage() {
  const box = document.getElementById('content');
  if (!box) {
    return;
  }
  if (!brIsAdmin()) {
    box.innerHTML = '<div class="mcard">هذه الصفحة للمدير فقط</div>';
    return;
  }
  box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div> جارٍ تحميل الفروع…</div>';
  await brLoad();
}

async function brLoad() {
  const box = document.getElementById('content');
  if (!box) {
    return;
  }
  try {
    const r = await apiFetch('/branches' + (_branchesShowAll ? '?all=1' : ''));
    _branchesCache = r.data || [];
    box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <h3 class="u-gold-strong"><i class=ji data-i=building></i> فروع المنشأة <span class="text-muted" style="font-weight:400;font-size:13px">(${_branchesCache.length})</span></h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label class="text-muted" style="font-size:13px;display:flex;gap:6px;align-items:center;cursor:pointer">
              <input type="checkbox" ${_branchesShowAll ? 'checked' : ''} data-karim-action="brToggleAll" data-karim-event="change" data-karim-pass="checked"> إظهار المعطّلة
            </label>
            <button class="btn btn-gold" data-karim-action="brAddModal"><i class=ji data-i=plus></i> إضافة فرع</button>
          </div>
        </div>
        <div class="workflow-banner" style="margin-bottom:12px">كل سجل (أمر بيع/مصروف/حضور/قيد) يُنسب لفرعه عبر عمود <strong>branch_id</strong> — الإيقاف ليّن: السجلات التاريخية تبقى سليمة.</div>
        ${brRowsHtml(_branchesCache, true)}`;
  } catch (e) {
    box.innerHTML = `<div class="mcard u-empty">تعذر تحميل الفروع: ${esc(e.message || 'خطأ')}
          <div style="margin-top:8px"><button class="btn btn-sm" data-karim-action="brLoad"><i class=ji data-i=rotate-ccw></i> إعادة المحاولة</button></div></div>`;
  }
}

function brToggleAll(on) {
  _branchesShowAll = Boolean(on);
  brLoad();
}

function brModalInner(b, saveFn) {
  b = b || {};
  window.showModal(`<h3 style="margin-top:0">${b.id ? '<i class=ji data-i=pencil></i> تعديل فرع' : '<i class=ji data-i=plus></i> فرع جديد'}</h3>
        <div class="fr">
          <div class="fg"><label>الكود <b style="color:#e74c3c">*</b></label>
            <input id="brCode" value="${esc(b.code || '')}" ${b.id ? 'readonly' : ''} placeholder="مثال: BR-2 (حروف لاتينية/أرقام/_-، حتى 20)"></div>
          <div class="fg"><label>العملة</label><input id="brCurrency" value="${esc(b.currency || 'SAR')}" maxlength="3" placeholder="SAR / EGP / AED"></div>
        </div>
        <div class="fg"><label>الاسم بالعربية <b style="color:#e74c3c">*</b></label><input id="brNameAr" value="${esc(b.name_ar || '')}"></div>
        <div class="fg"><label>الاسم بالإنجليزية</label><input id="brNameEn" value="${esc(b.name_en || '')}"></div>
        <div class="fr">
          <div class="fg"><label>المنطقة الزمنية</label><input id="brTz" value="${esc(b.timezone || 'Asia/Riyadh')}"></div>
          <div class="fg"><label>الهاتف</label><input id="brPhone" value="${esc(b.phone || '')}"></div>
        </div>
        <div class="fg"><label>العنوان</label><input id="brAddress" value="${esc(b.address || '')}"></div>
        <div id="brErr" class="form-error" role="alert"></div>
        <div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button>
          <button class="btn btn-gold" onclick="${saveFn}"><i class=ji data-i=save></i> حفظ</button></div>`);
}

function brAddModal() {
  brModalInner(null, 'brSaveNew()');
}

function brEditModal(id) {
  const b = _branchesCache.find(x => String(x.id) === String(id));
  if (!b) {
    toast('الفرع غير موجود', 'error');
    return;
  }
  brModalInner(b, `brSaveEdit('${id}')`);
}

function brRead() {
  return {
    code: document.getElementById('brCode')?.value.trim() || '',
    name_ar: document.getElementById('brNameAr')?.value.trim() || '',
    name_en: document.getElementById('brNameEn')?.value.trim() || null,
    currency: (document.getElementById('brCurrency')?.value.trim() || 'SAR').toUpperCase(),
    timezone: document.getElementById('brTz')?.value.trim() || 'Asia/Riyadh',
    phone: document.getElementById('brPhone')?.value.trim() || null,
    address: document.getElementById('brAddress')?.value.trim() || null,
  };
}

function brFail(e) {
  const box = document.getElementById('brErr');
  if (box) {
    box.textContent = e.message || 'فشل الحفظ';
  } else {
    toast(e.message || 'فشل الحفظ', 'error');
  }
}

async function brSaveNew() {
  const f = brRead();
  try {
    await apiFetch('/branches', { method: 'POST', body: JSON.stringify(f) });
    closeModal();
    toast('تم إنشاء الفرع', 'success');
    brLoad();
  } catch (e) {
    brFail(e);
  }
}

async function brSaveEdit(id) {
  const f = brRead();
  delete f.code; // الكود ثابت بعد الإنشاء (معرّف خارجي للسجلات)
  try {
    await apiFetch('/branches/' + id, { method: 'PATCH', body: JSON.stringify(f) });
    closeModal();
    toast('تم تعديل الفرع', 'success');
    brLoad();
  } catch (e) {
    brFail(e);
  }
}

async function brDeactivate(id, name) {
  if (!confirm('إيقاف الفرع «' + name + '»؟ سيجرى إخفاؤه من القوائم — سجلاته التاريخية تبقى كما هي.')) {
    return;
  }
  try {
    await apiFetch('/branches/' + id, { method: 'DELETE' });
    toast('تم إيقاف الفرع', 'success');
    brLoad();
  } catch (e) {
    toast(e.message || 'فشل الإيقاف', 'error');
  }
}

async function brReactivate(id) {
  try {
    await apiFetch('/branches/' + id, { method: 'PATCH', body: JSON.stringify({ is_active: true }) });
    toast('تمت إعادة تفعيل الفرع', 'success');
    brLoad();
  } catch (e) {
    toast(e.message || 'فشلت إعادة التفعيل', 'error');
  }
}

export {
  renderBranchesPage,
  brLoad,
  brRowsHtml,
  brToggleAll,
  brAddModal,
  brEditModal,
  brSaveNew,
  brSaveEdit,
  brDeactivate,
  brReactivate,
};
