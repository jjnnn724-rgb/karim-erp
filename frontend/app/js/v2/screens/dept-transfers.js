/**
 * V2 — شاشة «التحويلات الداخلية» بين الأقسام · dept-transfers
 * ═══════════════════════════════════════════════════════════════════════
 *
 * نظام التحويل بين أي قسمين (2026-11-01 — اعتماد المالك):
 *   المسار A: رئيس القسم يطلب (مُجبر على قسمه) → الشيف/السو-شيف يعتمد
 *             → تنفيذ فوري (خصم من المرسل + إضافة للمستلم بالتكلفة الفعلية).
 *   المسار B: «تحويل لمنافذ البيع الخارجية» — تنفيذ مباشر بلا اعتماد من أي
 *             قسم إلى external_sales · CAF (كافيهshop) · NAS (كافيه ناصر)،
 *             من بضاعة أذونات الصرف المعتمدة منذ بدء النظام ثم الشهر الحالي.
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/transfer-repo.js — الشبكة عبر المستودع حصرًا.
 *   • الأدوار مرآة الخادم (WRITE_ROLES/APPROVE_ROLES في transfer-repo).
 *   • الحالات: requested → received | rejected | cancelled (قيد الجدول).
 *   • أسماء الأقسام تُحل من /departments — الخادم يعيد الأكواد في metadata.
 *   • الأخطاء تُطبع من ردّ الخادم (e.message) لا من نصوص مخترعة.
 *   • الكشف المطبوع بنفس عائلة الأخضر الفاخرة الموثقة (4.9.221).
 */

import { kpiStrip } from '../role-dash-parts.js?v=4.9.332';
import { openInAppReport } from '../report-viewer.js?v=4.9.332';
import { formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.332';
import {
    fetchDeptTransfers, fetchDeptStock, fetchDeptOptions, deptNameByCode,
    fetchTransferSummary,
    createDeptTransfer, createExternalSaleTransfer, approveTransfer, rejectTransfer, cancelTransfer,
    transferBadge, transferToRow, summarizeTransfers, canCreate, canApprove, mySourceDeptCode,
    canExternalSale, canChooseSourceDept, isExternalDestination, EXTERNAL_SALE_DEPT, EXTERNAL_DESTINATIONS,
    factoryLinks, saveFactoryLink, fetchFactoryVariance, closeFactoryVariance,
} from '../data/transfer-repo.js?v=4.9.332';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* نفس fD/fDT في dispatch.js حرفًا (تواريخ عربية — السياسة الرقمية للأعداد فقط). */
function fD(v) {
    return v ? new Date(v).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function fDT(v) {
    return v ? new Date(v).toLocaleString('ar-EG') : '';
}

/* formatMoney يعيد كائنًا {amount, unit} لا نصًا — هذا الغلاف يأخذ المبلغ فقط
   كي لا يظهر [object Object] داخل الاستيفاء (درس مثبت بالتحقق الحي). */
function money(v) {
    const m = formatMoney(v);
    return m && typeof m === 'object' ? m.amount : m;
}

/** يوم اليوم بتوقيت الرياض (YYYY-MM-DD) — مصدر تواريخ لوحة التحويلات. */
function riyadhToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

/** أول يوم في الشهر الحالي بتوقيت الرياض — بداية العمل 2026-11-01. */
function monthStartRiyadhDay() {
    return riyadhToday().slice(0, 7) + '-01';
}

/** تاريخ قصير للعرض (أرقام لاتينية) — نفس سياسة الشاشة. */
function fDay(day) {
    const s = String(day || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '—';
}

const TABS = [
    { id: 'all', label: 'الكل', icon: 'inbox' },
    { id: 'requested', label: 'بانتظار الاعتماد', icon: 'hourglass' },
    { id: 'received', label: 'مكتملة', icon: 'package' },
    { id: 'rejected', label: 'مرفوضة', icon: 'circle-x' },
    { id: 'cancelled', label: 'ملغاة', icon: 'x' },
];

/* قرار المالك (2026-11-02): الشاشة تعرض كل التحويلات الحقيقية — مسار A بين
 *  الأقسام ومسار B لمنافذ البيع الخارجية معًا — بينما تحويلات التحقق الحي
 *  (metadata.test) مُخفاة من الجدول والمؤشرات والكشف المطبوع، ولوحة الملخص
 *  تُطلب بنطاق شامل يستبعد التحقق الحي من الخادم. إخفاء واجهة فقط: البيانات
 *  والقيود (مصروفات متقابلة + قيد 5000/5000) وتحليل التكاليف كما هي. */

export function mountDeptTransfersScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 dept-transfers]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    const role = String(ctx.role || '');
    const userId = ctx.userId != null ? Number(ctx.userId) : null;
    const deptCode = String(ctx.deptCode || '');
    const mayCreate = canCreate(role);
    const mayApprove = canApprove(role);
    const mySrc = mySourceDeptCode({ role, dept_code: deptCode });
    // الأدمن/المدير/المخازن حرّون في اختيار القسم المرسل (الخادم يفرض تحديدًا صريحًا
    // لهم في resolveSourceDept) — بقية الأدوار مُجبرة على قسمها.
    const mayChooseSource = canChooseSourceDept(role);
    // زر منافذ البيع الخارجية — أي قسم (المطبخ، الجزار، الحلواني...) بلا اعتماد،
    // والخادم يفرض أن البضاعة من أذونات الصرف الفعلية منذ بدء النظام.
    const mayExternal = canExternalSale({ role, dept_code: deptCode });
    // تقرير فرق المصنع: أدوار المراجعة (إدارة + مراجعة + محاسبة) — مرآة requireRole الخادم.
    const mayVariance = ['admin', 'manager', 'auditor', 'accountant'].includes(role);
    // ربط أصناف المصنع بالقائمة وقفل فرق الشهر: إدارة فقط — مرآة requireRole الخادم.
    const mayLink = role === 'admin' || role === 'manager';

    let rows = [];
    let rowsRaw = [];
    let deptOptions = [];
    let tab = 'all';
    let search = '';
    const stockCache = {};
    // لوحة التحويلات — الفترة الافتراضية: من أول الشهر الحالي (توقيت الرياض) إلى اليوم
    const dash = { from: monthStartRiyadhDay(), to: riyadhToday(), data: null, loading: false, error: '' };
    // تقرير فرق المصنع الشهري — الشهر الافتراضي: الشهر الحالي بتوقيت الرياض
    const variance = { month: riyadhToday().slice(0, 7), data: null, loading: false, error: '' };

    const el = document.createElement('div');
    el.className = 'erp-v2-dept-transfers-page';

    function template() {
        return `
      <div class="erp-dash-head" style="--erp-dash-eyebrow:'INTERNAL TRANSFERS'">
        <div>
          <h2 class="erp-dash-title">التحويلات الداخلية</h2>
          <div class="erp-dash-sub">تحويل البضاعة بين الأقسام — طلبٌ واعتماد الشيف وتنفيذٌ فوري بالتكلفة الفعلية، وتحويل مباشر للبيع الخارجي.</div>
        </div>
        <div class="erp-dash-controls">
          <button type="button" class="erp-btn erp-btn--sm" data-v2dt-refresh><i class="ji" data-i="refresh" aria-hidden="true"></i> تحديث</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2dt-print><i class="ji" data-i="printer" aria-hidden="true"></i> اطبع المعروض</button>
          ${mayCreate ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--brand" data-v2dt-new><i class="ji" data-i="plus" aria-hidden="true"></i> طلب تحويل جديد</button>` : ''}
          ${mayExternal ? `<button type="button" class="erp-btn erp-btn--sm" data-v2dt-external><i class="ji" data-i="arrow-left-right" aria-hidden="true"></i> تحويل للبيع الخارجي</button>` : ''}
        </div>
      </div>
      <div class="erp-kpis" data-v2dt-kpis aria-label="مؤشرات التحويلات"></div>
      <div data-v2dt-dash></div>
      ${mayVariance ? `<div class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div style="display:flex;gap:var(--erp-space-2);align-items:end;flex-wrap:wrap">
            <div style="flex:1;min-width:240px">
              <h3 class="erp-card__title">تقرير فرق المصنع الشهري</h3>
              <p class="erp-text-sm erp-text-muted">قيمة تحويلات المصنع بسعر القائمة مقابل مبيعات منافذ البيع الفعلية لنفس المنتجات — والفرق يُقفل شهريًا بإيراد للمصنع وتحميل على المنفذ.</p>
            </div>
            <label class="erp-text-sm">الشهر<input type="month" class="erp-input" data-v2dt-var-month value="${esc(variance.month)}" /></label>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--brand" data-v2dt-var-show><i class="ji" data-i="refresh" aria-hidden="true"></i> عرض</button>
          </div>
          <div data-v2dt-variance></div>
        </div>
      </div>` : ''}
      <div class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__body">
          <div class="erp-toolbar" style="display:flex;flex-wrap:wrap;gap:var(--erp-space-2);align-items:center;margin-block-end:var(--erp-space-3)">
            <div role="tablist" aria-label="تصفية الحالة" style="display:flex;gap:var(--erp-space-1);flex-wrap:wrap">
              ${TABS.map((t) => `<button type="button" class="erp-btn erp-btn--sm" role="tab" aria-selected="${tab === t.id}" data-v2dt-tab="${t.id}">${esc(t.label)}</button>`).join('')}
            </div>
            <div style="flex:1;min-width:180px;display:flex;justify-content:flex-end">
              <input type="search" class="erp-input" placeholder="بحث في رقم الإذن أو القسم أو الصنف…" aria-label="بحث" data-v2dt-search style="max-width:280px" />
            </div>
          </div>
          <div data-v2dt-note role="status" aria-live="polite" class="erp-text-sm erp-text-muted" style="margin-block-end:var(--erp-space-2)"></div>
          <div data-v2dt-table></div>
        </div>
      </div>
      <div data-v2dt-panel></div>`;
    }

    el.innerHTML = template();
    // إلحاق عنصر الشاشة بالـhost — عقود الشاشات تُركَّب داخل المضيف (نمط cost-center)
    host.appendChild(el);

    const tableHost = el.querySelector('[data-v2dt-table]');
    const kpisHost = el.querySelector('[data-v2dt-kpis]');
    const dashHost = el.querySelector('[data-v2dt-dash]');
    const note = el.querySelector('[data-v2dt-note]');
    const panelHost = el.querySelector('[data-v2dt-panel]');
    const searchInput = el.querySelector('[data-v2dt-search]');

    function setNote(text) { if (note) {note.textContent = text || '';} }

    function paintKpis() {
        const s = summarizeTransfers(scopedRows());
        const kpis = [
            { icon: 'arrow-left-right', label: 'إجمالي التحويلات', value: String(s.total) },
            { icon: 'hourglass', label: 'بانتظار الاعتماد', value: String(s.pending) },
            { icon: 'package', label: 'منفَّذة ومكتملة', value: String(s.done) },
            { icon: 'wallet', label: 'قيمة المنفَّذ (تكلفة فعلية)', value: money(s.value) },
        ];
        kpisHost.innerHTML = kpiStrip(kpis, 'مؤشرات التحويلات بين الأقسام');
    }

    /* ── لوحة التحويلات (ملخص الفترة) ─────────────────────────────────
       تستخدم نفس أصناف لوحة تحليل التكاليف (.erp-v2-cost__*) — لا CSS جديد.
       المصدر /dept-transfers/summary: إجماليات + توزيع مصادر/وجهات + أعلى
       الأصناف + الحركة اليومية، كلها من التحويلات المنفَّذة في الفترة. */
    function dashStat(icon, label, value, note) {
        return `<div class="erp-v2-cost__stat">
          <span class="erp-v2-cost__stat-icon"><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i></span>
          <div class="erp-v2-cost__stat-body">
            <span class="erp-v2-cost__stat-label">${esc(label)}</span>
            <span class="erp-v2-cost__stat-value">${esc(value)}</span>
            <span class="erp-v2-cost__stat-note">${esc(note || '')}</span>
          </div>
        </div>`;
    }

    function dashMix(list, emptyText) {
        if (!Array.isArray(list) || !list.length) {
            return `<div class="erp-v2-cost__rank-empty">${esc(emptyText)}</div>`;
        }
        const total = list.reduce((s, r) => s + (Number(r.value) || 0), 0);
        return `<ul class="erp-v2-cost__mix">${list.slice(0, 6).map((r) => {
            const v = Number(r.value) || 0;
            const pct = total > 0 ? Math.max(2, Math.min(100, Math.round((Math.abs(v) / total) * 100))) : 0;
            return `<li class="erp-v2-cost__mix-row">
              <div class="erp-v2-cost__mix-top">
                <span class="erp-v2-cost__mix-label">${esc(r.dept_name || r.dept_code || 'غير محدد')}</span>
                <span class="erp-v2-cost__mix-value">${money(v)}</span>
              </div>
              <div class="erp-v2-cost__mix-bar"><span style="--mix:${pct}%"></span></div>
              <div class="erp-v2-cost__mix-meta">
                <span>${formatQty(r.qty)} كمية</span>
                <span>${Number(r.transfers) || 0} تحويل</span>
              </div>
            </li>`;
        }).join('')}</ul>`;
    }

    function dashDaily(list) {
        if (!Array.isArray(list) || !list.length) {
            return `<div class="erp-v2-cost__rank-empty">لا حركة تحويلات في هذه الفترة.</div>`;
        }
        const max = Math.max(...list.map((r) => Number(r.value) || 0), 1);
        return `<ul class="erp-v2-cost__rank">${list.map((r) => {
            const v = Number(r.value) || 0;
            const pct = Math.max(2, Math.round((v / max) * 100));
            return `<li class="erp-v2-cost__rank-row">
              <span class="erp-v2-cost__rank-no">${Number(r.transfers) || 0}</span>
              <span class="erp-v2-cost__rank-body">
                <span class="erp-v2-cost__rank-name" style="direction:ltr;text-align:start">${esc(fDay(r.day))}</span>
                <span class="erp-v2-cost__rank-bar"><span style="--rank:${pct}%"></span></span>
              </span>
              <span class="erp-v2-cost__mix-value">${money(v)}</span>
            </li>`;
        }).join('')}</ul>`;
    }

    function dashTopItems(list) {
        if (!Array.isArray(list) || !list.length) {
            return `<div class="erp-v2-cost__rank-empty">لا أصناف محوَّلة في هذه الفترة.</div>`;
        }
        const max = Math.max(...list.map((r) => Number(r.value) || 0), 1);
        return `<ul class="erp-v2-cost__rank">${list.map((r, i) => {
            const v = Number(r.value) || 0;
            const pct = Math.max(2, Math.round((v / max) * 100));
            return `<li class="erp-v2-cost__rank-row">
              <span class="erp-v2-cost__rank-no">${i + 1}</span>
              <span class="erp-v2-cost__rank-body">
                <span class="erp-v2-cost__rank-name" title="${esc(r.item_name)}">${esc(r.item_name)}</span>
                <span class="erp-v2-cost__rank-sub">${formatQty(r.qty)} ${esc(r.unit || '')}</span>
                <span class="erp-v2-cost__rank-bar"><span style="--rank:${pct}%"></span></span>
              </span>
              <span class="erp-v2-cost__mix-value">${money(v)}</span>
            </li>`;
        }).join('')}</ul>`;
    }

    /** لوحة الحركة تُركَّب نصًا ثم تُسنَد دفعة واحدة: كل بيانات ظهر في
     *  النص تمر عبر esc()/money()/formatQty() قبل الوصول إلى DOM. */
    function dashMarkup() {
        const d = dash.data || {};
        const t = d.totals || {};
        const range = `${fDay(dash.from)} → ${fDay(dash.to)}`;
        return `
        <div class="erp-v2-cost" style="margin-block-start:var(--erp-space-4)">
          <section class="erp-v2-cost__hero">
            <header class="erp-v2-cost__hero-head">
              <span class="erp-v2-cost__hero-kicker">TRANSFER FLOW</span>
              <span class="erp-v2-cost__hero-range">${esc(range)}${dash.loading ? ' · جارٍ التحديث…' : ''}</span>
            </header>
            <div class="erp-v2-cost__hero-grid">
              ${dashStat('wallet', 'قيمة البضاعة المنقولة', money(Number(t.value) || 0), 'تكلفة فعلية · ريال سعودي')}
              ${dashStat('arrow-left-right', 'عدد التحويلات', String(Number(t.transfers) || 0), `${Number(t.lines) || 0} بند صنف`)}
              ${dashStat('inbox', 'أقسام مرسلة', String(Number(t.sources) || 0), 'أقسام سلّمت بضاعة')}
              ${dashStat('package', 'جهات مستلمة', String(Number(t.destinations) || 0), 'أقسام ومنافذ بيع خارجية')}
            </div>
            <div class="erp-v2-cost__filters" style="padding:var(--erp-space-3) var(--erp-space-2) 0">
              <label class="erp-v2-cost__date">
                <span>من تاريخ</span>
                <input type="date" class="erp-input" data-v2dt-dash-from value="${esc(fDay(dash.from))}" />
              </label>
              <label class="erp-v2-cost__date">
                <span>إلى تاريخ</span>
                <input type="date" class="erp-input" data-v2dt-dash-to value="${esc(fDay(dash.to))}" />
              </label>
              <div class="erp-v2-cost__actions">
                <button type="button" class="erp-btn erp-btn--sm erp-btn--brand" data-v2dt-dash-apply><i class="ji" data-i="refresh" aria-hidden="true"></i> تطبيق</button>
              </div>
            </div>
          </section>
          ${dash.error ? `<div class="erp-v2-cost__register" style="margin-block-start:var(--erp-space-3)"><div class="erp-v2-cost__rank-empty">تعذر تحميل ملخص التحويلات: ${esc(dash.error)}</div></div>` : ''}
          <div class="erp-v2-cost__split" style="margin-block-start:var(--erp-space-3)">
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head"><h4>أعلى الأقسام المرسلة</h4><span class="erp-v2-cost__panel-note">قيمة البضاعة الخارجة</span></header>
              ${dashMix(d.bySource, 'لا تحويلات صادرة في هذه الفترة.')}
            </section>
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head"><h4>أعلى الجهات المستلمة</h4><span class="erp-v2-cost__panel-note">قيمة البضاعة الواردة</span></header>
              ${dashMix(d.byDest, 'لا تحويلات واردة في هذه الفترة.')}
            </section>
          </div>
          <div class="erp-v2-cost__split" style="margin-block-start:var(--erp-space-3)">
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head"><h4>أعلى الأصناف المحوَّلة</h4><span class="erp-v2-cost__panel-note">حسب القيمة</span></header>
              ${dashTopItems(d.topItems)}
            </section>
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head"><h4>الحركة اليومية</h4><span class="erp-v2-cost__panel-note">عدد التحويلات · القيمة</span></header>
              ${dashDaily(d.daily)}
            </section>
          </div>
        </div>`;
    }

    function paintDash() {
        if (!dashHost) {return;}
        dashHost.innerHTML = dashMarkup();
    }

    async function loadSummary() {
        if (!dashHost) {return;}
        dash.loading = true;
        dash.error = '';
        paintDash();
        try {
            const res = await fetchTransferSummary(dash.from, dash.to, currentScopeMode());
            dash.data = res && typeof res === 'object' ? res : null;
        } catch (e) {
            dash.data = null;
            dash.error = (e && e.message) ? e.message : 'تعذر تحميل الملخص';
        } finally {
            dash.loading = false;
            paintDash();
        }
    }

    /** وضع اللوحة المُرسل للخادم — الشاشة تعرض كل النطاقات (داخلي + بيع خارجي). */
    function currentScopeMode() {
        return '';
    }

    /** صفوف النطاق: كل التحويلات — الداخلي والبيع الخارجي — إلا ما مُعلَّم
     *  تحويل تحقق حي (metadata.test) (قرار المالك 2026-11-02). */
    function scopedRows() {
        return rows.filter((r) => !r.test);
    }

    function filteredRows() {
        let out = scopedRows();
        if (tab !== 'all') {out = out.filter((r) => r.status === tab);}
        const q = search.trim().toLowerCase();
        if (q) {
            out = out.filter((r) => {
                const hay = [r.number, r.fromName, r.toName, r.requestedBy, r.itemsText]
                    .join(' ').toLowerCase();
                return hay.includes(q);
            });
        }
        return out;
    }

    function actionsHtml(r) {
        const btns = [];
        if (mayApprove && r.status === 'requested' && r.requestedByUserId !== userId) {
            btns.push(`<button type="button" class="erp-btn erp-btn--sm erp-btn--brand" data-v2dt-approve="${esc(r.id)}"><i class="ji" data-i="check" aria-hidden="true"></i> اعتماد</button>`);
            btns.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2dt-reject="${esc(r.id)}"><i class="ji" data-i="circle-x" aria-hidden="true"></i> رفض</button>`);
        }
        if (r.status === 'requested' && r.requestedByUserId === userId) {
            btns.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2dt-cancel="${esc(r.id)}"><i class="ji" data-i="x" aria-hidden="true"></i> إلغاء</button>`);
        }
        btns.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2dt-sheet="${esc(r.id)}"><i class="ji" data-i="printer" aria-hidden="true"></i> إذن</button>`);
        return btns.join(' ');
    }

    function tableHtml(list) {
        if (!list.length) {
            return `<div class="erp-state"><span class="erp-state__title">لا توجد تحويلات مطابقة</span><span>أنشئ طلب تحويل جديد أو غيّر التصفية.</span></div>`;
        }
        const caption = 'سجل التحويلات الداخلية — ' + list.length + ' إذن';
        const body = list.map((r) => `
          <tr>
            <td><strong>${esc(r.number)}</strong>${r.factory ? '<div class="erp-text-sm erp-text-muted">تحويل مصنع</div>' : (r.mode === 'external_sale' ? '<div class="erp-text-sm erp-text-muted">بيع خارجي</div>' : '')}</td>
            <td>${esc(r.fromName)}</td>
            <td>${esc(r.toName)}</td>
            <td title="${esc(r.itemsText)}">${esc(r.itemsText)}</td>
            <td>${formatQty(r.qty)}</td>
            <td>${money(r.value)}${r.factory ? `<div class="erp-text-sm erp-text-muted">تسوية القائمة (إيراد المصنع): ${money(r.factoryValue)}</div>` : ''}</td>
            <td>${transferBadge(r.status)}${r.status === 'rejected' && r.rejectionReason ? `<div class="erp-text-sm erp-text-muted" title="${esc(r.rejectionReason)}">${esc(r.rejectionReason)}</div>` : ''}</td>
            <td>${esc(r.requestedBy)}</td>
            <td>${esc(fD(r.createdAt))}</td>
            <td><div style="display:flex;gap:var(--erp-space-1);flex-wrap:wrap">${actionsHtml(r)}</div></td>
          </tr>`).join('');
        return `
          <div style="overflow-x:auto">
          <table class="erp-table">
            <caption class="erp-text-sm erp-text-muted" style="text-align:start">${esc(caption)}</caption>
            <thead><tr>
              <th scope="col">الإذن</th><th scope="col">من قسم</th><th scope="col">إلى قسم</th>
              <th scope="col">الأصناف</th><th scope="col">الكمية</th><th scope="col">القيمة (تكلفة فعلية)</th>
              <th scope="col">الحالة</th><th scope="col">طلبها</th><th scope="col">التاريخ</th><th scope="col">إجراءات</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table></div>`;
    }

    function paintTable() {
        tableHost.innerHTML = tableHtml(filteredRows());
    }

    function paint() { paintKpis(); paintTable(); }

    async function reload() {
        setNote('جارٍ تحميل التحويلات…');
        try {
            const [list, depts] = await Promise.all([fetchDeptTransfers(200), fetchDeptOptions()]);
            if (destroyed) {return;}
            deptOptions = Array.isArray(depts) ? depts : [];
            rowsRaw = Array.isArray(list) ? list : [];
            rows = rowsRaw.map((t) => {
                const r = transferToRow(t, {});
                r.requestedByUserId = Number(t.requested_by) || null;
                return r;
            });
            setNote(`الحساب: ${esc(String(ctx.userName || ''))} — قسمك: ${esc(deptNameByCode(deptOptions, mySrc) || mySrc || 'غير مربوط')}`);
            paint();
            await loadSummary();
        } catch (e) {
            if (destroyed) {return;}
            setNote(e && e.message ? `تعذر التحميل: ${e.message}` : 'تعذر تحميل التحويلات');
            await loadSummary();
        }
    }

    // ── لوحة طلب التحويل (مسار A) والبيع الخارجي (مسار B) ─────────────
    let panelState = null; // { mode, from, to, lines:[{inventory_id,name,unit,qty,avg_cost}], notes }

    async function deptStock(code, scope = '') {
        const key = scope ? (code + '|' + scope) : code;
        if (!stockCache[key]) {
            const res = await fetchDeptStock(code, scope);
            // الكاش يحفظ الرد كاملًا لا الأصناف وحدها — ردّ المصنع يحمل
            // factory وسعر القائمة لكل صنف (menu_price) فيُقرآن بعدها.
            stockCache[key] = res && typeof res === 'object' ? res : { items: [] };
        }
        return stockCache[key];
    }

    function invalidateStock(code) {
        delete stockCache[code];
        delete stockCache[code + '|month'];
    }

    /** قيمة السطر: للمصنع بسعر القائمة (إيراد المصنع المسجَّل)،
     *  ولغيره بالتكلفة الفعلية للإذن. */
    function lineTotal(l) {
        if (panelState && panelState.factory) {
            return (Number(l.qty) || 0) * (Number(l.menu_price) || 0);
        }
        return (Number(l.qty) || 0) * (Number(l.avg_cost) || 0);
    }

    /** وصف الصنف في قائمة الاختيار — السقف إذنُ الصرف لا رصيد المخزن:
     *  «صُرف للإذن» = اعتماد المخزن لهذا القسم في فترة الأهلية،
     *  «في مخزن القسم» = المستلَم فعلًا، «لم يُستلم بعد» = خرج من المخزن
     *  الرئيسي ولم يُسجَّل استلامه (يُستلم تلقائيًا عند التنفيذ)،
     *  و«متاح للتحويل» = المتبقي بعد تحويلات القسم. الوحدة المعروضة هي وحدة
     *  الإذن نفسها (كيلو/كرتونة/علبة/حبة) كما خرجت البضاعة. */
    function stockLabel(s, scope) {
        if (scope !== 'month') {
            return `${s.item_name} — متاح ${formatQty(s.on_hand)} ${s.unit || ''}`;
        }
        const avail = Number(s.available) || 0;
        const unit = s.voucher_unit || s.unit || '';
        const parts = [
            `${s.item_name} — صُرف بالإذن ${formatQty(s.month_qty)} ${unit}`,
            `متاح للتحويل ${formatQty(avail)} ${unit}`,
        ];
        if (Number(s.in_transit) > 0) {
            parts.push(`${formatQty(s.in_transit)} ${unit} لم تُستلم بعد — تُستلم تلقائيًا عند التحويل`);
        }
        const vouchers = Number(s.vouchers) || 0;
        parts.push(`${vouchers} إذن صرف`);
        // قسم مُصنِّع: السعر الذي ستُقيَّم به البضاعة عند التحويل للبيع الخارجي —
        // يُقرأ من القائمة تلقائيًا، وبلا ربط يرفض الخادم تحويل هذا الصنف.
        if (panelState && panelState.factory) {
            if (Number(s.menu_price) > 0) {
                parts.push(`سعر القائمة ${money(s.menu_price)}`);
            } else {
                parts.push('بلا سعر قائمة — يحتاج ربطًا بمنتج القائمة');
            }
        }
        return parts.join(' — ');
    }

    /** تتبّع المصدر: أذونات الصرف التي جاءت منها كمية الصنف — مراجعة احترافية
     *  تربط كل كمية تحويل بإذن صرفها وتكلفته الفعلية. */
    function traceHtml() {
        if (!panelState || panelState.scope !== 'month' || !panelState.selectedId) {return '';}
        const item = (panelState.stock || []).find((s) => String(s.inventory_id) === String(panelState.selectedId));
        if (!item) {return '';}
        const sources = Array.isArray(item.sources) ? item.sources : [];
        if (!sources.length) {return '';}
        const body = sources.map((s) => `
            <tr>
              <td>${esc(s.ref || s.dispatch_id || '—')}</td>
              <td>${esc(s.issued_at || fDay(s.date))}</td>
              <td>${esc(s.status || '—')}</td>
              <td>${formatQty(s.qty)}</td>
              <td>${esc(s.unit || '—')}</td>
              <td>${formatQty(s.in_transit)}</td>
              <td>${money((Number(s.qty) || 0) * (Number(s.unit_cost) || 0))}</td>
            </tr>`).join('');
        return `
          <div style="margin-block-start:var(--erp-space-3);border:1px solid var(--erp-border,rgba(24,53,43,.18));border-radius:12px;padding:var(--erp-space-3);background:var(--erp-surface-2,rgba(24,53,43,.04))">
            <div style="display:flex;align-items:center;gap:var(--erp-space-2);font-weight:700;margin-block-end:var(--erp-space-2)">
              <i class="ji" data-i="receipt" aria-hidden="true"></i>
              مصدر الكمية — أذونات الصرف التي جاءت بها (${sources.length})
            </div>
            <div style="overflow-x:auto">
              <table class="erp-table">
                <thead><tr><th scope="col">إذن الصرف</th><th scope="col">وقت اعتماد المخزن</th><th scope="col">الحالة</th><th scope="col">الكمية المصروفة</th><th scope="col">الوحدة</th><th scope="col">لم يُستلم بعد</th><th scope="col">القيمة</th></tr></thead>
                <tbody>${body}</tbody>
              </table>
            </div>
          </div>`;
    }

    function panelHtml() {
        if (!panelState) {return '';}
        const p = panelState;
        const isExt = p.mode === 'external';
        const isFactoryPanel = isExt && p.factory === true;
        const fromLabel = deptNameByCode(deptOptions, p.from) || p.from;
        const pickerLabel = p.from
            ? ('صنف من بضاعة أذونات صرف ' + fromLabel)
            : 'اختر القسم المرسل أولًا ثم اختر صنفًا';
        // «من قسم»: الأدوار الحرة (أدمن/مدير/مخازن) تختار أي قسم في المسارين،
        // ورئيس القسم مُجبر على قسمه — نفس resolveSourceDept في الخادم.
        const sourceChoices = deptOptions.filter((d) => d.code && !isExternalDestination(d.code));
        const fromBlock = mayChooseSource
            ? `<div>
                 <label class="erp-text-sm" for="v2dt-src">من قسم:</label>
                 <select id="v2dt-src" class="erp-input" data-v2dt-src style="min-width:200px">
                   <option value="">— اختر القسم المرسل —</option>
                   ${sourceChoices.map((d) => `<option value="${esc(d.code)}"${d.code.toLowerCase() === String(p.from).toLowerCase() ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
                 </select>
               </div>`
            : `<div><span class="erp-text-sm erp-text-muted">من:</span> <strong>${esc(fromLabel || '—')}</strong></div>`;
        const destBlock = isExt
            ? `<div>
                 <label class="erp-text-sm" for="v2dt-dest">إلى منفذ:</label>
                 <select id="v2dt-dest" class="erp-input" data-v2dt-dest style="min-width:200px">
                   ${EXTERNAL_DESTINATIONS.map((d) => {
                       const label = deptNameByCode(deptOptions, d.code) || d.name;
                       return `<option value="${esc(d.code)}"${d.code.toLowerCase() === String(p.to).toLowerCase() ? ' selected' : ''}>${esc(label)}</option>`;
                   }).join('')}
                 </select>
               </div>`
            : `<div>
                 <label class="erp-text-sm" for="v2dt-dest">إلى قسم:</label>
                 <select id="v2dt-dest" class="erp-input" data-v2dt-dest style="min-width:200px"${p.from ? '' : ' disabled'}>
                   <option value="">— اختر القسم المستلم —</option>
                   ${deptOptions.filter((d) => d.code && d.code.toLowerCase() !== String(p.from).toLowerCase() && !isExternalDestination(d.code)).map((d) => `<option value="${esc(d.code)}"${d.code.toLowerCase() === String(p.to).toLowerCase() ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
                 </select>
               </div>`;
        const lines = p.lines.length
            ? p.lines.map((l, i) => `
              <tr>
                <td>${esc(l.name)}</td>
                <td>${esc(l.unit || '')}</td>
                <td>${formatQty(l.qty)}</td>
                ${isFactoryPanel ? `<td>${money(l.menu_price || 0)}</td>` : ''}
                <td>${money(lineTotal(l))}</td>
                <td><button type="button" class="erp-btn erp-btn--sm" data-v2dt-delline="${i}" aria-label="إزالة ${esc(l.name)}"><i class="ji" data-i="x" aria-hidden="true"></i></button></td>
              </tr>`).join('')
            : `<tr><td colspan="${isFactoryPanel ? 6 : 5}" class="erp-text-muted">${p.from
                ? (p.scope === 'month'
                    ? 'لا توجد أذونات صرف مؤهلة للتحويل إلى القسم المرسل بعد — ستظهر الأصناف مع اعتماد إذن صرف مؤهل.'
                    : ('لم تُضَف أصناف بعد — اختر من رصيد مخزن ' + esc(fromLabel) + '.'))
                : 'حدد القسم المرسل لتظهر أصناف رصيده.'}</td></tr>`;
        const picker = `
          <div style="display:flex;gap:var(--erp-space-2);flex-wrap:wrap;align-items:end;margin-block:var(--erp-space-3)">
            <div>
              <label class="erp-text-sm" for="v2dt-itemsearch">بحث في أصناف القسم المرسل</label>
              <input id="v2dt-itemsearch" class="erp-input" type="search" data-v2dt-itemsearch placeholder="اكتب اسم الصنف…" style="min-width:200px"${p.from ? '' : ' disabled'} />
            </div>
            <div>
              <label class="erp-text-sm" for="v2dt-item">${esc(pickerLabel)}</label>
              <select id="v2dt-item" class="erp-input" data-v2dt-itempick style="min-width:240px"${p.from ? '' : ' disabled'}>
                <option value="">${p.from ? '— اختر صنفًا —' : '— القسم المرسل غير محدد —'}</option>
                ${p.stock.map((s) => {
                    const label = stockLabel(s, p.scope);
                    return `<option value="${esc(String(s.inventory_id))}">${esc(label)}</option>`;
                }).join('')}
              </select>
            </div>
            <div>
              <label class="erp-text-sm" for="v2dt-qty">الكمية</label>
              <input id="v2dt-qty" class="erp-input" type="number" min="0" step="0.001" data-v2dt-qty value="" style="width:120px"${p.from ? '' : ' disabled'} />
            </div>
            <button type="button" class="erp-btn erp-btn--sm" data-v2dt-addline${p.from ? '' : ' disabled'}><i class="ji" data-i="plus" aria-hidden="true"></i> إضافة</button>
            <span class="erp-text-sm erp-text-muted" data-v2dt-itemcount></span>
          </div>
          <div data-v2dt-trace>${traceHtml()}</div>`;
        const unpriced = isFactoryPanel ? (p.stock || []).filter((s) => !(Number(s.menu_price) > 0)) : [];
        const unpricedNote = unpriced.length
            ? `<div class="erp-text-sm" style="color:var(--erp-danger-text);margin-block-start:var(--erp-space-2)" role="alert">`
                + `أصناف بلا سعر قائمة — سيُرفض تحويلها: ${unpriced.map((s) => esc(s.item_name)).join('، ')}`
                + (mayLink ? ' — اربطها بمنتج القائمة أدناه.' : ' — راجع مدير النظام لربطها بمنتج القائمة.') + `</div>`
            : '';
        return `
        <div class="erp-card" style="margin-block-start:var(--erp-space-4);border-color:var(--erp-brand)">
          <div class="erp-card__body">
            <h3 class="erp-card__title">${isFactoryPanel ? 'تحويل مصنع لمنافذ البيع الخارجية — تسوية بسعر القائمة' : (isExt ? 'تحويل لمنافذ البيع الخارجية — تنفيذ مباشر' : 'طلب تحويل بين قسمين')}</h3>
            <p class="erp-text-sm erp-text-muted">${isFactoryPanel
                ? 'قسم مُصنِّع: يُقيَّم التحويل بسعر القائمة الحالي (يُقرأ تلقائيًا من القائمة) — يُسجَّل إيرادًا للمصنع ويُحمَّل على المنفذ المختار، والتكلفة تبقى على المصنع. المصدر: أذونات صرف اعتمدها المخزن فعليًا منذ 1 نوفمبر 2026 الساعة 22:00 بتوقيت الرياض، ثم أذونات الشهر الحالي فقط.'
                : (isExt
                    ? 'يخصم فورًا من مخزن قسمك ويُضاف إلى منفذ البيع المختار — بدون اعتماد. المصدر: أذونات صرف اعتمدها المخزن فعليًا منذ 1 نوفمبر 2026 الساعة 22:00 بتوقيت الرياض، ثم أذونات الشهر الحالي فقط، والتقييم بتكلفة الإذن نفسها. كل بند يعرض أذونات صرفه.'
                    : 'يرسل طلبًا للشيف — عند الاعتماد يُخصم ويُضاف بالتكلفة الفعلية. الكمية محصورة في أذونات الصرف المعتمدة فعليًا منذ بدء النظام ثم أذونات الشهر الحالي، ويُعاد التحقق منها وقت الاعتماد.')
            } كل قسم مخزنٌ صغير: السقف ما اعتمده إذنُ الصرف لا رصيد المخزن، والكمية التي لم يُسجَّل استلامها بعد تُستلم تلقائيًا في مخزن القسم بوحدة الإذن نفسها (كيلو/كرتونة/علبة/حبة) وتكلفته قبل الخصم.</p>
            <div style="display:flex;gap:var(--erp-space-3);flex-wrap:wrap;align-items:end">
              ${fromBlock}
              ${destBlock}
            </div>
            ${picker}
            ${unpricedNote}
            ${isFactoryPanel ? linksHtml() : ''}
            <div style="overflow-x:auto">
              <table class="erp-table">
                <thead><tr><th scope="col">الصنف</th><th scope="col">الوحدة</th><th scope="col">الكمية</th>${isFactoryPanel ? '<th scope="col">سعر القائمة</th>' : ''}<th scope="col">${isFactoryPanel ? 'قيمة الإيراد' : 'القيمة التقديرية'}</th><th scope="col"></th></tr></thead>
                <tbody>${lines}</tbody>
              </table>
            </div>
            <div style="margin-block-start:var(--erp-space-3)">
              <label class="erp-text-sm" for="v2dt-notes">ملاحظات (اختياري)</label>
              <input id="v2dt-notes" class="erp-input" data-v2dt-notes value="${esc(p.notes)}" style="width:100%" />
            </div>
            <p class="erp-text-sm" data-v2dt-status role="status" aria-live="polite"
               style="min-height:1.4em;margin-block-start:var(--erp-space-2);color:${statusColor(p)}">${esc(p.status || '')}</p>
            <div style="display:flex;gap:var(--erp-space-2);margin-block-start:var(--erp-space-2);flex-wrap:wrap">
              <button type="button" class="erp-btn erp-btn--brand" data-v2dt-submit${p.busy ? ' disabled' : ''}>${p.busy ? 'جارٍ التنفيذ…' : (isExt ? 'تنفيذ التحويل الآن' : 'إرسال الطلب للشيف')}</button>
              <button type="button" class="erp-btn" data-v2dt-closepanel>إلغاء</button>
            </div>
          </div>
        </div>`;
    }

    /** محرر ربط أصناف المصنع بمنتجات القائمة — إدارة فقط (الخادم يفرض الدور).
     *  الربط هو مصدر التسعير التلقائي: سعر القائمة الحالي يُقرأ عند كل تحويل،
     *  وبلا ربط يرفض الخادم تحويل الصنف (FACTORY_PRICE_MISSING). */
    function linksHtml() {
        if (!panelState || !panelState.factory || !mayLink) {return '';}
        const links = panelState.links;
        if (!links) {return '<p class="erp-text-sm erp-text-muted">جارٍ تحميل روابط القائمة…</p>';}
        if (links.error) {return `<p class="erp-text-sm" style="color:var(--erp-danger-text)">تعذر تحميل روابط القائمة: ${esc(links.error)}</p>`;}
        const items = Array.isArray(links.items) ? links.items : [];
        if (!items.length) {return '';}
        const products = Array.isArray(links.menu_products) ? links.menu_products : [];
        const rows = items.map((it) => {
            const opts = products
                .filter((m) => String(m.id) !== String(it.menu_product_id))
                .map((m) => `<option value="${esc(m.id)}">${esc(m.name_ar)} — ${money(m.price)}</option>`).join('');
            const selected = it.menu_product_id
                ? `<option value="${esc(it.menu_product_id)}" selected>${esc(it.menu_name || '')} — ${money(it.price)}</option>`
                : '';
            return `<tr>
              <td>${esc(it.item_name)}${it.unit ? ` <span class="erp-text-sm erp-text-muted">(${esc(it.unit)})</span>` : ''}</td>
              <td><select class="erp-input" data-v2dt-linkprod="${esc(it.inventory_id)}" style="min-width:220px">
                <option value="">— بلا ربط (يُرفض التحويل) —</option>
                ${selected}${opts}
              </select></td>
              <td><button type="button" class="erp-btn erp-btn--sm" data-v2dt-savelink="${esc(it.inventory_id)}">حفظ الربط</button></td>
            </tr>`;
        }).join('');
        return `
          <details style="margin-block-start:var(--erp-space-3)" open>
            <summary class="erp-text-sm" style="cursor:pointer;font-weight:700">ربط أصناف المصنع بمنتجات القائمة — التسعير التلقائي بسعر البيع</summary>
            <p class="erp-text-sm erp-text-muted">كل صنف يُربط بمنتج قائمة واحد، وسعر القائمة يُقرأ تلقائيًا عند كل تحويل (بلا قوائم أسعار يدوية). الأصناف هنا هي أصناف أذونات صرف هذا القسم في الشهر الحالي.</p>
            <div style="overflow-x:auto"><table class="erp-table">
              <thead><tr><th scope="col">صنف المصنع</th><th scope="col">منتج القائمة</th><th scope="col"></th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>
          </details>`;
    }

    async function loadFactoryLinks(code) {
        if (!mayLink) {return;}
        try {
            const res = await factoryLinks(code);
            if (panelState && panelState.from === code) {
                panelState.links = res && typeof res === 'object' ? res : { items: [], menu_products: [] };
                paintPanel();
            }
        } catch (e) {
            if (panelState && panelState.from === code) {
                panelState.links = { items: [], menu_products: [], error: (e && e.message) ? e.message : 'تعذر تحميل الروابط' };
                paintPanel();
            }
        }
    }

    async function doSaveLink(inventoryId) {
        if (!panelState || !mayLink) {return;}
        const sel = panelHost.querySelector(`[data-v2dt-linkprod="${inventoryId}"]`);
        const productId = sel && sel.value ? Number(sel.value) : null;
        try {
            await saveFactoryLink(Number(inventoryId), productId);
            notify(productId ? 'حُفظ ربط سعر القائمة' : 'فُك ربط سعر القائمة');
            // إعادة قراءة الأصناف (menu_price يتغير) والروابط معًا
            invalidateStock(panelState.from);
            await Promise.all([
                loadFactoryLinks(panelState.from),
                loadPanelStock(panelState.from, panelState.scope || ''),
            ]);
        } catch (e) {
            notify(e && e.message ? `تعذر حفظ الربط: ${e.message}` : 'تعذر حفظ الربط');
        }
    }

    function paintPanel() { panelHost.innerHTML = panelHtml(); }

    /** لون شريط حالة اللوحة — الرسالة تُقرأ بالعين لا بالحس. */
    function statusColor(p) {
        if (p.kind === 'error') {return 'var(--erp-danger)';}
        if (p.kind === 'ok') {return 'var(--erp-success)';}
        return 'var(--erp-text-muted, inherit)';
    }

    /* شريط الحالة داخل اللوحة نفسها: سطر الملاحظات أعلى الشاشة بعيد عن الزر
       على الهاتف، فمنعٌ بلا رسالة يبدو كزرٍ ميت. الرسالة تبقى في الحالة حتى
       يُعاد رسم اللوحة، فتُقرأ بعد الفشل دون أن يمسحها الرسم. */
    function say(message, kind = 'info') {
        if (!panelState) {return;}
        panelState.status = String(message || '');
        panelState.kind = kind;
        const line = panelHost.querySelector('[data-v2dt-status]');
        if (line) {
            line.textContent = panelState.status;
            line.style.color = statusColor(panelState);
        } else {
            paintPanel();
        }
        if (typeof line?.scrollIntoView === 'function') {line.scrollIntoView({ block: 'nearest' });}
    }

    async function loadPanelStock(code, scope = '') {
        try {
            const res = await deptStock(code, scope);
            const items = Array.isArray(res.items) ? res.items : [];
            if (panelState && panelState.from === code) {
                panelState.stock = items;
                panelState.scope = scope;
                panelState.selectedId = '';
                // قسم مُصنِّع: التحويل للبيع الخارجي يُقيَّم بسعر القائمة (menu_price
                // لكل صنف) — واللوحة تعرض السعر وتُظهر محرر الربط للإدارة.
                panelState.factory = res.factory === true;
                if (!items.length) {
                    panelState.status = 'لا أصناف مؤهلة لهذا القسم بعد — التحويل يُبنى من أذونات الصرف المعتمدة في الشهر الحالي.';
                    panelState.kind = 'error';
                }
                paintPanel();
                if (panelState.factory && panelState.mode === 'external') {await loadFactoryLinks(code);}
            }
        } catch (e) {
            if (panelState && panelState.from === code) {
                panelState.stock = [];
                say(`تعذر جلب بضاعة أذونات القسم: ${e && e.message ? e.message : 'الخادم لم يستجب'}`, 'error');
            } else {
                notify(e && e.message ? `تعذر جلب بضاعة أذونات القسم: ${e.message}` : 'تعذر جلب بضاعة أذونات القسم');
            }
        }
    }

    async function openPanel(mode) {
        if (mode === 'external' && !mayExternal) {
            notify('التحويل لمنافذ البيع الخارجية متاح لأدوار التحويل المعتمدة — راجع مدير النظام');
            return;
        }
        if (!mayChooseSource && !mySrc) {
            notify('حسابك غير مربوط بقسم — راجع مدير النظام');
            return;
        }
        // المصدر: الأدوار الحرة تختار (ويُفرض الخادم التحديد)، ورئيس القسم مُجبر
        // على قسمه. كل مسارات التحويل تقرأ أذونات الصرف المؤهلة فقط.
        const fixedFrom = mayChooseSource ? '' : mySrc;
        const stockScope = 'month';
        const dest = mode === 'external' ? EXTERNAL_SALE_DEPT : '';
        panelState = { mode, from: fixedFrom, to: dest, lines: [], notes: '', stock: [], scope: stockScope, selectedId: '', status: '', kind: 'info', busy: false, factory: false, links: null };
        paintPanel();
        if (panelState.from) {await loadPanelStock(panelState.from, stockScope);}
        const destSel = panelHost.querySelector('[data-v2dt-dest]');
        if (destSel) {destSel.value = panelState.to || '';}
    }

    function closePanel() { panelState = null; paintPanel(); }

    /* السطر المُعدّ في صف الاختيار -> جدول الأصناف. يُستدعى من زر «إضافة» ومن
       «تنفيذ التحويل» نفسه: لو كتب المالك الكمية واختار الصنف ثم ضغط التنفيذ،
       رفضٌ بلا شرح يبدو كزرٍ ميت — فالتنفيذ يلتقط السطر أولًا. */
    function addLineFromDraft() {
        if (!panelState) {return 'empty';}
        const pick = panelHost.querySelector('[data-v2dt-itempick]');
        const qtyEl = panelHost.querySelector('[data-v2dt-qty]');
        const value = pick ? pick.value : '';
        const qty = Number(qtyEl && qtyEl.value);
        if (!panelState.from) {say('حدد القسم المرسل أولًا — القائمة تُبنى من أذونات صرفه.', 'error'); return 'empty';}
        const stockItem = (panelState.stock || []).find((s) => String(s.inventory_id) === String(value));
        if (!stockItem) {return 'empty';}
        if (!Number.isFinite(qty) || qty <= 0) {return 'empty';}
        // مصنع بلا ربط قائمة: الخادم سيرفض الصنف — منعٌ مبكر برسالة واضحة
        // بدل زرٍ يبدو ميتًا (نفس رسائل FACTORY_PRICE_MISSING في الخادم).
        if (panelState.factory && !(Number(stockItem.menu_price) > 0)) {
            say(`«${stockItem.item_name}» بلا سعر قائمة — اربطه بمنتج القائمة أولًا`
                + (mayLink ? ' من قسم الربط أدناه.' : ' (راجع مدير النظام).'), 'error');
            return 'blocked';
        }
        // السقف سقفُ إذن الصرف لا رصيد المخزن: الخادم يحسبه (المعتمد
        // للقسم في فترة الأهلية ناقص ما حوَّله القسم سابقًا).
        if (panelState.scope === 'month') {
            const cap = Number(stockItem.available) || 0;
            const already = panelState.lines
                .filter((l) => String(l.inventory_id) === String(stockItem.inventory_id))
                .reduce((s, l) => s + (Number(l.qty) || 0), 0);
            if (qty + already > cap + 0.000001) {
                say(`الكمية تتجاوز المتاح من إذن الصرف — المتاح ${formatQty(cap)} ${stockItem.voucher_unit || stockItem.unit || ''}`
                    + ` (صُرف للإذن ${formatQty(stockItem.month_qty)} · حوَّله القسم سابقًا ${formatQty(Number(stockItem.transferred_qty) || 0)}`
                    + ` · في مخزن القسم ${formatQty(stockItem.on_hand)} · لم يُستلم بعد ${formatQty(stockItem.in_transit)})`, 'error');
                return 'blocked';
            }
        }
        const existing = panelState.lines.find((l) => String(l.inventory_id) === String(stockItem.inventory_id));
        if (existing) {existing.qty += qty;}
        else {
            panelState.lines.push({
                inventory_id: stockItem.inventory_id, name: stockItem.item_name,
                unit: stockItem.voucher_unit || stockItem.unit,
                qty, avg_cost: stockItem.avg_cost,
                menu_price: panelState.factory ? (Number(stockItem.menu_price) || 0) : 0,
                vouchers: Array.isArray(stockItem.sources) ? stockItem.sources : [],
            });
        }
        if (qtyEl) {qtyEl.value = '';}
        panelState.status = '';
        panelState.kind = 'info';
        paintPanel();
        return 'added';
    }

    async function submitPanel() {
        if (!panelState) {return;}
        const p = panelState;
        if (p.busy) {return;}
        if (addLineFromDraft() === 'blocked') {return;}
        if (!p.from) {say('حدد القسم المرسل أولًا — القائمة تُبنى من أذونات صرفه.', 'error'); return;}
        if (!p.lines.length) {say('أضف صنفًا واحدًا على الأقل — اختر الصنف من أذونات القسم ثم اضغط «إضافة».', 'error'); return;}
        if (!p.to) {
            say(p.mode === 'external' ? 'اختر منفذ البيع الخارجي (بيع خارجي · كافيه · كافيه ناصر).' : 'حدد القسم المستلم.', 'error');
            return;
        }
        const items = p.lines.map((l) => ({ inventory_id: l.inventory_id, qty: Number(l.qty) }));
        const body = { sourceDeptCode: p.from, items, notes: p.notes || undefined };
        p.busy = true;
        p.status = '';
        paintPanel();
        try {
            if (p.mode === 'external') {
                const destName = deptNameByCode(deptOptions, p.to) || p.to;
                const isFactoryRun = p.factory === true;
                const ok = await confirmFn(isFactoryRun
                    ? `تنفيذ تحويل المصنع إلى ${destName}؟ سيُقيَّم بسعر القائمة الحالي — يُسجَّل إيرادًا للمصنع ويُحمَّل على المنفذ، والتكلفة تبقى على المصنع.`
                    : `تنفيذ التحويل إلى ${destName} الآن؟ سيخصم من مخزن قسمك (بضاعة أذونات الصرف) ويُضاف للمنفذ بالتكلفة الفعلية.`);
                p.busy = false;
                if (!ok) {paintPanel(); return;}
                const created = await createExternalSaleTransfer({ ...body, destDeptCode: p.to });
                notify(isFactoryRun && created && created.factory_total_value != null
                    ? `تم التنفيذ — سُجِّل إيراد المصنع بسعر القائمة ${money(created.factory_total_value)} وحُمِّل على ${destName}`
                    : `تم التنفيذ — خُصمت من قسمك وأُضيفت إلى ${destName} بالتكلفة الفعلية`);
                closePanel();
            } else {
                await createDeptTransfer({ ...body, destDeptCode: p.to });
                p.busy = false;
                notify('أُرسل الطلب — وصل إشعار للشيف والسو-شيف للاعتماد');
                closePanel();
            }
            invalidateStock(p.from);
            await reload();
        } catch (e) {
            p.busy = false;
            const reason = e && e.message ? String(e.message) : 'رفض الخادم العملية';
            say(`تعذّر التنفيذ: ${reason}`, 'error');
            paintPanel();
            notify(`فشل: ${reason}`);
        }
    }

    // ── الإجراءات ─────────────────────────────────────────────────────
    async function doApprove(id) {
        const ok = await confirmFn('اعتماد التحويل وتنفيذه فورًا؟ سيخصم من مخزن المرسل ويضاف للمستلم بالتكلفة الفعلية.');
        if (!ok) {return;}
        try {
            await approveTransfer(id);
            notify('اعتُمد ونُفِّذ التحويل');
            await reload();
        } catch (e) {
            notify(e && e.message ? `تعذر الاعتماد: ${e.message}` : 'تعذر الاعتماد');
        }
    }

    async function doReject(id) {
        const reason = window.prompt('سبب الرفض (يُسجل ويُشعَر به مقدم الطلب):') || '';
        if (!reason || reason.trim().length < 3) {return;}
        try {
            await rejectTransfer(id, reason.trim());
            notify('رُفض التحويل وشُعر مقدم الطلب');
            await reload();
        } catch (e) {
            notify(e && e.message ? `تعذر الرفض: ${e.message}` : 'تعذر الرفض');
        }
    }

    async function doCancel(id) {
        const ok = await confirmFn('إلغاء طلب التحويل؟');
        if (!ok) {return;}
        try {
            await cancelTransfer(id);
            notify('أُلغي الطلب');
            await reload();
        } catch (e) {
            notify(e && e.message ? `تعذر الإلغاء: ${e.message}` : 'تعذر الإلغاء');
        }
    }

    function rowById(id) { return rows.find((r) => r.id === id) || null; }

    function rawById(id) { return rowsRaw.find((r) => String(r.id) === String(id)) || null; }

    function printSheet(id) {
        const raw = rawById(id);
        const r = rowById(id);
        if (!raw || !r) {return;}
        const w = openInAppReport(`إذن تحويل ${r.number}`);
        const priceOf = (invId) => {
            const hit = r.factoryPricing.find((x) => String(x.inventory_id) === String(invId));
            return hit ? Number(hit.price) || 0 : 0;
        };
        const items = (Array.isArray(raw.items) ? raw.items : []).map((it, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${esc(it.item_name || ('صنف #' + it.inventory_id))}</td>
            <td>${esc(it.unit || '')}</td>
            <td>${formatQty(it.received_qty ?? it.requested_qty)}</td>
            <td>${money(it.unit_cost)}</td>
            ${r.factory ? `<td>${money(priceOf(it.inventory_id))}</td>
            <td>${money((Number(it.received_qty ?? it.requested_qty) || 0) * priceOf(it.inventory_id))}</td>` : ''}
            <td>${money((Number(it.received_qty ?? it.requested_qty) || 0) * (Number(it.unit_cost) || 0))}</td>
          </tr>`).join('');
        const total = r.value;
        const isExt = r.mode === 'external_sale';
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن تحويل ${esc(r.number)}</title></head>
          <body style="font-family:'IBM Plex Sans Arabic','Tajawal',Tahoma,Arial,sans-serif;margin:0;background:#eef5f1">
          <div style="max-width:800px;margin:24px auto;background:#fff;border:2px solid #18352b;border-radius:14px;overflow:hidden">
            <div style="background:#18352b;color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-size:20px;font-weight:800">إذن تحويل داخلي</div>
              <div style="opacity:.85;font-size:13px">مطاعم الشرفة — التحويلات بين الأقسام</div></div>
              <div style="text-align:end"><div style="font-weight:800">${esc(r.number)}</div>
              <div style="font-size:13px;opacity:.85">${esc(fDT(r.createdAt))}</div></div>
            </div>
            <div style="padding:20px 24px">
              <table style="width:100%;border-collapse:collapse;margin-block-end:16px">
                <tr>
                  <td style="padding:8px;border:1px solid #bcd8cb;background:#e8f2ec"><strong>من قسم:</strong> ${esc(r.fromName)}</td>
                  <td style="padding:8px;border:1px solid #bcd8cb;background:#e8f2ec"><strong>إلى قسم:</strong> ${esc(r.toName)}</td>
                </tr>
                <tr>
                  <td style="padding:8px;border:1px solid #bcd8cb"><strong>النوع:</strong> ${r.factory ? 'تحويل مصنع — تسوية بسعر القائمة' : (isExt ? 'بيع خارجي — تنفيذ مباشر' : 'تحويل بين قسمين — باعتماد الشيف')}</td>
                  <td style="padding:8px;border:1px solid #bcd8cb"><strong>الحالة:</strong> ${esc(transferBadge(r.status).replace(/<[^>]*>/g, ''))}</td>
                </tr>
              </table>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead><tr style="background:#18352b;color:#fff">
                  <th style="padding:8px;border:1px solid #18352b">#</th>
                  <th style="padding:8px;border:1px solid #18352b">الصنف</th>
                  <th style="padding:8px;border:1px solid #18352b">الوحدة</th>
                  <th style="padding:8px;border:1px solid #18352b">الكمية</th>
                  <th style="padding:8px;border:1px solid #18352b">تكلفة الوحدة</th>
                  ${r.factory ? `<th style="padding:8px;border:1px solid #18352b">سعر القائمة</th>
                  <th style="padding:8px;border:1px solid #18352b">قيمة القائمة</th>` : ''}
                  <th style="padding:8px;border:1px solid #18352b">الإجمالي</th>
                </tr></thead>
                <tbody>${items || `<tr><td colspan="${r.factory ? 8 : 6}" style="padding:10px;text-align:center">لا بنود</td></tr>`}</tbody>
                <tfoot>
                  ${r.factory ? `<tr style="background:#e8f2ec;font-weight:800">
                    <td colspan="7" style="padding:8px;border:1px solid #bcd8cb;text-align:start">تسوية المصنع — إيراد بسعر القائمة يُحمَّل على المنفذ</td>
                    <td style="padding:8px;border:1px solid #bcd8cb">${money(r.factoryValue)}</td>
                  </tr>` : ''}
                  <tr style="background:#e8f2ec;font-weight:800">
                    <td colspan="${r.factory ? 7 : 5}" style="padding:8px;border:1px solid #bcd8cb;text-align:start">إجمالي التكلفة الفعلية (تبقى على المصنع)</td>
                    <td style="padding:8px;border:1px solid #bcd8cb">${money(total)}</td>
                  </tr>
                </tfoot>
              </table>
              ${r.notes ? `<p style="margin-block-start:14px"><strong>ملاحظات:</strong> ${esc(r.notes)}</p>` : ''}
              <div style="display:flex;justify-content:space-between;margin-top:34px;font-size:13px">
                <div>مقدم الطلب: <strong>${esc(r.requestedBy)}</strong><br/><br/>التوقيع: ..........................</div>
                <div>اعتماد الشيف: <strong>${esc(r.approvedBy || '—')}</strong><br/><br/>التوقيع: ..........................</div>
                <div>استلام المستلم:<br/><br/>التوقيع: ..........................</div>
              </div>
            </div>
          </div></body></html>`);
        w.document.close();
    }

    /** ملخص التوزيع على الجهات المستلمة — جدول يُضاف للكشف المطبوع
     *  (مراجعة احترافية: أين ذهبت البضاعة وبكم وبأي نسبة). */
    function destBreakdownHtml(list) {
        const agg = [];
        for (const r of list) {
            if (r.status !== 'received') {continue;}
            const key = r.toName || r.toCode || '—';
            let hit = agg.find((x) => x.name === key);
            if (!hit) {hit = { name: key, count: 0, qty: 0, value: 0 }; agg.push(hit);}
            hit.count += 1;
            hit.qty += Number(r.qty) || 0;
            hit.value += Number(r.value) || 0;
        }
        if (!agg.length) {return '';}
        agg.sort((a, b) => b.value - a.value);
        const total = agg.reduce((s, x) => s + x.value, 0);
        const body = agg.map((x) => {
            const pct = total > 0 ? Math.round((x.value / total) * 100) : 0;
            return `<tr>
              <td>${esc(x.name)}</td>
              <td>${x.count}</td>
              <td>${formatQty(x.qty)}</td>
              <td>${money(x.value)}</td>
              <td>${pct}%</td>
            </tr>`;
        }).join('');
        return `
          <h3 style="margin-block-start:22px;font-size:16px">التوزيع على الجهات المستلمة</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-block-start:8px">
            <thead><tr style="background:#18352b;color:#fff">
              <th style="padding:7px;border:1px solid #18352b">الجهة</th>
              <th style="padding:7px;border:1px solid #18352b">عدد التحويلات</th>
              <th style="padding:7px;border:1px solid #18352b">الكمية</th>
              <th style="padding:7px;border:1px solid #18352b">القيمة</th>
              <th style="padding:7px;border:1px solid #18352b">النسبة</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>`;
    }

    function printRegister() {
        const list = filteredRows();
        if (!list.length) {notify('لا صفوف مطابقة للطباعة'); return;}
        const scopeLabel = 'التحويلات الداخلية';
        const reportTitle = 'كشف التحويلات الداخلية';
        const w = openInAppReport(reportTitle);
        const body = list.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${esc(r.number)}</td>
            <td>${esc(r.fromName)}</td>
            <td>${esc(r.toName)}</td>
            <td>${esc(r.itemsText)}</td>
            <td>${formatQty(r.qty)}</td>
            <td>${money(r.value)}</td>
            <td>${esc(transferBadge(r.status).replace(/<[^>]*>/g, ''))}</td>
            <td>${esc(fD(r.createdAt))}</td>
          </tr>`).join('');
        const s = summarizeTransfers(list.map((r) => ({ status: r.status, items: [] })));
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(reportTitle)}</title></head>
          <body style="font-family:'IBM Plex Sans Arabic','Tajawal',Tahoma,Arial,sans-serif;margin:0;background:#eef5f1">
          <div style="max-width:1000px;margin:24px auto;background:#fff;border:2px solid #18352b;border-radius:14px;overflow:hidden">
            <div style="background:#18352b;color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-size:20px;font-weight:800">${esc(reportTitle)}</div>
              <div style="opacity:.85;font-size:13px">مطاعم الشرفة — ${esc(scopeLabel)} · المصدر: أذونات صرف صادرة فعليًا</div></div>
              <div style="font-size:13px;opacity:.85">${esc(fDT(new Date().toISOString()))}</div>
            </div>
            <div style="padding:20px 24px">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#18352b;color:#fff">
                  <th style="padding:7px;border:1px solid #18352b">#</th>
                  <th style="padding:7px;border:1px solid #18352b">الإذن</th>
                  <th style="padding:7px;border:1px solid #18352b">من</th>
                  <th style="padding:7px;border:1px solid #18352b">إلى</th>
                  <th style="padding:7px;border:1px solid #18352b">الأصناف</th>
                  <th style="padding:7px;border:1px solid #18352b">الكمية</th>
                  <th style="padding:7px;border:1px solid #18352b">القيمة</th>
                  <th style="padding:7px;border:1px solid #18352b">الحالة</th>
                  <th style="padding:7px;border:1px solid #18352b">التاريخ</th>
                </tr></thead>
                <tbody>${body}</tbody>
              </table>
              ${destBreakdownHtml(list)}
              <p style="margin-block-start:14px;font-size:13px">
                الإجمالي: <strong>${s.total}</strong> إذن — بانتظار الاعتماد: <strong>${s.pending}</strong> — منفَّذة: <strong>${s.done}</strong> — مرفوضة: <strong>${s.rejected}</strong> — ملغاة: <strong>${s.cancelled}</strong>
              </p>
              <div style="display:flex;justify-content:space-between;margin-top:34px;font-size:13px">
                <div>أمين المخازن:<br/><br/>التوقيع: ..........................</div>
                <div>الشيف العمومي:<br/><br/>التوقيع: ..........................</div>
                <div>الإدارة:<br/><br/>التوقيع: ..........................</div>
              </div>
            </div>
          </div></body></html>`);
        w.document.close();
    }

    // ── تقرير فرق المصنع الشهري ───────────────────────────────────────
    // قيمة تحويلات المصنع بسعر القائمة (لحظة التنفيذ) مقابل مبيعات المنفذ
    // الفعلية لنفس المنتجات (بكود Yara وبكاشيرات المنفذ نفسه) — الفرق
    // الإيجابي يعني أن المنفذ باع بأكثر من قيمة التسوية (يُضاف للمصنع)،
    // والسالب عكسه. القفل يقيّد الفرق ولا يُضاعفه لنفس الشهر.

    function paintVariance() {
        const host = el.querySelector('[data-v2dt-variance]');
        if (host) {host.innerHTML = varianceMarkup();}
    }

    function varianceMarkup() {
        if (variance.error) {
            return `<div class="erp-state"><span class="erp-state__title">تعذر التحميل</span><span>${esc(variance.error)}</span></div>`;
        }
        if (variance.loading) {return '<p class="erp-text-sm erp-text-muted">جارٍ تحميل تقرير فرق المصنع…</p>';}
        const d = variance.data;
        if (!d) {return '<p class="erp-text-sm erp-text-muted">اختر الشهر ثم اضغط «عرض» — يُقارن قيمة تحويلات المصنع بسعر القائمة مع مبيعات المنفذ الفعلية.</p>';}
        if (!Array.isArray(d.factories) || !d.factories.length) {
            return '<div class="erp-state"><span class="erp-state__title">لا تحويلات مصنع في هذا الشهر</span><span>سيظهر الفرق هنا بعد أول تحويل مصنع لمنفذ بيع خارجي.</span></div>';
        }
        return d.factories.map((f) => {
            const name = deptNameByCode(deptOptions, f.dept_code) || f.dept_code;
            const t = f.totals || {};
            const body = (f.rows || []).map((r) => {
                const destTip = Object.entries(r.by_dest || {})
                    .map(([k, part]) => `${deptNameByCode(deptOptions, k) || k}: حوَّل ${formatQty(part.t_qty)}/${money(part.t_value)} · باع ${formatQty(part.s_qty)}/${money(part.s_value)} · فرق ${money(part.diff)}`)
                    .join(' — ');
                return `
              <tr>
                <td title="${esc(destTip)}">${esc(r.item_name)}</td>
                <td>${esc(r.menu_name || '—')}</td>
                <td>${formatQty(r.transferred_qty)}</td>
                <td>${money(r.transferred_value)}</td>
                <td>${formatQty(r.sold_qty)}</td>
                <td>${money(r.sold_value)}</td>
                <td style="color:${Number(r.diff_value) < 0 ? 'var(--erp-danger)' : 'var(--erp-success)'}">${money(r.diff_value)}</td>
                <td>${r.matchable ? 'مطابق' : 'بلا ربط Yara'}</td>
              </tr>`;
            }).join('');
            return `
          <section class="erp-card" style="margin-block-start:var(--erp-space-3)">
            <div class="erp-card__head">
              <h4 class="erp-card__title">مصنع ${esc(name)} <span class="erp-badge" data-tone="neutral" dir="ltr">${esc(f.dept_code)}</span> — ${Number(f.transfers) || 0} تحويل</h4>
            </div>
            <div class="erp-card__body">
              <div class="erp-kpis" style="margin-block-end:var(--erp-space-3)">
                ${kpiStrip([
                    { icon: 'arrow-left-right', label: 'قيمة المحوَّل (سعر القائمة)', value: money(t.transferred_value) },
                    { icon: 'banknote', label: 'مبيعات المنافذ الفعلية', value: money(t.sold_value) },
                    { icon: 'trending-up', label: 'الفرق (مبيعات − تحويل)', value: money(t.diff_value) },
                    { icon: 'lock', label: 'قابل للإقفال', value: money(t.closable_diff_value) },
                ], `فرق مصنع ${esc(name)} — ${esc(variance.month)}`)}
              </div>
              <div style="overflow-x:auto">
                <table class="erp-table">
                  <thead><tr><th scope="col">صنف المصنع</th><th scope="col">منتج القائمة</th><th scope="col">كمية محوَّلة</th><th scope="col">قيمة محوَّلة</th><th scope="col">كمية مباعة</th><th scope="col">قيمة مباعة</th><th scope="col">الفرق</th><th scope="col">المطابقة</th></tr></thead>
                  <tbody>${body}</tbody>
                </table>
              </div>
              ${mayLink ? `<div style="margin-block-start:var(--erp-space-2)"><button type="button" class="erp-btn erp-btn--sm erp-btn--brand" data-v2dt-var-close="${esc(f.dept_code)}"><i class="ji" data-i="lock" aria-hidden="true"></i> قفل فرق الشهر</button></div>` : ''}
            </div>
          </section>`;
        }).join('');
    }

    async function showVariance() {
        const monthInput = el.querySelector('[data-v2dt-var-month]');
        if (monthInput) {variance.month = String(monthInput.value || '').slice(0, 7);}
        if (!/^\d{4}-\d{2}$/.test(variance.month)) {
            variance.error = 'اختر شهرًا بصيغة صحيحة (YYYY-MM)';
            paintVariance();
            return;
        }
        variance.loading = true;
        variance.error = '';
        variance.data = null;
        paintVariance();
        try {
            variance.data = await fetchFactoryVariance(variance.month);
        } catch (e) {
            variance.error = (e && e.message) ? e.message : 'تعذر جلب التقرير';
        } finally {
            variance.loading = false;
            paintVariance();
        }
    }

    async function doCloseVariance(deptCode) {
        const f = ((variance.data && variance.data.factories) || [])
            .find((x) => String(x.dept_code).toLowerCase() === String(deptCode).toLowerCase());
        if (!f) {return;}
        const name = deptNameByCode(deptOptions, deptCode) || deptCode;
        const ok = await confirmFn(`قفل فرق شهر ${variance.month} لمصنع ${name}؟`
            + ` الفرق القابل للإقفال ${money(f.totals.closable_diff_value)} —`
            + ' سيُقيَّد فرق كل منفذ إيرادًا للمصنع وتحميلًا على المنفذ مع قيد محاسبي (التكرار لنفس الشهر لا يُضاعف).');
        if (!ok) {return;}
        try {
            const res = await closeFactoryVariance(variance.month, deptCode);
            notify(`أُقفل فرق الشهر — ${(res && res.closed ? res.closed.length : 0)} منفذ`);
            await showVariance();
        } catch (e) {
            notify(e && e.message ? `تعذر القفل: ${e.message}` : 'تعذر القفل');
        }
    }

    // ── الأحداث ───────────────────────────────────────────────────────
    el.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) {return;}
        if (btn.hasAttribute('data-v2dt-refresh')) {await reload(); return;}
        if (btn.hasAttribute('data-v2dt-dash-apply')) {await loadSummary(); return;}
        if (btn.hasAttribute('data-v2dt-print')) {printRegister(); return;}
        if (btn.hasAttribute('data-v2dt-new')) {await openPanel('dept'); return;}
        if (btn.hasAttribute('data-v2dt-external')) {await openPanel('external'); return;}
        if (btn.hasAttribute('data-v2dt-closepanel')) {closePanel(); return;}
        if (btn.hasAttribute('data-v2dt-addline')) {addLineFromDraft(); return;}
        if (btn.hasAttribute('data-v2dt-var-show')) {await showVariance(); return;}
        const varCloseDept = btn.getAttribute('data-v2dt-var-close');
        if (varCloseDept) {await doCloseVariance(varCloseDept); return;}
        const saveLinkInv = btn.getAttribute('data-v2dt-savelink');
        if (saveLinkInv) {await doSaveLink(saveLinkInv); return;}
        const delIdx = btn.getAttribute('data-v2dt-delline');
        if (delIdx !== null && panelState) {
            panelState.lines.splice(Number(delIdx), 1);
            paintPanel();
            return;
        }
        if (btn.hasAttribute('data-v2dt-submit')) {await submitPanel(); return;}
        const approveId = btn.getAttribute('data-v2dt-approve');
        if (approveId) {await doApprove(approveId); return;}
        const rejectId = btn.getAttribute('data-v2dt-reject');
        if (rejectId) {await doReject(rejectId); return;}
        const cancelId = btn.getAttribute('data-v2dt-cancel');
        if (cancelId) {await doCancel(cancelId); return;}
        const sheetId = btn.getAttribute('data-v2dt-sheet');
        if (sheetId) {printSheet(sheetId); return;}
        const tabBtn = btn.getAttribute('data-v2dt-tab');
        if (tabBtn) {
            tab = tabBtn;
            el.querySelectorAll('[data-v2dt-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('data-v2dt-tab') === tab)));
            paintTable();
        }
    });

    if (searchInput) {
        let debounce = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                search = searchInput.value || '';
                paintTable();
            }, 200);
        });
    }

    // تواريخ لوحة التحويلات: تُحدَّث في الحالة فقط بلا إعادة رسم (حفاظًا على
    // التركيز أثناء اختيار التاريخ) — التطبيق يقرأ ثم يجلب الملخص.
    el.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t || !t.hasAttribute) {return;}
        if (t.hasAttribute('data-v2dt-dash-from')) {dash.from = String(t.value || dash.from).slice(0, 10); return;}
        if (t.hasAttribute('data-v2dt-dash-to')) {dash.to = String(t.value || dash.to).slice(0, 10); return;}
    });

    // dest select للتلوين داخل اللوحة (مسار A فقط)
    panelHost.addEventListener('change', async (ev) => {
        if (!panelState || !ev.target || !ev.target.hasAttribute) {return;}
        if (ev.target.hasAttribute('data-v2dt-src')) {
            const code = ev.target.value || '';
            if (code !== panelState.from) {
                panelState.from = code;
                panelState.to = '';
                panelState.lines = [];
                panelState.stock = [];
                paintPanel();
                if (code) {await loadPanelStock(code, panelState.scope || '');}
            }
            return;
        }
        if (ev.target.hasAttribute('data-v2dt-dest')) {
            panelState.to = ev.target.value || '';
            return;
        }
        // اختيار صنف → عرض تتبّع مصدره (أذونات الصرف) بلا إعادة رسم كاملة
        if (ev.target.hasAttribute('data-v2dt-itempick')) {
            panelState.selectedId = ev.target.value || '';
            const traceEl = panelHost.querySelector('[data-v2dt-trace]');
            if (traceEl) {traceEl.innerHTML = traceHtml();}
        }
    });
    /** إعادة بناء خيارات قائمة الأصناف حسب البحث — بلا إعادة رسم كاملة
     *  حفاظًا على نص البحث والتركيز. التسوية العربية: أإآ→ا، ة→ه، ى→ي. */
    function repaintItemOptions() {
        if (!panelState) {return;}
        const pick = panelHost.querySelector('[data-v2dt-itempick]');
        if (!pick) {return;}
        const searchEl = panelHost.querySelector('[data-v2dt-itemsearch]');
        const raw = searchEl ? String(searchEl.value || '').trim() : '';
        const norm = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
        const nq = norm(raw);
        const list = nq ? panelState.stock.filter((s) => norm(s.item_name).includes(nq)) : panelState.stock;
        const selected = pick.value;
        let html = '<option value="">' + (panelState.from ? '— اختر صنفًا —' : '— القسم المرسل غير محدد —') + '</option>';
        for (const s of list) {
            const label = stockLabel(s, panelState.scope);
            const sel = String(s.inventory_id) === selected ? ' selected' : '';
            html += '<option value="' + esc(String(s.inventory_id)) + '"' + sel + '>' + esc(label) + '</option>';
        }
        pick.innerHTML = html;
        const countEl = panelHost.querySelector('[data-v2dt-itemcount]');
        if (countEl) {
            countEl.textContent = panelState.from ? (list.length + ' من ' + panelState.stock.length + ' صنف') : '';
        }
    }

    panelHost.addEventListener('input', (ev) => {
        if (!panelState || !ev.target || !ev.target.hasAttribute) {return;}
        if (ev.target.hasAttribute('data-v2dt-itemsearch')) {repaintItemOptions(); return;}
        if (ev.target.hasAttribute('data-v2dt-notes')) {panelState.notes = ev.target.value || '';}
    });

    let destroyed = false;
    (async () => {
        await reload();
    })();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            destroyed = true;
            el.remove();
        },
    };
}
