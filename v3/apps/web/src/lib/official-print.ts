/**
 * official-print.ts — ورقة A4 رسمية «شركة محترمة» (ليست لقطة شاشة)
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «شكل الطباعة زي شركة محترمة — مش سكرين».
 * الإجابة: وثيقة A4 كاملة نبنيها بأنفسنا — رأس شعار + اسم الشركة + رقم
 * الوثيقة + الموعد + جدول بأعمدة + خانات توقيع (إعداد/مراجعة/اعتماد) +
 * تذييل برقم الصفحة والختم. تُطبع بدل التقاط الشاشة.
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
    /** عنوان الوثيقة (بالعربية والإنجليزية) */
    title: string;
    englishTitle?: string;
    subtitle?: string;
    from?: string;
    to?: string;
    /** مرجع الوثيقة (يولّد تلقائيًا إن لم يُمرّر) */
    ref?: string;
    /** خانات KPI */
    kpis?: OfficialSheetKpi[];
    sections: OfficialSheetSection[];
    /** ملاحظات منهجية (صغيرة أسفل الجداول) */
    notes?: string[];
    /** وجهة التوقيعات (اختياري) */
    signatures?: Array<{ role: string; name?: string }>;
}

const COMPANY_AR = 'مطاعم الشرفة العالمي';
const COMPANY_EN = 'AL SHURFA AL ALAMI AL RESTAURANTS';
const COMPANY_LINE2 = 'كاريم ERP · KARIM ERP';

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function autoRef(title: string): string {
    const now = new Date();
    const stamp = todayIso().replace(/-/g, '');
    // عدد عشوائي غير مكرر: آخر ٤ أرقام من الطابع الزمني
    const seq = String(now.getTime() % 10000).padStart(4, '0');
    const code = String(title || 'doc').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'DOC';
    return `${code}-${stamp}-${seq}`;
}

export function buildOfficialSheetHtml(input: OfficialSheetInput): string {
    const from = input.from ?? '';
    const to = input.to ?? '';
    const ref = input.ref ?? autoRef(input.title);
    const signatures = input.signatures ?? [{ role: 'إعداد' }, { role: 'مراجعة' }, { role: 'اعتماد' }];

    const kpiHtml = input.kpis && input.kpis.length
        ? `<div class="kpis">${input.kpis.map((k) => `
            <div class="kpi"><span class="kpi-label">${escape(k.label)}</span>
                <strong class="kpi-value">${escape(k.value)}</strong>
                ${k.hint ? `<span class="kpi-hint">${escape(k.hint)}</span>` : ''}
            </div>`).join('')}
        </div>`
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
        ? `<div class="notes">${input.notes.map((n) => `<p>• ${escape(n)}</p>`).join('')}</div>`
        : '';

    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${escape(input.title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm 16mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #111; margin: 0; font-size: 10.5pt; }

  /* ── الترويسة: شعار + اسم الشركة عربي/لاتيني ───────────────────────── */
  .letterhead { display: flex; align-items: center; gap: 16px; border-bottom: 2.6px double #0f3d3e; padding-bottom: 10px; margin-bottom: 8px; }
  .letterhead img { width: 64px; height: 64px; object-fit: contain; }
  .lh-company { display: flex; flex-direction: column; gap: 2px; }
  .lh-ar { font-size: 19pt; font-weight: 800; color: #0f3d3e; letter-spacing: -0.01em; line-height: 1.15; }
  .lh-en { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.06em; color: #34414e; text-transform: uppercase; }
  .lh-sub { font-size: 8pt; color: #5b6773; letter-spacing: 0.02em; }
  .lh-ref { margin-inline-start: auto; text-align: end; font-size: 9pt; color: #34414e; line-height: 1.6; }
  .lh-ref strong { font-size: 11pt; color: #0f3d3e; font-variant-numeric: tabular-nums; }

  .doc-title { text-align: center; margin: 10px 0 2px; font-size: 17pt; font-weight: 900; color: #0f3d3e; }
  .doc-english { text-align: center; font-size: 10pt; letter-spacing: 0.08em; text-transform: uppercase; color: #68768a; margin-bottom: 8px; }
  .doc-subtitle { text-align: center; font-size: 10pt; color: #34414e; margin-bottom: 4px; }
  .period-line { text-align: center; font-size: 10pt; color: #20292f; padding: 5px 0; border-block: 1px solid #d8e0e6; margin-bottom: 12px; }
  .period-line b { color: #0f3d3e; }

  /* ── KPI band ── */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; margin-bottom: 12px; }
  .kpi { border: 1px solid #cfd8dd; border-inline-start: 3px solid #168653; border-radius: 6px; padding: 6px 8px; }
  .kpi-label { font-size: 7.5pt; font-weight: 700; color: #5b6773; display: block; letter-spacing: 0.02em; }
  .kpi-value { font-size: 13pt; font-weight: 800; color: #111; font-variant-numeric: tabular-nums; }
  .kpi-hint { font-size: 7pt; color: #68768a; display: block; }

  /* ── الجداول الرسمية ── */
  .sheet-section { margin-bottom: 12px; break-inside: avoid; }
  .section-title { font-size: 11.5pt; font-weight: 800; color: #0f3d3e; border-bottom: 1.3px solid #0f3d3e; padding-bottom: 3px; margin: 0 0 5px; }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 8.6pt; }
  .sheet th { background: #eef3f0; border: 1px solid #c5d2ca; color: #0f3d3e; padding: 4px 6px; font-size: 8pt; text-align: right; font-weight: 800; }
  .sheet td { border: 1px solid #d5ded8; padding: 3.5px 6px; text-align: right; font-variant-numeric: tabular-nums; }
  .sheet tbody tr:nth-child(even) td { background: #f7faf8; }
  .sheet .totals-row td { background: #0f3d3e; color: #fff; font-weight: 800; border-color: #0f3d3e; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
  .bullets { margin: 4px 0 0; padding-inline-start: 20px; font-size: 8.5pt; }
  .bullets li { margin-bottom: 2px; }
  .section-note { font-size: 8pt; color: #5b6773; border: 1px dashed #c5d2ca; border-radius: 4px; padding: 4px 6px; margin-top: 4px; }

  .notes { border-top: 1px solid #d8e0e6; padding-top: 6px; margin-top: 10px; font-size: 7.6pt; color: #5b6773; }
  .notes p { margin: 0 0 2px; }

  /* ── التذييل: خانات التوقيع + رقم الصفحة ── */
  .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 26px; break-inside: avoid; }
  .sig { flex: 1; border-top: 1.4px solid #0f3d3e; padding-top: 4px; text-align: center; font-size: 9.5pt; font-weight: 700; color: #20292f; }
  .sig small { display: block; font-size: 7pt; color: #68768a; font-weight: 500; margin-top: 2px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 7pt; color: #98a5b3; border-top: 1px solid #e3e9ee; padding-top: 4px; }
  @page { @bottom-center { content: 'KARIM ERP'; } }
  @media print { .no-print { display: none; } }
</style>
</head><body>
  <header class="letterhead">
    <img src="/app/assets/karim-logo.png" alt="شعار الشركة">
    <div class="lh-company">
      <div class="lh-ar">${COMPANY_AR}</div>
      <div class="lh-en">${COMPANY_EN}</div>
      <div class="lh-sub">${COMPANY_LINE2}</div>
    </div>
    <div class="lh-ref">
      <div>رقم الوثيقة</div>
      <strong dir="ltr">${escape(ref)}</strong>
      <div>التاريخ: ${escape(todayIso())}</div>
    </div>
  </header>

  <h1 class="doc-title">${escape(input.title)}</h1>
  ${input.englishTitle ? `<div class="doc-english">${escape(input.englishTitle)}</div>` : ''}
  ${input.subtitle ? `<div class="doc-subtitle">${escape(input.subtitle)}</div>` : ''}
  ${(from || to) ? `<div class="period-line">الفترة: <b>${escape(from)}</b> ← <b>${escape(to)}</b></div>` : ''}

  ${kpiHtml}

  ${sectionsHtml}

  ${notesHtml}

  <div class="signatures">${signatures.map((s) => `<div class="sig">${escape(s.role)}<small>${escape(s.name ?? 'الاسم والتوقيع')}</small></div>`).join('')}</div>

  <div class="footer">
    <span>${COMPANY_AR} · ${COMPANY_LINE2}</span>
    <span>هذه الوثيقة صادرة إلكترونيًا من KARIM ERP</span>
    <span>${escape(ref)}</span>
  </div>
</body></html>`;
}

/** يفتح الوثيقة في نافذة جديدة ويطبعها (بدل التقاط الشاشة). */
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
    win.setTimeout(() => win.print(), 300);
    return true;
}
