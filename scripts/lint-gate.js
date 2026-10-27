#!/usr/bin/env node
/**
 * lint-gate.js — بوابة جودة ESLint: أخطاء + تحذيرات جديدة فقط
 * ══════════════════════════════════════════════════════════════════════
 * لماذا ملف أساس بدل رقم واحد:
 *   · الرقم الواحد (max-warnings 58) يسمح بإضافة 58 تحذيراً جديداً.
 *   · ملف الأساس يقارن **لكل ملف**: أي ملف يتجاوز حصة�� → فشل.
 *   · عند إصلاح تحذيرات تُخفض الحصة في نفس الـ PR (تحديث الأساس).
 *
 * القواعد:
 *   1. أي خطأ (error) → فشل فوراً.
 *   2. أي ملف يحوي تحذيرات أكثر من حصته في الأساس → فشل.
 *   3. مجموع التحذيرات أكبر من مجموع الأساس → فشل.
 *   4. ملف جديد بتحذيرات → يُعامل كحصة صفر → أي تحذير فيه يفشل.
 *
 * التشغيل: node scripts/lint-gate.js [--write-baseline]
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'lint-baseline.json');
const ESLINT_BIN = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

function relative(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

class GateError extends Error {}

/**
 * يحكم هل تشغيل ESLint صالح للحكم عليه — منطق نقي قابل للاختبار.
 *
 * رموز خروج ESLint: 0 = نظيف، 1 = وُجدت مشاكل lint (stdout يحمل JSON صالحاً)،
 * 2 = ESLint نفسه فشل (إعداد تالف، مسار مفقود). في الحالة الثالثة يكون stdout
 * فارغاً، ولو اكتفينا بـ `e.stdout || ''` لتحول إلى `[]` ورجعت البوابة
 * «0 أخطاء» وكاشف الأخطاء لا يعمل أصلاً — أخضر كاذب أخطر من الانهيار بمسطرة.
 *
 * @param {{exitCode:number, stdout:string, stderr?:string}} run
 * @returns {Array} تقرير ESLint
 * @throws {GateError} عندما لا يمكن الحكم على جودة الكود
 */
function parseEslintRun({ exitCode, stdout, stderr }) {
  if (exitCode !== 0 && exitCode !== 1) {
    const why = String(stderr || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 4)
      .join(' ');
    throw new GateError(
      `ESLint لم يعمل (رمز الخروج ${exitCode}) — لا يمكن الحكم على جودة الكود.${why ? ` ${why}` : ''}`
    );
  }
  let report;
  try {
    report = JSON.parse(String(stdout || '[]'));
  } catch (e) {
    throw new GateError(`مخرجات ESLint ليست JSON صالحاً (${e.message}) — لا يمكن الحكم على جودة الكود.`);
  }
  if (!Array.isArray(report)) {
    throw new GateError('مخرجات ESLint ليست مصفوفة تقارير — لا يمكن الحكم على جودة الكود.');
  }
  return report;
}

function runEslint() {
  let stdout;
  let exitCode = 0;
  let stderr = '';
  try {
    // stdio مُلتقَط لا موروث: نص «Oops!» ومسطرة ESLint يذهبان إلى e.stderr
    // فيصبح تقرير البوابة سطراً واحداً مقروءاً بدل 20 سطراً من الضوضاء.
    stdout = execFileSync(process.execPath, [ESLINT_BIN, '.', '--ext', '.js,.mjs', '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // الرمز -1 يعني أن العملية لم تُقلع أصلاً (ENOENT، تجاوز maxBuffer).
    exitCode = Number.isInteger(e.status) ? e.status : -1;
    stdout = typeof e.stdout === 'string' ? e.stdout : '';
    stderr = typeof e.stderr === 'string' && e.stderr.trim() ? e.stderr : String(e.message || '');
  }
  return parseEslintRun({ exitCode, stdout, stderr });
}

function collect(report) {
  const files = {};
  let errors = 0;
  let warnings = 0;
  for (const entry of report) {
    const rel = relative(entry.filePath);
    const w = entry.warningCount || 0;
    const e = entry.errorCount || 0;
    errors += e;
    warnings += w;
    if (w > 0) {
      files[rel] = w;
    }
  }
  return { files, errors, warnings };
}

function buildBaseline(report) {
  const c = collect(report);
  return {
    _comment: 'حصة التحذيرات المسموحة لكل ملف. تُخفض مع كل دفعة إصلاح، ولا تُرفع أبدًا.',
    total: c.warnings,
    files: Object.fromEntries(Object.entries(c.files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * مقارنة خط الأساس بالوضع الحالي — منطق نقي قابل للاختبار.
 * @param {{total?:number, files?:Object}} baseline
 * @param {{errors:number, warnings:number, files:Object}} current
 * @returns {string[]} قائمة الإخفاقات (فارغة = نجاح)
 */
function compare(baseline, current) {
  const failures = [];
  if (current.errors > 0) {
    failures.push(`أخطاء ESLint: ${current.errors} (مسموح 0)`);
  }
  const baseFiles = (baseline && baseline.files) || {};
  for (const [file, count] of Object.entries(current.files || {})) {
    const allowed = Number(baseFiles[file] || 0);
    if (count > allowed) {
      failures.push(`${file}: ${count} تحذيراً (الحصة ${allowed}) — +${count - allowed}`);
    }
  }
  // نقارن المجموع على مجموعة الملفات الموجودة على هذه المنصة فقط:
  // فالأساس قد يحتوي ملفات لا توجد على ويندوز/لينكس ⇒ المقارنة العادلة
  // كانت تُظهر انحدارًا وهميًا على CI.
  const baseTotalHere = Object.entries(current.files || {}).reduce(
    (sum, [file]) => sum + Number(baseFiles[file] || 0),
    0
  );
  const currentTotalHere = Object.entries(current.files || {}).reduce((sum, [, count]) => sum + Number(count || 0), 0);
  if (currentTotalHere > baseTotalHere) {
    failures.push(`مجموع التحذيرات ${currentTotalHere} > الأساس ${baseTotalHere} (لهذه المنصة)`);
  }
  return failures;
}

function main() {
  if (!fs.existsSync(ESLINT_BIN)) {
    console.error('lint-gate: eslint غير مثبّت (node_modules/eslint)');
    process.exit(1);
  }
  let report;
  try {
    report = runEslint();
  } catch (e) {
    // تقرير نظيف ورمز فشل — لا مسطرة stack ولا أخضر كاذب.
    console.error(`✗ lint-gate: ${e instanceof GateError ? e.message : `تعذر تشغيل ESLint — ${e.message}`}`);
    process.exit(1);
  }
  const current = collect(report);

  if (process.argv.includes('--write-baseline')) {
    const baseline = buildBaseline(report);
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`lint-gate: كُتب الأساس — ${baseline.total} تحذيراً في ${Object.keys(baseline.files).length} ملفاً.`);
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(
      'lint-gate: لا يوجد scripts/lint-baseline.json — ولّده مرة بـ: node scripts/lint-gate.js --write-baseline'
    );
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const failures = compare(baseline, current);

  if (failures.length) {
    console.error('✗ lint-gate فشل:\n' + failures.map(f => `   • ${f}`).join('\n'));
    console.error('\nالإصلاح: انقص التحذيرات، أو خفّض حصة الملف في scripts/lint-baseline.json (لا ترفعها).');
    process.exit(1);
  }

  console.log(`✓ lint-gate: 0 أخطاء · ${current.warnings} تحذيراً (≤ الأساس ${baseline.total}) — لا جديد.`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { compare, collect, buildBaseline, parseEslintRun, GateError };
