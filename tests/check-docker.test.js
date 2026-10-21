/**
 * check-docker.test.js — بوابة فحص الحاويات (Dockerfile + compose) بلا Docker
 * ────────────────────────────────────────────────────────────────────────────
 * لا يوجد Docker على هذا المضيف ⇒ لا بناء ولا اختبار للصورة هنا. البوابة
 * تحلّ محل ذلك للعيوب التي تُكتشف عادةً في بيئة خاطئة فقط:
 *   · "//" بدل "#" ⇒ "unknown instruction" والبناء يفشل.
 *   · COPY .env ⇒ أسرار مخبوزة داخل الصورة.
 *   · USER root أو غياب USER ⇒ ثغرة كاملة على المضيف لو اخترق التطبيق.
 *   · منفذ قاعدة البيانات مكشوف على كل الواجهات.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-docker.js');

function run(args = []) {
    try {
        const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

function tmp(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-docker-'));
    const paths = {};
    for (const [k, v] of Object.entries(files)) {
        paths[k] = path.join(dir, k);
        fs.writeFileSync(paths[k], v, 'utf8');
    }
    return paths;
}

const GOOD_DOCKERFILE = [
    'FROM node:20-slim',
    'RUN groupadd --system --gid 1001 karim && useradd --system --uid 1001 karim',
    'WORKDIR /app',
    'COPY --chown=karim:karim backend/ ./backend/',
    'USER karim',
    'EXPOSE 5000',
    'CMD ["node", "backend/server.js"]',
].join('\n');

const GOOD_COMPOSE = [
    'services:',
    '  db:',
    '    image: postgres:18-alpine',
    '    ports:',
    '      - "127.0.0.1:5433:5432"',
    '  app:',
    '    image: karim-erp:portable',
].join('\n');

describe('بوابة فحص الحاويات', () => {
    test('الملفات الحالية سليمة (0 خطأ)', () => {
        const r = run();
        expect(r.ok).toBe(true);
        expect(r.out).toContain('0 خطأ');
    });

    test('تعليق بـ "//" يُكتشف (يكسر البناء)', () => {
        const p = tmp({
            'Dockerfile': `FROM node:20-slim\n// تعليق خاطئ\nUSER karim\nEXPOSE 5000\n`,
            'docker-compose.yml': GOOD_COMPOSE,
        });
        const r = run(['--dockerfile', p['Dockerfile'], '--compose', p['docker-compose.yml']]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('unknown instruction');
    });

    test('نسخ .env داخل الصورة يُرفض', () => {
        const p = tmp({
            'Dockerfile': `FROM node:20-slim\nCOPY .env ./\nUSER karim\nEXPOSE 5000\n`,
            'docker-compose.yml': GOOD_COMPOSE,
        });
        const r = run(['--dockerfile', p['Dockerfile'], '--compose', p['docker-compose.yml']]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('أسرار');
    });

    test('USER root أو غياب USER ⇒ خطأ', () => {
        const rootDf = tmp({
            'Dockerfile': 'FROM node:20-slim\nUSER root\nEXPOSE 5000\n',
            'docker-compose.yml': GOOD_COMPOSE,
        });
        expect(run(['--dockerfile', rootDf['Dockerfile'], '--compose', rootDf['docker-compose.yml']]).ok).toBe(false);

        const noUserDf = tmp({
            'Dockerfile': 'FROM node:20-slim\nEXPOSE 5000\n',
            'docker-compose.yml': GOOD_COMPOSE,
        });
        const r = run(['--dockerfile', noUserDf['Dockerfile'], '--compose', noUserDf['docker-compose.yml']]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('root');
    });

    test('منفذ قاعدة البيانات المكشوف ⇒ خطأ', () => {
        const p = tmp({
            'Dockerfile': GOOD_DOCKERFILE,
            'docker-compose.yml': 'services:\n  db:\n    ports:\n      - "5432:5432"\n',
        });
        const r = run(['--dockerfile', p['Dockerfile'], '--compose', p['docker-compose.yml']]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('127.0.0.1');
    });

    test('compose نظيف + Dockerfile نظيف ⇒ نجاح', () => {
        const p = tmp({ 'Dockerfile': GOOD_DOCKERFILE, 'docker-compose.yml': GOOD_COMPOSE });
        const r = run(['--dockerfile', p['Dockerfile'], '--compose', p['docker-compose.yml']]);
        expect(r.ok).toBe(true);
    });

    test('privileged / user root في compose ⇒ خطأ', () => {
        const p = tmp({
            'Dockerfile': GOOD_DOCKERFILE,
            'docker-compose.yml': 'services:\n  app:\n    privileged: true\n    user: root\n',
        });
        const r = run(['--dockerfile', p['Dockerfile'], '--compose', p['docker-compose.yml']]);
        expect(r.ok).toBe(false);
        expect(r.out).toContain('privileged');
    });
});
