import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * بوابة Lighthouse — ميزانية أداء/وصول/ممارسات/SEO على الحزمة المبنية.
 *
 * الافتراضي: الحزمة العامة الثابتة `http://127.0.0.1:5320/v3/` (نفس خادم
 * `static-server.mjs` الذي تخدمه الحزمة العامة في Playwright). إن لم يكن
 * الخادم قائمًا شغّله السكربت نفسه ثم أوقفه بعد الفحص. للتشغيل الحي مرّر
 * `LIGHTHOUSE_URL` (لن يُشغَّل خادم محلي إذن).
 *
 * الحدود في `e2e/lighthouse-budget.json` — الفشل عند أي تجاوز. المتصفح هو
 * Chromium المثبّت عبر Playwright (يُبحث في ms-playwright، ويُقدَّم الكامل
 * على headless shell)، ويُمرَّر عبر `CHROME_PATH` إلى chrome-launcher.
 *
 * التقرير JSON يُكتب في مجلد مؤقت (خارج المستودع) ويُطبع مساره.
 */

const WEB = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const E2E = join(WEB, 'e2e');
const PORT = Number(process.env.V3_E2E_PORT ?? 5320);
const URL_TARGET = process.env.LIGHTHOUSE_URL ?? `http://127.0.0.1:${PORT}/v3/`;
const BUDGET = JSON.parse(readFileSync(join(E2E, 'lighthouse-budget.json'), 'utf8'));
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const REPORT_DIR = join(tmpdir(), 'karim-v3-lighthouse');
const REPORT_PATH = join(REPORT_DIR, 'report.json');

/** إيجاد Chromium المثبّت عبر Playwright — الكامل أولًا ثم headless shell. */
function findChrome() {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
    const roots = [
        process.env.PLAYWRIGHT_BROWSERS_PATH,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : '',
        home ? join(home, 'AppData', 'Local', 'ms-playwright') : '',
        home ? join(home, '.cache', 'ms-playwright') : '',
        home ? join(home, 'Library', 'Caches', 'ms-playwright') : '',
    ].filter(Boolean);
    // تخطيطات Playwright القديمة والجديدة (chrome-win → chrome-win64 منذ 1.6x).
    const exes = {
        win32: {
            full: [join('chrome-win64', 'chrome.exe'), join('chrome-win', 'chrome.exe')],
            shell: [
                join('chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
                join('chrome-win', 'headless_shell.exe'),
            ],
        },
        linux: {
            full: [join('chrome-linux64', 'chrome'), join('chrome-linux', 'chrome')],
            shell: [
                join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
                join('chrome-headless-shell-linux', 'headless_shell'),
                join('chrome-linux', 'headless_shell'),
            ],
        },
        darwin: {
            full: [
                join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                join('chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            ],
            shell: [
                join('chrome-headless-shell-mac', 'chrome-headless-shell'),
                join('chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
                join('chrome-mac', 'headless_shell'),
            ],
        },
    }[process.platform];
    if (!exes) return '';
    const found = [];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        for (const dir of readdirSync(root)) {
            const match = /^chromium(_headless_shell)?-(\d+)$/.exec(dir);
            if (!match) continue;
            const kind = match[1] ? 'shell' : 'full';
            for (const rel of exes[kind]) {
                const exe = join(root, dir, rel);
                if (existsSync(exe)) {
                    found.push({ kind, rev: Number(match[2]), exe });
                    break;
                }
            }
        }
    }
    // الكامل أولًا (يدعم كل ما يفحصه Lighthouse)، ثم الأحدث مراجعةً.
    found.sort((a, b) => (a.kind === b.kind ? b.rev - a.rev : a.kind === 'full' ? -1 : 1));
    return found[0]?.exe ?? '';
}

async function reachable(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2_500), redirect: 'follow' });
        return response.ok;
    } catch {
        return false;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** تشغيل أمر وجمع مخرجاته — يرفض عند رمز خروج غير صفري. */
function run(command, args, options) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => {
            out += chunk;
        });
        child.stderr.on('data', (chunk) => {
            err += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolvePromise({ out, err });
            else reject(new Error(`${command} exited ${code}\n${err || out}`));
        });
    });
}

async function main() {
    const chrome = findChrome();
    if (!chrome) {
        console.error('لم يُعثر على Chromium الخاص بـPlaywright — شغّل: npx playwright install chromium');
        process.exit(1);
    }
    console.log(`المتصفح: ${chrome}`);
    console.log(`الهدف: ${URL_TARGET}`);

    let server = null;
    if (!process.env.LIGHTHOUSE_URL) {
        if (!existsSync(join(WEB, 'dist', 'index.html'))) {
            console.error('لا يوجد dist مبني — شغّل أولًا: pnpm build (في v3/apps/web)');
            process.exit(1);
        }
        if (!(await reachable(URL_TARGET))) {
            server = spawn(process.execPath, [join(E2E, 'scripts', 'static-server.mjs')], {
                env: { ...process.env, V3_E2E_PORT: String(PORT) },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            server.stdout.on('data', (chunk) => process.stdout.write(chunk));
            server.stderr.on('data', (chunk) => process.stderr.write(chunk));
            let ready = false;
            for (let i = 0; i < 40; i += 1) {
                if (await reachable(URL_TARGET)) {
                    ready = true;
                    break;
                }
                await sleep(500);
            }
            if (!ready) {
                server.kill();
                console.error('تعذّر إقلاع الخادم الثابت على المنفذ المحدد.');
                process.exit(1);
            }
        } else {
            console.log('الخادم الثابت قائم أصلًا — يُعاد استخدامه.');
        }
    } else if (!(await reachable(URL_TARGET))) {
        console.error(`LIGHTHOUSE_URL غير قابل للوصول: ${URL_TARGET}`);
        process.exit(1);
    }

    mkdirSync(REPORT_DIR, { recursive: true });
    const cli = join(WEB, 'node_modules', 'lighthouse', 'cli', 'index.js');
    const args = [
        cli,
        URL_TARGET,
        '--output=json',
        `--output-path=${REPORT_PATH}`,
        `--only-categories=${CATEGORIES.join(',')}`,
        '--quiet',
        '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
    ];
    if (process.env.LIGHTHOUSE_PRESET === 'desktop') args.push('--preset=desktop');

    try {
        await run(process.execPath, args, { cwd: WEB, env: { ...process.env, CHROME_PATH: chrome } });
    } catch (error) {
        console.error(`فشل تشغيل Lighthouse:\n${error.message}`);
        process.exitCode = 1;
        return;
    } finally {
        if (server) server.kill();
    }

    const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
    console.log(`\nميزانية Lighthouse (الحدود من e2e/lighthouse-budget.json):`);
    let failed = false;
    for (const category of CATEGORIES) {
        const score = report.categories?.[category]?.score;
        const limit = BUDGET[category];
        if (typeof score !== 'number') {
            console.error(`  ✗ ${category.padEnd(15)} لا نتيجة في التقرير`);
            failed = true;
            continue;
        }
        const over = score < limit;
        failed ||= over;
        console.log(`  ${over ? '✗' : '✓'} ${category.padEnd(15)} ${score.toFixed(2)} / ${limit.toFixed(2)}`);
    }
    console.log(`\nالتقرير الكامل: ${REPORT_PATH}`);
    if (failed) {
        console.error('تجاوزت النتيجة ميزانية Lighthouse — أصلح الانحدار أو وثّق رفع الحد في lighthouse-budget.json.');
        process.exitCode = 1;
        return;
    }
    console.log('داخل الميزانية.');
}

await main();
