'use strict';
/**
 * tests/security-gate.test.js — بوابة الأمان داخل npm test
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا jest وليس سكربتًا فقط:
 *   · npm test هو المسار الذي يمرّ به كل تعديل — ربط البوابة هنا يعني أن
 *     أي كود جديد لا يجتازها لا يمرّ أصلًا (قاعدة «الأبواب» المطلوبة).
 *   · اختبارات العضّ السلبي تثبت أن البوابة تفشل فعلاً على كود خطر،
 *     لا أنها «خضراء» دائماً (أخضر كاذب أخطر من بوابة مكسورة).
 */
const fs = require('fs');
const path = require('path');
const { scanContent, runGate } = require('../scripts/security-gate');

describe('بوابة الأمان — الالتزام بالمجموعة الحالية', () => {
    test('صفر انتهاكات مقابل الأساس والثوابت', () => {
        const res = runGate();
        expect(res.violations).toEqual([]);
        expect(res.ok).toBe(true);
    });

    test('ملف الأساس والثوابت موجودان على القرص', () => {
        expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'security-baseline.json'))).toBe(true);
        expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'check-secrets.js'))).toBe(true);
        expect(fs.existsSync(path.join(__dirname, '..', 'backend', 'middleware', 'security.js'))).toBe(true);
    });
});

describe('بوابة الأمان — اختبارات العضّ (تثبت أن البوابة تفشل)', () => {
    test('قاعدة صفرية: eval وnew Function يُمسكان دائمًا', () => {
        expect(scanContent('backend/_probe.js', 'const x = eval(input);').some((f) => f.rule === 'no-eval')).toBe(true);
        expect(scanContent('backend/_probe.js', 'const f = new Function(a);').some((f) => f.rule === 'no-eval')).toBe(true);
    });

    test('حقن SQL من req يُمسك، والاستعلام المُعاملَل يمر', () => {
        const bad = scanContent('backend/_probe.js', 'await pool.query(`SELECT * FROM t WHERE id = ${req.query.id}`);');
        expect(bad.some((f) => f.rule === 'sql-interp')).toBe(true);
        const good = scanContent('backend/_probe.js', "await pool.query('SELECT * FROM t WHERE id = $1', [id]);");
        expect(good.some((f) => f.rule === 'sql-interp')).toBe(false);
    });

    test('XSS: حقن innerHTML غير المغلّف يُمسك وesc() يمر', () => {
        const bad = scanContent('frontend/app/js/_probe.js', 'el.innerHTML = `<b>${name}</b>`;');
        expect(bad.some((f) => f.rule === 'html-unescaped')).toBe(true);
        const good = scanContent('frontend/app/js/_probe.js', 'el.innerHTML = `<b>${esc(name)}</b>`;');
        expect(good.some((f) => f.rule === 'html-unescaped')).toBe(false);
    });

    test('التعليقات ليست كودًا: نص هجوم داخل تعليق لا يُمسك', () => {
        const commented = scanContent('backend/_probe.js', '// eval(userInput)\n/* pool.query(`SELECT ${x}`) */\nconst a = 1;');
        expect(commented).toEqual([]);
    });

    test('مسار جديد بلا مصادقة يُمسك ولو كان الملف باقيه محميًا', () => {
        const src = [
            "router.get('/ok', jwtAuth, async (req, res) => {});",
            "router.post('/open', async (req, res) => {});",
        ].join('\n');
        const keys = scanContent('backend/_probe-routes.js', src)
            .filter((f) => f.rule === 'unguarded-route').map((f) => f.key);
        expect(keys.some((k) => k.includes('POST /open'))).toBe(true);
        expect(keys.some((k) => k.includes('GET /ok'))).toBe(false);
    });

    test('حارس على مستوى الموجّه يغطي مسارات الملف', () => {
        const src = [
            'router.use(jwtAuth, requireRole(\'admin\'));',
            "router.delete('/x', async (req, res) => {});",
        ].join('\n');
        expect(scanContent('backend/_probe-routes.js', src).filter((f) => f.rule === 'unguarded-route')).toEqual([]);
    });

    test('زيادة حصّة ملف فوق الأساس تُفضح (محاكاة انتهاك)', () => {
        // محاكاة: ملف موجود في الأساس بحصّة N، وكود جديد يضيف إصابة (N+1)
        const findings = {
            'sql-interp': { 'backend/ai-assistant/tools.js': { count: 999, line: 1 } },
        };
        const res = runGate({ findings, filesScanned: 1 });
        expect(res.ok).toBe(false);
        expect(res.violations.some((v) => v.includes('sql-interp'))).toBe(true);
    });
});

describe('بوابة الأمان — الاستثناءات الموثقة (_exceptions)', () => {
    const KEY = 'frontend/app/js/v2/screens/_probe.js';
    const findingsAt = (count) => ({ 'html-unescaped': { [KEY]: { count, line: 531 } } });
    const base = (extra) => ({
        'html-unescaped': { [KEY]: 9 },
        _exceptions: [{
            rule: 'html-unescaped', file: KEY, count: 10,
            owner: 'owner', reference: 'SEC-TEST', reason: 'سبب', ...extra,
        }],
    });

    test('استثناء ساري يخفي الانتهاك ويظهر ملاحظة بمرجعه', () => {
        const res = runGate({ findings: findingsAt(10), filesScanned: 1, baselineOverride: base({ expires: '2999-12-31' }) });
        expect(res.ok).toBe(true);
        expect(res.notes.join('\n')).toContain('SEC-TEST');
    });

    test('استثناء منتهي لا يخفي ويعود انتهاكًا صريحًا', () => {
        const res = runGate({ findings: findingsAt(10), filesScanned: 1, baselineOverride: base({ expires: '2000-01-01' }) });
        expect(res.ok).toBe(false);
        expect(res.violations.join('\n')).toContain('منتهي الصلاحية');
    });

    test('تجاوُز عدد الاستثناء يعود انتهاكًا (لا تمدد صامت)', () => {
        const res = runGate({ findings: findingsAt(11), filesScanned: 1, baselineOverride: base({ expires: '2999-12-31' }) });
        expect(res.ok).toBe(false);
    });

    test('القاعدة الصفرية لا تُستثنى إطلاقًا', () => {
        const res = runGate({
            findings: { 'no-eval': { 'backend/_probe.js': { count: 1, line: 1 } } },
            filesScanned: 1,
            baselineOverride: { _exceptions: [{ rule: 'no-eval', file: 'backend/_probe.js', count: 1, expires: '2999-12-31', reference: 'X', reason: 'Y' }] },
        });
        expect(res.ok).toBe(false);
    });
});
