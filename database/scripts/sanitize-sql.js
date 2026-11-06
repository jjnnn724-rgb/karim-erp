#!/usr/bin/env node
'use strict';
/**
 * sanitize-sql.js — حذف عبارات pg_dump الخاصة بإصدارٍ أحدث من الخادم.
 *
 * لماذا ملف مستقل: كانت الدالة داخل backup.js بلا تصدير، فلم يكن ممكنًا
 * اختبارها. وهي تعمل على Buffer لا على string (نسخة 577MB تتجاوز سقف V8
 * للسلاسل)، وحين انكسرت (`line.startsWith is not a function`) لم يلاحظها
 * أحد: النسخة كانت تُكتب كاملة ثم يفشل التعقيم، فيخرج السكربت بالرمز 1
 * وتُسجَّل النسخة الليلية فاشلة رغم سلامتها.
 *
 * الملف الأصلي لا يُمَس: يُكتب مُرشَّح في `.sanitize.tmp` ثم يُستبدل به، فأي
 * فشل في المنتصف يترك النسخة الأصلية سليمة.
 */

const fs = require('fs');

const TRANSACTION_TIMEOUT_LINE = Buffer.from('SET transaction_timeout');
const NEWLINE = Buffer.from('\n');

/** Buffer لا يملك startsWith — المقارنة على البايتات. */
function startsWithBuffer(buf, prefix) {
  return buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);
}

/**
 * @param {string} file
 * @param {{chunkSize?:number}} [opts] — حجم المقطع قابل للحقن للاختبار فقط.
 * @returns {{stripped: number, changed: boolean}}
 */
function stripVersionSpecificStatements(file, opts = {}) {
  const CHUNK = Number(opts.chunkSize) > 0 ? Number(opts.chunkSize) : 1024 * 1024;
  const tmp = `${file}.sanitize.tmp`;
  const buf = Buffer.allocUnsafe(CHUNK);
  const fdIn = fs.openSync(file, 'r');
  let fdOut = -1;
  let stripped = 0;
  let carry = Buffer.alloc(0);
  let position = 0;
  try {
    fdOut = fs.openSync(tmp, 'w');
    for (;;) {
      const read = fs.readSync(fdIn, buf, 0, CHUNK, position);
      position += read;
      const atEof = read === 0;
      const work = atEof ? carry : Buffer.concat([carry, buf.subarray(0, read)]);
      // قبل EOF: آخر مقطع بلا \n هو سطر ناقص يُرحَّل للدورة التالية.
      const boundary = atEof ? -1 : work.lastIndexOf(0x0a);
      carry = !atEof && boundary !== work.length - 1 ? work.subarray(boundary + 1) : Buffer.alloc(0);
      const complete = atEof ? work : boundary === -1 ? Buffer.alloc(0) : work.subarray(0, boundary + 1);

      if (complete.length) {
        const kept = [];
        let start = 0;
        for (let i = 0; i < complete.length; i++) {
          if (complete[i] !== 0x0a) {continue;}
          const line = complete.subarray(start, i);
          start = i + 1;
          if (startsWithBuffer(line, TRANSACTION_TIMEOUT_LINE)) {
            stripped++;
          } else {
            kept.push(line, NEWLINE);
          }
        }
        // ذيل بلا سطر جديد (عند EOF فقط) — لا يجوز إسقاطه.
        if (start < complete.length) {
          const tail = complete.subarray(start);
          if (startsWithBuffer(tail, TRANSACTION_TIMEOUT_LINE)) {
            stripped++;
          } else {
            kept.push(tail);
          }
        }
        if (kept.length) {fs.writeSync(fdOut, Buffer.concat(kept));}
      }
      if (atEof) {break;}
    }
  } finally {
    if (fdOut >= 0) {fs.closeSync(fdOut);}
    fs.closeSync(fdIn);
  }
  if (!stripped) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* لا شيء */
    }
    return { stripped: 0, changed: false };
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* لا شيء */
    }
    throw new Error(`تعذر اعتماد النسخة المعقّمة: ${e.message}`);
  }
  return { stripped, changed: true };
}

module.exports = { stripVersionSpecificStatements, startsWithBuffer, TRANSACTION_TIMEOUT_LINE };
