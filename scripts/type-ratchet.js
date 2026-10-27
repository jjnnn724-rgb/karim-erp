#!/usr/bin/env node
/**
 * scripts/type-ratchet.js — بوابة الأنواع: لا يزداد عدد أخطاء checkJs صارمًا
 * ══════════════════════════════════════════════════════════════════════
 * لماذا ملف أساس لكل ملف بدل رقم واحد:
 *   · `npm run typecheck` يفحص الملفات المكتوبة بلغة TypeScript فقط، والمشروع
 *     JavaScript بالكامل (ملف .ts واحد) ⇒ يمرّ وهو لا يفحص شيئًا.
 *   · `tsconfig.strict.json` يفحص عددًا محدودًا من الملفات (نادي صارم صغير).
 *   · هذه البوابة تفحص **backend كله** بـ checkJs، وتسجّل حصّة كل ملف في
 *     `scripts/type-ratchet-baseline.json`.
 *
 * القواعد (نفس عقد lint-gate.js):
 *   1. أي ملف يتجاوز حصّته في الأساس → فشل.
 *   2. مجموع الأخطاء أكبر من مجموع الأساس → فشل.
 *   3. ملف جديد يحوي أخطاء → حصّته صفر ⇒ أي خطأ فيه يفشل.
 *   4. عند إصلاح أخطاء تُخفض الحصة في نفس الـ PR (تحديث الأساس).
 *
 * التشغيل:
 *   node scripts/type-ratchet.js                  # فحص
 *   node scripts/type-ratchet.js --write-baseline  # تجديد الأساس بعد إصلاح
 *
 * الاستقرار: المقارنة تقتصر على الملفات الموجودة على هذه المنصة (ويندوز/لينكس
 * قد يختلفان في المسارات) حتى لا يظهر انحدار وهمي على CI.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'type-ratchet-baseline.json');
const TSCONFIG = path.join(ROOT, 'tsconfig.checkjs.json');
const TSC_BIN = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function normalize(p) {
  return String(p).split(path.sep).join('/');
}

/** تشغيل tsc وجمع مخرجاته (tsc يُخرج رمزًا غير صفر عند وجود أخطاء). */
function runTsc() {
  let output;
  let exitCode = 0;
  let spawnError = '';
  try {
    // عبر مسار tsc مباشرة (لا npx/shell): يشبه نهج lint-gate ويزيل تحذير
    // DeprecationWarning المتعلق بـ shell:true مع مصفوفة معاملات.
    output = execFileSync(process.execPath, [TSC_BIN, '--noEmit', '-p', TSCONFIG], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // الرمز -1 يعني أن tsc لم يُقلع أصلاً (ENOENT، تجاوز maxBuffer).
    exitCode = Number.isInteger(e.status) ? e.status : -1;
    output = `${typeof e.stdout === 'string' ? e.stdout : ''}${typeof e.stderr === 'string' ? e.stderr : ''}`;
    spawnError = String(e.message || '');
  }
  return { output, exitCode, spawnError };
}

/**
 * يحكم هل تشغيل tsc صالح للحكم عليه — منطق نقي قابل للاختبار.
 *
 * رمز خروج tsc وحده لا يكفي: التشغيل السليم يخرج **2** (وُجدت تشخيصات)،
 * والإعداد التالف يخرج 2 أيضاً. الفارق في المحتوى:
 *   · تشخيص بلا موضع ملف (`error TS5058` مسار مفقود، `TS18003` لا مدخلات)
 *     ⇒ tsc فشل قبل أن يفحص البرنامج.
 *   · تشخيص منسوب إلى tsconfig نفسه (`TS1136`/`TS1005`) ⇒ الإعداد لم يُقرأ،
 *     فيسقط tsc إلى برنامج افتراضي ويبلغ عن ملفات خارج backend.
 *   · خروج برمز فشل بلا أي مخرجات ⇒ لا شيء للحكم عليه (أما الفراغ مع رمز 0
 *     فهو النظافة الحقيقية — tsc --noEmit لا يطبع شيئاً عندما لا يجد خطأً).
 * في الحالات الثلاث كان collect() يعيد 0 أخطاء فترجع البوابة خضراء — وهذا
 * أخضر كاذب في بوابة حاجبة بالـCI.
 *
 * @param {{exitCode:number, output:string, spawnError?:string}} run
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function assessTscRun({ exitCode, output, spawnError }) {
  const text = String(output || '');
  // مخرجات فارغة مع رمز 0 هي الحالة السليمة (tsc --noEmit لا يطبع شيئاً عند
  // النظافة). الفراغ يُدين فقط عندما يخرج tsc برمز فشل.
  if (!text.trim() && exitCode !== 0) {
    return {
      ok: false,
      reason: `tsc لم يُنتج أي مخرجات (رمز الخروج ${exitCode}) — لا يمكن الحكم على الأنواع.${
        spawnError ? ` ${String(spawnError).split(/\r?\n/)[0]}` : ''
      }`,
    };
  }
  const diagnostics = text.split(/\r?\n/).filter(l => l.includes('error TS'));
  const unattributed = diagnostics.filter(l => !/\(\d+,\d+\):\s*error TS\d+/.test(l));
  if (unattributed.length) {
    return {
      ok: false,
      reason: `tsc فشل قبل فحص البرنامج — ${unattributed.length} تشخيصاً بلا موضع ملف، أولها: ${unattributed[0].trim().slice(0, 200)}`,
    };
  }
  const configErrors = diagnostics.filter(l => /^tsconfig[^\s(]*\.json\(/.test(normalize(l).trim()));
  if (configErrors.length) {
    return {
      ok: false,
      reason: `tsconfig.checkjs.json نفسه غير صالح — tsc لم يفحص البرنامج المقصود، أولها: ${configErrors[0].trim().slice(0, 200)}`,
    };
  }
  if (exitCode !== 0 && diagnostics.length === 0) {
    return {
      ok: false,
      reason: `tsc خرج بالرمز ${exitCode} بلا أي تشخيص قابل للقراءة — لا يمكن الحكم على الأنواع.`,
    };
  }
  return { ok: true };
}

/**
 * تجميع أخطاء tsc per-file — منطق نقي قابل للاختبار.
 * صيغة السطر: backend/path.js(12,5): error TS7006: ...
 * @param {string} raw مخرجات tsc
 * @returns {{files: Object<string, number>, total: number, skipped: number}}
 */
function collect(raw) {
  const files = {};
  let total = 0;
  let skipped = 0;
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.includes('error TS')) {
      continue;
    }
    const m = line.match(/^(.*?)\(\d+,\d+\): error TS\d+/);
    if (!m) {
      skipped++;
      continue;
    } // سطور متعددة الأسطر لا تنتمي لملف
    const file = normalize(m[1]).trim();
    if (!file.startsWith('backend/')) {
      skipped++;
      continue;
    }
    files[file] = (files[file] || 0) + 1;
    total++;
  }
  return { files, total, skipped };
}

function buildBaseline(current) {
  return {
    _comment:
      'حصة أخطاء checkJs الصارمة المسموحة لكل ملف. تُخفض مع كل دفعة إصلاح، ولا تُرفع أبدًا. الجيل: --write-baseline',
    generatedAt: new Date().toISOString(),
    total: current.total,
    files: Object.fromEntries(Object.entries(current.files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * مقارنة خط الأساس بالوضع الحالي.
 * @param {{total?:number, files?:Object}} baseline
 * @param {{total:number, files:Object}} current
 * @returns {string[]} قائمة الإخفاقات (فارغة = نجاح)
 */
function compare(baseline, current) {
  const failures = [];
  const baseFiles = (baseline && baseline.files) || {};

  for (const [file, count] of Object.entries(current.files)) {
    const allowed = Number(baseFiles[file] || 0);
    if (count > allowed) {
      failures.push(`${file}: ${count} خطأ أنواع (الحصة ${allowed}) — +${count - allowed}`);
    }
  }

  // نقارن المجموع على الملفات الموجودة هنا فقط (انظر تعليق الاستقرار أعلاه).
  const baseTotalHere = Object.entries(current.files).reduce((sum, [file]) => sum + Number(baseFiles[file] || 0), 0);
  if (current.total > baseTotalHere) {
    failures.push(`مجموع أخطاء الأنواع ${current.total} > الأساس ${baseTotalHere} (لهذه المنصة)`);
  }
  return failures;
}

function main() {
  const writeBaseline = process.argv.includes('--write-baseline');
  // قبل أي حكم — وأيضاً قبل تجديد الأساس: أساس مولَّد من تشغيل فاشل
  // كان سيصفر الحصة ويُبطل البوابة نهائياً.
  const run = runTsc();
  const verdict = assessTscRun(run);
  if (!verdict.ok) {
    console.error(`TYPE-RATCHET FAILED: ${verdict.reason}`);
    process.exit(1);
  }
  const current = collect(run.output);

  if (writeBaseline) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(buildBaseline(current), null, 2) + '\n');
    console.log(`TYPE-RATCHET: تم تجديد الأساس — ${current.total} خطأ في ${Object.keys(current.files).length} ملفًا.`);
    return;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('TYPE-RATCHET FAILED: لا يوجد ملف أساس. شغّل --write-baseline أولًا.');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const failures = compare(baseline, current);

  if (failures.length) {
    console.error(`TYPE-RATCHET FAILED: ${failures.length} إخفاقًا`);
    failures.slice(0, 40).forEach(f => console.error('  ' + f));
    console.error('\n  للإصلاح: قلّل أخطاء الملفات أعلاه، ثم حدّث الأساس:');
    console.error('  node scripts/type-ratchet.js --write-baseline');
    process.exit(1);
  }
  console.log(
    `TYPE-RATCHET OK — ${current.total} خطأ في ${Object.keys(current.files).length} ملفًا ` +
      `(الحصة ${baseline.total}). لم يزداد أي ملف.`
  );
}

module.exports = { collect, compare, buildBaseline, assessTscRun };

if (require.main === module) {
  main();
}
