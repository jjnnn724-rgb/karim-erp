/**
 * card-fonts.ts — خطوط Tajawal المضمّنة base64 للطباعة.
 * تُحقن في ورق الكرت المطبوع حتى تُطبع بنفس النقاء في أي جهاز (APK/Windows) بلا إنترنت.
 * المولّد: node scripts/build-card-fonts.mjs — أعد توليده عند تحديث ملفات الخطوط.
 * لا تُحرّره يدويًا — عدّل المولّد أو الخطوط.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const fonts = [
    ['Tajawal', 700, 'tajawal-normal-700-arabic.woff2'],
    ['Tajawal', 800, 'tajawal-normal-800-arabic.woff2'],
    ['Tajawal', 800, 'tajawal-normal-800-latin.woff2'],
];

const faces = fonts.map(([family, weight, file]) => {
    const b64 = readFileSync(join(root, '..', 'v3', 'apps', 'web', 'src', 'assets', 'fonts', file)).toString('base64');
    return `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
});

const out = `/**
 * card-fonts.ts — خطوط Tajawal المضمّنة base64 للطباعة (مولّدة — لا تعدّلها يدويًا).
 * المصدر: v3/apps/web/src/assets/fonts/ · أُعيد توليدها بـ node scripts/build-card-fonts.mjs
 */

export const CARD_FONT_CSS = \`${faces.join('\n')}\`;
`;
writeFileSync(join(root, '..', 'v3', 'apps', 'web', 'src', 'lib', 'card-fonts.ts'), out);
console.log('written card-fonts.ts', (out.length / 1024).toFixed(0) + 'KB');
