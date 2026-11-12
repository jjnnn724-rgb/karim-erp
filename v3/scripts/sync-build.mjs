#!/usr/bin/env node
/**
 * مزامنة بُنية V3 — من `v3/apps/web/dist` إلى `frontend/v3` التي يخدمها
 * `backend/v3-static.js`.
 *
 * المزامنة تلمس `index.html` و`assets/*` المبصومة وملفات PWA الجذرية
 * (`manifest.webmanifest` و`sw.js`). كل ما عداها (`rollout.json` موعد القلب،
 * `screens.json` الشاشات، `preview/`، `v2-announce.*`) يبقى كما هو — يُتحقق
 * من ذلك بالبصمة بعد النسخ.
 *
 * الأصول القديمة لا تُحذف تلقائيًا: تُعدّ وتُذكر فقط، لأن الحذف قرار مالكٍ
 * منفصل (تبويبات مفتوحة قد تطلبها، والتاريخ في git يحفظها).
 *
 * الاستخدام:
 *   node v3/scripts/sync-build.mjs [--dry-run] [--from <dist>] [--to <frontend/v3>]
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DEFAULTS = {
    from: path.join(REPO, 'v3', 'apps', 'web', 'dist'),
    to: path.join(REPO, 'frontend', 'v3'),
};

const PRESERVED = ['rollout.json', 'screens.json', 'preview', 'v2-announce.css', 'v2-announce.js'];
/**
 * مجلدات أصول غير مبصومة تُنسخ كاملة. `img/` تحمل صور أصناف الكاشير التي
 * تشير إليها قاعدة البيانات (`/v3/img/pos/…`) — بلا نسخها يظهر الكاشير بلا صور.
 */
const STATIC_DIRS = ['img'];
/** ملفات PWA التي يخدمها Express مباشرة من `frontend/v3`. */
const PWA_FILES = [
    'manifest.webmanifest',
    'manifest-cashier.webmanifest',
    'sw.js',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-192-maskable.png',
    'icons/icon-512-maskable.png',
];
/** أصول البناء المبصومة فقط — `/app/assets/icon-192.png` أصلٌ قديم لا يُطلب من dist. */
const HASHED_ASSET = /^assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg)$/;

function parseArgs(argv) {
    const options = { dryRun: false, from: DEFAULTS.from, to: DEFAULTS.to };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--from' || arg === '--to') {
            const value = argv[index + 1];
            if (!value) {
                throw new Error(`${arg} يحتاج مسارًا`);
            }
            options[arg === '--from' ? 'from' : 'to'] = path.resolve(value);
            index += 1;
        } else {
            throw new Error(`وسيط غير معروف: ${arg}`);
        }
    }
    return options;
}

function sha256(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

/** بصمة ملف أو مجلد (اسم/حجم/زمن كل ملف) — `preview/` مجلد لا يُقرأ كملف. */
function fingerprint(target) {
    if (!existsSync(target)) {
        return null;
    }
    if (statSync(target).isFile()) {
        return sha256(target);
    }
    const hash = createHash('sha256');
    const walk = (dir, prefix) => {
        for (const name of readdirSync(dir).sort()) {
            const full = path.join(dir, name);
            const stat = statSync(full);
            if (stat.isDirectory()) {
                walk(full, `${prefix}${name}/`);
            } else {
                hash.update(`${prefix}${name}:${stat.size}:${stat.mtimeMs}\n`);
            }
        }
    };
    walk(target, '');
    return hash.digest('hex').slice(0, 16);
}

/** بصمة محتوى شجرة ملفات — تُستخدم للتحقق بعد النسخ (بلا اعتماد على زمن التعديل). */
function treeHash(dir) {
    const hash = createHash('sha256');
    const walk = (current, prefix) => {
        for (const name of readdirSync(current).sort()) {
            const full = path.join(current, name);
            if (statSync(full).isDirectory()) {
                walk(full, `${prefix}${name}/`);
            } else {
                hash.update(`${prefix}${name}:`);
                hash.update(readFileSync(full));
            }
        }
    };
    walk(dir, '');
    return hash.digest('hex').slice(0, 16);
}

/** نسخ مجلد أصول كما هو (مع إنشاء المجلدات الفرعية). */
function copyTree(source, target) {
    mkdirSync(target, { recursive: true });
    let files = 0;
    for (const name of readdirSync(source)) {
        const from = path.join(source, name);
        const to = path.join(target, name);
        if (statSync(from).isDirectory()) {
            files += copyTree(from, to);
        } else {
            copyFileSync(from, to);
            files += 1;
        }
    }
    return files;
}

function fail(message) {
    console.error(`✗ ${message}`);
    process.exit(1);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const sourceIndex = path.join(options.from, 'index.html');
    const sourceAssets = path.join(options.from, 'assets');
    const sourcePwa = PWA_FILES.map((name) => path.join(options.from, name));

    if (!existsSync(sourceIndex) || !statSync(sourceIndex).isFile()) {
        fail(`بُنية غير موجودة: ${sourceIndex} — شغّل pnpm build داخل v3 أولًا`);
    }
    if (!existsSync(sourceAssets) || !statSync(sourceAssets).isDirectory()) {
        fail(`مجلد أصول غير موجود: ${sourceAssets}`);
    }
    const missingPwa = sourcePwa.filter((file) => !existsSync(file) || !statSync(file).isFile());
    if (missingPwa.length > 0) {
        fail(`ملفات PWA غير موجودة: ${missingPwa.join(', ')} — شغّل pnpm build داخل v3 أولًا`);
    }

    const html = readFileSync(sourceIndex, 'utf8');
    const referenced = [...new Set(html.match(/assets\/[A-Za-z0-9._-]+/g) ?? [])];
    const missing = referenced.filter((relative) => HASHED_ASSET.test(relative) && !existsSync(path.join(options.from, relative)));
    if (missing.length > 0) {
        fail(`index.html يشير إلى أصول غير موجودة: ${missing.join(', ')}`);
    }

    const preservedBefore = new Map();
    for (const name of PRESERVED) {
        const file = path.join(options.to, name);
        preservedBefore.set(name, fingerprint(file));
    }

    const assetFiles = readdirSync(sourceAssets).filter((name) => statSync(path.join(sourceAssets, name)).isFile());
    const targetAssets = path.join(options.to, 'assets');
    const previous = existsSync(targetAssets) ? readdirSync(targetAssets) : [];
    const stale = previous.filter((name) => !assetFiles.includes(name));

    const summary = {
        dryRun: options.dryRun,
        from: options.from,
        to: options.to,
        index: { sha256: sha256(sourceIndex), references: referenced },
        assets: { copied: assetFiles.length, staleInTarget: stale.length, staleSample: stale.slice(0, 8) },
        staticDirs: STATIC_DIRS.filter((dir) => existsSync(path.join(options.from, dir))).map((dir) => ({
            dir,
            present: true,
        })),
        pwa: { copied: PWA_FILES },
    };

    if (options.dryRun) {
        console.log(JSON.stringify(summary, null, 2));
        console.log('ℹ dry-run — لم يُكتب أي ملف.');
        return;
    }

    mkdirSync(targetAssets, { recursive: true });
    copyFileSync(sourceIndex, path.join(options.to, 'index.html'));
    for (const name of assetFiles) {
        copyFileSync(path.join(sourceAssets, name), path.join(targetAssets, name));
    }
    const staticCopied = {};
    for (const dir of STATIC_DIRS) {
        const source = path.join(options.from, dir);
        if (!existsSync(source) || !statSync(source).isDirectory()) continue;
        staticCopied[dir] = copyTree(source, path.join(options.to, dir));
    }
    for (const name of PWA_FILES) {
        const target = path.join(options.to, name);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(path.join(options.from, name), target);
    }

    if (sha256(path.join(options.to, 'index.html')) !== summary.index.sha256) {
        fail('index.html في الهدف لا يطابق المصدر بعد النسخ');
    }
    for (const name of PWA_FILES) {
        if (sha256(path.join(options.to, name)) !== sha256(path.join(options.from, name))) {
            fail(`${name} في الهدف لا يطابق المصدر بعد النسخ`);
        }
    }
    for (const [dir, count] of Object.entries(staticCopied)) {
        if (count === 0) {
            fail(`مجلد الأصول ${dir} فارغ في المصدر`);
        }
        if (treeHash(path.join(options.from, dir)) !== treeHash(path.join(options.to, dir))) {
            fail(`مجلد الأصول ${dir} في الهدف لا يطابق المصدر بعد النسخ`);
        }
    }
    for (const name of PRESERVED) {
        const file = path.join(options.to, name);
        const before = preservedBefore.get(name);
        const after = fingerprint(file);
        if (before !== after) {
            fail(`ملف محفوظ تغيّر أثناء المزامنة: ${name} — راجعه فورًا`);
        }
    }

    console.log(JSON.stringify({ ...summary, staticDirs: { copied: staticCopied }, verified: true }, null, 2));
}

main();
