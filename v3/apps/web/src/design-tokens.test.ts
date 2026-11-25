import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس نظام التصميم — الهوية المؤسسية لـKARIM V3.
 *
 * يثبّت ثلاثة أشياء لا تُرى بالعين في مراجعة سريعة:
 *   ١) عقد الألوان: كل بدائي (`--erp-c-*`) موجود في الوضعين، وOKLCH المعرَّف
 *      يعود إلى HEX العقد نفسه (±1 في القناة) — فلا ينزلق اللون بترقيم.
 *   ٢) التباين: كل زوج نص/خلفية مستعمل فعليًا ≥ 4.5:1 (WCAG 2.2 AA)، وحدود
 *      المكوّنات ≥ 3:1 (1.4.11) — يُحسب من القيم نفسها لا من لقطة شاشة.
 *   ٣) نَفَس الهوية: Tajawal مستضاف محليًا بملفاته، ولا تدرّج ولا زجاج في
 *      ملف الرموز، ولا قيمة لونية خام داخل `@theme` (تكسر تبديل الوضع).
 *
 * لا يعتمد على jsdom ولا على شبكة: يقرأ `styles.css` ويحسب، فبوابة المرحلة
 * تعمل في أي بيئة.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(SRC, 'styles.css');
const css = readFileSync(CSS_PATH, 'utf8');

/** ملفات المصدر التي قد تحمل خطًّا (CSS/TS/TSX/HTML)، بلا `assets`. */
function sourceFiles(dir: string = SRC): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'assets') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.(css|ts|tsx|html)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const MARK_LIGHT = '/* ─── البدائيات: الوضع الفاتح ─── */';
const MARK_DARK = '/* ─── البدائيات: الوضع الداكن ─── */';
const MARK_SEMANTIC = '/* ─── الدلالات ─── */';

function sliceBetween(startMark: string, endMark: string): string {
    const start = css.indexOf(startMark);
    const end = css.indexOf(endMark);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return css.slice(start, end);
}

type Primitives = Readonly<Record<string, string>>;

/** يقرأ `--erp-c-*` من كتلة: oklch فقط، و`overlay` شفاف بـrgb. */
function primitivesOf(block: string): Primitives {
    const found: Record<string, string> = {};
    for (const match of block.matchAll(/--erp-c-([a-z0-9-]+):\s*(oklch\([^)]*\)|rgba?\([^)]*\));/g)) {
        const key = match[1];
        const value = match[2];
        if (key && value) found[key] = value;
    }
    return found;
}

const LIGHT = primitivesOf(sliceBetween(MARK_LIGHT, MARK_DARK));
const DARK = primitivesOf(sliceBetween(MARK_DARK, MARK_SEMANTIC));

/** oklch → 8-bit sRGB كما تحسمه المتصفحات (تُقصّ القيم خارج النطاق). */
function oklchToRgb(value: string): [number, number, number] {
    const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')')).trim();
    const [lPart, cPart, hPart = '0'] = inner.split(/\s+/);
    const L = Number(lPart ?? '');
    const C = Number(cPart ?? '');
    if (!Number.isFinite(L) || !Number.isFinite(C)) throw new Error(`oklch غير صالح: ${value}`);
    const H = /(deg|turn|rad)$/.test(hPart) ? Number(hPart.replace(/(deg|turn|rad)$/, '')) : Number(hPart);
    const hue = (Number.isFinite(H) ? H : 0) * (Math.PI / 180);
    const a = C * Math.cos(hue);
    const b = C * Math.sin(hue);

    const lp = L + 0.3963377774 * a + 0.2158037573 * b;
    const mp = L - 0.1055613458 * a - 0.0638541728 * b;
    const sp = L - 0.0894841775 * a - 1.291485548 * b;
    const l = lp ** 3;
    const m = mp ** 3;
    const s = sp ** 3;

    const linear = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return linear.map((channel) => {
        const clipped = Math.min(1, Math.max(0, channel));
        const srgb = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, srgb)) * 255);
    }) as [number, number, number];
}

const toHex = ([r, g, b]: [number, number, number]): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** نسبة التباين WCAG من لمعان نسبي محسوب من نفس القيم. */
function luminance(hex: string): number {
    const raw = hex.replace('#', '');
    const channels = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const [r = 0, g = 0, b = 0] = linear;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
    const a = luminance(fg);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hexOf = (palette: Primitives, key: string): string => {
    const value = palette[key];
    if (!value) throw new Error(`البدائي مفقود: --erp-c-${key}`);
    return toHex(oklchToRgb(value));
};

/** نتيجة `color-mix(in srgb, tone 15%, transparent)` مركّبة فوق سطح معتم. */
function tint(hex: string, over: string, amount = 0.15): string {
    const channels = (value: string): number[] => [0, 2, 4].map((i) => parseInt(value.replace('#', '').slice(i, i + 2), 16));
    const [fr = 0, fg = 0, fb = 0] = channels(hex);
    const [br = 0, bg = 0, bb = 0] = channels(over);
    return toHex([
        Math.round(fr * amount + br * (1 - amount)),
        Math.round(fg * amount + bg * (1 - amount)),
        Math.round(fb * amount + bb * (1 - amount)),
    ]);
}

describe('نظام التصميم — البدائيات في الوضعين', () => {
    it('لكل بدائي في الفاتح نظيرٌ في الداكن، والعكس', () => {
        expect(Object.keys(LIGHT).length).toBeGreaterThan(30);
        expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
    });

    it('كل بدائي لوني بـOKLCH ما عدا الطبقة الشفافة', () => {
        for (const palette of [LIGHT, DARK]) {
            for (const [key, value] of Object.entries(palette)) {
                if (key === 'overlay') {
                    expect(value).toMatch(/^rgb\(/);
                    continue;
                }
                expect(value, `--erp-c-${key}`).toMatch(/^oklch\(/);
            }
        }
    });

    it('OKLCH يعود إلى HEX عقد الهوية المؤسسية بلا انزلاق', () => {
        const anchor: ReadonlyArray<readonly [string, string]> = [
            ['canvas', '#f3f6fa'],
            ['surface', '#ffffff'],
            ['ink', '#172b3b'],
            ['muted', '#596e80'],
            ['hairline', '#dce5ec'],
            ['primary', '#0f766e'],
            ['success', '#16834a'],
            ['on-primary', '#ffffff'],
        ];
        for (const [key, expected] of anchor) {
            expect(hexOf(LIGHT, key), `--erp-c-${key}`).toBe(expected);
        }
    });

    it('الوضع الداكن لا يستخدم أسودَ نقيًّا ولا أبيضَ نقيًّا للنص', () => {
        expect(hexOf(DARK, 'canvas')).not.toBe('#000000');
        expect(hexOf(DARK, 'ink')).not.toBe('#ffffff');
        expect(hexOf(DARK, 'canvas')).toBe('#0c1722');
        expect(hexOf(DARK, 'primary')).toBe('#53d3c5');
        expect(hexOf(DARK, 'sidebar')).toBe('#081724');
    });
});

describe('نظام التصميم — التباين (WCAG 2.2 AA)', () => {
    /** كل زوج هنا يُستعمل فعلًا في الواجهة؛ الخلفية هي ما يُطبع تحته. */
    const TEXT_PAIRS = [
        ['ink', 'canvas'],
        ['ink', 'surface'],
        ['ink-secondary', 'canvas'],
        ['ink-secondary', 'surface'],
        ['muted', 'surface'],
        ['muted', 'canvas'],
        ['faint', 'canvas'],
        ['faint', 'surface'],
        ['on-primary', 'primary'],
        ['brand-text', 'canvas'],
        ['success-text', 'surface'],
        ['warning-text', 'surface'],
        ['danger-text', 'surface'],
        ['info-text', 'surface'],
        ['neutral-text', 'surface'],
        ['sidebar-ink', 'sidebar'],
        ['sidebar-plaque-ink', 'sidebar-plaque'],
    ] as const;

    it.each([
        ['فاتح', LIGHT],
        ['داكن', DARK],
    ] as const)('نص %s ≥ 4.5:1', (_mode, palette) => {
        for (const [fg, bg] of TEXT_PAIRS) {
            expect(contrast(hexOf(palette, fg), hexOf(palette, bg)), `${fg} على ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    /**
     * `-soft` = `color-mix(in srgb, tone 15%, transparent)` فوق السطح، وهو خلف
     * `Badge` و`Alert`. القيمة المركّبة أخفض تباينًا من السطح الأبيض، فتُقاس
     * نفسها لا تُفترض.
     */
    it.each([
        ['فاتح', LIGHT],
        ['داكن', DARK],
    ] as const)('نصّ النبرة على خلفيتها اللينة %s ≥ 4.5:1', (_mode, palette) => {
        const surface = hexOf(palette, 'surface');
        const body = hexOf(palette, 'ink-secondary');
        for (const tone of ['success', 'warning', 'danger', 'info', 'neutral'] as const) {
            const soft = tint(hexOf(palette, tone), surface);
            expect(contrast(hexOf(palette, `${tone}-text`), soft), `${tone}-text على ${tone}-soft`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(body, soft), `ink-secondary على ${tone}-soft`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([
        ['فاتح', LIGHT],
        ['داكن', DARK],
    ] as const)('حدود المكوّنات %s ≥ 3:1', (_mode, palette) => {
        const border = hexOf(palette, 'field-border');
        for (const surface of ['surface', 'canvas', 'surface-sunken'] as const) {
            expect(contrast(border, hexOf(palette, surface)), `field-border على ${surface}`).toBeGreaterThanOrEqual(3);
        }
        // حلقة التركيز تُرى على الكانفس وعلى الورق.
        const ring = hexOf(palette, 'primary');
        expect(contrast(ring, hexOf(palette, 'canvas'))).toBeGreaterThanOrEqual(3);
        expect(contrast(ring, hexOf(palette, 'surface'))).toBeGreaterThanOrEqual(3);
    });

    it('الفاصل الزخرفي أفتح من حدّ المكوّن — فلا يُستخدم فاصلًا لحقل', () => {
        for (const palette of [LIGHT, DARK]) {
            expect(luminance(hexOf(palette, 'hairline'))).not.toBe(luminance(hexOf(palette, 'field-border')));
            expect(contrast(hexOf(palette, 'field-border'), hexOf(palette, 'surface'))).toBeGreaterThan(
                contrast(hexOf(palette, 'hairline'), hexOf(palette, 'surface')),
            );
        }
    });
});

describe('نظام التصميم — الخطوط', () => {
    it('Tajawal أولًا، لا خط قديم في الرموز', () => {
        expect(css).toMatch(/--font-sans:\s*Tajawal,/);
        const retired = ['IBM', 'Plex', 'Sans', 'Arabic'].join(' ');
        expect(css).not.toContain(retired);
    });

    it('Tajawal مستضاف محليًا: أربعة أوزان بعائلتين يونيكود', () => {
        const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)]
            .map((m) => m[1] ?? '')
            .filter((body) => body.includes('font-family: "Tajawal"'));
        expect(faces).toHaveLength(8);
        for (const body of faces) {
            expect(body).toMatch(/font-display:\s*swap/);
            expect(body).toMatch(/unicode-range:/);
            const file = /url\("\.\/assets\/fonts\/([^"]+)"\)/.exec(body)?.[1];
            expect(file, body).toBeTruthy();
            expect(existsSync(join(SRC, 'assets', 'fonts', String(file)))).toBe(true);
        }
        expect(css).not.toMatch(/https?:\/\/fonts\./);
    });

    it('لا أثر للخط القديم في أي ملف مصدر (واجهة أو طباعة أو Canvas)', () => {
        // يُبنى النص من قطعٍ كي لا يطابق الحارس نفسه.
        const retired = ['IBM', 'Plex', 'Sans', 'Arabic'].join(' ');
        const offenders = sourceFiles()
            .filter((file) => readFileSync(file, 'utf8').includes(retired))
            .map((file) => file.slice(SRC.length + 1));
        expect(offenders).toEqual([]);
    });

    it('لا ملفَّ خطٍّ ميتًا: كل woff2 مُعلَن في @font-face', () => {
        const declared = new Set([...css.matchAll(/url\("\.\/assets\/fonts\/([^"]+)"\)/g)].map((m) => m[1]));
        const onDisk = readdirSync(join(SRC, 'assets', 'fonts')).filter((f) => f.endsWith('.woff2'));
        expect(onDisk.length).toBeGreaterThan(0);
        expect(onDisk.filter((file) => !declared.has(file))).toEqual([]);
    });

    it('الأرقام لا تنكسر: خط جدولي معزول الاتجاه', () => {
        expect(css).toMatch(/\.erp-numeric\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
        expect(css).toMatch(/\.erp-numeric\s*\{[^}]*unicode-bidi:\s*isolate/);
    });
});

describe('نظام التصميم — القواعد الممنوعة', () => {
    const themeBlock = (): string => {
        const start = css.indexOf('@theme inline {');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        for (let i = css.indexOf('{', start); i < css.length; i += 1) {
            if (css[i] === '{') depth += 1;
            else if (css[i] === '}') {
                depth -= 1;
                if (depth === 0) return css.slice(start, i + 1);
            }
        }
        throw new Error('@theme inline غير مغلق');
    };

    it('لا قيمة لونية خام داخل @theme (تكسر تبديل الوضع)', () => {
        const block = themeBlock().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(block).not.toMatch(/oklch\(|rgba?\(|hsla?\(/);
    });

    it('لا تدرّج ولا زجاج في ملف الرموز', () => {
        const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/(linear|radial|conic)-gradient\(/);
        expect(code).not.toMatch(/backdrop-filter/);
    });

    it('لا أدوات تدرّج في المكوّنات (class strings)', () => {
        // الحارس نفسه مستثنى: نمطه مكتوب هنا كنصّ، فبلمسه يصير مخالفةً لنفسه.
        const offenders = sourceFiles()
            .filter((file) => /\.tsx?$/.test(file))
            .filter((file) => !file.endsWith('design-tokens.test.ts'))
            .filter((file) => /bg-(linear|radial|conic)-|bg-gradient-to/.test(readFileSync(file, 'utf8')))
            .map((file) => file.slice(SRC.length + 1));
        expect(offenders).toEqual([]);
    });

    it('الظلال محايدة لا دافئة، ومعرَّفة في الوضعين', () => {
        const radii = ['card', 'pop', 'drawer'];
        for (const shadow of radii) {
            expect(css.match(new RegExp(`--erp-shadow-${shadow}:`, 'g'))?.length).toBe(2);
        }
        expect(css).not.toMatch(/rgba?\(46 38 24/);
    });

    it('سلّم المسافات على شبكة 4px وسلّم الزوايا تصاعدي', () => {
        const spacing = [...css.matchAll(/--spacing-([a-z]+):\s*(\d+)px;/g)].map((m) => ({ name: m[1], value: Number(m[2]) }));
        expect(spacing.length).toBeGreaterThanOrEqual(8);
        for (const { name, value } of spacing) {
            expect(value % 4, `--spacing-${name}`).toBe(0);
        }
        const radii = [...css.matchAll(/--radius-(sm|md|lg|xl|xxl):\s*(\d+)px;/g)].map((m) => Number(m[2]));
        expect(radii).toEqual([6, 10, 16, 20, 24]);
    });
});

describe('نظام التصميم — الدلالات والربط', () => {
    it('الدلالات تشير إلى البدائيات لا إلى قيم خام', () => {
        const semantic = sliceBetween(MARK_SEMANTIC, '/*\n * `@theme inline`');
        expect(semantic).toMatch(/--erp-field-border:\s*var\(--erp-c-field-border\)/);
        expect(semantic).toMatch(/--erp-primary:\s*var\(--erp-c-primary\)/);
        expect(semantic).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it('حقول النموذج تقرأ حدّ المكوّن لا الفاصل الزخرفي', () => {
        expect(css).toMatch(/--field-border:\s*var\(--erp-field-border\)/);
        expect(css).toMatch(/--input:\s*var\(--erp-field-border\)/);
        expect(css).not.toMatch(/--field-border:\s*var\(--erp-hairline-strong\)/);
    });

    it('حلقة التركيز على لون الإجراء لا على لون قديم', () => {
        expect(css).toMatch(/--erp-focus-ring:\s*2px solid var\(--erp-c-primary\)/);
    });
});
