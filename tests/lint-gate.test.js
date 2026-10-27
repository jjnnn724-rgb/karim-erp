/**
 * lint-gate.test.js — بوابة ESLint: أخطاء + تحذيرات جديدة فقط
 * ──────────────────────────────────────────────────────────────
 * القاعدة: خط أساس لكل ملف. أي ملف يتجاوز حصته يفشل، وأي خطأ يفشل.
 * الإصلاح ba-baseline لا يُرفع أبداً — يُخفض فقط.
 */
const fs = require('fs');
const path = require('path');
const { compare, parseEslintRun, GateError } = require('../scripts/lint-gate');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'lint-baseline.json');

describe('بوابة lint (scripts/lint-gate.js)', () => {
  test('خط الأساس في المستودع صالح ومتسق مع نفسه', () => {
    expect(fs.existsSync(BASELINE_FILE)).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    expect(typeof baseline.total).toBe('number');
    expect(baseline.total).toBeGreaterThanOrEqual(0);
    const sum = Object.values(baseline.files || {}).reduce((s, n) => s + Number(n), 0);
    expect(sum).toBe(baseline.total);
  });

  test('وضع مطابق للأساس ينجح', () => {
    const baseline = { total: 10, files: { 'a.js': 6, 'b.js': 4 } };
    const current = { errors: 0, warnings: 10, files: { 'a.js': 6, 'b.js': 4 } };
    expect(compare(baseline, current)).toEqual([]);
  });

  test('أي خطأ ESLint يفشل فوراً', () => {
    const failures = compare({ total: 10, files: {} }, { errors: 1, warnings: 0, files: {} });
    expect(failures.some(f => f.includes('أخطاء'))).toBe(true);
  });

  test('تحذير جديد في ملف قائم يفشل', () => {
    const baseline = { total: 10, files: { 'a.js': 6 } };
    const current = { errors: 0, warnings: 11, files: { 'a.js': 7 } };
    const failures = compare(baseline, current);
    expect(failures.some(f => f.includes('a.js'))).toBe(true);
  });

  test('ملف جديد بتحذير واحد يفشل (حصة الصفر)', () => {
    const baseline = { total: 10, files: { 'a.js': 10 } };
    const current = { errors: 0, warnings: 11, files: { 'a.js': 10, 'new.js': 1 } };
    const failures = compare(baseline, current);
    expect(failures.some(f => f.includes('new.js'))).toBe(true);
  });

  test('إنقاص التحذيرات ينجح (تخفيض الأساس ممكن)', () => {
    const baseline = { total: 10, files: { 'a.js': 10 } };
    const current = { errors: 0, warnings: 4, files: { 'a.js': 4 } };
    expect(compare(baseline, current)).toEqual([]);
  });

  test('ملف اختفى من الأساس يخفض المجموع ولا يفشل', () => {
    const baseline = { total: 10, files: { 'a.js': 6, 'b.js': 4 } };
    const current = { errors: 0, warnings: 6, files: { 'a.js': 6 } };
    expect(compare(baseline, current)).toEqual([]);
  });
});

/**
 * parseEslintRun — حارس الأخضر الكاذب.
 *
 * `e.stdout || ''` كان يحوّل فشل ESLint نفسه (إعداد تالف ⇒ رمز 2 وstdout فارغ)
 * إلى `[]`، فتطبع البوابة «✓ 0 أخطاء» وتخرج 0 والكاشف لا يعمل أصلاً. مُثبت
 * بتخريب eslint.config.js فعلياً: البوابة رجعت خضراء.
 */
describe('حارس الأخضر الكاذب في بوابة lint (parseEslintRun)', () => {
  const REPORT = JSON.stringify([{ filePath: 'a.js', errorCount: 1, warningCount: 0, messages: [{}] }]);

  test('رمز 0 مع تقرير صالح يمر', () => {
    expect(parseEslintRun({ exitCode: 0, stdout: REPORT, stderr: '' })).toHaveLength(1);
  });

  test('رمز 1 (وُجدت مشاكل lint) يمر — stdout يحمل التقرير', () => {
    expect(parseEslintRun({ exitCode: 1, stdout: REPORT, stderr: '' })).toHaveLength(1);
  });

  test('رمز 2 (ESLint نفسه فشل) يرمي GateError بدل قائمة فارغة', () => {
    const broken = { exitCode: 2, stdout: '', stderr: 'Oops! Something went wrong!' };
    expect(() => parseEslintRun(broken)).toThrow(GateError);
    expect(() => parseEslintRun(broken)).toThrow(/ESLint لم يعمل/);
  });

  test('فشل الإقلاع (رمز -1) يرمي GateError', () => {
    expect(() => parseEslintRun({ exitCode: -1, stdout: '', stderr: 'spawnSync ENOENT' })).toThrow(GateError);
  });

  test('stdout غير JSON يرمي GateError بدل مسطرة stack', () => {
    expect(() => parseEslintRun({ exitCode: 1, stdout: 'not json at all', stderr: '' })).toThrow(/ليست JSON/);
  });

  test('JSON ليس مصفوفة تقارير يرمي GateError', () => {
    expect(() => parseEslintRun({ exitCode: 0, stdout: '{"ok":true}', stderr: '' })).toThrow(/ليست مصفوفة/);
  });

  test('stdout فارغ مع رمز 0 يعني مستودعاً نظيفاً فعلاً (لا التباس)', () => {
    expect(parseEslintRun({ exitCode: 0, stdout: '', stderr: '' })).toEqual([]);
  });
});
