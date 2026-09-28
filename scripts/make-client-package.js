/**
 * scripts/make-client-package.js — تجميع حزمة عميل الشبكة (Karim-Client)
 * ────────────────────────────────────────────────────────────────────────────
 * بعد بناء الإصدار المكتبي (npm run electron:build) يأخذ هذا السكربت
 * release/win-unpacked، يضيف ملف العلامة client-mode.json الذي يحوّل التطبيق
 * إلى عميل يكتشف السيرفر تلقائيًا عبر UDP (بلا أي إعدادات)، ويضع دليل استخدام،
 * ثم يعبّئ كل شيء في release/Karim-Client-<version>.zip — مجلد واحد يُنسخ
 * لأي جهاز على الشبكة وتشغيل Karim-Client.exe فقط.
 *
 * بديل التثبيت الكامل: ثبّت KarimERP-Setup العادي ثم ضع client-mode.json
 * في مجلد التثبيت أو %APPDATA%\karim-erp\ — نفس النتيجة.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0');
const unpacked = path.join(root, 'release', 'win-unpacked');

if (!fs.existsSync(unpacked)) {
    console.error('✗ لا يوجد release/win-unpacked — شغّل npm run electron:build أولاً ثم أعد هذا السكربت');
    process.exit(1);
}

const outDir = path.join(root, 'release', `Karim-Client-${version}`);
const zipPath = path.join(root, 'release', `Karim-Client-${version}.zip`);

console.log('→ نسخ win-unpacked إلى', path.basename(outDir), '(قد يستغرق دقيقة)…');
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(unpacked, outDir, { recursive: true });

// علامة وضع العميل — بلا عنوان: الاكتشاف التلقائي يحدد السيرفر على الشبكة
fs.writeFileSync(path.join(outDir, 'client-mode.json'),
    JSON.stringify({ discovery: true }, null, 2), 'utf8');

// إعادة تسمية التنفيذي ليكون واضحًا للمستخدم
const exeName = 'KarimERP.exe';
const exeSrc = path.join(outDir, exeName);
const clientExe = path.join(outDir, 'Karim-Client.exe');
if (fs.existsSync(exeSrc)) {fs.renameSync(exeSrc, clientExe);}

const readme = `Karim ERP — عميل الشبكة (v${version})
════════════════════════════════════════════

شغّل Karim-Client.exe — سيكتشف الخادم على الشبكة تلقائيًا ويتصل به.

المتطلبات:
  • جهاز الخادم يعمل (تطبيق Karim ERP السيرفر) ومتصل بنفس الشبكة
  • لا حاجة لأي إعدادات — الاكتشاف تلقائي عبر الشبكة المحلية

لو فشل الاكتشاف التلقائي:
  1) أنشئ ملف اسمه server-target.json بجانب Karim-Client.exe بالمحتوى:
       { "serverUrl": "https://عنوان-السيرفر:5000" }
  2) أعد فتح البرنامج — العنوان اليدوي له الأولوية.

التحديثات:
  • العميل يتحقق من السيرفر كل 10 دقائق ويحدّث نفسه تلقائيًا من مجلد
    updates على جهاز السيرفر — لا حاجة لإنترنت ولا تثبيت يدوي.

ملاحظات:
  • هذا الجهاز لا يحتاج PostgreSQL — كل شيء على السيرفر.
  • حذف client-mode.json يعيد التطبيق لوضع السيرفر المحلي (لا تفعل ذلك
    على أجهزة الكاشير).
`;
fs.writeFileSync(path.join(outDir, 'اقرأني.txt'), readme, 'utf8');

console.log('→ ضغط الحزمة…');
fs.rmSync(zipPath, { force: true });
try {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' });
    console.log(`✓ جاهز: release/Karim-Client-${version}.zip (والمجلد ${path.basename(outDir)} جاهز للنسخ مباشرة)`);
} catch (e) {
    console.warn(`⚠ الضغط فشل (${e.message}) — المجلد ${path.basename(outDir)} نفسه جاهز للنسخ للشبكة`);
}
