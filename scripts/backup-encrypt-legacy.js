#!/usr/bin/env node
'use strict';
/**
 * backup-encrypt-legacy.js — ترحيل النسخ الاحتياطية القديمة إلى أرشيفات مشفّرة
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا: النسخ القديمة في database/backups كانت نصًا صريحًا على القرص
 * (13GB+ من .sql/.dump وحزم بيانات). لا تُحذف قبل التأكد من وجود نسخة
 * مشفّرة سليمة: ترتيب العمليات إجباري.
 *
 *   1) تحقّق من بصمة SHA-256 للنسخة الصريحة (.sidecar) — إن وُجدت.
 *   2) تشفير GPG (بثّ — بلا استهلاك ذاكرة للملفات الكبيرة) → <file>.gpg
 *   3) بصمة النص المشفَّر → <file>.gpg.sha256
 *   4) فك تشفير في ملف مؤقّت ومقارنة البصمة (إثبات أن الأرشيف يحوي النسخة أصلًا)
 *   5) مرآة مشفّرة اختيارية على D:/E:
 *   6) حذف النسخة الصريحة — فقط بعد نجاح الخطوات 1..5
 *
 * أي فشل ⇒ النسخة الصريحة تبقى كما هي (لا تُفقد بيانات).
 *
 * التشغيل:
 *   node scripts/backup-encrypt-legacy.js --dry-run     # معاينة فقط
 *   node scripts/backup-encrypt-legacy.js               # ترحيل كامل
 *   node scripts/backup-encrypt-legacy.js --limit=3     # أول 3 ملفات (اختبار)
 *   node scripts/backup-encrypt-legacy.js --no-mirror   # بلا مرايا خارجية
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const REPORT = path.join(BACKUPS, 'legacy-encryption-report.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const doMirror = !argv.includes('--no-mirror');
const limitArg = argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2];
  }
}

const { encryptBackupFile, decryptBackupFile, mirrorFile, sha256File } = require('./backup-mirror');

const PLAINTEXT_RE = /\.(sql|dump|zip)$/i;
const SECRET_RE = /\.env.*\.bak$/i;

function readEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function collectPlaintext(dir) {
  const out = [];
  const walk = d => {
    for (const entry of readEntries(d)) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (PLAINTEXT_RE.test(entry.name) || SECRET_RE.test(entry.name)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out.sort();
}

function readExpectedDigest(file) {
  const sidecar = `${file}.sha256`;
  if (!fs.existsSync(sidecar)) {
    return null;
  }
  const m = fs
    .readFileSync(sidecar, 'utf8')
    .trim()
    .match(/^([a-f0-9]{64})\s+/i);
  return m ? m[1].toLowerCase() : null;
}

function encryptedCounterpart(file) {
  for (const ext of ['.gpg', '.kbak']) {
    const candidate = `${file}${ext}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function tmpPath(label) {
  return path.join(os.tmpdir(), `legacy-verify-${label}-${Date.now()}-${process.pid}.tmp`);
}

const report = {
  startedAt: new Date().toISOString(),
  dryRun,
  mirror: doMirror,
  encrypted: [],
  skipped: [],
  failed: [],
  freedBytes: 0,
};

const targets = collectPlaintext(BACKUPS);
console.log(`[migrate] ملفات صريحة مرشّحة: ${targets.length}`);
if (dryRun) {
  for (const t of targets) {
    console.log(`  - ${path.relative(BACKUPS, t)} (${(fs.statSync(t).size / 1048576).toFixed(1)}MB)`);
  }
  process.exit(0);
}

let processed = 0;
for (const file of targets) {
  if (processed >= LIMIT) {
    break;
  }
  processed += 1;
  const label = path.basename(file);
  const size = fs.statSync(file).size;

  // 1) بصمة النسخة الصريحة
  const expected = readExpectedDigest(file);
  let plaintextDigest;
  try {
    plaintextDigest = sha256File(file);
  } catch (e) {
    report.failed.push({ file: path.relative(BACKUPS, file), error: `digest-failed: ${e.message}` });
    console.error(`[migrate] FAILED ${label}: digest ${e.message}`);
    continue;
  }
  if (expected && expected !== plaintextDigest) {
    report.failed.push({ file: path.relative(BACKUPS, file), error: 'plaintext-checksum-mismatch' });
    console.error(`[migrate] FAILED ${label}: البصمة غير متطابقة — النسخة تالفة، لم تُلمس`);
    continue;
  }

  // نسخة مشفّرة سابقة؟ تُستخدم (المهمة قابلة للاستئناف) — لا يُعاد التشفير
  const existing = encryptedCounterpart(file);
  let encrypted = existing;
  if (!encrypted) {
    // 2+3) تشفير GPG + بصمة النص المشفَّر
    try {
      encrypted = encryptBackupFile(file, { method: 'gpg' });
    } catch (e) {
      report.failed.push({
        file: path.relative(BACKUPS, file),
        error: `encrypt-failed: ${String(e.message).slice(0, 200)}`,
      });
      console.error(`[migrate] FAILED ${label}: تشفير ${String(e.message).slice(0, 160)}`);
      continue;
    }
  }

  // 4) فك تشفير ومطابقة البصمة
  const verifyPath = tmpPath(processed);
  try {
    decryptBackupFile(encrypted, verifyPath);
    const restoredDigest = sha256File(verifyPath);
    if (restoredDigest !== plaintextDigest) {
      throw new Error('decrypted-digest-mismatch');
    }
  } catch (e) {
    try {
      fs.unlinkSync(verifyPath);
    } catch (_) {}
    if (!existing) {
      try {
        fs.unlinkSync(encrypted);
      } catch (_) {}
      try {
        fs.unlinkSync(`${encrypted}.sha256`);
      } catch (_) {}
    }
    report.failed.push({
      file: path.relative(BACKUPS, file),
      error: `verify-failed: ${String(e.message).slice(0, 200)}`,
    });
    console.error(`[migrate] FAILED ${label}: التحقق ${String(e.message).slice(0, 160)} — النسخة الصريحة باقية`);
    continue;
  }
  try {
    fs.unlinkSync(verifyPath);
  } catch (_) {}

  // 5) مرآة مشفّرة خارجية (اختيارية)
  let mirrored = 0;
  if (doMirror) {
    try {
      const m = mirrorFile(encrypted, 'legacy');
      mirrored = m.mirrored.length;
      if (!m.ok) {
        console.warn(`[migrate] مرايا ${label}: ${m.errors.slice(0, 2).join(' | ')}`);
      }
    } catch (e) {
      console.warn(`[migrate] مرايا ${label}: ${String(e.message).slice(0, 120)}`);
    }
  }

  // 6) حذف النسخة الصريحة — بعد نجاح كل ما سبق
  try {
    fs.unlinkSync(file);
    report.freedBytes += size;
  } catch (e) {
    report.failed.push({ file: path.relative(BACKUPS, file), error: `delete-failed: ${e.message}` });
    console.error(`[migrate] FAILED ${label}: حذف ${e.message}`);
    continue;
  }
  report.encrypted.push({
    file: path.relative(BACKUPS, file),
    encrypted: path.relative(BACKUPS, encrypted),
    bytes: size,
    mirrored,
    sha256: plaintextDigest,
  });
  console.log(
    `[migrate] ok ${label} → ${path.basename(encrypted)} (${(size / 1048576).toFixed(1)}MB, مرايا=${mirrored})`
  );
}

report.finishedAt = new Date().toISOString();
report.summary = {
  encrypted: report.encrypted.length,
  skipped: report.skipped.length,
  failed: report.failed.length,
  freedMB: Math.round(report.freedBytes / 1048576),
};
try {
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[migrate] التقرير: ${REPORT}`);
} catch (e) {
  console.warn('[migrate] تعذر كتابة التقرير:', e.message);
}
console.log('[migrate] ملخص:', JSON.stringify(report.summary));
if (report.failed.length) {
  process.exit(1);
}
