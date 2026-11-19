// مزامنة بناء v3 إلى frontend/v3 — نسخ تحقق بلا حذف مدمّر.
// الاستخدام: node scripts/sync-build.mjs   (بعد pnpm --filter @karim/web build)
// ينسخ assets + index.html من dist، ويُبقي screens.json/rollout.json/preview كما هي،
// ثم يتحقق أن كل مرجع في الحزمة المدخلة وفي index.html موجود فعلًا (يفشل عند أي نقص).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const dist = path.join(webDir, 'dist');
const target = path.resolve(webDir, '../../frontend/v3');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('✗ لا يوجد dist/index.html — شغّل البناء أولًا: pnpm --filter @karim/web build');
    process.exit(1);
}
fs.mkdirSync(path.join(target, 'assets'), { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(path.join(dist, 'assets'))) {
    fs.copyFileSync(path.join(dist, 'assets', f), path.join(target, 'assets', f));
    copied++;
}
fs.copyFileSync(path.join(dist, 'index.html'), path.join(target, 'index.html'));

// تحقق المراجع: كل أصل يشير إليه المدخل أو index.html يجب أن يكون موجودًا.
const files = new Set(fs.readdirSync(path.join(target, 'assets')));
const html = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
// المدخل هو ما يشير إليه index.html فعلًا (لا أول ملف أبجدي — قد تبقى أجيال قديمة).
const entryMatch = html.match(/assets\/(index-[^"]+\.js)/);
const entry = entryMatch ? entryMatch[1] : fs.readdirSync(path.join(target, 'assets')).find((f) => /^index-.*\.js$/.test(f));
if (!entry || !files.has(entry)) { console.error('✗ لا يوجد أصل مدخل index-*.js مطابق لـindex.html'); process.exit(1); }
const js = fs.readFileSync(path.join(target, 'assets', entry), 'utf8');
const refs = [...new Set(js.match(/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp)/g) || [])];
const missing = refs.filter((r) => !files.has(r));
const htmlRefs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
const htmlMissing = htmlRefs.filter((h) => !fs.existsSync(path.join(target, h)));
if (missing.length || htmlMissing.length) {
    console.error(`✗ مراجع مكسورة: ${missing.length + htmlMissing.length}`, [...missing, ...htmlMissing].slice(0, 10));
    process.exit(1);
}
console.log(`✓ تمت المزامنة: ${copied} أصلًا، ${refs.length} مرجعًا سليمًا، مدخل ${entry}`);
