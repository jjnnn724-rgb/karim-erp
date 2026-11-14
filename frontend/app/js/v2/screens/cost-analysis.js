/**
 * V2 — Cost analysis screen · شاشة 17 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * LEGACY PARITY (features/finance.js:252-273 + auth-navigation.js:398-451)
 *   The legacy screen computes over STATE.revenues + STATE.expenses +
 *   STATE.departments. V2 uses /finance/cost-analysis to apply the same
 *   department-tree and expense-bucket rules in one aggregated read.
 *   Buckets per department: صرف مخزون (stock movement, net of returns via
 *   the Math.max(0, …) legacy rule) / تحويلات بين الأقسام (بند موقَّع: سالب
 *   على المرسل موجب على المستلم) / فرق جرد (count_correction) /
 *   تشغيلية (the rest). KPI thresholds: <50 green, <75 orange, else red
 *   (finance.js:273).
 *   Charts (bar + donut) are drawn by js/v2/charts.js as SVG — no external
 *   library, no CSP change.
 *   Read gate on the sources: admin|manager|accountant|auditor.
 *
 * PRINTING
 *   The print action opens /finance/cost-analysis/print in the in-app
 *   report viewer: the server renders the full A4 sheet (logo, brand
 *   header, composition, departments, categories, totals, footer) from the
 *   same aggregate query. The screen never re-computes a number for print.
 *
 * THIS SCREEN NEVER WRITES.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.331';
import { barChart, donutChart } from '../charts.js?v=4.9.331';
import { openInAppReport } from '../report-viewer.js?v=4.9.331';
import {
    fetchCostAnalysis, fetchCostAnalysisDept, fetchCostAnalysisPrintHtml, firstOfMonth, riyadhToday,
} from '../data/finance-repo.js?v=4.9.331';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.331';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Legacy KPI threshold coloring (finance.js:273): <50 green, <75 orange. */
function costTone(pct) {
    if (pct < 50) {return 'erp-text-success';}
    if (pct < 75) {return 'erp-text-warning';}
    return 'erp-text-danger';
}

function toneName(pct) {
    if (pct < 50) {return 'success';}
    if (pct < 75) {return 'warning';}
    return 'danger';
}

/** A department may hold revenue, cost, both, or neither. Calling a pure
 *  cost centre «خاسر» would read as a loss when the company is profitable,
 *  so the verdict names the centre itself unless both sides exist. */
function verdict(row) {
    const hasRev = num(row.rev) > 0;
    const hasCost = num(row.exp) > 0;
    if (hasRev && hasCost) {
        return row.profit >= 0
            ? { label: 'مربح', tone: 'success' }
            : { label: 'خاسر', tone: 'danger' };
    }
    if (hasCost) {return { label: 'مركز تكلفة', tone: 'warning' };}
    if (hasRev) {return { label: 'مركز إيراد', tone: 'brand' };}
    return { label: 'بدون حركة', tone: 'neutral' };
}

function moneyCell(v, currency, signed = false) {
    const m = formatMoney(v, currency);
    const cls = signed && Number(v) < 0 ? ' erp-text-success' : (signed && Number(v) > 0 ? ' erp-text-danger' : '');
    return `<span class="erp-num${cls}" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function moneyText(v, currency) {
    const m = formatMoney(v, currency);
    return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
}

/** خلية «مع فروعه»: رقمُ القسم مع كل فروعه، في سطرَين متراكَمين.
    سلسلةٌ واحدة عريضة كانت تفيض من عمودِ الجدول وتُقطع أرقامها. */
function familyCell(row, currency) {
    const fam = row.family || {};
    if (!fam.kids) {return '<span class="erp-text-muted">—</span>';}
    const line = (label, v) => `<span class="erp-v2-cost__fam-line"><em>${label}</em>`
        + `<span class="erp-num">${esc(formatMoney(v, currency).amount)}</span></span>`;
    return '<span class="erp-v2-cost__fam" dir="ltr">'
        + line('إيراد', num(fam.rev)) + line('تكلفة', num(fam.exp)) + '</span>';
}

/** بنية المعيار المصدّق (نفس عقد المطبخ): ul.erp-kpis > li.erp-kpi — لا ديفات. */
function kpiCard(label, body, icon) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top">
        ${icon ? `<span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>` : ''}
        <span class="erp-kpi__label">${esc(label)}</span>
      </div>
      <div class="erp-kpi__value"><span data-v2-kpi="${esc(label)}">${body}</span></div>
    </li>`;
}

function statCard({ label, value, note, noteHtml, icon, tone }) {
    return `<article class="erp-v2-cost__stat" data-tone="${esc(tone)}">
      <span class="erp-v2-cost__stat-icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>
      <div class="erp-v2-cost__stat-body">
        <span class="erp-v2-cost__stat-label">${esc(label)}</span>
        <strong class="erp-v2-cost__stat-value" data-v2-stat="${esc(label)}">${value}</strong>
        <span class="erp-v2-cost__stat-note">${noteHtml !== undefined ? noteHtml : esc(note)}</span>
      </div>
    </article>`;
}

/* ── بطاقات الأقسام ──────────────────────────────────────────────────────
   أرقام القسم وحده هي وجه البطاقة دائمًا، لا وجهان في بطاقة واحدة:
   المالك يريد «مصروف القسم وكوسته وايراداته» — لا إيراد أبيه وفروعه.
   المجموع الشجري (row.rev/row.exp) يبقى للقراءة القديمة والجدول، أما
   البطاقة فتبني سطحها على row.own وتحته سطر «مع فروعه» محسوب من الأبناء
   المعروضين في الشبكة نفسها — فلا يُحسب فرع مرتين ولا يظهر رقم لا يُفهم. */

const CARD_BUCKETS = [
    { key: 'materials', label: 'صرف مخزون' },
    { key: 'transfers', label: 'تحويلات بين الأقسام' },
    { key: 'countAdj', label: 'فروق جرد' },
    { key: 'operating', label: 'تشغيلية' },
];

/* البيع الخارجي قسم مستقل عند المالك لا فرع في المطبخ: كاشيراه ٤ و٥
   وإيرادهم في بطاقته وحده، ولا يدخلون في سطر «مع فروعه» لأبيه. */
const CARD_STANDALONE = new Set(['external_sales']);

/** ترتيب الشبكة: كل أمّ ثم فروعها (والفروع الأعلى تكلفة أولًا)، فتُقرأ
 *  البطاقات عموديًا كعائلات لا كقائمة مسطّحة. صفوف يتيم أبوها أو تدور
 *  الحلقة تُلتحق في النهاية بلا حذف. كل مدخل يحمل أبناءه تحته ليُحسب
 *  «مع فروعه» من المعروض لا من الشجرة. */
function cardOrder(list) {
    const byCode = new Map(list.map((row) => [String(row.code), row]));
    const kidsOf = new Map();
    const roots = [];
    const ownExp = (r) => num((r.own || {}).exp);
    const ownRev = (r) => num((r.own || {}).rev);
    const cmp = (a, b) => (ownExp(b) - ownExp(a)) || (ownRev(b) - ownRev(a))
        || String(a.name).localeCompare(String(b.name), 'ar');
    for (const row of list) {
        const parent = row.parent == null ? '' : String(row.parent);
        const standalone = CARD_STANDALONE.has(String(row.code));
        if (!standalone && parent && parent !== String(row.code) && byCode.has(parent)) {
            const bucket = kidsOf.get(parent) || [];
            bucket.push(row);
            kidsOf.set(parent, bucket);
        } else {
            roots.push(row);
        }
    }
    roots.sort(cmp);
    const out = [];
    const seen = new Set();
    const walk = (row, depth) => {
        const code = String(row.code);
        if (seen.has(code)) {return []; }
        seen.add(code);
        const entry = { row, depth, kids: [] };
        out.push(entry);
        const direct = (kidsOf.get(code) || []).slice().sort(cmp);
        for (const kid of direct) {
            entry.kids.push(kid, ...walk(kid, depth + 1));
        }
        return entry.kids;
    };
    for (const row of roots) {walk(row, 0);}
    for (const row of list) {
        if (!seen.has(String(row.code))) {out.push({ row, depth: 0, kids: [] });}
    }
    return out;
}

/** سابقة تكلفة القسم وحده، لا شجرته. الخادم يعطي ownExp لكل قسم؛ وإن غاب
 *  (بناءٌ أقدم) تُخصم سابقات أبنائه المباشرين من سابقة الأب — فجمع الشجرة
 *  يُلقي تكلفة الفروع على أبيه وتُقرأ المقارنة مضاعفة. */
function prevOwnByDept(previous, list) {
    const out = new Map();
    if (!previous || !previous.byDept) {return out;}
    const byDept = previous.byDept;
    const rolled = (code) => num((byDept[String(code)] || {}).exp);
    const direct = new Map();
    for (const row of list) {
        const parent = row.parent == null ? '' : String(row.parent);
        if (parent && parent !== String(row.code)) {
            direct.set(parent, (direct.get(parent) || []).concat([String(row.code)]));
        }
    }
    for (const row of list) {
        const code = String(row.code);
        const entry = byDept[code] || {};
        out.set(code, entry.ownExp != null
            ? num(entry.ownExp)
            : Math.max(0, rolled(code) - (direct.get(code) || []).reduce((s, k) => s + rolled(k), 0)));
    }
    return out;
}

/** دلتا التكلفة عن الفترة السابقة — على أرقام القسم وحده حين تُعرض وحدها،
 *  فمقارنة «المجمّع» بسابقه تُنسب للفروع فضلًا عن القسم. */
function cardDelta(own, prevExp, currency, label) {
    if (prevExp <= 0) {
        return '<span class="erp-text-muted">بلا تكلفة في الفترة السابقة</span>';
    }
    const delta = own - prevExp;
    const pct = (delta / prevExp) * 100;
    const tone = delta > 0 ? 'erp-text-danger' : (delta < 0 ? 'erp-text-success' : 'erp-text-muted');
    const arrow = delta > 0 ? '▲' : (delta < 0 ? '▼' : '—');
    return `<span class="${tone}" dir="ltr">${arrow} ${round1(Math.abs(pct))}%</span>`
        + ` <span class="erp-text-muted">عن السابقة${esc(label)} (${esc(moneyText(prevExp, currency))})</span>`;
}

/**
 * بطاقة قسم واحد: أرقامه هو — إيراد وتكلفة وصافي ونسبة — ثم بنوده، كاشيرياته،
 * نصيبه، وسطر «مع فروعه» فقط لمن له فرع في الشبكة. لا رقم مجمّع على السطح.
 * @param {{row: object, depth: number, currency: string, totals: object,
 *          cashiers: Array<{no: string, primary: boolean, revenue: number}>,
 *          parentName: string, previous: object|null, prevOwn: Map|null,
 *          family?: object}} opts
 * @returns {string} */
function deptCardHtml(opts) {
    const { row, depth, currency, totals, cashiers, parentName, previous, prevOwn, family } = opts;
    const own = row.own || {};
    const rev = num(own.rev);
    const exp = num(own.exp);
    const profit = rev - exp;
    const costRatio = rev > 0 ? (exp / rev) * 100 : 0;
    const v = verdict({ rev, exp, profit });
    /* بطاقة مستقلة لا تُنسب لأبيها: «فرع من المطبخ» على بطاقة البيع الخارجي
       تُعيد الدمج الذي طلب المالك فصله. */
    const standalone = CARD_STANDALONE.has(String(row.code));
    const shownParent = standalone ? '' : parentName;
    const kids = Array.isArray(family && family.kids) ? family.kids : [];
    /* «مع فروعه» يُجمع من الأبناء المعروضين تحت البطاقة نفسها، لا من الشجرة:
       الشجرة تحسب البيع الخارجي داخل المطبخ، والبيع الخارجي هنا بطاقة وحده. */
    const familyRev = kids.reduce((s, k) => s + num((k.own || {}).rev), rev);
    const familyExp = kids.reduce((s, k) => s + num((k.own || {}).exp), exp);
    const hasFamilyLine = kids.length > 0
        && (Math.abs(familyExp - exp) > 0.005 || Math.abs(familyRev - rev) > 0.005);
    const shareCost = num(totals.exp) > 0 ? (exp / num(totals.exp)) * 100 : 0;
    const shareRev = num(totals.rev) > 0 ? (rev / num(totals.rev)) * 100 : 0;
    const figures = [
        { k: 'rev', label: 'إيراد القسم', value: moneyCell(rev, currency) },
        { k: 'exp', label: 'تكلفة القسم', value: moneyCell(exp, currency) },
        {
            k: 'net',
            label: 'الصافي',
            value: `<span class="erp-num ${profit >= 0 ? 'erp-text-success' : 'erp-text-danger'}" dir="ltr">${esc(moneyText(profit, currency))}</span>`,
        },
        {
            k: 'ratio',
            label: 'نسبة التكلفة',
            value: rev > 0
                ? `<span class="erp-num ${costTone(costRatio)}" dir="ltr">${round1(costRatio)}%</span>`
                : '<span class="erp-text-muted">—</span>',
        },
    ].map((f) => `<div class="erp-v2-cost-card__fig" data-fig="${f.k}">
            <span class="erp-v2-cost-card__fig-label">${esc(f.label)}</span>
            <strong class="erp-v2-cost-card__fig-value">${f.value}</strong>
          </div>`).join('');

    const buckets = CARD_BUCKETS.map((b) => {
        const value = num(own[b.key]);
        const pct = exp > 0 ? Math.max(0, Math.min(100, (value / exp) * 100)) : 0;
        return `<li class="erp-v2-cost-card__mix-row">
            <span class="erp-v2-cost-card__mix-label">${esc(b.label)}</span>
            <span class="erp-v2-cost-card__mix-bar" aria-hidden="true"><span style="--card-mix:${round1(pct)}%"></span></span>
            <span class="erp-v2-cost-card__mix-value">${moneyCell(value, currency, b.key === 'transfers' || b.key === 'countAdj')}</span>
          </li>`;
    }).join('');

    const cashBlock = cashiers.length
        ? `<div class="erp-v2-cost-card__cash">
             <span class="erp-v2-cost-card__cash-title">كاشيريات القسم وإيراداتها</span>
             <div class="erp-v2-cost-card__cash-grid">
               ${cashiers.map((c) => `<article class="erp-v2-cost-cash" data-primary="${c.primary ? '1' : '0'}">
                   <span class="erp-v2-cost-cash__no" dir="ltr">كاشير ${esc(c.no)}</span>
                   <strong class="erp-v2-cost-cash__value" dir="ltr">${esc(moneyText(c.revenue, currency))}</strong>
                   <span class="erp-v2-cost-cash__tag">${c.primary ? 'أساسي' : 'ثانوي'}</span>
                 </article>`).join('')}
             </div>
           </div>`
        : '';

    /* سابقة القسم وحده من prevOwn — لا من شجرة الأب. */
    const ownPrev = num(prevOwn && prevOwn.get(String(row.code)));
    const quiet = rev <= 0.005 && exp <= 0.005 && !cashiers.length;

    return `<article class="erp-v2-cost-card${depth > 0 ? ' erp-v2-cost-card--child' : ''}${quiet ? ' erp-v2-cost-card--quiet' : ''}" data-code="${esc(row.code)}" data-tone="${esc(v.tone)}" data-depth="${depth}"${quiet ? ' data-quiet="1"' : ''}>
      <header class="erp-v2-cost-card__head">
        <div class="erp-v2-cost-card__id">
          <h5 class="erp-v2-cost-card__name">${esc(row.name)}</h5>
          <span class="erp-v2-cost-card__meta"><span dir="ltr">${esc(row.code)}</span>${shownParent ? ` · فرع من ${esc(shownParent)}` : ''}${kids.length ? ` · ${formatInt(kids.length)} فرع` : ''}</span>
        </div>
        <span class="erp-badge" data-tone="${esc(v.tone)}">${esc(v.label)}</span>
      </header>
      ${quiet
        ? '<p class="erp-v2-cost-card__quiet">لا إيراد ولا مصروف في هذه الفترة.</p>'
        : `<div class="erp-v2-cost-card__figures">${figures}</div>`}
      ${hasFamilyLine
        ? `<p class="erp-v2-cost-card__own">مع فروعه (${formatInt(kids.length)}): إيراد <span dir="ltr">${esc(moneyText(familyRev, currency))}</span> · تكلفة <span dir="ltr">${esc(moneyText(familyExp, currency))}</span>.</p>`
        : ''}
      ${quiet ? '' : `<ul class="erp-v2-cost-card__mix">${buckets}</ul>`}
      ${cashBlock}
      <footer class="erp-v2-cost-card__foot">
        <span class="erp-v2-cost-card__shares">${round1(shareCost)}% من تكلفة الشركة · ${round1(shareRev)}% من الإيراد · <span dir="ltr">${formatInt(num(own.rowCount))}</span> حركة</span>
        <span class="erp-v2-cost-card__delta">${previous && previous.byDept
            ? cardDelta(exp, ownPrev, currency, kids.length ? ' للقسم وحده' : '')
            : '<span class="erp-text-muted">بلا فترة سابقة</span>'}</span>
        <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail="${esc(row.code)}" data-v2-detail-name="${esc(row.name)}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>تفاصيل</span></button>
      </footer>
    </article>`;
}

function template(from, to) {
    /* ONE ROOT, ALWAYS. The mount code binds every lookup to
       `host.lastElementChild`; a template with two top-level nodes silently
       dropped the header (and every control inside it) from scope, which is
       how the date inputs came back null and reload() threw. The wrapper keeps
       the header and the card children of a single element. */
    return `
      <div class="erp-v2-cost-page">
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">تحليل التكاليف
            <span class="erp-eyebrow" dir="ltr" lang="en">Cost Analysis</span>
          </h2>
          <div class="erp-dash-sub">ملخص الإيرادات والتكاليف حسب القسم والفترة المحددة.</div>
        </div>
        <div class="erp-dash-controls erp-v2-cost__filters" role="group" aria-label="فترة تحليل التكاليف">
          <label class="erp-v2-cost__date" for="v2cost-from">
            <span>من تاريخ</span>
            <!-- FIX 2026-11-01: قيد min=أول الشهر كان يمنع المتصفح من قبول أي
                 تاريخ قبل اليوم الأول — «التاريخ مش بيتغير» شكوى المالك. الفترة
                 حرّة، والتحقق من ترتيبها لباب rangeError في reload. -->
            <input class="erp-input erp-input--ltr" id="v2cost-from" type="date" value="${esc(from)}">
          </label>
          <label class="erp-v2-cost__date" for="v2cost-to">
            <span>إلى تاريخ</span>
            <input class="erp-input erp-input--ltr" id="v2cost-to" type="date" value="${esc(to)}" max="${esc(riyadhToday())}">
          </label>
          <div class="erp-v2-cost__actions">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-month>بداية الشهر</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة التحليل">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة الحساب</span>
            </button>
          </div>
        </div>
      </div>
      <section class="erp-card erp-v2-cost">
        <div class="erp-card__body erp-stack">
          <section class="erp-v2-cost__hero" data-v2-hero aria-label="المؤشرات الرئيسية">
            <div class="erp-v2-cost__hero-head">
              <span class="erp-v2-cost__hero-kicker">ملخص الفترة</span>
              <span class="erp-v2-cost__hero-range" data-v2-range></span>
            </div>
            <div class="erp-v2-cost__hero-grid" data-v2-hero-grid>
              ${statCard({ label: 'إجمالي الإيرادات', value: '—', note: ' ', icon: 'banknote', tone: 'brand' })}
              ${statCard({ label: 'إجمالي التكاليف', value: '—', note: ' ', icon: 'wallet', tone: 'danger' })}
              ${statCard({ label: 'صافي الربح', value: '—', note: ' ', icon: 'trending-up', tone: 'success' })}
              ${statCard({ label: 'نسبة التكلفة', value: '—', note: ' ', icon: 'pie', tone: 'warning' })}
            </div>
          </section>
          <ul class="erp-kpis erp-v2-cost__kpis" data-v2-kpis></ul>

          <!-- بطاقات الأقسام: قسمٌ واحد لكل بطاقة، وكل بطاقة تحمل الإيراد
               والتكلفة وبنودها والصافي وعلاوة الفترة السابقة وكاشيرياتها.
               الفروع تُرسم بعد أبيها مباشرة داخل نفس الشبكة، فتبقى القراءة
               مرتبة: أمّ ثم أبناؤها. -->
          <section class="erp-v2-cost__cards" data-v2-cards aria-labelledby="v2cost-cards-title">
            <header class="erp-v2-cost__panel-head">
              <h4 id="v2cost-cards-title">بطاقات الأقسام</h4>
              <span class="erp-v2-cost__panel-note" data-v2-cards-note></span>
            </header>
            <div class="erp-v2-cost__cards-grid" data-v2-cards-grid></div>
            <div class="erp-v2-cost__cards-quiet" data-v2-cards-quiet hidden>
              <h5 class="erp-v2-cost__cards-quiet-title" data-v2-cards-quiet-title>أقسام بلا حركة في الفترة</h5>
              <div class="erp-v2-cost__cards-quiet-grid" data-v2-cards-quiet-grid></div>
            </div>
          </section>

          <div class="erp-v2-cost__split">
            <section class="erp-v2-cost__panel" aria-labelledby="v2cost-mix-title">
              <header class="erp-v2-cost__panel-head">
                <h4 id="v2cost-mix-title">تركيب التكلفة</h4>
                <span class="erp-v2-cost__panel-note" data-v2-mix-total></span>
              </header>
              <ul class="erp-v2-cost__mix" data-v2-mix></ul>
            </section>
            <section class="erp-v2-cost__panel" aria-labelledby="v2cost-rank-title">
              <header class="erp-v2-cost__panel-head">
                <h4 id="v2cost-rank-title">أعلى الأقسام تكلفة</h4>
                <span class="erp-v2-cost__panel-note" data-v2-rank-note></span>
              </header>
              <ol class="erp-v2-cost__rank" data-v2-rank></ol>
            </section>
          </div>

          <div class="erp-v2-chart-grid" data-v2-charts></div>

          <section class="erp-v2-cost__split" data-v2-flow hidden aria-label="حركة التحويلات بين الأقسام">
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head">
                <h4>حركة التحويلات — الأقسام المرسلة</h4>
                <span class="erp-v2-cost__panel-note" data-v2-flow-total></span>
              </header>
              <ul class="erp-v2-cost__mix" data-v2-flow-src></ul>
            </section>
            <section class="erp-v2-cost__panel">
              <header class="erp-v2-cost__panel-head">
                <h4>حركة التحويلات — الجهات المستلمة</h4>
                <span class="erp-v2-cost__panel-note">سالب على المرسل · موجب على المستلم</span>
              </header>
              <ul class="erp-v2-cost__mix" data-v2-flow-dst></ul>
            </section>
          </section>

          <section class="erp-v2-cost__register" aria-labelledby="v2cost-table-title">
            <div class="erp-v2-cost__register-head">
              <h4 id="v2cost-table-title">تفصيل التكاليف حسب القسم</h4>
              <span class="erp-v2-cost__register-total" data-v2-register-total></span>
              <p data-v2-summary role="status" aria-live="polite" class="erp-text-sm erp-text-muted"></p>
              <p class="erp-text-sm erp-text-muted" data-v2-attribution></p>
            </div>
            <div data-v2-table></div>
          </section>

          <section class="erp-v2-cost__register" data-v2-detail-panel hidden aria-live="polite"></section>
        </div>
      </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getTotals: ()=>object|null, destroy: ()=>void}}
 */
export function mountCostAnalysisScreen(host, ctx = {}) {
    let rows = [];
    let categories = [];
    let attribution = { links: [], channelRevenue: [] };
    let flow = null;
    let previous = null;
    let detail = null;
    let detailSelection = null;
    let detailRequestId = 0;
    let currency = '';
    let totals = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), riyadhToday()));
    const el = host.lastElementChild;
    /* Fail loudly if the contract ever drifts again: a template that emits more
       than one top-level node leaves this branch without its controls, and the
       old symptom was a null dereference three hundred lines later. */
    if (!el || !el.classList.contains('erp-v2-cost-page') || !el.querySelector('#v2cost-from')) {
        throw new Error('cost-analysis: template must render a single .erp-v2-cost-page root');
    }
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const mixEl = q('[data-v2-mix]');
    const rankEl = q('[data-v2-rank]');
    const chartsEl = q('[data-v2-charts]');
    const summaryEl = q('[data-v2-summary]');
    const attrEl = q('[data-v2-attribution]');
    const flowEl = q('[data-v2-flow]');
    const flowSrcEl = q('[data-v2-flow-src]');
    const flowDstEl = q('[data-v2-flow-dst]');
    const flowTotalEl = q('[data-v2-flow-total]');
    const detailEl = q('[data-v2-detail-panel]');
    const cardsGridEl = q('[data-v2-cards-grid]');
    const cardsNoteEl = q('[data-v2-cards-note]');
    const cardsQuietEl = q('[data-v2-cards-quiet]');
    const cardsQuietGridEl = q('[data-v2-cards-quiet-grid]');
    const cardsQuietTitleEl = q('[data-v2-cards-quiet-title]');

    const table = createDataTable({
        caption: 'تكلفة الأقسام',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا توجد أقسام مسجلة',
        rowKey: (row) => row.code,
        columns: [
            {
                key: 'name', header: 'القسم', sortable: true, filterable: true,
                render: (row) => `<span>${esc(row.name)}</span>`
                    + (row.external
                        ? ' <span class="erp-badge" data-tone="neutral">بيع خارجي — خارج الإجمالي</span>'
                        : ''),
            },
            {
                key: 'rev', header: 'إيراد القسم', type: 'number', sortable: true,
                align: 'end', value: (row) => row.rev, render: (row) => moneyCell(row.rev, currency),
            },
            {
                key: 'materials', header: 'صرف مخزون', type: 'number', sortable: true,
                align: 'end', value: (row) => row.materials, render: (row) => moneyCell(row.materials, currency),
            },
            {
                key: 'transfers', header: 'تحويلات', type: 'number', sortable: true,
                align: 'end', value: (row) => num(row.transfers),
                render: (row) => (num(row.transfers) === 0
                    ? '<span class="erp-text-muted">—</span>'
                    : moneyCell(row.transfers, currency, true)),
            },
            {
                key: 'countAdj', header: 'فرق جرد', type: 'number', sortable: true,
                align: 'end', value: (row) => row.countAdj, render: (row) => moneyCell(row.countAdj, currency, true),
            },
            {
                key: 'operating', header: 'تشغيلية', type: 'number', sortable: true,
                align: 'end', value: (row) => row.operating, render: (row) => moneyCell(row.operating, currency),
            },
            {
                key: 'exp', header: 'تكلفة القسم', type: 'number', sortable: true,
                align: 'end', value: (row) => row.exp, render: (row) => moneyCell(row.exp, currency),
            },
            {
                key: 'family', header: 'مع فروعه', type: 'number', sortable: true,
                width: '126px', align: 'end', value: (row) => num((row.family || {}).exp),
                render: (row) => familyCell(row, currency),
            },
            {
                key: 'costRatio', header: 'نسبة التكلفة', type: 'number', sortable: true,
                width: '120px', align: 'end', value: (row) => row.costRatio,
                render: (row) => (num(row.rev) > 0
                    ? `<span class="erp-num ${costTone(row.costRatio)}" dir="ltr">${round1(row.costRatio)}%</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'profit', header: 'صافي الربح', type: 'number', sortable: true,
                align: 'end', value: (row) => row.profit,
                render: (row) => `<span class="erp-num ${row.profit >= 0 ? 'erp-text-success' : 'erp-text-danger'}" dir="ltr">${moneyText(row.profit, currency)}</span>`,
            },
            {
                key: 'margin', header: 'هامش الربح', type: 'number', sortable: true,
                width: '110px', align: 'end', value: (row) => row.margin,
                render: (row) => (num(row.rev) > 0
                    ? `<span class="erp-num erp-text-muted" dir="ltr">${round1(row.margin)}%</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'rowCount', header: 'الحركات', type: 'number', sortable: true,
                width: '90px', align: 'end', value: (row) => row.rowCount,
                render: (row) => `<span class="erp-num erp-text-muted" dir="ltr">${formatInt(row.rowCount)}</span>`,
            },
            {
                key: 'status', header: 'التقييم', sortable: true, width: '120px', align: 'center',
                value: (row) => row.profit,
                render: (row) => {
                    const v = verdict(row);
                    return `<span class="erp-badge" data-tone="${v.tone}">${v.label}</span>`;
                },
            },
            {
                key: 'delta', header: 'تغير عن الفترة السابقة', type: 'number', sortable: true,
                width: '160px', align: 'end', value: (row) => row.delta,
                render: (row) => {
                    if (!previous) {return '<span class="erp-text-muted">—</span>';}
                    const pct = num(row.prevExp) > 0 ? (num(row.delta) / num(row.prevExp)) * 100 : null;
                    const tone = num(row.delta) > 0 ? 'erp-text-danger' : (num(row.delta) < 0 ? 'erp-text-success' : 'erp-text-muted');
                    const arrow = num(row.delta) > 0 ? '▲' : (num(row.delta) < 0 ? '▼' : '—');
                    const text = pct !== null ? `${round1(pct)}%` : moneyText(row.delta, currency);
                    return `<span class="erp-num ${tone}" dir="ltr">${arrow} ${text}</span>`;
                },
            },
            {
                key: 'detail', header: 'مراجعة', sortable: false, width: '110px', align: 'center',
                render: (row) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail="${esc(row.code)}" data-v2-detail-name="${esc(row.name)}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>تفاصيل</span></button>`,
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function withMargin(list) {
        const prevOwn = prevOwnByDept(previous, list);
        return list.map((row) => {
            const prevExp = num(prevOwn.get(String(row.code)));
            const ownExp = num((row.own || {}).exp);
            return {
                ...row,
                margin: row.rev > 0 ? (row.profit / row.rev) * 100 : 0,
                prevExp,
                delta: ownExp - prevExp,
            };
        });
    }

    /** قنوات البيع (ys_cc_N) ليست أقسامًا: إيرادها أُسند لأقسامه في الخادم
     *  فبقيت صفوفها صفرية — لا تُعرض كأقسام ولا تدخل الرسوم. */
    /** صفوف الجدول على أرقام القسم وحده — لا رقم الشجرة. الشجرة كانت تُدخل
     *  إيراد البيع الخارجي في صف المطبخ ثم تُعيد صف البيع الخارجي وحده،
     *  فيُقرأ الرقم مرتين أمام المالك. «مع فروعه» عمود صريح لمن له فرع. */
    function departmentRows() {
        const familyBy = new Map();
        for (const entry of cardOrder(rows.filter((row) => !row.channel && !row.external))) {
            const ownOf = (r) => r.own || {};
            familyBy.set(String(entry.row.code), {
                rev: num(ownOf(entry.row).rev) + entry.kids.reduce((s, k) => s + num(ownOf(k).rev), 0),
                exp: num(ownOf(entry.row).exp) + entry.kids.reduce((s, k) => s + num(ownOf(k).exp), 0),
                kids: entry.kids.length,
            });
        }
        return rows.filter((row) => !row.channel).map((row) => {
            const own = row.own || {};
            const rev = num(own.rev);
            const exp = num(own.exp);
            const family = familyBy.get(String(row.code)) || { rev: rev, exp: exp, kids: 0 };
            return {
                ...row,
                rev,
                materials: num(own.materials),
                transfers: num(own.transfers),
                countAdj: num(own.countAdj),
                operating: num(own.operating),
                exp,
                profit: rev - exp,
                costRatio: rev > 0 ? (exp / rev) * 100 : 0,
                margin: rev > 0 ? ((rev - exp) / rev) * 100 : 0,
                rowCount: num(own.rowCount),
                family,
            };
        });
    }

    /**
     * سطر الإسناد: من يغذّي إيراد كل قسم. المصدر جدول dept_cashier_links وحده
     * (103) — لا خريطة موازية. القنوات غير المرتبطة تُكشف بالاسم كي لا يضيع
     * إيرادها بصمت.
     */
    function paintAttribution() {
        if (!attrEl) {return;}
        const links = Array.isArray(attribution && attribution.links) ? attribution.links : [];
        const channels = Array.isArray(attribution && attribution.channelRevenue) ? attribution.channelRevenue : [];
        if (!links.length && !channels.length) {
            attrEl.textContent = 'إسناد الكاشير غير متاح الآن — الإيراد يظهر على القنوات كما ورد.';
            return;
        }
        const nameOf = new Map(departmentRows().map((row) => [String(row.code), row.name]));
        const byDept = new Map();
        for (const link of links) {
            const list = byDept.get(link.dept) || [];
            list.push(String(link.cashierNo));
            byDept.set(link.dept, list);
        }
        const parts = [...byDept.entries()].map(([code, nos]) => {
            const label = nameOf.get(code) || code;
            return `<span class="erp-v2-cost__attr-item"><span>${esc(label)}</span> ← <span dir="ltr">${esc(nos.join('، '))}</span></span>`;
        });
        const linkedNos = new Set(links.map((l) => String(l.cashierNo)));
        const orphanNos = channels
            .map((c) => String(c.code).replace(/^ys_cc_/i, ''))
            .filter((no) => !linkedNos.has(no));
        const attributed = channels
            .filter((c) => linkedNos.has(String(c.code).replace(/^ys_cc_/i, '')))
            .reduce((sum, c) => sum + num(c.revenue), 0);
        attrEl.innerHTML = `<span class="erp-v2-cost__attr-label">إسناد الكاشيرات:</span> `
            + (parts.length ? parts.join('<span class="erp-text-muted"> · </span>') : '<span>لا روابط مسجَّلة</span>')
            + (attributed > 0 ? ` <span class="erp-text-muted">— المُسند ${moneyText(attributed, currency)}</span>` : '')
            + (orphanNos.length
                ? ` <span class="erp-text-warning">· كاشير بلا قسم: <span dir="ltr">${esc(orphanNos.join('، '))}</span></span>`
                : '');
    }

    function paintHero(t) {
        const net = num(t.rev) - num(t.exp);
        /* مرآة البيع الخارجي (ys_b4_ext) للمراجعة لا للإحصاء: عدها قسمًا يجعل
           الهيرو يقول «١٧» والشبكة «١٦ بطاقة» أمام ناظر واحد. */
        const deptCount = departmentRows().filter((row) => !row.external).length;
        /* إجمالي السابقة مجموع أرقام الأقسام وحدها، لا مجموع الأسطر الشجرية:
           الشجرة تُعيد تكلفة الفرع مع كل أب، فيُقرأ الانخفاض أضخم من حجمه. */
        const prevTotal = Array.from(prevOwnByDept(previous, rows).values()).reduce((s, v) => s + v, 0);
        const shareOfRev = num(t.rev) > 0 ? (num(t.exp) / num(t.rev)) * 100 : 0;
        const margin = num(t.rev) > 0 ? (net / num(t.rev)) * 100 : 0;
        const from = q('#v2cost-from').value || firstOfMonth();
        const to = q('#v2cost-to').value || riyadhToday();
        const rangeEl = q('[data-v2-range]');
        if (rangeEl) {
            rangeEl.innerHTML = `<span dir="ltr">${esc(from)}</span> ← <span dir="ltr">${esc(to)}</span>`;
        }
        q('[data-v2-hero-grid]').innerHTML = [
            statCard({
                label: 'إجمالي الإيرادات',
                value: moneyCell(t.rev, currency),
                note: `${formatInt(deptCount)} قسمًا مسجلًا`,
                icon: 'banknote', tone: 'brand',
            }),
            statCard({
                label: 'إجمالي التكاليف',
                value: moneyCell(t.exp, currency),
                note: `${round1(shareOfRev)}% من الإيراد`,
                icon: 'wallet', tone: 'danger',
            }),
            statCard({
                label: 'صافي الربح',
                value: moneyCell(net, currency),
                note: `هامش الربح ${round1(margin)}%`,
                icon: net >= 0 ? 'trending-up' : 'trending-down',
                tone: net >= 0 ? 'success' : 'danger',
            }),
            statCard({
                label: 'نسبة التكلفة',
                value: `<span class="erp-num ${costTone(shareOfRev)}" dir="ltr">${round1(shareOfRev)}%</span>`,
                note: 'التكلفة ÷ الإيراد',
                icon: 'pie', tone: toneName(shareOfRev),
            }),
            previous ? statCard({
                label: 'تكلفة الفترة السابقة',
                value: moneyCell(prevTotal, currency),
                noteHtml: (() => {
                    const diff = num(t.exp) - prevTotal;
                    const pct = prevTotal > 0 ? (diff / prevTotal) * 100 : 0;
                    const arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '—');
                    const tone = diff > 0 ? 'danger' : (diff < 0 ? 'success' : 'neutral');
                    return `<span class="erp-text-${tone === 'neutral' ? 'muted' : tone}" dir="ltr">${arrow} ${round1(Math.abs(pct))}%</span> · ${esc(previous.from)} → ${esc(previous.to)}`;
                })(),
                icon: 'history', tone: 'warning',
            }) : '',
        ].join('');
    }

    function paintKpis(t) {
        kpisEl.innerHTML = [
            kpiCard('صرف مخزون (صافي المرتجعات)', moneyCell(t.mat, currency), 'package'),
            kpiCard('تحويلات بين الأقسام (موقَّعة)', moneyCell(t.trn, currency, true), 'arrow-left-right'),
            kpiCard('عجز / زيادة الجرد', moneyCell(t.cnt, currency, true), 'clipboard-list'),
            kpiCard('مصروفات تشغيلية', moneyCell(t.ops, currency), 'pen-tool'),
            kpiCard('تصنيفات المصروف', `<span class="erp-num" dir="ltr">${formatInt(categories.length)}</span>`, 'layers'),
        ].join('');
    }

    /** الكاشيريات لكل قسم من dept_cashier_links وحده، مع إيراد قناتها ys_cc_N.
     *  البيع الخارجي يظهر بكاشيريه ٤ و٥ داخل بطاقته المستقلة، لا داخل بطاقة
     *  المطبخ — فالرابط على القسم لا على أبيه. */
    function cashiersByDept() {
        const map = new Map();
        const links = Array.isArray(attribution && attribution.links) ? attribution.links : [];
        const channels = Array.isArray(attribution && attribution.channelRevenue) ? attribution.channelRevenue : [];
        const revenueOf = new Map(channels.map((c) => [String(c.code), num(c.revenue)]));
        for (const link of links) {
            const code = String(link.dept);
            const no = String(link.cashierNo);
            const bucket = map.get(code) || [];
            bucket.push({
                no,
                primary: Boolean(link.primary),
                revenue: num(revenueOf.has(`ys_cc_${no}`) ? revenueOf.get(`ys_cc_${no}`) : revenueOf.get(no)),
            });
            map.set(code, bucket);
        }
        for (const bucket of map.values()) {
            bucket.sort((a, b) => (Number(b.primary) - Number(a.primary))
                || (b.revenue - a.revenue)
                || (Number(a.no) - Number(b.no)));
        }
        return map;
    }

    function paintCards(t) {
        if (!cardsGridEl) {return;}
        /* مرآة البيع الخارجي (ys_b4_ext) وقنوات الكاشير (ys_cc_N) ليست أقسامًا
           تشغيلية: لها صفوف في الجدول للمراجعة، وبطاقة واحدة توهم بالازدواج. */
        const list = rows.filter((row) => !row.channel && !row.external);
        if (!list.length) {
            cardsGridEl.innerHTML = '<div class="erp-v2-cost-card erp-v2-cost-card--empty">لا توجد أقسام مسجلة</div>';
            if (cardsQuietEl) {cardsQuietEl.hidden = true;}
            if (cardsNoteEl) {cardsNoteEl.textContent = '';}
            return;
        }
        const cashiers = cashiersByDept();
        const prevOwn = prevOwnByDept(previous, list);
        const nameOf = new Map(list.map((row) => [String(row.code), String(row.name)]));
        const activityOf = (row) => num((row.own || {}).rev) > 0.005
            || num((row.own || {}).exp) > 0.005
            || (cashiers.get(String(row.code)) || []).length > 0;
        const render = (entry) => deptCardHtml({
            row: entry.row,
            depth: entry.depth,
            currency,
            totals: t,
            cashiers: cashiers.get(String(entry.row.code)) || [],
            parentName: entry.row.parent ? String(nameOf.get(String(entry.row.parent)) || entry.row.parent) : '',
            previous,
            prevOwn,
            family: { kids: entry.kids },
        });
        /* ذيل مدمج للأقسام الصفرية: بطاقة الحركة تبقى في أعلى الشبكة،
           فلا يُدفن البيع الخارجي تحت أحد عشر قسمًا بلا إيراد ولا مصروف. */
        const entries = cardOrder(list);
        const quietOf = (entry) => !activityOf(entry.row) && !entry.kids.some(activityOf);
        const active = entries.filter((entry) => !quietOf(entry));
        const quiet = entries.filter(quietOf);
        cardsGridEl.innerHTML = active.map(render).join('')
            || '<div class="erp-v2-cost-card erp-v2-cost-card--empty">لا حركة لأقسامك في هذه الفترة</div>';
        if (cardsQuietEl && cardsQuietGridEl) {
            cardsQuietEl.hidden = !quiet.length;
            cardsQuietGridEl.innerHTML = quiet.map(render).join('');
            if (cardsQuietTitleEl) {cardsQuietTitleEl.textContent = `أقسام بلا حركة في الفترة (${formatInt(quiet.length)})`;}
        }
        if (cardsNoteEl) {
            const linked = list.filter((row) => (cashiers.get(String(row.code)) || []).length).length;
            const moving = list.filter(activityOf).length;
            cardsNoteEl.textContent = `${formatInt(list.length)} بطاقة · ${formatInt(moving)} بق حركة · ${formatInt(linked)} قسمًا مرتبطًا بكاشير`;
        }
    }

    function paintMix(t) {
        const total = num(t.exp);
        const items = [
            { label: 'صرف المخزون', value: num(t.mat), tone: 'brand' },
            { label: 'تحويلات بين الأقسام', value: num(t.trn), tone: 'neutral' },
            { label: 'فروق الجرد', value: num(t.cnt), tone: 'warning' },
            { label: 'مصروفات تشغيلية', value: num(t.ops), tone: 'success' },
        ];
        q('[data-v2-mix-total]').textContent = `الإجمالي ${moneyText(total, currency)}`;
        mixEl.innerHTML = items.map((item) => {
            const ofCost = total > 0 ? (item.value / total) * 100 : 0;
            const ofRev = num(t.rev) > 0 ? (item.value / num(t.rev)) * 100 : 0;
            const bar = Math.max(0, Math.min(100, Math.abs(ofCost)));
            return `<li class="erp-v2-cost__mix-row" data-tone="${item.tone}">
              <div class="erp-v2-cost__mix-top">
                <span class="erp-v2-cost__mix-label">${esc(item.label)}</span>
                <span class="erp-v2-cost__mix-value">${moneyCell(item.value, currency)}</span>
              </div>
              <div class="erp-v2-cost__mix-bar"><span style="--mix:${round1(bar)}%"></span></div>
              <div class="erp-v2-cost__mix-meta">
                <span>${round1(ofCost)}% من التكلفة</span>
                <span>${round1(ofRev)}% من الإيراد</span>
              </div>
            </li>`;
        }).join('');
    }

    function paintRank() {
        const ranked = departmentRows()
            .filter((row) => num(row.exp) > 0)
            .sort((a, b) => num(b.exp) - num(a.exp))
            .slice(0, 5);
        const top = ranked.length ? num(ranked[0].exp) : 0;
        q('[data-v2-rank-note]').textContent = ranked.length ? `أعلى ${formatInt(ranked.length)}` : '';
        rankEl.innerHTML = ranked.length
            ? ranked.map((row, index) => {
                const v = verdict(row);
                const share = top > 0 ? Math.max(2, Math.min(100, (num(row.exp) / top) * 100)) : 0;
                const ratio = num(row.rev) > 0
                    ? `${round1(row.costRatio)}% من الإيراد`
                    : 'مركز تكلفة';
                return `
              <li class="erp-v2-cost__rank-row">
                <span class="erp-v2-cost__rank-no" aria-hidden="true">${index + 1}</span>
                <span class="erp-v2-cost__rank-body">
                  <span class="erp-v2-cost__rank-name">${esc(row.name)}</span>
                  <span class="erp-v2-cost__rank-sub">${moneyText(row.exp, currency)} · ${ratio}</span>
                  <span class="erp-v2-cost__rank-bar" aria-hidden="true"><span style="--rank:${round1(share)}%"></span></span>
                </span>
                <span class="erp-badge" data-tone="${v.tone}">${v.label}</span>
              </li>`;
            }).join('')
            : '<li class="erp-v2-cost__rank-empty">لا تكاليف مسجلة في هذه الفترة</li>';
    }

    function paintFlow() {
        if (!flowEl) {return;}
        const f = flow || {};
        const src = Array.isArray(f.bySource) ? f.bySource : [];
        const dst = Array.isArray(f.byDest) ? f.byDest : [];
        if (!src.length && !dst.length) {flowEl.hidden = true; flowEl.style.display = 'none'; return;}
        flowEl.hidden = false;
        flowEl.style.display = '';
        const total = num(f.total);
        if (flowTotalEl) {
            flowTotalEl.textContent = `${formatInt(num(f.transfers))} تحويل · ${moneyText(total, currency)}`;
        }
        const list = (items) => (items.length
            ? items.slice(0, 6).map((r) => {
                const v = num(r.value);
                const pct = total > 0 ? Math.max(2, Math.min(100, (Math.abs(v) / total) * 100)) : 0;
                return `<li class="erp-v2-cost__mix-row">
                  <div class="erp-v2-cost__mix-top">
                    <span class="erp-v2-cost__mix-label">${esc(r.dept_name || r.dept_code || 'غير محدد')}</span>
                    <span class="erp-v2-cost__mix-value">${moneyCell(v, currency)}</span>
                  </div>
                  <div class="erp-v2-cost__mix-bar"><span style="--mix:${round1(pct)}%"></span></div>
                  <div class="erp-v2-cost__mix-meta">
                    <span>${formatInt(num(r.transfers))} تحويل</span>
                    <span>${round1(num(r.qty))} كمية</span>
                  </div>
                </li>`;
            }).join('')
            : '<li class="erp-v2-cost__rank-empty">لا حركة في هذه الفترة</li>');
        flowSrcEl.innerHTML = list(src);
        flowDstEl.innerHTML = list(dst);
    }

    /* ── مراجعة تفاصيل تكلفة قسم ────────────────────────────────────────
       البنود خلف الرقم: أي حركة، أي فئة، أي تاريخ، وقيد التكلفة. */
    const BUCKET_LABELS = {
        materials: 'صرف مخزون',
        transfers: 'تحويلات بين الأقسام',
        countAdj: 'فروق جرد',
        operating: 'مصروفات تشغيلية',
    };

    function paintDetail(name) {
        if (!detailEl) {return;}
        const d = detail || {};
        const items = Array.isArray(d.items) ? d.items : [];
        if (!items.length) {
            detailEl.hidden = false;
            detailEl.innerHTML = `<div class="erp-v2-cost__register-head"><h4>تفاصيل تكلفة ${esc(name || d.code || '')}</h4></div>
                <div class="erp-v2-cost__rank-empty">لا توجد حركات تكلفة مسجلة لهذا القسم في الفترة.</div>`;
            return;
        }
        const buckets = d.buckets || {};
        const bucketCards = Object.keys(BUCKET_LABELS).map((k) => `
          <div class="erp-v2-cost__stat">
            <div class="erp-v2-cost__stat-body">
              <span class="erp-v2-cost__stat-label">${esc(BUCKET_LABELS[k])}</span>
              <span class="erp-v2-cost__stat-value">${esc(moneyText(num(buckets[k]), currency))}</span>
            </div>
          </div>`).join('');
        const body = items.map((it) => `
          <tr>
            <td>${esc(it.date || '—')}</td>
            <td>${esc(it.description || it.notes || '—')}</td>
            <td>${esc(it.category || '—')}</td>
            <td>${esc(it.adjustmentType || '—')}</td>
            <td>${esc(it.deptCode || '—')}</td>
            <td>${moneyCell(it.amount, currency, true)}</td>
          </tr>`).join('');
        detailEl.hidden = false;
        // النص يُبنى ثم يُسنَد: كل ظهور من البيانات يمر عبر esc() داخل
        // البناء، والبقية هياكل ثابتة من نفس الدالة.
        const markup = `
          <div class="erp-v2-cost__register-head">
            <h4>تفاصيل تكلفة ${esc(name || d.code || '')} — ${esc(moneyText(num(d.total), currency))}</h4>
            <span class="erp-v2-cost__register-total">${esc(String(items.length))} حركة</span>
          </div>
          <div class="erp-v2-cost__hero-grid" style="margin-block-start:var(--erp-space-2)">${bucketCards}</div>
          <div style="overflow-x:auto;margin-block-start:var(--erp-space-3)">
            <table class="erp-table">
              <thead><tr>
                <th scope="col">التاريخ</th><th scope="col">البيان</th><th scope="col">الفئة</th>
                <th scope="col">نوع القيد</th><th scope="col">القسم</th><th scope="col">المبلغ</th>
              </tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>`;
        detailEl.innerHTML = markup;
    }

    async function openDeptDetail(code, name, scroll = true) {
        if (!detailEl) {return;}
        detailSelection = { code, name };
        const requestId = ++detailRequestId;
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        detailEl.hidden = false;
        detailEl.innerHTML = `<div class="erp-v2-cost__register-head"><h4>تفاصيل تكلفة ${esc(name || code)}</h4></div>
            <div class="erp-v2-cost__rank-empty">جارٍ تحميل حركات التكلفة…</div>`;
        if (scroll) {detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });}
        try {
            const res = await fetchCostAnalysisDept(code, from, to);
            if (!el.isConnected || requestId !== detailRequestId) {return;}
            detail = res && typeof res === 'object' ? res : null;
            paintDetail(name);
        } catch (e) {
            if (!el.isConnected || requestId !== detailRequestId) {return;}
            detail = null;
            detailEl.innerHTML = `<div class="erp-v2-cost__register-head"><h4>تفاصيل تكلفة ${esc(name || code)}</h4></div>
                <div class="erp-v2-cost__rank-empty">تعذر تحميل التفاصيل: ${esc(e && e.message ? e.message : '')}</div>`;
        }
    }

    function paint() {
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        const t = totals || { rev: 0, mat: 0, trn: 0, cnt: 0, ops: 0, exp: 0, avgCost: 0 };
        paintHero(t);
        paintKpis(t);
        paintCards(t);
        paintMix(t);
        paintRank();
        paintFlow();
        paintAttribution();
        const totalEl = q('[data-v2-register-total]');
        if (totalEl) {
            totalEl.innerHTML = totals
                ? `<span>إجمالي التكاليف</span><strong class="erp-num" dir="ltr">${moneyText(num(t.exp), currency)}</strong>`
                : '';
        }

        const visible = departmentRows();
        if (!visible.length) {
            chartsEl.innerHTML = '';
            summaryEl.textContent = 'لا توجد أقسام مسجلة.';
            table.setRows([]);
            return;
        }

        const chartRows = visible.slice()
            .sort((a, b) => (num(b.rev) + num(b.exp)) - (num(a.rev) + num(a.exp)))
            .slice(0, 8);
        chartsEl.innerHTML = [
            barChart({
                title: visible.length > chartRows.length
                    ? `مقارنة أعلى ${formatInt(chartRows.length)} أقسام`
                    : 'الإيرادات مقابل التكلفة حسب القسم',
                ariaLabel: visible.length > chartRows.length
                    ? `أعمدة الإيرادات والتكلفة لأعلى ${chartRows.length} أقسام`
                    : 'أعمدة الإيرادات والتكلفة الإجمالية لكل قسم',
                labels: chartRows.map((r) => r.name),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: chartRows.map((r) => r.rev) },
                    { label: 'التكلفة الإجمالية', tone: 'danger', values: chartRows.map((r) => r.exp) },
                ],
                formatValue: (v) => moneyText(v, currency),
                emptyText: 'لا أقسام في هذه الفترة',
            }),
            donutChart({
                title: 'توزيع بنود التكلفة بالتصنيف',
                ariaLabel: 'رسم دائري لنسب تصنيفات المصروفات في الفترة',
                slices: categories,
                centerLabel: 'إجمالي المصروفات',
                formatValue: (v) => moneyText(v, currency),
                maxSlices: 8,
                emptyText: 'لا مصروفات في هذه الفترة',
            }),
        ].join('');

        summaryEl.textContent = `${formatInt(visible.length)} قسمًا · ${from || firstOfMonth()} → ${to || riyadhToday()}`;
        table.setRows(visible);
    }

    async function printSheet(button) {
        if (button) {button.disabled = true;}
        try {
            const html = await fetchCostAnalysisPrintHtml(
                q('#v2cost-from').value, q('#v2cost-to').value,
            );
            const viewer = openInAppReport('تحليل التكاليف');
            viewer.document.write(html);
            viewer.document.close();
        } catch (e) {
            ctx.notify?.((e && e.message) || 'تعذر تجهيز المستند للطباعة', 'error');
        } finally {
            if (button && button.isConnected) {button.disabled = false;}
        }
    }

    async function reload() {
        if (loading) {return;}
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        if (Boolean(from) !== Boolean(to)) {
            summaryEl.textContent = 'تاريخ البداية والنهاية مطلوبان معًا.';
            if (detailSelection) {
                detailRequestId += 1;
                detail = null;
                detailEl.hidden = true;
            }
            return;
        }
        if (detailSelection) {
            detailRequestId += 1;
            detail = null;
            detailEl.hidden = true;
        }
        loading = true;
        table.setLoading(true);
        summaryEl.textContent = 'جارٍ التجميع…';
        q('#v2cost-from').disabled = true;
        q('#v2cost-to').disabled = true;
        q('[data-v2-reload]').disabled = true;
        q('[data-v2-month]').disabled = true;
        try {
            const [result, cur] = await Promise.all([
                fetchCostAnalysis(from, to),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            previous = result && result.previous && typeof result.previous === 'object' ? result.previous : null;
            rows = withMargin(Array.isArray(result && result.rows) ? result.rows : []);
            categories = Array.isArray(result && result.categories) ? result.categories : [];
            attribution = result && result.attribution && typeof result.attribution === 'object'
                ? result.attribution
                : { links: [], channelRevenue: [] };
            totals = result && result.totals ? result.totals : null;
            flow = result && result.flow && typeof result.flow === 'object' ? result.flow : null;
            if (!totals) {throw new Error('استجابة تحليل التكاليف غير مكتملة من الخادم');}
            paint();
            if (detailSelection) {
                void openDeptDetail(detailSelection.code, detailSelection.name, false);
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            totals = null;
            rows = [];
            categories = [];
            flow = null;
            paint();
            summaryEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض تحليل التكاليف بهذا الحساب.'
                    : `تعذّر حساب التحليل: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
            if (el.isConnected) {
                q('#v2cost-from').disabled = false;
                q('#v2cost-to').disabled = false;
                q('[data-v2-reload]').disabled = false;
                q('[data-v2-month]').disabled = false;
            }
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-month]')) {
            q('#v2cost-from').value = firstOfMonth();
            q('#v2cost-to').value = riyadhToday();
            reload();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {
            printSheet(event.target.closest('[data-v2-print]'));
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload(); return;}
        const detailBtn = event.target.closest('button[data-v2-detail]');
        if (detailBtn) {
            openDeptDetail(detailBtn.getAttribute('data-v2-detail'), detailBtn.getAttribute('data-v2-detail-name'));
        }
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2cost-from, #v2cost-to')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getTotals: () => totals,
        destroy() {
            detailRequestId += 1;
            table.destroy();
            el.remove();
        },
    };
}
