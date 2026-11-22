import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس عقد الشاشات — نفس فلسفة `css-contract.test.ts`: لا نمنع التطور،
 * نمنع **التدهور**.
 *
 *  1. `PageHeader` إجباري: أي شاشة تعرض عنوان صفحة `<h1>` يجب أن تستخدمه،
 *     والاستثناءات محدودة ومعلنة صراحة (ترويسات مؤسسية بتصميمها الخاص).
 *     الدين القائم مسجَّل في `screen-headers-baseline.json`؛ الشاشة الجديدة
 *     تبدأ صفرًا، والهجرة تُضيِّق الأساس.
 *  2. لا ترويسة صفحة مكررة: كتلة `<header>` بنفس أصناف الترويسة القديمة
 *     ممنوعة — من يضيف شاشة يمرّ من المكوّن الموحّد. نفس الأساس يحرسها.
 *  3. الجدول: `DataTable` هو المسار، والأساس `screen-tables-baseline.json`
 *     يسجّل ما تبقّى من جداول خام. أي زيادة = فشل، وأي نظافة تُسجَّل.
 *     التضييق بعد التنظيف:
 *       SCREEN_TABLES_UPDATE=1 node node_modules/vitest/vitest.mjs run src/screen-contract.test.ts
 *       SCREEN_HEADERS_UPDATE=1 node node_modules/vitest/vitest.mjs run src/screen-contract.test.ts
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = join(SRC, 'screens');
const BASELINE_PATH = join(SRC, 'screen-tables-baseline.json');
const HEADERS_BASELINE_PATH = join(SRC, 'screen-headers-baseline.json');

const SCREEN_FILES = readdirSync(SCREENS_DIR)
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx') && !file.endsWith('.lazy.tsx'))
    .sort();

const SOURCE = new Map(SCREEN_FILES.map((file) => [file, readFileSync(join(SCREENS_DIR, file), 'utf8')]));

/** ترويسات مؤسسية بتصميمها الخاص — بديل PageHeader المعلن لكل شاشة. */
const BESPOKE_HEADERS: Readonly<Record<string, string>> = {
    'Mudad.tsx': 'mudad-hero',
    'FinancialCompliance.tsx': 'fc-header',
    'CashierKiosk.tsx': 'pos-kiosk__bar',
    'LegacySource.tsx': 'legacy-source__head',
};

/** أصناف الترويسة القديمة المكررة التي وُحّدت إلى PageHeader. */
const LEGACY_PAGE_HEADER =
    /<header className="(?:flex flex-wrap items-end justify-between gap-sm|flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md)">/;

interface TablesBaseline {
    readonly _generated?: string;
    readonly files: Readonly<Record<string, number>>;
}

interface HeadersBaseline {
    readonly _generated?: string;
    readonly pageHeader: readonly string[];
    readonly legacyHeader: readonly string[];
}

const tableCounts = new Map<string, number>(
    SCREEN_FILES.map((file) => [`screens/${file}`, (SOURCE.get(file)?.match(/<table\b/g) ?? []).length]),
);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as TablesBaseline;
const headersBaseline = JSON.parse(readFileSync(HEADERS_BASELINE_PATH, 'utf8')) as HeadersBaseline;

/** شاشات عقد الترويسة المخالِفة حاليًا (بلا أساس). */
function pageHeaderOffenders(): string[] {
    const offenders: string[] = [];
    for (const [file, source] of SOURCE) {
        if (!source.includes('<h1')) continue;
        if (source.includes('PageHeader')) continue;
        const bespoke = BESPOKE_HEADERS[file];
        if (!bespoke) {
            offenders.push(file);
            continue;
        }
        if (!source.includes(bespoke)) offenders.push(file);
    }
    return offenders.sort();
}

const legacyHeaderOffenders = (): string[] =>
    SCREEN_FILES.filter((file) => LEGACY_PAGE_HEADER.test(SOURCE.get(file) ?? '')).sort();

/* وضع التضييق: يُكتب أساس جديد بالحد الأدنى — لا رفع أبدًا. */
if (process.env.SCREEN_TABLES_UPDATE === '1') {
    const tightened: Record<string, number> = {};
    for (const [file, allowed] of Object.entries(baseline.files)) {
        const current = tableCounts.get(file) ?? 0;
        const next = Math.min(allowed, current);
        if (next > 0) tightened[file] = next;
    }
    writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ _generated: new Date().toISOString(), files: tightened }, null, 4)}\n`,
    );
}

/* نفس القاعدة للترويسة: التحديث يُنقص ولا يضيف. */
let activeHeadersBaseline: HeadersBaseline = headersBaseline;
if (process.env.SCREEN_HEADERS_UPDATE === '1') {
    const next: HeadersBaseline = {
        _generated: new Date().toISOString(),
        pageHeader: headersBaseline.pageHeader.filter((file) => pageHeaderOffenders().includes(file)),
        legacyHeader: headersBaseline.legacyHeader.filter((file) => legacyHeaderOffenders().includes(file)),
    };
    writeFileSync(HEADERS_BASELINE_PATH, `${JSON.stringify(next, null, 4)}\n`);
    activeHeadersBaseline = next;
}

describe('عقد الشاشات — الترويسة الموحّدة', () => {
    it('كل شاشة فيها <h1> تستخدم PageHeader أو ترويسة مؤسسية معلنة', () => {
        const allowed = new Set(activeHeadersBaseline.pageHeader);
        const offenders = pageHeaderOffenders().filter((file) => !allowed.has(file));
        expect(offenders).toEqual([]);
    });

    it('لا ترويسة صفحة مكررة بأصناف قديمة — PageHeader هو المصدر الوحيد', () => {
        const allowed = new Set(activeHeadersBaseline.legacyHeader);
        const offenders = legacyHeaderOffenders().filter((file) => !allowed.has(file));
        expect(offenders).toEqual([]);
    });

    it('الديون المسجّلة انخفضت — ضيّق الأساس (SCREEN_HEADERS_UPDATE=1)', () => {
        const current = new Set([...pageHeaderOffenders(), ...legacyHeaderOffenders()]);
        const recorded = new Set([...activeHeadersBaseline.pageHeader, ...activeHeadersBaseline.legacyHeader]);
        const notes = [...recorded].filter((file) => !current.has(file));
        for (const file of notes) console.info(`هاجرت ${file} — ضيّق أساس الترويسة`);
        expect(notes.length).toBeGreaterThanOrEqual(0);
    });

    it('الاستثناءات المؤسسية محدودة ومعلنة', () => {
        expect(Object.keys(BESPOKE_HEADERS).sort()).toEqual([
            'CashierKiosk.tsx',
            'FinancialCompliance.tsx',
            'LegacySource.tsx',
            'Mudad.tsx',
        ]);
    });
});

describe('عقد الشاشات — جدول واحد (DataTable)', () => {
    it('لا زيادة على أساس الجداول الخام في أي شاشة', () => {
        const offenders: string[] = [];
        for (const [file, count] of tableCounts) {
            const allowed = baseline.files[file] ?? 0;
            if (count > allowed) offenders.push(`${file}: ${count} جدول خام > الأساس ${allowed}`);
        }
        expect(offenders).toEqual([]);
    });

    it('الانخفاضات تُسجَّل — حدّث الأساس لتضييقه (SCREEN_TABLES_UPDATE=1)', () => {
        const notes: string[] = [];
        for (const [file, allowed] of Object.entries(baseline.files)) {
            if (!tableCounts.has(file)) notes.push(`ملف الأساس لم يعد موجودًا: ${file}`);
            else if ((tableCounts.get(file) ?? 0) < allowed) notes.push(`انخفض في ${file}`);
        }
        for (const note of notes) console.info(note);
        expect(notes.length).toBeGreaterThanOrEqual(0);
    });

    it('دليل الموظفين لا يزيد عن أساسه — الهجرة إلى DataTable لم تكتمل بعد', () => {
        const allowed = baseline.files['screens/Employees.tsx'] ?? 0;
        expect(tableCounts.get('screens/Employees.tsx') ?? 0).toBeLessThanOrEqual(allowed);
    });
});
