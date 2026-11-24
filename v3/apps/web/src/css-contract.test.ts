import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس عقد الألوان في CSS — نفس فلسفة `scripts/security-gate.js`:
 * لا نمنع التطور، نمنع **التدهور**.
 *
 * القاعدة: كل لون في الواجهة يأتي من رموز `styles.css` (`--erp-*` أو أدوات
 * تيلويند المرتبطة بها). القيم الخام (hex، دوال rgb/hsl، أسماء الألوان)
 * تكسر تبديل الوضع الداكن وتفلت من فحص التباين في `design-tokens.test.ts`.
 *
 * الأساس `css-contract-baseline.json` يسجّل حصّة كل ملف قائم اليوم؛ أي
 * زيادة في حصّة ملف أو ملف جديد غير نظيف = فشل. من يضيف لونًا خامًا يجب
 * أن يُصلحه أو يُخفّض حصّة ملف آخر في نفس التغيير — لا يُخالَص بالصمت.
 * الانخفاضات تُسجَّل في المخرجات، وتضييق الأساس بعد التنظيف اختياري:
 *   CSS_CONTRACT_UPDATE=1 node node_modules/vitest/vitest.mjs run src/css-contract.test.ts
 * (وضع التحديث يُنقص الحصص ويحذف الأصفار فقط — لا يرفع أساسًا أبدًا.)
 *
 * الاستثناء الوحيد: `styles.css` نفسه — مصدر الرموز، وبدائياته OKLCH/rgb
 * مصرّحة ومحمية بحارس `design-tokens.test.ts` (التباين والعقد).
 *
 * العدّ عملي لا شكلي: تُزال التعليقات و`url()` والسلاسل النصية أولًا،
 * ثم تُعدّ hex ودوال rgb/rgba/hsl/hsla (بما فيها قيم الاحتياط داخل `var`)،
 * وأسماء الألوان الشائعة خارج أسماء المتغيّرات (`--fc-red` ليس لونًا خامًا).
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const TOKEN_SOURCE = 'styles.css';
const BASELINE_PATH = join(SRC, 'css-contract-baseline.json');

/** ملفات CSS للواجهة بلا `assets` (ملفات الخطوط والصور ليست أنماطًا). */
function collectCss(dir: string = SRC): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'assets') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectCss(full));
        else if (entry.name.endsWith('.css')) out.push(full);
    }
    return out;
}

const rel = (file: string): string => relative(SRC, file).replace(/\\/g, '/');

/** التعليقات ليست كودًا: تُزال التعليقات والروابط والسلاسل قبل العدّ. */
function stripNoise(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/url\([^)]*\)/g, '')
        .replace(/"[^"]*"|'[^']*'/g, '');
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const COLOR_FUNC = /\b(?:rgba?|hsla?)\s*\(/gi;
/** أسماء الألوان الشائعة كقيم مستقلة — لا داخل اسم متغيّر أو صنف. */
const NAMED =
    /(?<![-\w])(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|navy|teal|cyan|magenta|maroon|olive|lime|aqua|fuchsia|brown|beige|ivory|coral|crimson|salmon|turquoise|indigo|violet|khaki|plum|orchid|tan|wheat)(?![-\w])/gi;
const VAR_REF = /var\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

/** عدد القيم اللونية الخام في نص CSS (بعد إزالة الضجيج). */
function countRawColors(text: string): number {
    const code = stripNoise(text);
    const hex = code.match(HEX)?.length ?? 0;
    const funcs = code.match(COLOR_FUNC)?.length ?? 0;
    const named = code.replace(VAR_REF, '').match(NAMED)?.length ?? 0;
    return hex + funcs + named;
}

const FILES = collectCss().filter((file) => rel(file) !== TOKEN_SOURCE);
const COUNTS = new Map<string, number>(FILES.map((file) => [rel(file), countRawColors(readFileSync(file, 'utf8'))]));

interface Baseline {
    readonly _generated?: string;
    readonly files: Readonly<Record<string, number>>;
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;

/* وضع التضييق: يُكتب أساس جديد بالحد الأدنى من الحصتين — لا رفع أبدًا. */
if (process.env.CSS_CONTRACT_UPDATE === '1') {
    const tightened: Record<string, number> = {};
    for (const [file, allowed] of Object.entries(baseline.files)) {
        const current = COUNTS.get(file) ?? 0;
        const next = Math.min(allowed, current);
        if (next > 0) tightened[file] = next;
    }
    writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ _generated: new Date().toISOString(), files: tightened }, null, 4)}\n`,
    );
}

describe('حارس عقد الألوان في CSS', () => {
    it('المسح يغطّي ملفات الواجهة', () => {
        expect(FILES.length).toBeGreaterThan(40);
    });

    it('لا زيادة على حصّة الأساس في أي ملف (والجديد يجب أن يكون صفرًا)', () => {
        const offenders: string[] = [];
        for (const [file, count] of COUNTS) {
            const allowed = baseline.files[file] ?? 0;
            if (count > allowed) offenders.push(`${file}: ${count} قيمة خامّة > الأساس ${allowed}`);
        }
        expect(offenders).toEqual([]);
    });

    it('الانخفاضات تُسجَّل — حدّث الأساس لتضييقه (CSS_CONTRACT_UPDATE=1)', () => {
        const notes: string[] = [];
        for (const [file, allowed] of Object.entries(baseline.files)) {
            const current = COUNTS.get(file);
            if (current === undefined) notes.push(`ملف الأساس لم يعد موجودًا: ${file}`);
            else if (current < allowed) notes.push(`حصّة انخفضت في ${file}: ${current} من ${allowed} — ضيّق الأساس`);
        }
        for (const note of notes) console.info(note);
        // اختبار معلوماتي: لا فشل هنا، فالأساس يمنع الزيادة وحدها.
        expect(notes.length).toBeGreaterThanOrEqual(0);
    });

    it('FinancialCompliance.css نظيفة تمامًا وليست في الأساس', () => {
        expect(COUNTS.get('screens/FinancialCompliance.css')).toBe(0);
        expect(baseline.files['screens/FinancialCompliance.css']).toBeUndefined();
    });
});

describe('حارس عقد الألوان — عضّ الحارس (bite)', () => {
    it('يلتقط hex ودوال الألوان والأسماء المستقلة', () => {
        expect(countRawColors('.x { color: #fff; background: rgba(0, 0, 0, 0.5); border-color: red; }')).toBe(3);
        expect(countRawColors('.x { color: hsl(120 50% 50%); }')).toBe(1);
        expect(countRawColors('.x { color: #0f766e; }')).toBe(1);
    });

    it('يلتقط قيمة الاحتياط الخام داخل var', () => {
        expect(countRawColors('.x { color: var(--accent, #0f766e); }')).toBe(1);
    });

    it('لا يعاقب الرموز ولا التعليقات ولا الروابط', () => {
        expect(countRawColors('/* #fff */ .x { color: var(--erp-ink); background: var(--erp-surface); }')).toBe(0);
        expect(countRawColors('.x { color: var(--fc-red); }')).toBe(0);
        expect(countRawColors('.x { background: url("a.png"); content: "#fff"; }')).toBe(0);
        expect(countRawColors('.x { color: color-mix(in srgb, var(--erp-primary) 15%, transparent); }')).toBe(0);
    });
});
