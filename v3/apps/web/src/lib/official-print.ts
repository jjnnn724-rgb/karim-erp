/**
 * official-print.ts — ورقة A4 رسمية «شركة محترمة» (هوية كربون + ذهبي)
 * ─────────────────────────────────────────────
 * لغة واحدة مع إذن الصرف: شريط كربوني/ذهبي بشارة الشعار، عناوين قابلة
 * للقراءة باللغة العربية والإنجليزية، شبكة KPI عصرية، وجداول بحد أحمر أو
 * كريمي — كل ورقة تخرج من النظام تبدو واحدة ولا لعازة فيها.
 *
 * هذه هي نفس الروح التي اتّبعها `dispatch-print.ts` (إصلاح v4.9.361)،
 * ووسّعناها هنا لبقية المستندات: تقارير الذكاء الاصطناعي، وضع القسم،
 * تكلفة الإفطار، وربط سلسلة الاعتماد بخانة توقيع فارغة رسمية.
 */

const escape = (v: unknown): string =>
    String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface OfficialSheetKpi {
    label: string;
    value: string;
    hint?: string;
}

export interface OfficialSheetColumn {
    key: string;
    header: string;
    align?: 'start' | 'center' | 'end';
    width?: string;
}

export interface OfficialSheetSection {
    heading: string;
    columns?: OfficialSheetColumn[];
    rows?: Array<Record<string, string | number>>;
    totalsRow?: Array<Record<string, string | number> | string>;
    list?: string[];
    note?: string;
}

export interface OfficialSheetInput {
    /** عنوان المستند (عربي رسمي) */
    title: string;
    englishTitle?: string;
    subtitle?: string;
    from?: string;
    to?: string;
    /** رقم المستند (الافتراضي مُولَّد تلقائيًا) */
    ref?: string;
    /** ختم دائرة فوق عنوان المستند («معتمد» / «مكتمل»…) — اختياري */
    stamp?: string;
    /** مجموعة KPI */
    kpis?: OfficialSheetKpi[];
    sections: OfficialSheetSection[];
    /** ملاحظات ختامية */
    notes?: string[];
    /** سطر توقيع (افتراضي: إعداد/مراجعة/اعتماد) */
    signatures?: Array<{ role: string; name?: string }>;
}

const COMPANY_AR = 'شركة مطاعم الشرفة العالمي';
const COMPANY_EN = 'AL SHURFA AL ALAMI RESTAURANTS';
const COMPANY_SUB = 'نظام Karim ERP للإدارة المتكاملة';
const GOLD = '#c8a24a';
const GOLD_DEEP = '#fff3c4';
const GOLD_SOFT = '#e0c56f';
const CARBON = '#0d0f0b';
const CARBON_EDGE = '#1c241c';
const INK = '#14231f';
const CREAM = '#faf8ee';

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function stampDate(): string {
    const now = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function autoRef(title: string): string {
    const now = new Date();
    const stamp = todayIso().replace(/-/g, '');
    const seq = String(now.getTime() % 10000).padStart(4, '0');
    const code = String(title || 'doc').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'DOC';
    return `${code}-${stamp}-${seq}`;
}

function signatureCards(signatures: Array<{ role: string; name?: string }>): string {
    return `<div class="signatures">${signatures.map((s) => `
        <div class="sig-box">
            <span class="sig-role">${escape(s.role)}</span>
            <span class="sig-line"></span>
            <span class="sig-name">${escape(s.name ?? 'التوقيع / التاريخ')}</span>
        </div>`).join('')}</div>`;
}

export function buildOfficialSheetHtml(input: OfficialSheetInput): string {
    const from = input.from ?? '';
    const to = input.to ?? '';
    const ref = input.ref ?? autoRef(input.title);
    const signatures = input.signatures ?? [{ role: 'إعداد الطلب' }, { role: 'مراجعة المسؤول' }, { role: 'الاعتماد' }];

    const kpiHtml = input.kpis && input.kpis.length
        ? `<div class="kpis">${input.kpis.map((k) => `
            <div class="kpi"><span class="kpi-label">${escape(k.label)}</span>
                <strong class="kpi-value">${escape(k.value)}</strong>
                ${k.hint ? `<span class="kpi-hint">${escape(k.hint)}</span>` : ''}
            </div>`).join('')}</div>`
        : '';

    const sectionsHtml = input.sections.map((section) => {
        const parts: string[] = [];
        parts.push(`<h2 class="section-title">${escape(section.heading)}</h2>`);
        if (section.columns && section.rows?.length) {
            const cols = section.columns;
            const hasTotals = Array.isArray(section.totalsRow) && section.totalsRow.length > 0;
            parts.push(`
            <table class="sheet">
              <thead><tr>${cols.map((c) => `<th style="${c.width ? `width:${c.width};` : ''}text-align:${c.align ?? 'right'}">${escape(c.header)}</th>`).join('')}</tr></thead>
              <tbody>
${section.rows.map((row) => `                <tr>${cols.map((c) => `<td style="text-align:${c.align ?? 'right'}">${escape(row[c.key])}</td>`).join('')}</tr>`).join('\n')}
${hasTotals && section.totalsRow ? `                <tr class="totals-row">${section.totalsRow.map((cell, i) => {
    const col = cols[i];
    const key = col?.key ?? String(i);
    const value = typeof cell === 'string' ? cell : cell[key];
    return `<td style="text-align:${col?.align ?? 'right'}">${escape(value)}</td>`;
}).join('')}</tr>` : ''}
              </tbody>
            </table>`);
        }
        if (section.list?.length) {
            parts.push(`<ul class="bullets">${section.list.map((li) => `<li>${escape(li)}</li>`).join('')}</ul>`);
        }
        if (section.note) {
            parts.push(`<p class="section-note">${escape(section.note)}</p>`);
        }
        return `<section class="sheet-section">${parts.join('\n')}</section>`;
    }).join('\n');

    const notesHtml = input.notes?.length
        ? `<div class="notes">${input.notes.map((n) => `<p>◆ ${escape(n)}</p>`).join('')}</div>`
        : '';

    const printedStamp = stampDate();

    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${escape(input.title)} — ${escape(COMPANY_AR)}</title>
<style>
  @page { size: A4 portrait; margin: 11mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
      margin: 0; padding: 24px 12px 48px; direction: rtl;
      font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      color: ${INK}; background: #e9ebe8; font-size: 10pt;
  }
  .sheet {
      max-width: 830px; margin: auto; background: #fff;
      border: 1px solid #d8d2c2; border-radius: 16px;
      box-shadow: 0 14px 40px rgb(15 32 27 / 0.18);
      padding: 0 0 16px; overflow: hidden;
  }
  /* ── الشريط الافتتاحي: كربون × ذهبي ── */
  .sheet-head {
      display: flex; align-items: center; gap: 18px;
      background: linear-gradient(135deg, ${CARBON} 0%, #131a12 55%, ${CARBON_EDGE} 100%);
      border-bottom: 4px solid ${GOLD}; padding: 18px 26px;
  }
  .sheet-logo {
      width: 80px; height: 80px; object-fit: contain; flex: 0 0 auto;
      background: #fff; border: 2px solid ${GOLD}; border-radius: 14px;
      padding: 5px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
  }
  .sheet-brand { display: flex; flex-direction: column; gap: 3px; }
  .sheet-company-ar { font-size: 19.5pt; font-weight: 900; color: #f5efdc; letter-spacing: -0.01em; line-height: 1.18; }
  .sheet-company-en { font-size: 7.5pt; font-weight: 800; letter-spacing: 0.22em; color: ${GOLD}; text-transform: uppercase; }
  .sheet-company-sub { font-size: 6.5pt; color: rgb(245 239 220 / 0.55); }
  .sheet-ref { margin-inline-start: auto; text-align: end; color: #d9cfa8; font-size: 7pt; line-height: 1.75; }
  .sheet-ref b { display: block; font-size: 12pt; color: ${GOLD_DEEP}; font-variant-numeric: tabular-nums; letter-spacing: 0.05em; }
  /* ── ترويسة المستند ── */
  .doc-headline {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 18px;
      padding: 16px 24px 4px; border-bottom: 1px solid #e3ded0;
  }
  .doc-eyebrow { position: absolute; inset-block-start: 10px; inset-inline-start: 28px; font-size: 6.5pt; letter-spacing: 0.30em; font-weight: 800; color: #8a6b2f; }
  .doc-title { margin: 8px 0 0; font-size: 26pt; font-weight: 900; color: ${CARBON}; }
  .doc-sub { font-size: 8pt; color: #6b6556; }
  .stamp {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 6px 16px; border-radius: 999px; font-size: 10pt; font-weight: 900;
      background: ${CARBON}; color: ${GOLD_DEEP}; border: 1.8px solid ${GOLD};
      box-shadow: 0 2px 10px rgb(0 0 0 / 0.22);
  }
  .period-line { text-align: center; font-size: 9pt; color: #34362c; padding: 5px 0; border-block-start: 1px solid #e3ded0; border-block-end: 1px solid #e3ded0; margin-block: 4px 8px; background: ${CREAM}; }
  .period-line b { color: #4b3810; }
  /* ── شبكة KPI العصرية ── */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; padding: 12px 26px 4px; }
  .kpi {
      border: 1px solid #e2ddd0; border-block-start: 4px solid ${GOLD}; border-radius: 10px;
      background: #fdfcf8; padding: 6px 10px; text-align: center;
  }
  .kpi-label { font-size: 7pt; font-weight: 800; color: #8a6b2f; display: block; letter-spacing: 0.03em; }
  .kpi-value { font-size: 15pt; font-weight: 900; color: ${INK}; font-variant-numeric: tabular-nums; }
  .kpi-hint { font-size: 6pt; color: #8a8672; display: block; margin-top: 1px; }
  /* ── الأقسام ── */
  .sheet-section { padding: 8px 26px 0; break-inside: avoid; page-break-inside: avoid; }
  .section-title {
      font-size: 11pt; font-weight: 900; color: ${CARBON};
      border-bottom: 2.4px solid ${GOLD}; padding-bottom: 4px; margin-bottom: 6px; letter-spacing: 0.01em;
  }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .sheet thead th {
      background: ${CARBON}; color: ${GOLD_SOFT}; font-size: 8pt; font-weight: 800; letter-spacing: 0.04em;
      border: 1px solid ${CARBON}; padding: 5px 7px; text-align: right;
  }
  .sheet td { border: 1px solid #d9d5c8; padding: 4px 7px; text-align: right; font-variant-numeric: tabular-nums; }
  .sheet tbody tr:nth-child(even) td { background: ${CREAM}; }
  .sheet .totals-row td {
      background: ${CARBON} !important; color: ${GOLD_DEEP}; font-weight: 900;
      border: 1px solid ${CARBON}; font-size: 9pt; padding: 6px 7px;
  }
  .bullets { margin: 4px 0 0; padding-inline-start: 22px; font-size: 8pt; }
  .bullets li { margin-bottom: 2px; }
  .section-note { font-size: 7.5pt; color: #6b6556; border: 1px dashed #c8ae74; border-radius: 6px; padding: 4px 8px; margin-top: 6px; background: #fffdf4; }
  /* ── ملاحظات ختامية ── */
  .notes { margin: 10px 26px 0; border: 1px solid #e2ddd0; border-inline-start: 4px solid ${GOLD};
      border-radius: 10px; background: #fdfaf0; padding: 8px 12px; font-size: 7.6pt; color: #5c563f; line-height: 1.9; }
  .notes p { margin: 0 0 2px; }
  .notes p:last-child { margin-bottom: 0; }
  /* ── سطر التوقيع الرسمي ── */
  .signatures { display: flex; gap: 14px; padding: 14px 26px 0; break-inside: avoid; }
  .sig-box {
      flex: 1; border: 1px solid #e2ddd0; border-block-start: 3px solid ${GOLD}; border-radius: 10px;
      background: #fdfcf8; padding: 8px 8px 10px; display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center;
  }
  .sig-role { font-size: 8.5pt; font-weight: 800; color: #4b4433; }
  .sig-line { width: 78%; border-bottom: 1.6px dotted #a89e7c; height: 34px; }
  .sig-name { font-size: 6.5pt; color: #8a8672; }
  /* ── ذيل الورقة ── */
  .sheet-foot {
      margin-top: 12px; border-top: 1.6px solid ${GOLD}; padding: 8px 26px 0;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      font-size: 6.5pt; color: #6b6556;
  }
  .sheet-foot b { color: ${INK}; }
  /* ── أزرار الشاشة فقط ── */
  .controls { position: fixed; inset-block-start: 10px; inset-inline-start: 10px; display: flex; gap: 8px; z-index: 20; }
  .controls button {
      border: 0; border-radius: 8px; padding: 8px 18px; font: inherit; font-weight: 800; cursor: pointer;
      background: ${CARBON}; color: ${GOLD_DEEP}; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  }
  .controls button.ghost { background: #555; color: #fff; }
  @media print {
      body { padding: 0; background: #fff; }
      .sheet { box-shadow: none; border: 0; border-radius: 0; max-width: none; }
      .controls { display: none !important; }
      .sheet-head, .sheet thead th, .totals-row td, .status-stamp, .stamp {
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
  }
</style></head><body>
<div class="controls"><button type="button" onclick="window.print()">طباعة الآن</button><button type="button" class="ghost" onclick="window.close()">إغلاق</button></div>
<article class="sheet">
  <header class="sheet-head">
    <img class="sheet-logo" src="/app/assets/karim-logo.png" alt="شعار الشركة" />
    <div class="sheet-brand">
      <div class="sheet-company-ar">${COMPANY_AR}</div>
      <div class="sheet-company-en" lang="en" dir="ltr">${COMPANY_EN}</div>
      <div class="sheet-company-sub">${COMPANY_SUB}</div>
    </div>
    <div class="sheet-ref">
      <small>رقم المستند</small>
      <b dir="ltr">${escape(ref)}</b>
      <span>زمن الطباعة: <span dir="ltr">${escape(printedStamp)}</span></span>
    </div>
  </header>

  <div class="doc-headline">
    <span class="doc-eyebrow" lang="en" dir="ltr">${escape(input.englishTitle ?? 'OFFICIAL DOCUMENT')}</span>
    <div>
      <h1 class="doc-title">${escape(input.title)}</h1>
      ${input.subtitle ? `<div class="doc-sub">${escape(input.subtitle)}</div>` : ''}
    </div>
    ${input.stamp ? `<span class="stamp">${escape(input.stamp)}</span>` : ''}
  </div>
  ${(from || to) ? `<div class="period-line">الفترة: <b>${escape(from || 'بداية السجل')}</b> ← <b>${escape(to || 'اليوم')}</b></div>` : ''}

  ${kpiHtml}
  ${sectionsHtml}
  ${notesHtml}
  ${signatureCards(signatures)}

  <footer class="sheet-foot">
    <span><b>${COMPANY_AR}</b> — ${COMPANY_SUB}</span>
    <span>مستند رسمي داخلي — للاستخدام الرسمي فقط</span>
    <span dir="ltr">${escape(ref)}</span>
  </footer>
</article>
</body></html>`;
}

/** فتح المستند في تبويب مستقل مع زر الطباعة والتلقائية. */
export function printOfficialSheet(input: OfficialSheetInput): boolean {
    const html = buildOfficialSheetHtml(input);
    const win = window.open('', '_blank', 'width=1000,height=1100');
    if (!win) {
        return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 350);
    return true;
}
