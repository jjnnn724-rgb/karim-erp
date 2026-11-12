import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * أدوات الاختبار المشتركة — التقاتٌ حقيقية من القديم، لا بيانات مصنوعة.
 *
 * `loadFixture` يقرأ من `fixtures/<area>/<name>.json`؛ وكل ملف بشكله الملتقط:
 * `{ meta: { status, url, captured_at, server }, body }`.
 *
 * `canonicalize` يطبّق قواعد ADR على الجسد القديم ليصير ما يُصدره v3:
 *  · ADR-04: المال نصٌّ بصيغة NUMERIC(14,2) — `journal` القديم يُخرجه رقمًا.
 *  · ADR-05: `DATE` نصٌّ `YYYY-MM-DD` — القديم يُخرجه `…T21:00:00.000Z`
 *    (منتصف ليل الرياض). تُحسب في توقيت الرياض لا UTC كي لا ينزلق اليوم.
 *
 * لا تحويل للمجاميع (`total_debit`…) لأن عقدها أرقامٌ صريحة في القديم وv3.
 */

const LEGACY_DATE_ISO = /^\d{4}-\d{2}-\d{2}T21:00:00\.000Z$/;
const RIYADH = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export interface Fixture<T = unknown> {
    meta: {
        status: number;
        url?: string;
        captured_at?: string;
        server?: string;
    };
    body: T;
}

export function loadFixture<T = unknown>(name: string, area = 'accounting'): Fixture<T> {
    // يُحسب عند الطلب: بيئة jsdom في Vitest تعيد كتابة `import.meta.url` إلى
    // http، فحسابه عند تحميل الوحدة يرمي حتى لو لم يُطلب أي التقاط.
    const file = path.join(fileURLToPath(new URL('../fixtures', import.meta.url)), area, `${name}.json`);
    return JSON.parse(readFileSync(file, 'utf8')) as Fixture<T>;
}

function dateOnly(iso: string): string {
    const instant = Date.parse(iso);
    if (Number.isNaN(instant)) {
        throw new RangeError(`توقيت غير صالح «${iso}»`);
    }
    return RIYADH.format(new Date(instant));
}

function moneyText(value: number): string {
    if (!Number.isFinite(value)) {
        throw new RangeError(`مبلغ غير منتهٍ «${String(value)}»`);
    }
    return value.toFixed(2);
}

/** حقول صف `/api/v3/accounting/journal` — العمود الصريح الذي يختاره محوّل v3. */
const V3_JOURNAL_KEYS = [
    'id',
    'entry_no',
    'date',
    'memo',
    'source_type',
    'source_id',
    'status',
    'created_by',
    'created_at',
    'approved_by',
    'approved_at',
    'branch_id',
    'created_by_name',
    'voided_at',
    'voided_by',
    'voided_by_name',
    'void_reason',
    'lines',
] as const;

const V3_JOURNAL_LINE_KEYS = ['account_code', 'debit', 'credit', 'memo'] as const;

function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        if (row[key] !== undefined) {
            out[key] = row[key];
        }
    }
    return out;
}

function canonicalizeRecord(row: Record<string, unknown>): Record<string, unknown> {
    // القديم يقرأ `SELECT e.*` فيسيل أعمدةً أضيفت بعده (voided_*) لا يعرفها
    // عقد v3. المحوّل في v3 يختار أعمدةً صريحة، فهذه هي الحقول الملتقَطة.
    const source = typeof row.entry_no === 'string' ? pick(row, V3_JOURNAL_KEYS) : row;
    const out: Record<string, unknown> = { ...source };
    if (typeof out.date === 'string' && LEGACY_DATE_ISO.test(out.date)) {
        out.date = dateOnly(out.date);
    }
    if (Array.isArray(out.lines)) {
        out.lines = out.lines.map((line) => {
            if (line === null || typeof line !== 'object') {
                return line;
            }
            const copy: Record<string, unknown> = pick(line as Record<string, unknown>, V3_JOURNAL_LINE_KEYS);
            for (const key of ['debit', 'credit'] as const) {
                if (typeof copy[key] === 'number') {
                    copy[key] = moneyText(copy[key] as number);
                }
            }
            return copy;
        });
    }
    return out;
}

/**
 * يُحوّل جسدًا ملتقطًا من القديم إلى الشكل الذي يُصدره v3 (`/api/v3/…`).
 * يعمل على المصفوفات كما على الكائن المفرد، ويعيد نسخة جديدة دائمًا.
 */
export function canonicalize<T>(body: T): T {
    if (Array.isArray(body)) {
        return body.map((row) => (row !== null && typeof row === 'object' ? canonicalizeRecord(row as Record<string, unknown>) : row)) as T;
    }
    if (body !== null && typeof body === 'object') {
        return canonicalizeRecord(body as Record<string, unknown>) as T;
    }
    return body;
}
