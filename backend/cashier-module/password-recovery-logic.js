/**
 * password-recovery-logic.js — استعادة كلمة المرور الذاتية (منطق نقي قابل للاختبار)
 * ────────────────────────────────────────────────────────────────────────────
 * التدفق: المدير يُصدر رمزًا من 6 أرقام لموظف نسي كلمة مروره (يُشارك شفهيًا)،
 * والموظف يستخدمه في شاشة الدخول لضبط كلمة مرور جديدة بنفسه.
 *
 * قرارات أمنية:
 *   - الرمز يُولَّد بـ crypto.randomInt (قابلية التنبؤ ضئيلة) ويُخزَّن مجزأً
 *     SHA-256 فقط — تسريب قاعدة البيانات لا يكشف الرموز القائمة.
 *   - صلاحية 10 دقائق، واستخدام واحد فقط، وإصدار رمز جديد يُبطل السابق
 *     (تُحذف صفوف "غير المستخدمة" للمستخدم).
 *   - 5 محاولات تحقق فاشلة كحد أقصى قبل قفل الرمز (مقاومة التخمين).
 *   - سياسة كلمة المرور نفسها المطبقة في jwt-middleware (≥8 حروف مع
 *     حروف وأرقام) — لا ثغرة سياسة بين الدخول والاستعادة.
 */

const crypto = require('crypto');
const { z } = require('zod');
const { isStrongPassword } = require('./jwt-middleware');

const RESET_CODE_TTL_MS = 10 * 60 * 1000;   // 10 دقائق
const MAX_VERIFY_ATTEMPTS = 5;              // قفل الرمز بعد هذا العدد من الأخطاء

/** رمز رقمي من 6 خانات (بأصفار بادئة عند اللزوم) */
function generateResetCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** تجزئة الرمز قبل التخزين — SHA-256 سداسي عشري (64 خانة) */
function hashCode(code) {
    return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

const requestCodeSchema = z.object({
    username: z.string().trim().min(2, 'اسم المستخدم قصير جدًا').max(50, 'اسم المستخدم طويل جدًا'),
});

const resetRequestSchema = z.object({
    username: z.string().trim().min(2, 'اسم المستخدم قصير جدًا').max(50, 'اسم المستخدم طويل جدًا'),
    code: z.string().regex(/^\d{6}$/, 'الرمز يتكون من 6 أرقام'),
    new_password: z.string().refine(isStrongPassword, 'يجب أن تتكون كلمة المرور من 8 حروف على الأقل وتحتوي حروفًا وأرقامًا'),
});

/**
 * حكم رمز الاستعادة مقابل صف القاعدة — نقي بالكامل (يُختبر بدون DB).
 * يُقيَّم القفل قبل المطابقة حتى لا تُضاعف المحاولة السادسة كشف القفل،
 * والانتهاء قبل الاستخدام، والمطابقة بالتجزئة لا بالنص الخام.
 */
function evaluateCodeRow(row, presentedCode, now = Date.now()) {
    if (!row) {return { ok: false, reason: 'NO_ACTIVE_CODE' };}
    if (row.used_at) {return { ok: false, reason: 'CODE_USED' };}
    if (Number(row.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {return { ok: false, reason: 'CODE_LOCKED' };}
    if (new Date(row.expires_at).getTime() <= now) {return { ok: false, reason: 'CODE_EXPIRED' };}
    if (hashCode(presentedCode) !== row.code_hash) {return { ok: false, reason: 'CODE_MISMATCH' };}
    return { ok: true };
}

module.exports = {
    RESET_CODE_TTL_MS,
    MAX_VERIFY_ATTEMPTS,
    generateResetCode,
    hashCode,
    requestCodeSchema,
    resetRequestSchema,
    evaluateCodeRow,
};
