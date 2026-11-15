/**
 * dispatch-print.ts — إذن صرف بهوية الشركة («التعاقد الأسود + الذهبي» الطباعي)
 *
 * وثيقة داخلية رسمية تُطبع من الشاشة. تجمع كل ما كان المالك يحبه في إذن صرف V2
 * (الشريط الداكن + شارة الحالة + شبكة المعلومات + جدول كحلي + سلسلة الاعتماد)
 * وما ينقصه هناك تحسّنه هنا:
 *   · الشعار في شارة بيضاء داخل الشريط الداكن + الرقم التسلسلي للوثيقة.
 *   · شارة حالة مموّجة (pending/chef_approved/approved/…) بألوان الحالة نفسها.
 *   · «سلسلة الاعتماد»: كل خطوة (المنشئ ← الشيف ← المخزن ← المستلم) بمستندها
 *     واسمها وتاريخها — والتوقيع الحبري الفعلي يظهر كصورة متى وُجد.
 *   · جدول بمطابقة البطاقة مع صفوف متناوبة + صف إجمالي كحلي.
 *   · ورقة واحدة A4 (بهامش وشريط @page) + زري تحكّم للشاشة فقط.
 *
 * يفشل الطلب الكامل بهدوء: بلا رد يفتح النافذة ببيانات القائمة دون التوقيعات.
 */

import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

const escape = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const num = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const fmtQty = (value: unknown): string => {
    const n = num(value);
    if (n <= 0) { return '—'; }
    return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
};

const fmtMoney = (value: number): string =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const escMultiline = (value: string | null | undefined): string =>
    escape(value ?? '').replace(/\r?\n/g, '<br>');

/* ── السجل الكامل (best effort — نتحقق أجزاءً ونمرّر الباقي) ─────────────── */

const itemSchema = z
    .object({
        itemName: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        approvedQty: z.union([z.string(), z.number()]).nullable().optional(),
        receivedQty: z.union([z.string(), z.number()]).nullable().optional(),
        avgCost: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

const fullDispatchSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform(String),
        deptCode: z.string().nullable().optional(),
        deptName: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        createdBy: z.string().nullable().optional(),
        createdAt: z.string().nullable().optional(),
        requestNotes: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        items: z.array(itemSchema).nullable().optional(),
        approvedItems: z.array(itemSchema).nullable().optional(),
        receivedItems: z.union([z.array(itemSchema), z.record(z.string(), z.unknown())]).nullable().optional(),
        needsChefApproval: z.boolean().nullable().optional(),
        approveNotes: z.string().nullable().optional(),
        requestSignatureData: z.string().nullable().optional(),
        chefApprovedBy: z.string().nullable().optional(),
        chefApprovedAt: z.string().nullable().optional(),
        chefApprovalSignatureData: z.string().nullable().optional(),
        chefRejectedBy: z.string().nullable().optional(),
        chefRejectedAt: z.string().nullable().optional(),
        chefRejectionSignatureData: z.string().nullable().optional(),
        warehouseApprovedBy: z.string().nullable().optional(),
        warehouseApprovedAt: z.string().nullable().optional(),
        warehouseApprovalSignatureData: z.string().nullable().optional(),
        approvedBy: z.string().nullable().optional(),
        approvedDate: z.string().nullable().optional(),
        warehouseRejectedBy: z.string().nullable().optional(),
        warehouseRejectedAt: z.string().nullable().optional(),
        warehouseRejectionSignatureData: z.string().nullable().optional(),
        kitchenReceivedBy: z.string().nullable().optional(),
        kitchenReceivedAt: z.string().nullable().optional(),
        kitchenReceiptSignatureData: z.string().nullable().optional(),
    })
    .passthrough();

export type DispatchPrintRecord = z.infer<typeof fullDispatchSchema>;

/** تحويل أي حمولة (قائمة أو سجل كامل) إلى سجل صالح للورقة — يفشل رجعيًا إلى أدنى سجل. */
export function parseDispatchPrintRecord(input: unknown): DispatchPrintRecord {
    const parsed = fullDispatchSchema.safeParse(input);
    if (parsed.success) { return parsed.data; }
    const raw = (input as { id?: string | number } | null) ?? {};
    return { id: String(raw.id ?? '?') };
}

/** قراءة السجل الكامل مع التواقيع — يفشل صامتًا ويعيد `null`. */
export async function fetchDispatchFull(id: string, signal?: AbortSignal): Promise<DispatchPrintRecord | null> {
    try {
        const body = await fetchJson(fullDispatchSchema, `/api/dispatches/${encodeURIComponent(id)}`, getAccessToken(), signal ? { signal } : {});
        return body;
    } catch {
        return null;
    }
}

/* ── الهوية والحالة ─────────────────────────────────────────────────────── */

const COMPANY_AR = 'شركة مطاعم الشرفة العالمي';
const COMPANY_EN = 'AL SHURFA AL ALAMI RESTAURANTS';
const COMPANY_SUB = 'نظام Karim ERP للإدارة المتكاملة';

type PillTone = 'amber' | 'blue' | 'green' | 'teal' | 'red' | 'slate';
const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
    pending: { label: 'بانتظار الاعتماد', tone: 'amber' },
    chef_approved: { label: 'معتمد من الشيف — بانتظار المخزن', tone: 'blue' },
    approved: { label: 'معتمد من المخزن', tone: 'teal' },
    partially_received: { label: 'مستلم جزئيًا', tone: 'teal' },
    received: { label: 'مستلم كاملًا', tone: 'green' },
    rejected: { label: 'مرفوض', tone: 'red' },
};

const TONE_HEX: Record<PillTone, { bg: string; ink: string; edge: string }> = {
    amber: { bg: '#3a2e10', ink: '#f6c453', edge: '#f6c453' },
    blue: { bg: '#10233a', ink: '#7db4f7', edge: '#7db4f7' },
    green: { bg: '#0e2b1d', ink: '#5fdca0', edge: '#5fdca0' },
    teal: { bg: '#0d2724', ink: '#e0c56f', edge: '#c8a24a' },
    red: { bg: '#33100f', ink: '#ff8a80', edge: '#ff8a80' },
    slate: { bg: '#18202a', ink: '#cbd5e1', edge: '#cbd5e1' },
};

function sheetDateTime(): string {
    const now = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function dateOnly(value: string | null | undefined): string {
    return String(value ?? '').slice(0, 10) || '—';
}

function formatAt(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) { return '—'; }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) { return raw.slice(0, 16).replace('T', ' '); }
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function splitName(value: string | null | undefined): string {
    return String(value ?? '').trim() || '—';
}

function pickItems(record: DispatchPrintRecord): Array<z.infer<typeof itemSchema>> {
    const approved = Array.isArray(record.approvedItems) ? record.approvedItems : [];
    if (approved.length) { return approved; }
    return Array.isArray(record.items) ? record.items : [];
}

function firstNameOf(record: DispatchPrintRecord): string {
    return splitName(record.createdBy);
}

function inkImage(dataUrl: string | null | undefined, label: string): string {
    const src = String(dataUrl ?? '').trim();
    if (!src.startsWith('data:image')) { return ''; }
    return `<img class="sig-ink" src="${escape(src)}" alt="توقيع ${escape(label)}" />`;
}

function buildChain(record: DispatchPrintRecord): Array<{ role: string; name: string; at: string; ink: string }> {
    const chain: Array<{ role: string; name: string; at: string; ink: string }> = [
        {
            role: 'مُنشئ الطلب',
            name: firstNameOf(record),
            at: dateOnly(record.createdAt ?? record.date),
            ink: inkImage(record.requestSignatureData, 'المنشئ'),
        },
    ];
    if (record.chefApprovedBy || record.chefApprovedAt || record.chefApprovalSignatureData) {
        chain.push({
            role: 'اعتماد الشيف',
            name: splitName(record.chefApprovedBy),
            at: formatAt(record.chefApprovedAt),
            ink: inkImage(record.chefApprovalSignatureData, splitName(record.chefApprovedBy)),
        });
    } else if (record.chefRejectedBy || record.chefRejectedAt || record.chefRejectionSignatureData) {
        chain.push({
            role: 'قرار الشيف — رفض',
            name: splitName(record.chefRejectedBy),
            at: formatAt(record.chefRejectedAt),
            ink: inkImage(record.chefRejectionSignatureData, splitName(record.chefRejectedBy)),
        });
    }
    if (record.warehouseApprovedBy || record.approvedBy || record.warehouseApprovedAt || record.approvedDate || record.warehouseApprovalSignatureData) {
        chain.push({
            role: 'اعتماد المخزن',
            name: splitName(record.warehouseApprovedBy ?? record.approvedBy),
            at: formatAt(record.warehouseApprovedAt ?? record.approvedDate),
            ink: inkImage(record.warehouseApprovalSignatureData, splitName(record.warehouseApprovedBy ?? record.approvedBy)),
        });
    } else if (record.warehouseRejectedBy || record.warehouseRejectedAt || record.warehouseRejectionSignatureData) {
        chain.push({
            role: 'قرار المخزن — رفض',
            name: splitName(record.warehouseRejectedBy),
            at: formatAt(record.warehouseRejectedAt),
            ink: inkImage(record.warehouseRejectionSignatureData, splitName(record.warehouseRejectedBy)),
        });
    }
    if (record.kitchenReceivedBy || record.kitchenReceivedAt || record.kitchenReceiptSignatureData) {
        chain.push({
            role: 'الاستلام من القسم',
            name: splitName(record.kitchenReceivedBy),
            at: formatAt(record.kitchenReceivedAt),
            ink: inkImage(record.kitchenReceiptSignatureData, splitName(record.kitchenReceivedBy)),
        });
    }
    return chain;
}

export function buildDispatchPrintHtml(record: DispatchPrintRecord, opts: { currency?: string; printedBy?: string | undefined } = {}): string {
    const items = pickItems(record);
    const statusKey = String(record.status ?? '').trim();
    const pill = STATUS_PILL[statusKey] ?? { label: statusKey || '—', tone: 'slate' as PillTone };
    const tone = TONE_HEX[pill.tone];
    const ref = `DIS-${record.id}`;
    const deptLabel = splitName(record.deptName ?? record.deptCode ?? null);
    const printStamp = sheetDateTime();
    const cur = (opts.currency ?? 'SAR').trim() || 'SAR';

    let totalValue = 0;
    let unitCostKnown = false;
    const rowsHtml = items.map((item, idx) => {
        const name = splitName(item.itemName ?? item.name ?? null);
        const unit = splitName(item.unit);
        const reqQty = num(item.qty);
        const appQty = item.approvedQty == null ? null : num(item.approvedQty);
        const recQty = item.receivedQty == null ? null : num(item.receivedQty);
        const cost = num(item.avgCost);
        if (cost > 0) {
            unitCostKnown = true;
            totalValue += (appQty ?? reqQty) * cost;
        }
        return `<tr>
            <td class="c-num" dir="ltr">${idx + 1}</td>
            <td class="c-name">${escape(name)}</td>
            <td class="c-unit">${escape(unit)}</td>
            <td class="c-qty" dir="ltr">${fmtQty(reqQty)}</td>
            <td class="c-qty" dir="ltr">${appQty == null ? '—' : fmtQty(appQty)}</td>
            <td class="c-qty" dir="ltr">${recQty == null ? '—' : fmtQty(recQty)}</td>
            <td class="c-cost" dir="ltr">${cost > 0 ? fmtMoney(cost) : '—'}</td>
            <td class="c-total" dir="ltr">${cost > 0 ? fmtMoney((appQty ?? reqQty) * cost) : '—'}</td>
        </tr>`;
    }).join('');

    const totalsRow = unitCostKnown
        ? `<tr class="sheet-totals"><td colspan="6">الإجمالي — ${items.length} صنف</td><td class="c-total" dir="ltr">${fmtMoney(totalValue)}</td></tr>`
        : `<tr class="sheet-totals"><td colspan="6">الإجمالي — ${items.length} صنف</td><td class="c-total" dir="ltr">—</td></tr>`;

    const chain = buildChain(record);
    const chainHtml = chain.map((step, idx) => `
        <div class="chain-box">
            <div class="chain-step">
                <span class="chain-role">${escape(step.role)}</span>
                <span class="chain-arrow" aria-hidden="true">${idx < chain.length - 1 ? '←' : '◉'}</span>
            </div>
            ${step.ink || '<div class="sig-ink-empty" aria-hidden="true"></div>'}
            <span class="chain-name">${escape(step.name)}</span>
            <small class="chain-at" dir="ltr">${escape(step.at)}</small>
        </div>`).join('<div class="chain-connector" aria-hidden="true"></div>');

    const notes = [record.requestNotes ?? record.notes, record.approveNotes]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .map(escMultiline)
        .join('<br>');

    const printedBy = String(opts.printedBy ?? '').trim();

    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>إذن صرف ${escape(ref)} — ${escape(COMPANY_AR)}</title>
<style>
@page { size: A4 portrait; margin: 11mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
body {
    margin: 0; padding: 24px 12px 48px; direction: rtl;
    font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    color: #14231f; background: #e9ebe8;
}
.sheet {
    max-width: 830px; margin: auto; background: #fff;
    border: 1px solid #d8d2c2; border-radius: 16px;
    box-shadow: 0 14px 40px rgb(15 32 27 / 0.18);
    padding: 0 0 16px; overflow: hidden;
}
/* ── الشريط الافتتاحي: أسود كربون + ذهبي ── */
.sheet-head {
    display: flex; align-items: center; gap: 18px;
    background: linear-gradient(135deg, #0d0f0b 0%, #131a12 55%, #1c241c 100%);
    border-bottom: 4px solid #c8a24a; padding: 18px 26px;
}
.sheet-logo {
    width: 88px; height: 88px; object-fit: contain; flex: 0 0 auto;
    background: #fff; border: 2px solid #c8a24a; border-radius: 14px;
    padding: 5px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
}
.sheet-brand { display: flex; flex-direction: column; gap: 3px; }
.sheet-company-ar { font-size: 21pt; font-weight: 900; color: #f5efdc; letter-spacing: -0.01em; line-height: 1.18; }
.sheet-company-en { font-size: 8pt; font-weight: 800; letter-spacing: 0.22em; color: #c8a24a; text-transform: uppercase; }
.sheet-company-sub { font-size: 7pt; color: rgb(245 239 220 / 0.55); letter-spacing: 0.04em; }
.sheet-ref { margin-inline-start: auto; text-align: end; color: #d9cfa8; font-size: 7.5pt; line-height: 1.75; }
.sheet-ref b { display: block; font-size: 13pt; color: #fff3c4; font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }
/* ── ترويسة المستند ── */
.doc-headline {
    display: flex; align-items: center; justify-content: center; gap: 18px;
    padding: 16px 24px 4px; position: relative;
    border-bottom: 1px solid #e3ded0;
}
.doc-eyebrow { position: absolute; inset-block-start: 10px; inset-inline-start: 28px; font-size: 7pt; letter-spacing: 0.30em; font-weight: 800; color: #8a6b2f; }
.doc-title { margin: 8px 0 0; font-size: 30pt; font-weight: 900; color: #0d0f0b; }
.doc-sub { font-size: 8pt; color: #6b6556; }
.status-stamp {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 6px 18px; border-radius: 999px; font-size: 10.5pt; font-weight: 900;
    background: ${tone.bg}; color: ${tone.ink}; border: 1.8px solid ${tone.edge}; letter-spacing: 0.02em;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.22);
}
/* ── شبكة المعلومات ── */
.meta-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    padding: 12px 26px 6px;
}
.meta-cell {
    border: 1px solid #e2ddd0; border-inline-start: 4px solid #c8a24a; border-radius: 10px;
    background: #fdfcf8; padding: 8px 12px;
}
.meta-cell small { display: block; font-size: 7pt; font-weight: 800; color: #8a6b2f; letter-spacing: 0.03em; }
.meta-cell b { font-size: 12.5pt; color: #14231f; font-variant-numeric: tabular-nums; }
/* ── الجدول ── */
.items-wrap { padding: 6px 26px 2px; }
table.sheet-items {
    width: 100%; border-collapse: collapse; font-size: 9pt; direction: rtl;
}
.sheet-items thead th {
    background: #0d0f0b; color: #e0c56f; font-size: 8.5pt; font-weight: 800; letter-spacing: 0.04em;
    border: 1px solid #0d0f0b; padding: 6px 8px; text-align: center;
}
.sheet-items td { border: 1px solid #d9d5c8; padding: 5px 8px; text-align: center; font-variant-numeric: tabular-nums; }
.sheet-items td.c-name { text-align: right; font-weight: 700; color: #14231f; }
.sheet-items tbody tr:nth-child(even) td { background: #faf8ee; }
.sheet-items .sheet-totals td {
    background: #0d0f0b !important; color: #fff3c4; font-weight: 900;
    border: 1px solid #0d0f0b; font-size: 9.5pt; padding: 7px 8px; text-align: right;
}
/* ── سلسلة الاعتماد ── */
.chain-section { padding: 10px 26px 4px; }
.chain-title {
    font-size: 9pt; font-weight: 800; letter-spacing: 0.14em; color: #8a6b2f;
    border-bottom: 1px solid #e0d8c3; padding-bottom: 3px; margin-bottom: 8px; text-align: center;
}
.chain { display: flex; gap: 10px; align-items: stretch; }
.chain-box {
    flex: 1; border: 1px solid #e2ddd0; border-top: 3px solid #c8a24a; border-radius: 10px;
    background: #fdfcf8; padding: 8px 6px; display: flex; flex-direction: column; gap: 3px;
    align-items: center; text-align: center; box-shadow: 0 2px 6px rgb(15 23 42 / 0.07);
}
.chain-role { font-size: 8pt; font-weight: 800; color: #4b4433; letter-spacing: 0.04em; }
.chain-arrow { color: #c8a24a; font-size: 12pt; line-height: 1; font-weight: 900; }
.sig-ink { max-height: 46px; max-width: 150px; object-fit: contain; }
.sig-ink-empty { height: 46px; border-bottom: 1.4px dashed #b9b39c; width: 100%; }
.chain-name { font-size: 10pt; font-weight: 800; color: #14231f; }
.chain-at { font-size: 6.5pt; color: #8a8672; }
.chain-connector { flex: 0 0 6px; }
/* ── ملاحظات ── */
.notes-box {
    margin: 10px 26px 0; border: 1px solid #e2ddd0; border-right: 4px solid #c8a24a;
    border-radius: 10px; background: #fdfaf0; padding: 8px 12px; font-size: 9pt; line-height: 1.9;
}
.notes-box b { color: #8a6b2f; font-size: 8pt; letter-spacing: 0.06em; }
/* ── ذيل الورقة ── */
.sheet-foot {
    margin-top: 12px; border-top: 1.6px solid #c8a24a; padding: 8px 26px 0;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    font-size: 6.5pt; color: #6b6556; letter-spacing: 0.02em;
}
.sheet-foot b { color: #14231f; }
/* ── أزرار الشاشة فقط ── */
.controls { position: fixed; inset-block-start: 10px; inset-inline-start: 10px; display: flex; gap: 8px; z-index: 10; }
.controls button {
    border: 0; border-radius: 8px; padding: 8px 18px; font: inherit; font-weight: 800; cursor: pointer;
    background: #0d0f0b; color: #fff3c4; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
}
.controls button.ghost { background: #555; color: #fff; }
@media print {
    body { padding: 0; background: #fff; }
    .sheet { box-shadow: none; border: 0; border-radius: 0; max-width: none; }
    .controls { display: none !important; }
    .sheet-head, .sheet-totals td, .sheet-items thead th, .status-stamp {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
}
@media (max-width: 640px) {
    .sheet-head { flex-wrap: wrap; gap: 10px; }
    .meta-grid { grid-template-columns: repeat(2, 1fr); }
    .chain { flex-wrap: wrap; }
    .chain-box { min-width: calc(50% - 10px); }
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
            <small>رقم الوثيقة</small>
            <b dir="ltr">${escape(ref)}</b>
            <span>طُبعت: <span dir="ltr">${escape(printStamp)}</span></span><br>
            <span>${printedBy ? `عامل الطباعة: ${escape(printedBy)}` : ''}</span>
        </div>
    </header>

    <div class="doc-headline">
        <span class="doc-eyebrow" lang="en" dir="ltr">ISSUE AUTHORIZATION</span>
        <div>
            <h1 class="doc-title">إذن صرف</h1>
            <div class="doc-sub">سند صرف مواد من المخزن إلى قسم المطبخ — وثيقة داخلية رسمية</div>
        </div>
        <span class="status-stamp">${escape(pill.label)}</span>
    </div>

    <div class="meta-grid">
        <div class="meta-cell"><small>رقم الإذن</small><b dir="ltr">${escape(record.id)}</b></div>
        <div class="meta-cell"><small>القسم المصروف إليه</small><b>${escape(deptLabel)}</b></div>
        <div class="meta-cell"><small>تاريخ الطلب</small><b dir="ltr">${escape(dateOnly(record.date))}</b></div>
        <div class="meta-cell"><small>عدد الأصناف</small><b dir="ltr">${items.length}</b></div>
    </div>

    <div class="items-wrap">
        <table class="sheet-items">
            <thead>
                <tr><th style="width:34px">#</th><th style="text-align:right">الصنف</th><th style="width:70px">الوحدة</th><th style="width:72px">المطلوب</th><th style="width:72px">المعتمد</th><th style="width:72px">المستلم</th><th style="width:88px">متوسط التكلفة ${escape(cur)}</th><th style="width:104px">قيمة التكلفة</th></tr>
            </thead>
            <tbody>${rowsHtml}${totalsRow}</tbody>
        </table>
    </div>

    <section class="chain-section">
        <div class="chain-title"><bdi lang="en">APPROVAL CHAIN</bdi> · سلسلة الاعتماد</div>
        <div class="chain">${chainHtml}</div>
    </section>

    ${notes ? `<div class="notes-box"><b>ملاحظات</b><br>${notes}</div>` : ''}

    <footer class="sheet-foot">
        <span><b>${COMPANY_AR}</b> — ${COMPANY_SUB}</span>
        <span>وثيقة رسمية داخلية — لا تُستخدم خارج دورة المخزن</span>
        <span dir="ltr">${escape(ref)}</span>
    </footer>
</article>
</body></html>`;
}
