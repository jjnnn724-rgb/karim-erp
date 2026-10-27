'use strict';
/**
 * backup-retention.js — تدوير مجلد النسخ الاحتياطية بمجموعات
 * ────────────────────────────────────────────────────────────────────────────
 * النسخة الواحدة = عدة ملفات بنفس الاسم الأساسي:
 *   karim-<db>-<ts>.sql.kbak        الأرشيف المشفَّر
 *   karim-<db>-<ts>.sql.kbak.sha256 بصمة النص المشفَّر
 *   karim-<db>-<ts>.sql.sha256      بصمة النسخة الصريحة (إثبات أن فك التشفير أنتج الأصل)
 * التدوير يحذف المجموعة كاملة (أرشيف + بصمتيه) دفعة واحدة — لا يبقى نص صريح
 * ولا بصمة يتيمة.
 */
const fs = require('fs');
const path = require('path');

function readEntries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
}

/**
 * يجمع ملفات مجلد النسخ في مجموعات حسب الاسم الأساسي.
 * @param {string} dir
 * @param {(name: string) => string|null} baseOf يعيد الاسم الأساسي للمجموعة أو null
 */
function collectBackupGroups(dir, baseOf) {
  const groups = new Map();
  for (const name of readEntries(dir)) {
    const base = baseOf(name);
    if (!base) {
      continue;
    }
    if (!groups.has(base)) {
      groups.set(base, { base, files: [], mtime: 0 });
    }
    const group = groups.get(base);
    group.files.push(name);
    try {
      const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
      if (mtime > group.mtime) {
        group.mtime = mtime;
      }
    } catch (_) {}
  }
  return [...groups.values()].sort((a, b) => b.mtime - a.mtime);
}

/**
 * يحذف كل المجموعات الأقدم من `keep` (بما فيها بصمات النسخة الصريحة).
 * @returns {string[]} الأسماء الأساسية للمجموعات المحذوفة
 */
function pruneBackupGroups(dir, groups, keep) {
  const removed = [];
  for (const group of groups.slice(keep)) {
    for (const name of group.files) {
      const old = { path: path.join(dir, name) };
      try {
        fs.unlinkSync(old.path);
      } catch (_) {}
      try {
        fs.unlinkSync(`${old.path}.sha256`);
      } catch (_) {}
    }
    try {
      fs.unlinkSync(path.join(dir, `${group.base}.sha256`));
    } catch (_) {}
    removed.push(group.base);
  }
  return removed;
}

/** يطابق "اسم.sql" أو "اسم.sql.kbak" أو "اسم.sql.gpg" ويعيد "اسم.sql". */
function sqlBase(name) {
  const m = /^(.*\.sql)(?:\.(?:kbak|gpg))?$/.exec(name);
  return m ? m[1] : null;
}

/** يطابق "اسم.dump" أو "اسم.dump.kbak" ويعيد "اسم.dump". */
function dumpBase(name) {
  const m = /^(.*\.dump)(?:\.(?:kbak|gpg))?$/.exec(name);
  return m ? m[1] : null;
}

/** يطابق "اسم.zip" أو "اسم.zip.kbak" ويعيد "اسم.zip". */
function zipBase(name) {
  const m = /^(.*\.zip)(?:\.(?:kbak|gpg))?$/.exec(name);
  return m ? m[1] : null;
}

module.exports = { collectBackupGroups, pruneBackupGroups, sqlBase, dumpBase, zipBase };
