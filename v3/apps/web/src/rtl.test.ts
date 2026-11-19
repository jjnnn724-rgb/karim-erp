import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس الاتجاه — RTL-first (قاعدة G5).
 *
 * في `dir="rtl"` الإزاحة الفيزيائية (`left`/`right`) تعني المعاكس، فكل
 * إزاحةٍ في الواجهة منطقية (`ms`/`me`/`ps`/`pe`/`start`/`end`/`inset-inline`).
 * الحارس يمنع عودة `left:`/`ml-`/`pr-`… بالخطأ.
 *
 * `dirname(fileURLToPath(import.meta.url))` لا `new URL('.', import.meta.url)`:
 * الأخيرة يعيدها Vite (تحويل روابط الأصول) فتفقد مخطّط `file:`.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * الحارس نفسه مستثنى: أنماطه مكتوبة كنصٍّ حرفي، فبلمسها تصير مخالفةً لنفسه.
 * الملف الوحيد الذي لا يمرّ على الحارس هو الحارس.
 */
const GUARD_FILE = 'rtl.test.ts';

/** مكوّنات shadcn المولّدة (`components/ui`) مصدر upstream وتستخدم خصائص فيزيائية
 * (`left-[50%]` في Dialog) — تُستثنى من الحارس، والتخصيصات الأصلية عبر `src/ui`
 * فوقها تبقى منطقية (start/end).
 */
const VENDOR_SEGMENT = 'components/ui';

interface SourceFile {
    readonly path: string;
    readonly text: string;
}

function isVendorDir(full: string): boolean {
    const normalized = full.replace(/\\/g, '/');
    return normalized.endsWith(`/${VENDOR_SEGMENT}`) || normalized === VENDOR_SEGMENT;
}

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (isVendorDir(full)) continue;
            collect(full, out);
        } else if (/\.(tsx?|css)$/.test(entry.name) && entry.name !== GUARD_FILE) {
            out.push({ path: full, text: readFileSync(full, 'utf8') });
        }
    }
    return out;
}

const FILES = collect(SRC);

/**
 * الحارس يفحص **الكود** لا النصوص: مساراتٌ مثل `pr-routes.js` في تعليقٍ أو
 * `scrollTo({ left: 0 })` إحداثيٌ متماثل لا إزاحة CSS. تُزال التعليقات،
 * وإزاحة CSS تُفحص في ملفات `.css` وكتل `style={{…}}` فقط.
 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function styleBlocks(text: string): string {
    return Array.from(text.matchAll(/style=\{\{([\s\S]*?)\}\}/g), (match) => match[1] ?? '').join('\n');
}

interface Rule {
    readonly label: string;
    readonly pattern: RegExp;
    readonly scan: (file: SourceFile) => string;
}

const code = (file: SourceFile): string => stripComments(file.text);

const FORBIDDEN: readonly Rule[] = [
    {
        label: 'إزاحة فيزيائية (left/right)',
        pattern: /(?<![a-z0-9-])(left|right)-(\d|auto|full|screen|px|\[)/,
        scan: code,
    },
    {
        label: 'هامش فيزيائي (ml/mr/pl/pr)',
        pattern: /(?<![a-z0-9-])(ml|mr|pl|pr)-(\d|auto|full|screen|px|\[)/,
        scan: code,
    },
    { label: 'محاذاة نصّ فيزيائية', pattern: /text-(left|right)\b/, scan: code },
    {
        label: 'حدّ فيزيائي (border-l/border-r)',
        pattern: /border-(l|r)(?![a-z0-9-])/,
        scan: code,
    },
    {
        label: 'استدارة فيزيائية (rounded-l/rounded-r)',
        pattern: /rounded-(l|r)(?![a-z0-9-])/,
        scan: code,
    },
    {
        label: 'إزاحة CSS فيزيائية',
        pattern: /(?<![a-z0-9-])(left|right)\s*:/,
        scan: (file) => (file.path.endsWith('.css') ? stripComments(file.text) : styleBlocks(stripComments(file.text))),
    },
];

describe('حارس RTL', () => {
    it('المسح يغطّي ملفات الواجهة', () => {
        expect(FILES.length).toBeGreaterThan(5);
    });

    it.each(FORBIDDEN)('لا $label في أي ملف', ({ pattern, scan }) => {
        const offenders = FILES.filter((file) => pattern.test(scan(file))).map((file) => file.path.slice(SRC.length));
        expect(offenders).toEqual([]);
    });
});
