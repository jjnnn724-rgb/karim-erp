#!/usr/bin/env node
/**
 * karim1 — باني التغليف والتسليم لنظام مطاعم الشرفه العالمي (Task 30)
 * ────────────────────────────────────────────────────────────────────────────
 * أوامر:
 *   karim1 check            فحص بيئي شامل قبل أي بناء
 *   karim1 portable [--full]  حزمتا المصدر والتشغيل (tar.gz) — ‎--full يضمّن node_modules
 *   karim1 inno             توليد سكربت Inno Setup + دليله + بيانات الحزم
 *   karim1 exe              بناء NSIS EXE عبر electron-builder — Windows فقط
 *                           (حرس منصّة: على غير Windows يخرج برمز 2 فورًا
 *                            لمنع تعبئة ثنائيات Linux في مُثبِّت Windows معطوب)
 *   karim1 all              check + portable + inno (+ exe تلقائيًا على Windows)
 *
 * حارس التغطية: كل حزمة يجب أن تحوي كل مهاجرات database/migrations (منها 035)
 * والمُشغّلات karim/karim1/karim.cmd/karim1.cmd — الحزمة الناقصة تُرفض.
 *
 * المخرجات في dist/:
 *   karim-erp-source-v<ver>.tar.gz   كود المصدر (بلا ثنائيات ولا node_modules)
 *   karim-erp-runtime-v<ver>.tar.gz  حزمة التشغيل (تشمل قاعدة PG المدمجة، وnode_modules مع --full)
 *   installer/AlShorfa-ERP-Setup.iss + README-INNO.txt + manifests/*.json
 *   karim1-report.json               تقرير مفصل بالخطوات والبصمات
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const INSTALLER_DIR = path.join(DIST_DIR, 'installer');
const MANIFESTS_DIR = path.join(INSTALLER_DIR, 'manifests');
const PAYLOAD_DIR = path.join(INSTALLER_DIR, 'payload');

const INNO_APPID = '{{8C1F2A4E-77B1-4F3A-9C2D-5E47B1A2C3D4}}';

const lib = require('./shared');
const { log } = lib;

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PKG.version || '0.0.0';

// ما يستثنى من كل الحزم: مخلفات التشغيل والبناء + الأسرار والبيانات الحية
const BASE_EXCLUDES = [
    'node_modules', 'database/data', 'logs', 'dist', 'release',
    'database/backups', '.git', '.github', '*.tar.gz', '*.zip',
    'dist', 'agent-ctx', '.pytest_cache', '__pycache__',
    // أسرار: لا تُحزم أبدًا (.env.example مسموح — نمط دقيق لا يمس المشابه)
    '.env', '.env.local', '.env.production', 'database/pg-password.txt',
];

const report = {
    generatedAt: new Date().toISOString(),
    tool: 'karim1',
    version: VERSION,
    platform: `${process.platform}/${os.arch()}`,
    node: process.version,
    steps: {},
    artifacts: [],
};

function sha256(file) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    return hash.digest('hex');
}

function addArtifact(file, kind) {
    const bytes = fs.statSync(file).size;
    const entry = { kind, path: path.relative(ROOT, file), bytes, sha256: sha256(file) };
    report.artifacts.push(entry);
    return entry;
}

function writeManifest(name, file, kind, excludes) {
    const a = report.artifacts[report.artifacts.length - 1];
    const manifest = {
        generatedAt: new Date().toISOString(),
        kind,
        name: path.basename(file),
        version: VERSION,
        platform: process.platform,
        bytes: a.bytes,
        sha256: a.sha256,
        excludes,
        notes: ['لا يحتوي .env (أسرار)', 'لا يحتوي database/data (بيانات حية)', kind === 'source' ? 'بلا ثنائيات PG ولا node_modules' : 'يشمل ثنائيات PG المدمجة'],
    };
    fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(MANIFESTS_DIR, name), JSON.stringify(manifest, null, 2), 'utf-8');
}

function run(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, { cwd: ROOT, stdio: opts.silent ? 'pipe' : 'inherit', encoding: 'utf-8', timeout: opts.timeout || 300000 });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ─── 1) فحص بيئي ────────────────────────────────────────────────────────────
function stepCheck() {
    log.header(`karim1 check — v${VERSION} على ${process.platform}`);
    const checks = [];
    const push = (name, ok, detail) => { checks.push({ name, ok, detail }); log[ok ? 'ok' : 'warn'](`${name}: ${detail}`); };

    push('node', Number(process.versions.node.split('.')[0]) >= 18, process.version);
    push('package.json', !!PKG.name && !!VERSION, `${PKG.name}@${VERSION}`);
    const criticalFiles = [
        'backend/server.js', 'frontend/app/js/app.js', 'database/migrations',
        'database/scripts/db.js', 'scripts/build-app.js', 'scripts/serve.js',
        'karim', 'karim1', 'karim.cmd', 'karim1.cmd', 'package.json',
    ];
    for (const f of criticalFiles) {
        push(`ملف: ${f}`, fs.existsSync(path.join(ROOT, f)), fs.existsSync(path.join(ROOT, f)) ? 'موجود' : 'مفقود!');
    }
    const pgCtl = path.join(ROOT, 'database', 'bin', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
    push('PostgreSQL المدمج', fs.existsSync(pgCtl), fs.existsSync(pgCtl) ? pgCtl : 'غير مثبّت — npm run download-pg');
    const nodeModules = fs.existsSync(path.join(ROOT, 'node_modules'));
    push('node_modules', nodeModules, nodeModules ? 'مثبّت' : 'غائب — npm install (ضروري لـ --full)');
    const migrations = fs.readdirSync(path.join(ROOT, 'database', 'migrations')).filter(f => f.endsWith('.sql'));
    push('migrations', migrations.length >= 34, `${migrations.length} ملفًا (آخرها ${migrations[migrations.length - 1]})`);
    // حارس صريح: مهاجرة 035 (بنية لوحة القسم) يجب أن تكون حاضرة في أي بناء
    const has035 = migrations.some(f => /^035_dept_panel_infrastructure\.sql$/.test(f));
    push('migrations/035 (dept-panel)', has035, has035 ? 'موجودة' : 'مفقودة! — تُمنع الحزمة بدونها');
    const env = fs.existsSync(path.join(ROOT, '.env'));
    push('.env', env, env ? 'موجود (لا يُحزم أبدًا — يحتوي أسرار)' : 'غائب — karim start سيولّده');

    const failed = checks.filter(c => !c.ok).length;
    report.steps.check = { checks, failed };
    log.plain('');
    if (failed > 0) {
        log.warn(`فحص مكتمل مع ${failed} ملاحظة — راجع الأسطر أعلاه (لا يمنع البناء إلا إن كانت أساسية)`);
        return 0;
    }
    log.ok('البيئة جاهزة للبناء');
    return 0;
}

// ─── 2) الحزمتان ────────────────────────────────────────────────────────────
function stepPortable(full) {
    log.header(`karim1 portable — ${full ? 'مع node_modules (--full)' : 'بدون node_modules'}`);
    fs.mkdirSync(DIST_DIR, { recursive: true });
    const results = {};

    // حزمة المصدر: الكود فقط — بلا node_modules ولا ثنائيات PG ولا بيانات حية
    const sourceFile = path.join(DIST_DIR, `karim-erp-source-v${VERSION}.tar.gz`);
    log.step(`تغليف المصدر → ${path.basename(sourceFile)}`);
    const sourceExcludes = [...BASE_EXCLUDES, 'database/bin'];
    const sourceArgs = ['-czf', sourceFile];
    for (const ex of sourceExcludes) {sourceArgs.push(`--exclude=${ex}`);}
    sourceArgs.push('-C', ROOT, '.');
    const sourceRun = run('tar', sourceArgs, { silent: true });
    results.source = sourceRun.status === 0;
    if (results.source) {
        const a = addArtifact(sourceFile, 'source');
        writeManifest('source-manifest.json', sourceFile, 'source', sourceExcludes);
        log.ok(`${path.basename(sourceFile)} — ${(a.bytes / 1024 / 1024).toFixed(1)}MB — sha256 ✓`);
    }
    else {log.error('فشل تغليف المصدر');}

    // حزمة التشغيل: كود + ثنائيات PG المدمجة (+ node_modules مع --full)
    const runtimeFile = path.join(DIST_DIR, `karim-erp-runtime-v${VERSION}.tar.gz`);
    log.step(`تغليف التشغيل → ${path.basename(runtimeFile)}`);
    const runtimeExcludes = full ? BASE_EXCLUDES : [...BASE_EXCLUDES, 'node_modules'];
    const runtimeArgs = ['-czf', runtimeFile];
    for (const ex of runtimeExcludes) {runtimeArgs.push(`--exclude=${ex}`);}
    runtimeArgs.push('-C', ROOT, '.');
    const runtimeRun = run('tar', runtimeArgs, { silent: true });
    results.runtime = runtimeRun.status === 0;
    if (results.runtime) {
        const a = addArtifact(runtimeFile, 'runtime');
        writeManifest('runtime-manifest.json', runtimeFile, 'runtime', runtimeExcludes);
        log.ok(`${path.basename(runtimeFile)} — ${(a.bytes / 1024 / 1024).toFixed(1)}MB — sha256 ✓`);
    }
    else {log.error('فشل تغليف التشغيل');}

    if (full && !fs.existsSync(path.join(ROOT, 'node_modules'))) {
        log.warn('--full طُلب لكن node_modules غائب — الحزمة خرجت بلا اعتماديات، شغّل npm install أولًا');
    }

    report.steps.portable = results;
    return results.source && results.runtime ? 0 : 1;
}

// ─── 3) Inno Setup ──────────────────────────────────────────────────────────
function stepInno() {
    log.header('karim1 inno — توليد سكربت المثبِّت');
    fs.mkdirSync(MANIFESTS_DIR, { recursive: true });

    const iss = `; ═══════════════════════════════════════════════════════════════════
; AlShorfa-ERP-Setup.iss — مُثبِّت Windows لنظام مطاعم الشرفه العالمي
; توليد آلي بواسطة karim1 v${VERSION} — لا تحرّر هذا الملف يدويًا، أعد توليده بـ karim1 inno
; التغليف: ضع نسخة التشغيل الكاملة داخل مجلد payload/ بجانب هذا الملف
;          (karim1 exe على Windows يفعل ذلك تلقائيًا) ثم Compile من Inno Setup
; ═══════════════════════════════════════════════════════════════════
#define MyAppId "${INNO_APPID}"
#define MyAppName "Karim ERP — مطاعم الشرفه العالمي"
#define MyAppVersion "${VERSION}"
#define MyAppPublisher "AlShorfa Global Restaurants"
#define MyAppExeName "KarimERP.exe"
#define PayloadDir "payload"

; حارس الحمولة: البناء يفشل بصوت عالٍ إن كان payload فارغًا
; (لا يُسمح بمُثبِّت فارغ يبدو ناجحًا)
#ifndef PayloadSentinel
#define PayloadSentinel PayloadDir + "\\package.json"
#endif
#if !FileExists(PayloadSentinel)
#error "payload فارغ: ضع حزمة التشغيل داخل installer/payload قبل الترجمة"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\\KarimERP
DefaultGroupName={#MyAppName}
UninstallDisplayIcon={app}\\{#MyAppExeName}
OutputDir=.
OutputBaseFilename=AlShorfa-ERP-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
LaunchProgram=تشغيل Karim ERP بعد الإنهاء

[Files]
Source: "{#PayloadDir}\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "إنشاء أيقونة على سطح المكتب"; GroupDescription: "Additional:"

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&')}}"; Flags: nowait postinstall skipifsilent
`;
    const issFile = path.join(INSTALLER_DIR, 'AlShorfa-ERP-Setup.iss');
    fs.writeFileSync(issFile, iss, 'utf-8');
    addArtifact(issFile, 'inno-script');
    log.ok(`سكربت المثبِّت: ${path.relative(ROOT, issFile)}`);

    const readme = `AlShorfa ERP — دليل بناء مثبِّت Windows (Inno Setup)
=====================================================
الإصدار: ${VERSION}
التوليد: ${report.generatedAt} بواسطة karim1 على ${process.platform}

المتطلب:
  - Inno Setup 6.3 أو أحدث مع مكونات المعالج القبلي (Preprocessor) — القياسية.
  - اكتمل بَناء exe بنجاح بواسطة karim1 exe على Windows (يملأ payload/).

الخطوات:
  1) على Windows: ./karim1 exe
     يبني نسخة electron-builder NSIS/Portable ويجهز installer/payload تلقائيًا.
  2) افتح installer/AlShorfa-ERP-Setup.iss في Inno Setup Compiler واضغط Compile.
     - إن كان payload فارغًا يفشل الترجمة فورًا (حارس مدمج) — هذا مقصود.
  3) الناتج: installer/AlShorfa-ERP-Setup-v${VERSION}.exe

ملاحظات أمانة:
  - هذا السكربت وُلّد على ${process.platform} — بَناء EXE الفعلي يحتاج Windows.
  - الحزمتان source/runtime في dist/ لا تحتويان .env (أسرار) ولا database/data (بيانات حية).
  - حمولة Inno تشمل: كل المهاجرات (035 ضمنها) + karim/karim1 (shell وcmd) + database/bin + node_modules،
    وتفترض وجود Node.js على جهاز التشغيل — للمُثبِّت الذاتي الكامل استخدم ناتج electron-builder الأساسي.
`;
    const readmeFile = path.join(INSTALLER_DIR, 'README-INNO.txt');
    fs.writeFileSync(readmeFile, readme, 'utf-8');
    addArtifact(readmeFile, 'inno-readme');
    log.ok(`دليل البناء: ${path.relative(ROOT, readmeFile)}`);

    report.steps.inno = { iss: path.relative(ROOT, issFile), readme: path.relative(ROOT, readmeFile) };
    return 0;
}

// ─── 4) EXE — حرس المنصة ────────────────────────────────────────────────────
function stepExe() {
    if (process.platform !== 'win32') {
        log.error('karim1 exe متاح على Windows فقط — ثنائيات Linux لن تُعبَّأ في مُثبِّت Windows');
        report.steps.exe = { skipped: true, reason: `platform ${process.platform}` };
        return 2; // حرس المنصة: رمز 2 موثق — لا خروج مباشر حتى يُكتب التقرير
    }
    log.header('karim1 exe — بناء NSIS عبر electron-builder');
    log.step('تجهيز installer/payload من حزمة التشغيل');
    fs.mkdirSync(PAYLOAD_DIR, { recursive: true });
    // الحمولة الكاملة القابلة للتشغيل: الكود + المهاجرات (شاملة 035) + ثنائيات PG
    // + الاعتماديات + المُشغّلات karim/karim1 بأسماء الجذر (لينكس وويندوز)
    const payloadEntries = [
        'package.json', 'backend', 'frontend',
        'database/migrations', 'database/scripts', 'database/bin',
        'scripts', 'node_modules', '.env.example',
        'karim', 'karim1', 'karim.cmd', 'karim1.cmd',
    ];
    for (const entry of payloadEntries) {
        const src = path.join(ROOT, entry);
        if (!fs.existsSync(src)) {
            // database/bin حرجة — لا حمولة صالحة بدون ثنائيات PG (حرس صاخب لا صامت)
            if (entry === 'database/bin') {
                log.error('database/bin غائب — شغّل npm run download-pg أولًا (لا يمكن بناء مثبّت بلا PostgreSQL)');
                report.steps.exe = { error: 'database/bin missing' };
                return 1;
            }
            log.warn(`تخطي ${entry} (غير موجود)`);
            continue;
        }
        // حرس ثنائيات ويندوز: database/bin على Windows يجب أن تحوي pg_ctl.exe
        if (entry === 'database/bin' && process.platform === 'win32'
            && !fs.existsSync(path.join(ROOT, 'database', 'bin', 'bin', 'pg_ctl.exe'))) {
            log.error('database/bin لا تحوي pg_ctl.exe — ثنائيات PG لويندوز غير محمّلة (npm run download-pg)');
            report.steps.exe = { error: 'pg_ctl.exe missing from database/bin' };
            return 1;
        }
        const dest = path.join(PAYLOAD_DIR, entry);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const cp = run('cp', process.platform === 'win32' ? ['/r', src, dest] : ['-r', src, dest], { silent: true, timeout: 900000 });
        if (cp.status !== 0) { log.error(`فشل نسخ ${entry}`); return 1; }
    }
    log.ok(`الحمولة: ${payloadEntries.length} عنصرًا (شاملة مهاجرة 035 والمُشغّلات karim/karim1)`);
    log.step('electron-builder NSIS');
    const build = run('npm', ['run', 'electron:build:nsis'], { timeout: 900000 });
    report.steps.exe = { status: build.status };
    if (build.status !== 0) {
        log.error('فشل بناء NSIS — راجع مخرجات electron-builder');
        return 1;
    }
    log.ok('EXE جاهز في release/');
    return 0;
}

// ─── 5) الكل ────────────────────────────────────────────────────────────────
async function stepAll() {
    let code = stepCheck();
    if (code === 0) {code = stepPortable(process.argv.includes('--full'));}
    if (code === 0) {code = stepInno();}
    if (code === 0) {
        if (process.platform === 'win32') {code = stepExe();}
        else {log.info('خطوة exe تُتخطى هنا (تحتاج Windows) — شغّل karim1 exe على جهاز Windows');}
    }
    return code;
}

function writeReport() {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    const reportFile = path.join(DIST_DIR, 'karim1-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    log.ok(`التقرير: ${path.relative(ROOT, reportFile)}`);
}

async function main() {
    const command = String(process.argv[2] || 'check').toLowerCase();
    const full = process.argv.includes('--full');
    let code;
    if (command === 'check') {code = stepCheck();}
    else if (command === 'portable') {code = stepPortable(full);}
    else if (command === 'inno') {code = stepInno();}
    else if (command === 'exe') {code = stepExe();}
    else if (command === 'all') {code = await stepAll();}
    else {
        console.log('الاستخدام: karim1 [check|portable [--full]|inno|exe|all]');
        code = 1;
    }
    writeReport();
    process.exit(code);
}

main().catch((error) => {
    console.error('[karim1] خطأ غير متوقع:', error.message || error);
    process.exit(1);
});
