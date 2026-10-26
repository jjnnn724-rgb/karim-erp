'use strict';
/**
 * backup-passphrase-encryption.js — تشفير متماثل للنسخ الاحتياطية بعبارة مرور
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا هذا المسار إلى جانب GPG:
 *   مفتاح GPG يحتاج **نقل المفتاح الخاص خارج الجهاز** — وإلا فُقدت النسخ
 *   المشفّرة مع الجهاز. وهذا بالضبط ما القلق عليه المالك: أن يضيع المفتاح.
 *   عبارة المرور التي يحفظها المالك في مدير كلمات المرور لا تحتاج نقل شيء:
 *   سرّ يعرفه، ويصلح به أينما كانت النسخة.
 *
 * الأمان:
 *   · AES-256-GCM (تشفير موثّق) + scrypt KDF (مقاومة للقوة الغاشمة).
 *   · salt و iv عشوائيان لكل ملف.
 *   · وسم GCM يوثّق سلامة النص المشفَّر (يكشف أي عبث).
 *   · الحاوية self-describing: تقرأها بأداة فك التشفير دون إعدادات مسبقة.
 *   · لا يُطبع السرّ ولا يُخزَّن إلا في متغيّر البيئة.
 *
 * صيغة الحاوية:
 *   magic "KBKP1\0" | version(1) | salt(16) | iv(12) | tag(16) | ciphertext
 */
const fs = require('fs');
const crypto = require('crypto');

const MAGIC = Buffer.from('KBKP1\0', 'binary');
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
    return crypto.scryptSync(Buffer.from(String(passphrase), 'utf8'), salt, KEY_LEN, SCRYPT_PARAMS);
}

/**
 * تشفير ملف بعبارة مرور.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} passphrase
 */
function encryptFile(inputPath, outputPath, passphrase) {
    if (!passphrase || String(passphrase).length < 12) {
        throw new Error('Backup passphrase must be at least 12 characters.');
    }
    if (fs.existsSync(outputPath)) {
        throw new Error(`Encrypted backup already exists; refusing to overwrite it: ${outputPath}`);
    }
    const salt = crypto.randomBytes(SALT_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const key = deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = fs.readFileSync(inputPath);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag]);
    const tmp = `${outputPath}.tmp`;
    fs.writeFileSync(tmp, header);
    const fd = fs.openSync(tmp, 'a');
    try { fs.writeSync(fd, ciphertext); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, outputPath);
    return outputPath;
}

/**
 * فك تشفير ملف بعبارة مرور (مع تحقق التوقيع).
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string} passphrase
 */
function decryptFile(inputPath, outputPath, passphrase) {
    const raw = fs.readFileSync(inputPath);
    if (raw.length < MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error(`Not a passphrase-encrypted backup (bad header): ${inputPath}`);
    }
    let off = MAGIC.length;
    const version = raw[off]; off += 1;
    if (version !== VERSION) { throw new Error(`Unsupported container version: ${version}`); }
    const salt = raw.subarray(off, off + SALT_LEN); off += SALT_LEN;
    const iv = raw.subarray(off, off + IV_LEN); off += IV_LEN;
    const tag = raw.subarray(off, off + TAG_LEN); off += TAG_LEN;
    const ciphertext = raw.subarray(off);
    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let plaintext;
    try {
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (e) {
        throw new Error('Decryption failed — wrong passphrase, or the file was altered.', { cause: e });
    }
    fs.writeFileSync(outputPath, plaintext);
    return outputPath;
}

/** هل passphrase متاح؟ (من البيئة أو من متغيّر processo) */
function readPassphrase(env = process.env) {
    const p = String(env.KARIM_BACKUP_PASSPHRASE || '').trim();
    return p.length >= 12 ? p : null;
}

module.exports = { encryptFile, decryptFile, readPassphrase, MAGIC, VERSION };
