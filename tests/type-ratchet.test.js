/**
 * type-ratchet.test.js — بوابة الأنواع: أخطاء checkJs لا تُزداد
 * ──────────────────────────────────────────────────────────────
 * القاعدة: خط أساس لكل ملف. أي ملف يتجاوز حصته يفشل، وأي ملف جديد بخطأ يفشل
 * (حصّته صفر). الأساس يُخفض فقط — لا يُرفع.
 * نفس عقد tests/lint-gate.test.js.
 */
const fs = require('fs');
const path = require('path');
const { collect, compare, buildBaseline, assessTscRun } = require('../scripts/type-ratchet');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'type-ratchet-baseline.json');
const TSCONFIG_FILE = path.join(ROOT, 'tsconfig.checkjs.json');

describe('بوابة الأنواع (scripts/type-ratchet.js)', () => {
  test('خط الأساس في المستودع صالح ومتسق مع نفسه', () => {
    expect(fs.existsSync(BASELINE_FILE)).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    expect(typeof baseline.total).toBe('number');
    expect(baseline.total).toBeGreaterThanOrEqual(0);
    const sum = Object.values(baseline.files || {}).reduce((s, n) => s + Number(n), 0);
    expect(sum).toBe(baseline.total);
    // حصص سالبة تعني خطأً في توليد الأساس: لا يُسمح بها.
    for (const [file, n] of Object.entries(baseline.files || {})) {
      expect({ file, n: Number(n) }).toEqual({ file, n: Number(n) });
      expect(Number(n)).toBeGreaterThanOrEqual(0);
    }
  });

  test('البوابة تفحص backend كله لا قائمة محدودة', () => {
    expect(fs.existsSync(TSCONFIG_FILE)).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(TSCONFIG_FILE, 'utf8'));
    expect(cfg.include).toContain('backend/**/*.js');
    // checkJs هو ما يفعّل فحص JavaScript؛ بدونه تكون البوابة زائفة.
    expect(cfg.compilerOptions.checkJs).toBe(true);
  });

  test('وضع مطابق للأساس ينجح', () => {
    const baseline = { total: 10, files: { 'backend/a.js': 6, 'backend/b.js': 4 } };
    const current = { total: 10, files: { 'backend/a.js': 6, 'backend/b.js': 4 }, skipped: 0 };
    expect(compare(baseline, current)).toEqual([]);
  });

  test('ملف يتجاوز حصته يفشل مع بيان الزيادة', () => {
    const baseline = { total: 6, files: { 'backend/a.js': 6 } };
    const current = { total: 9, files: { 'backend/a.js': 9 }, skipped: 0 };
    const failures = compare(baseline, current);
    expect(failures.length).toBe(2); // تجاوز الملف + تجاوز المجموع
    expect(failures[0]).toContain('backend/a.js');
    expect(failures[0]).toContain('+3');
  });

  test('ملف جديد بخطأ واحد يفشل (حصة الصفر)', () => {
    const baseline = { total: 0, files: {} };
    const current = { total: 1, files: { 'backend/brand-new.js': 1 }, skipped: 0 };
    expect(compare(baseline, current)).toEqual([
      'backend/brand-new.js: 1 خطأ أنواع (الحصة 0) — +1',
      'مجموع أخطاء الأنواع 1 > الأساس 0 (لهذه المنصة)',
    ]);
  });

  test('إنقاص الأخطاء ينجح (الأساس يُخفَّض ولا يُرفع)', () => {
    const baseline = { total: 10, files: { 'backend/a.js': 10 } };
    const current = { total: 3, files: { 'backend/a.js': 3 }, skipped: 0 };
    expect(compare(baseline, current)).toEqual([]);
  });

  test('ملف اختفى من الأساس يخفض المجموع ولا يفشل', () => {
    const baseline = { total: 10, files: { 'backend/gone.js': 10 } };
    const current = { total: 0, files: {}, skipped: 0 };
    expect(compare(baseline, current)).toEqual([]);
  });

  test('collect يقرأ مخرجات tsc: يعدّ backend فقط ويعزل ما عداها', () => {
    const raw = [
      'backend/a.js(3,5): error TS7006: Parameter x implicitly has an any type.',
      'backend/a.js(9,1): error TS2339: Property y does not exist.',
      `backend${path.sep}b.js(4,2): error TS7005: Variable implicitly has an any type.`,
      'frontend/app.js(1,1): error TS7006: خارج backend — لا يُحتسب في الحصة.',
      '  Try `npm i --save-dev @types/express` if it exists or add a new declaration',
    ].join('\n');
    const result = collect(raw);
    // المسافات القُطريّة تُوحَّد إلى / (ويندوز vs لينكس).
    expect(result.files).toEqual({ 'backend/a.js': 2, 'backend/b.js': 1 });
    expect(result.total).toBe(3);
    // skipped = خطأ منسوب لملف خارج backend. السطر النصي لا يحمل error TS
    // أصلًا فلا يُعدّ ولا يُحتسب — ولا يجوز أن يلوّث حصة أي ملف.
    expect(result.skipped).toBe(1);
  });

  test('buildBaseline يرتّب الملفات ويسجّل المجموع', () => {
    const b = buildBaseline({ total: 2, files: { 'backend/z.js': 1, 'backend/a.js': 1 }, skipped: 0 });
    expect(b.total).toBe(2);
    expect(Object.keys(b.files)).toEqual(['backend/a.js', 'backend/z.js']);
  });
});

/**
 * assessTscRun — حارس الأخضر الكاذب.
 *
 * هذه الحالات مأخوذة من تشغيل tsc فعلياً على المستودع، لا مُتخيَّلة: في كلٍّ
 * منها كان collect() يعيد total=0 فترجع البوابة «OK — 0 خطأ» و exit 0، وهي
 * موصولة بالـCI كخطوة حاجبة. رمز خروج tsc وحده لا يفرّق بينها: التشغيل السليم
 * والإعداد التالف كلاهما يخرج 2.
 */
describe('حارس الأخضر الكاذب في بوابة الأنواع (assessTscRun)', () => {
  const HEALTHY = [
    'backend/a.js(3,5): error TS7006: Parameter x implicitly has an any type.',
    'common/lan-discovery.js(22,26): error TS7006: Parameter info implicitly has an any type.',
  ].join('\n');

  test('تشغيل سليم يقبله الحارس (exit 2 مع تشخيصات منسوبة لملفات)', () => {
    expect(assessTscRun({ exitCode: 2, output: HEALTHY, spawnError: '' })).toEqual({ ok: true });
  });

  test('تشغيل نظيف تماماً (exit 0) مقبول', () => {
    expect(assessTscRun({ exitCode: 0, output: '', spawnError: '' })).toEqual({ ok: true });
  });

  test('tsconfig تالف يُفشل البوابة بدل total=0 — أخضر كاذب سابق', () => {
    const output = [
      'capacitor.config.ts(22,5): error TS2353: Object literal may only specify known properties.',
      'tsconfig.checkjs.json(1,24): error TS1136: Property assignment expected.',
      "tsconfig.checkjs.json(2,1): error TS1005: '}' expected.",
    ].join('\n');
    // collect وحده كان يرى صفر أخطاء backend ⇒ أخضر.
    expect(collect(output).total).toBe(0);
    const verdict = assessTscRun({ exitCode: 2, output, spawnError: '' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('tsconfig.checkjs.json');
  });

  test('tsconfig مفقود (TS5058) يُفشل البوابة', () => {
    const output = "error TS5058: The specified path does not exist: 'tsconfig.checkjs.json'.";
    expect(collect(output).total).toBe(0);
    const verdict = assessTscRun({ exitCode: 1, output, spawnError: '' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('TS5058');
  });

  test('include لا يطابق شيئاً (TS18003) يُفشل البوابة', () => {
    const output =
      "error TS18003: No inputs were found in config file 'tsconfig.checkjs.json'. " +
      "Specified 'include' paths were '[\"backend/__nope__/**/*.js\"]'.";
    expect(collect(output).total).toBe(0);
    const verdict = assessTscRun({ exitCode: 2, output, spawnError: '' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('TS18003');
  });

  test('tsc لم يُقلع أصلاً (بلا مخرجات) يُفشل البوابة', () => {
    const verdict = assessTscRun({
      exitCode: -1,
      output: '',
      spawnError: 'spawnSync ENOENT',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('ENOENT');
  });

  test('خروج غير صفر بلا تشخيصات قابلة للقراءة يُفشل البوابة', () => {
    const verdict = assessTscRun({ exitCode: 3, output: 'Some non-diagnostic noise', spawnError: '' });
    expect(verdict.ok).toBe(false);
  });

  test('تشخيصات خارج backend وحدها لا تُفشل (نطاق البوابة backend فقط)', () => {
    const output = 'frontend/app.js(1,1): error TS7006: outside backend scope.';
    expect(assessTscRun({ exitCode: 2, output, spawnError: '' })).toEqual({ ok: true });
    expect(collect(output).total).toBe(0);
  });
});
