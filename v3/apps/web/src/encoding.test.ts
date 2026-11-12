import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس الترميز — يمنع عودة النص العربي المُشفَّر مرتين
 * (UTF-8 → cp1256 → UTF-8)، وهو العطب الذي يقلب الكلمات العربية إلى
 * محارف لاتينية/عربية مختلطة.
 *
 * العلامة القاطعة: حرف عربي يتبعه مباشرة محرف ترقيم من مجموعة cp1256
 * (§ ‚ „) — لا يظهر هذا التسلسل في نص عربي سليم. النقطة الوسطى (·)
 * مستثناة لأنها فاصل شرعي في واجهات المشروع.
 *
 * الأنماط تُبنى من نقاط الكود لا من محارف حرفية كي لا يطابق الحارس نفسه.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PUNCT = [0x00a7, 0x201a, 0x201e];
const MARKER = new RegExp(`[\\u0600-\\u06ff][${PUNCT.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('')}]`);

function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            collect(full, out);
        } else if (/\.(tsx?|css)$/.test(entry.name) && entry.name !== 'encoding.test.ts') {
            out.push(full);
        }
    }
    return out;
}

describe('حارس الترميز', () => {
    it('لا محارف بديلة U+FFFD في أي ملف واجهة', () => {
        // U+FFFD يعني أن البايتات الأصلية ضاعت عند نسخ/تحويل الترميز،
        // فلا يمكن استرجاع النص من الملف نفسه — نمنع دخوله من الأساس.
        const files = collect(HERE);
        const offenders = files
            .map((path) => ({ path: path.slice(HERE.length), text: readFileSync(path, 'utf8') }))
            .filter((file) => file.text.includes('\uFFFD'))
            .map((file) => file.path);
        expect(offenders).toEqual([]);
    });

    it('لا نص عربي مُشفَّر مرتين في أي ملف واجهة', () => {
        const files = collect(HERE);
        expect(files.length).toBeGreaterThan(20);
        const offenders = files
            .map((path) => ({ path: path.slice(HERE.length), text: readFileSync(path, 'utf8') }))
            .filter((file) => MARKER.test(file.text))
            .map((file) => file.path);
        expect(offenders).toEqual([]);
    });
});
