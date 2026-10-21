#!/usr/bin/env node
'use strict';
/**
 * build-electron.js — بناء حزمة ويندوز مع/بدون توقيع Authenticode
 * ══════════════════════════════════════════════════════════════════════
 * الوضع الحالي: الحزم **غير موقّعة** (verifyUpdateCodeSignature=false،
 * signAndEditExecutable=false) ⇒ لا يمكن التحقق من سلامة التحديث.
 * بمجرّد توفير شهادة Authenticode (متغيّرات البيئة) يتحوّل البناء تلقائيًا
 * إلى وضع **موقّع ومتحقَّق** ⇒ لا حاجة لتعديل أي ملف.
 *
 * المتغيّرات المطلوبة للتوقيع:
 *   WIN_CSC_LINK        مسار ملف .pfx (أو base64 للسلسلة)
 *   WIN_CSC_KEY_PASSWORD كلمة مرور الملف
 *   (اختياري) WIN_CSC_SHA256/SHA1 Fingerprint للتثبيت على المتجر
 *
 * بدونها: البناء يجري كما هو (غير موقّع) مع تحذير واضح.
 *
 * الاستخدام:
 *   node scripts/build-electron.js              # بناء (يختار الوضع تلقائيًا)
 *   node scripts/build-electron.js --config-only # طباعة الـconfig الفعّال فقط
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CONFIG_ONLY = process.argv.includes('--config-only');

const hasCert = Boolean(process.env.WIN_CSC_LINK && process.env.WIN_CSC_KEY_PASSWORD);

if (!hasCert) {
    console.warn('\n⚠ لا توجد شهادة توقيع (WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD).');
    console.warn('  ⇒ البناء سيكون غير موقّع، والتحديثات لن تُتحقَّق من توقيعها.');
    console.warn('  ⇒ هذا مقبول للتطوير فقط. للإنتاج: احصل على شهادة Authenticode');
    console.warn('    واضبط المتغيّرات، ثم أعد البناء.\n');
}

// نكتب config مؤقتًا (بدون تعديل package.json المراقب بالـgit)
const buildConfig = JSON.parse(JSON.stringify(pkg.build || {}));
if (hasCert) {
    buildConfig.win = { ...(buildConfig.win || {}) };
    buildConfig.win.verifyUpdateCodeSignature = true;
    buildConfig.win.signAndEditExecutable = true;
    // electron-builder يقرأ CSC_LINK/CSC_KEY_PASSWORD للـWindows
    process.env.CSC_LINK = process.env.WIN_CSC_LINK;
    process.env.CSC_KEY_PASSWORD = process.env.WIN_CSC_KEY_PASSWORD;
}

const tmpConfig = path.join(ROOT, 'logs', 'electron-builder.config.json');
fs.mkdirSync(path.dirname(tmpConfig), { recursive: true });
fs.writeFileSync(tmpConfig, JSON.stringify(buildConfig, null, 2), 'utf8');

console.log(`electron-builder config: ${hasCert ? 'موقّع ✓ (verifyUpdateCodeSignature=true)' : 'غير موقّع ✗'}`);
console.log(`config: ${path.relative(ROOT, tmpConfig)}`);
if (CONFIG_ONLY) {process.exit(0);}

const args = ['--config', tmpConfig];
if (process.argv.includes('--publish')) {args.push('--publish', 'always');}

console.log(`\n> npx electron-builder ${args.join(' ')}\n`);
const r = spawnSync('npx', ['electron-builder', ...args], {
    cwd: ROOT, stdio: 'inherit', shell: true, env: process.env,
});
if (r.status !== 0) {
    console.error(`\n✗ فشل البناء (code=${r.status})`);
    process.exit(r.status || 1);
}
console.log('\n✓ اكتمل البناء.');
if (!hasCert) {
    console.warn('⚠ تذكير: الحزمة غير موقّعة — فعّل WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD للإنتاج.');
}
