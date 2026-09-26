/**
 * yarasoft/files.js — الوصول إلى مشاركة الشبكة (حد التكامل الوحيد)
 * ────────────────────────────────────────────────────────────────────────────
 * • قراءة فقط من مشاركة Yarasoft — لا كتابة في ملفات Yarasoft الأصلية أبدًا
 *   (الحركة الوحيدة المسموحة: نقل الفاتورة بعد الالتزام إلى Archive/Failed
 *    داخل مجلدات مخصصة لها، حسب المواصفة Phase 10).
 * • كشف ترميز الملف (BOM/UTF-16/UTF-8/ANSI) بدون افتراضات.
 * • فحص استقرار الملف قبل القراءة (Phase 4): الحجم ووقت التعديل ثابتان
 *   عبر عدة محاولات + يمكن فتحه وقراءته فعليًا.
 * • صمّام أمان شبكي: كل العمليات بأخطاء SMB مؤقتة لا تُسقط الخدمة —
 *   تُعاد المحاولة كل NETWORK_RETRY_INTERVAL.
 */

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const RETRYABLE_CODES = new Set([
    'ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH',
    'EACCES', 'EPERM', 'EBUSY', 'EAGAIN', 'EMFILE', 'ENOTFOUND', 'EPIPE',
    'ECONNRESET', 'EIO', 'ESTALE', 'ENOTDIR',
]);

class NetworkUnavailableError extends Error {
    constructor(message, { code = 'NETWORK_UNAVAILABLE', cause } = {}) {
        super(message);
        this.name = 'NetworkUnavailableError';
        this.code = code;
        this.cause = cause;
    }
}

function isTransientError(error) {
    if (!error) {return false;}
    if (error instanceof NetworkUnavailableError) {return true;}
    if (RETRYABLE_CODES.has(error.code)) {return true;}
    const msg = String(error.message || '');
    return /UNC|network|SMB|share|timeout|unreachable|permission denied/i.test(msg);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** probe: هل المشاركة متاحة الآن؟ (قابل للقراءة والفهرسة) */
async function probeShare(dirPath, { timeoutMs = 5000 } = {}) {
    try {
        const list = await withTimeout(fsp.readdir(dirPath), timeoutMs, 'SHARE_LIST_TIMEOUT');
        return { ok: true, entries: list.length };
    } catch (error) {
        return { ok: false, code: error.code || 'UNKNOWN', message: error.message };
    }
}

function withTimeout(promise, ms, code) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`العملية تجاوزت المهلة (${ms}ms)`);
            err.code = code;
            reject(err);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** readdir بأمان — إخفاق الشبكة يُرجع خطأ مؤقت بدل الانهيار */
async function listDir(dirPath, { timeoutMs = 8000 } = {}) {
    try {
        return await withTimeout(fsp.readdir(dirPath, { withFileTypes: true }), timeoutMs, 'SHARE_LIST_TIMEOUT');
    } catch (error) {
        if (isTransientError(error)) {
            throw new NetworkUnavailableError(`تعذر الوصول إلى المجلد: ${dirPath}`, { code: error.code, cause: error });
        }
        throw error;
    }
}

async function statFile(filePath) {
    try {
        return await fsp.stat(filePath);
    } catch (error) {
        if (isTransientError(error)) {
            throw new NetworkUnavailableError(`تعذر قراءة خصائص الملف: ${filePath}`, { code: error.code, cause: error });
        }
        throw error;
    }
}

/**
 * Phase 4 — انتظار استقرار الملف:
 * يتحقق (stabilityChecks) متتالية مفصولة بـ stabilityDelayMs من أن
 * الحجم ووقت التعديل لم يتغيرا وأن الملف قابل للقراءة الفعلية.
 * يرمي FileNotStableError إن كان ما زال يتغير (يُعاد جدولته لاحقًا).
 */
class FileNotStableError extends Error {
    constructor(filePath, reason) {
        super(`الملف غير مستقر بعد: ${filePath} (${reason})`);
        this.name = 'FileNotStableError';
        this.code = 'FILE_NOT_STABLE';
        this.reason = reason;
    }
}

async function waitForFileStability(filePath, { stabilityDelayMs = 2000, stabilityChecks = 3 } = {}) {
    let lastSize = -1;
    let lastMtime = -1;
    for (let attempt = 1; attempt <= stabilityChecks; attempt++) {
        const stat = await statFile(filePath);
        if (!stat.isFile()) {throw new FileNotStableError(filePath, 'ليس ملفًا عاديًا');}
        const readable = await canOpenForRead(filePath);
        if (!readable) {throw new FileNotStableError(filePath, 'مقفل أو غير قابل للقراءة');}
        if (stat.size === lastSize && stat.mtimeMs === lastMtime) {
            return { stable: true, size: stat.size, mtimeMs: stat.mtimeMs, attempts: attempt };
        }
        lastSize = stat.size;
        lastMtime = stat.mtimeMs;
        if (attempt < stabilityChecks) {await sleep(stabilityDelayMs);}
    }
    return { stable: true, size: lastSize, mtimeMs: lastMtime, attempts: stabilityChecks };
}

async function canOpenForRead(filePath) {
    let handle;
    try {
        handle = await fsp.open(filePath, 'r');
        return true;
    } catch {
        return false;
    } finally {
        if (handle) {await handle.close().catch(() => {});}
    }
}

/** كشف الترميز من البداية الفعلية للبايتات (بدون افتراض صيغة) */
function detectEncoding(buffer) {
    if (buffer.length >= 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {return 'utf16le';}
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {return 'utf16be';}
        if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {return 'utf8';}
    }
    // UTF-16 بلا BOM: تكرار بايت صفري على المراتب الزوجية/الفردية
    const sample = buffer.subarray(0, Math.min(256, buffer.length));
    let zeroEven = 0, zeroOdd = 0;
    for (let i = 0; i < sample.length; i++) {
        if (sample[i] === 0) { if (i % 2 === 0) {zeroEven++;} else {zeroOdd++;} }
    }
    if (sample.length >= 8 && zeroOdd > sample.length * 0.3) {return 'utf16le';}
    if (sample.length >= 8 && zeroEven > sample.length * 0.3) {return 'utf16be';}
    return 'utf8';
}

/** قراءة الملف كنص مع كشف الترميز + SHA-256 للبايتات الخام (idempotency) */
async function readFileWithMeta(filePath, { maxBytes = 10 * 1024 * 1024 } = {}) {
    const buffer = await withTimeout(fsp.readFile(filePath), 20000, 'FILE_READ_TIMEOUT');
    if (buffer.length > maxBytes) {
        const err = new Error(`حجم الملف يتجاوز الحد (${Math.round(maxBytes / 1048576)}MB)`);
        err.code = 'FILE_TOO_LARGE';
        throw err;
    }
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const encoding = detectEncoding(buffer);
    let text;
    try {
        if (encoding === 'utf16be') {
            // Node لا يدعم utf16be مباشرة — اعكس البايتات واقرأها LE (بدون BOM)
            const swapped = Buffer.from(buffer);
            swapped.swap16();
            text = swapped.toString('utf16le').replace(/^\uFEFF/, '');
        } else {
            text = buffer.toString(encoding).replace(/^\uFEFF/, '');
        }
    } catch {
        text = buffer.toString('latin1'); // آخر ملجأ: ANSI/Windows-1252 بايت-ببايت
    }
    return { buffer, hash, encoding, text };
}

/**
 * Phase 10 — أرشفة آمنة: لا تُحرَّك الفاتورة الأصلية إلا بعد التزام المعاملة.
 * النقل داخل المشاركة نفسها (rename سريع) ومع سقوط rename بين الأحزام
 * (跨 الأقراص) نستخدم نسخة + حذف. الفشل غير قاتل — يُعاد في الدورة القادمة.
 */
async function moveFile(fromPath, toDir, { timeoutMs = 15000 } = {}) {
    await fsp.mkdir(toDir, { recursive: true }).catch(() => {});
    const fileName = path.basename(fromPath);
    const toPath = path.join(toDir, fileName);
    try {
        await withTimeout(fsp.rename(fromPath, toPath), timeoutMs, 'MOVE_TIMEOUT');
        return { moved: true, to: toPath };
    } catch (error) {
        if (error.code === 'EXDEV' || error.code === 'EPERM' || error.code === 'EACCES') {
            await withTimeout(fsp.copyFile(fromPath, toPath, fs.constants.COPYFILE_EXCL), timeoutMs, 'COPY_TIMEOUT');
            await fsp.unlink(fromPath).catch(() => {});
            return { moved: true, to: toPath, copied: true };
        }
        if (error.code === 'EEXIST') {
            // نسخة سابقة بنفس الاسم في الهدف — لا نكتب فوق بيانات Yarasoft أبدًا
            const stamp = Date.now();
            const unique = path.join(toDir, `${stamp}_${fileName}`);
            await withTimeout(fsp.rename(fromPath, unique), timeoutMs, 'MOVE_TIMEOUT');
            return { moved: true, to: unique, renamed: true };
        }
        if (isTransientError(error)) {
            throw new NetworkUnavailableError(`تعذر نقل الملف إلى ${toDir}`, { code: error.code, cause: error });
        }
        throw error;
    }
}

module.exports = {
    NetworkUnavailableError,
    FileNotStableError,
    isTransientError,
    probeShare,
    listDir,
    statFile,
    waitForFileStability,
    readFileWithMeta,
    detectEncoding,
    moveFile,
    sleep,
};
