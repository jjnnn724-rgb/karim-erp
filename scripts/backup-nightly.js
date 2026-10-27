// backup-nightly.js — نسخة احتياطية ليلية مضغوطة (pg_dump -Fc) + تدوير + latest
// HARDENED 2026-10-07 (بعد حادثة ضياع القاعدة):
//   • فشل صاخب: أي خطأ → status ok:false + خروج بكود 1 (المجدول يسجل الفشل)
//   • حد أدنى للحجم 5MB: ملف أصغر يُحذف ولا يمس latest أبدًا (درس ملف 0 بايت)
//   • latest تُحدَّث فقط من نسخة سليمة مُتحقق منها
//   • تدوير: آخر 7 نسخ ليلية (بدل 3)
//   • مرايا مشفرة تلقائيًا على D:/KarimBackups و E:/KarimBackups
// HARDENED 2026-10-26 (A3 — لا نص صريح على القرص):
//   • كل نسخة تُشفَّر محليًا (.kbak) وتُحذف النسخة الصريحة فور نجاح التشفير
//   • latest صار نسخة مشفّرة (karim_erp-latest.dump.kbak)
//   • فشل التشفير ⇒ تبقى النسخة الصريحة (لا تُفقد بيانات ولا يُحذف بلا بديل)
// التشغيل: مهمة مجدولة يوميًا 03:00 و 15:00 (schtasks) أو يدويًا: node scripts/backup-nightly.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const KEEP = 7;
const MIN_BYTES = 5 * 1024 * 1024; // أقل حجم مقبول لنسخة -Fc كاملة
const STATUS_FILE = path.join(BACKUPS, 'nightly-backup-status.json');

function writeStatus(payload) {
  try {
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...payload }, null, 2), 'utf8');
  } catch (_) {}
}

function fail(msg) {
  console.error('[backup] FAILED:', msg);
  writeStatus({ ok: false, error: msg });
  process.exit(1);
}

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    process.env[m[1]] = m[2];
  }
}
const PG = 'C:/Program Files/PostgreSQL/18/bin';
const DB = process.env.DB_NAME || 'karim_erp';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

fs.mkdirSync(BACKUPS, { recursive: true });
// طابع زمني: تشغيلان في اليوم نفسه لا يتصادمان (والأرشيف المشفَّر
// يرفض الكتابة فوق موجود — حاجز أمان لا يُلغى).
const stamp = new Date()
  .toISOString()
  .replace(/[-:T.Z]/g, '')
  .slice(0, 14);
const nightly = path.join(BACKUPS, `karim_erp-nightly-${stamp}.dump`);
console.log('[backup] pg_dump →', nightly);
try {
  execFileSync(
    path.join(PG, 'pg_dump.exe'),
    [
      '-h',
      process.env.DB_HOST || '127.0.0.1',
      '-p',
      process.env.DB_PORT || '5432',
      '-U',
      process.env.DB_USER || 'postgres',
      '-d',
      DB,
      '-Fc',
      '-f',
      nightly,
    ],
    { stdio: 'inherit', env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, timeout: 600000 }
  );
} catch (e) {
  try {
    if (fs.existsSync(nightly) && fs.statSync(nightly).size < MIN_BYTES) {
      fs.unlinkSync(nightly);
    }
  } catch (_) {}
  fail('pg_dump error: ' + String((e && e.message) || e).slice(0, 200));
}

let size = 0;
try {
  size = fs.statSync(nightly).size;
} catch (_) {
  fail('dump file missing after pg_dump');
}
if (size < MIN_BYTES) {
  try {
    fs.unlinkSync(nightly);
  } catch (_) {}
  fail(`dump too small (${size} bytes < ${MIN_BYTES}) — deleted, latest untouched`);
}

// بصمة للنسخة الليلية (بصمة النسخة الصريحة — تبقى دليلًا أن فك التشفير أنتج الأصل)
try {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(nightly)).digest('hex');
  fs.writeFileSync(`${nightly}.sha256`, `${digest}  ${path.basename(nightly)}\n`, 'utf8');
} catch (e) {
  console.warn('[backup] sha256 skipped:', e.message);
}

// ── نسخ مجلدات البيانات الحرجة: جلسة واتساب + شهادة HTTPS + KarimData ──
const CRIT_ALL = ['C:/HorusData/certs', 'C:/HorusData/whatsapp-sessions', 'C:/HorusData/links', 'C:/KarimData'];
const CRIT = CRIT_ALL.filter(p => {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
});
if (!CRIT.length) {
  console.warn('[backup] no critical folders found — data-zip skipped');
}
const dataZip = path.join(BACKUPS, `karim_data-folders-${today}.zip`);
try {
  if (!CRIT.length) {
    throw new Error('no existing critical folders');
  }
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${CRIT.join("','")}' -DestinationPath '${dataZip}'`],
    { stdio: 'pipe', timeout: 300000 }
  );
  console.log('[backup] data-folders.zip →', dataZip, `(${Math.round(fs.statSync(dataZip).size / 1024)}KB)`);
} catch (e) {
  console.warn('[backup] data-folders zip skipped:', String(e.message).slice(0, 120));
}

// ── تشفير محلي + مرايا خارجية D/E مشفرة (best-effort؛ لا يُرسل dump أو ZIP خام) ──
const offsiteErrors = [];
const encryptedOf = {};
try {
  const { encryptBackupFile, mirrorFile } = require('./backup-mirror');
  for (const [file, label] of [
    [nightly, 'nightly-dump'],
    [dataZip, 'nightly-data'],
  ]) {
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      const encrypted = encryptBackupFile(file);
      encryptedOf[label] = encrypted;
      const result = mirrorFile(encrypted, label);
      if (!result.ok) {
        offsiteErrors.push(...result.errors);
      }
      console.log(
        `[backup] encrypted mirror ${label}:`,
        JSON.stringify({ copies: result.mirrored.length, errors: result.errors.slice(0, 3) })
      );
    } catch (e) {
      offsiteErrors.push(`${label}:${String(e.message).slice(0, 160)}`);
      console.warn(`[backup] encrypted mirror ${label} skipped:`, String(e.message).slice(0, 160));
    }
  }
} catch (e) {
  offsiteErrors.push(String(e.message).slice(0, 160));
  console.warn('[backup] encrypted mirrors skipped:', String(e.message).slice(0, 160));
}

// ── لا نص صريح على القرص: يُحذف كل ملف صريح بعد نجاح تشفيره ──
// latest مشفَّر أيضًا (karim_erp-latest.dump.kbak) — بوابة الجودة تقرأه.
const latestPlain = path.join(BACKUPS, 'karim_erp-latest.dump');
const latestEncrypted = `${latestPlain}.kbak`;
try {
  if (encryptedOf['nightly-dump']) {
    fs.copyFileSync(encryptedOf['nightly-dump'], latestEncrypted);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(latestEncrypted)).digest('hex');
    fs.writeFileSync(`${latestEncrypted}.sha256`, `${digest}  ${path.basename(latestEncrypted)}\n`, 'utf8');
    console.log('[backup] latest.copy →', latestEncrypted, `(${Math.round(size / 1048576)}MB, مشفَّر)`);
  }
} catch (e) {
  offsiteErrors.push(`latest:${String(e.message).slice(0, 160)}`);
  console.warn('[backup] latest copy skipped:', String(e.message).slice(0, 160));
}
for (const plain of [nightly, dataZip, latestPlain]) {
  const encrypted = plain === dataZip ? encryptedOf['nightly-data'] : encryptedOf['nightly-dump'];
  if (!encrypted || !fs.existsSync(encrypted)) {
    console.warn('[backup] plaintext kept (no encrypted counterpart):', path.basename(plain));
    continue;
  }
  try {
    fs.unlinkSync(plain);
  } catch (e) {
    console.warn('[backup] plaintext delete failed:', path.basename(plain), String(e.message).slice(0, 120));
  }
}
const remainingPlain = [nightly, dataZip, latestPlain].filter(p => fs.existsSync(p));
const plaintextRemoved = remainingPlain.length === 0;
if (!plaintextRemoved) {
  offsiteErrors.push(`plaintext-remains:${remainingPlain.map(p => path.basename(p)).join(',')}`);
  console.warn('[backup] plaintext still on disk:', remainingPlain.map(p => path.basename(p)).join(', '));
}

// تدوير: آخر KEEP نسخ ليلية (أرشيف + بصمات) وآخر KEEP حزم بيانات
try {
  const { collectBackupGroups, pruneBackupGroups, dumpBase, zipBase } = require('./backup-retention');
  const nightlies = collectBackupGroups(BACKUPS, f => (f.startsWith('karim_erp-nightly-') ? dumpBase(f) : null));
  for (const old of pruneBackupGroups(BACKUPS, nightlies, KEEP)) {
    console.log('[backup] pruned:', old);
  }
  const zips = collectBackupGroups(BACKUPS, f => (f.startsWith('karim_data-folders-') ? zipBase(f) : null));
  for (const old of pruneBackupGroups(BACKUPS, zips, KEEP)) {
    console.log('[backup] pruned:', old);
  }
} catch (e) {
  console.warn('[backup] rotation skipped:', String(e.message).slice(0, 120));
}

writeStatus({
  ok: plaintextRemoved,
  file: path.basename(nightly),
  encrypted: encryptedOf['nightly-dump'] ? path.basename(encryptedOf['nightly-dump']) : null,
  plaintextRemoved,
  bytes: size,
  offsite: { ok: offsiteErrors.length === 0, errors: offsiteErrors },
});
console.log('[backup] done ✓');
