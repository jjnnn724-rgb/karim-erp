'use strict';

/**
 * integration/lib.js — ثوابت ودوال نقية لطبقة التكامل الحكومي.
 * لا قاعدة ولا شبكة هنا، حتى تُختبر البوابات بلا تجهيزات.
 */

const crypto = require('crypto');

const PROVIDER_CODES = Object.freeze(['zatca', 'mudad', 'gosi', 'qiwa']);
const VERIFICATION_LEVELS = Object.freeze(['VERIFIED', 'INFERRED', 'UNVERIFIED', 'BLOCKED']);
const OUTBOX_STATUSES = Object.freeze(['pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled']);
const KEY_NAME_RE = /^[a-z][a-z0-9_.]{1,63}$/;

/**
 * مرآة بذور هجرة 145 — تُستخدم فقط عندما تكون جداول التكامل غير مطبقة،
 * حتى تعرض الشاشة الحقيقة (مدد محظور، التأمينات وقوى غير موثّقين) بلا 503.
 */
const PROVIDER_CATALOG = Object.freeze([
  Object.freeze({
    code: 'zatca',
    name_ar: 'هيئة الزكاة والضريبة والجمارك',
    name_en: 'ZATCA / FATOORA',
    verification: 'UNVERIFIED',
    evidence_note: 'كود إعدادات وطابور قائم (VERIFIED كودًا)؛ لا إثبات قبول إنتاجي بعد — راجع ADR-006',
  }),
  Object.freeze({
    code: 'mudad',
    name_ar: 'نظام حماية الأجور',
    name_en: 'Mudad / WPS',
    verification: 'BLOCKED',
    evidence_note: 'لا واجهة برمجية عامة موثّقة — راجع ADR-008',
  }),
  Object.freeze({
    code: 'gosi',
    name_ar: 'المؤسسة العامة للتأمينات الاجتماعية',
    name_en: 'GOSI',
    verification: 'UNVERIFIED',
    evidence_note: 'لا تكامل قائم ولا وثيقة أسرار متاحة',
  }),
  Object.freeze({
    code: 'qiwa',
    name_ar: 'منصة قوى',
    name_en: 'QIWA',
    verification: 'UNVERIFIED',
    evidence_note: 'لا تكامل قائم ولا وثيقة أسرار متاحة',
  }),
]);

function staticProviders() {
  return PROVIDER_CATALOG.map(p => ({ ...p, is_enabled: false, last_verified_at: null }));
}

/** بوابة الإرسال: التفعيل يتطلب تصنيفًا موثّقًا — لا استثناء بحسب المزوّد. */
function canEnableProvider(provider) {
  return Boolean(provider) && provider.verification === 'VERIFIED';
}

/** مفتاح إعادة حتمي بحد 200 حرف، والإصدار الأصلي يبقى سالمًا للتدقيق. */
function retryIdempotencyKey(base, attempt) {
  const suffix = `:retry:${attempt}`;
  const text = String(base);
  if (text.length + suffix.length <= 200) {
    return `${text}${suffix}`;
  }
  // Bases الطويلة: قصّ مشترك كان يخلق تصادمًا؛ بصمة تفصلها.
  const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  return `${text.slice(0, 200 - suffix.length - 17)}~${digest}${suffix}`;
}

/** maker-checker: non-admin لا يعتمد نتيجة صفًا أنشأه هو. */
function isSelfReview(actor, row) {
  if (!actor || !row) {
    return false;
  }
  if (actor.role === 'admin') {
    return false;
  }
  return row.created_by != null && String(row.created_by) === String(actor.id);
}

function clampLimit(value, fallback = 50, max = 200) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

/** شكل عام للمزوّد: لا اعتمادات ولا حقول إضافية تتسرّب مستقبلًا. */
function publicProvider(row) {
  return {
    code: row.code,
    name_ar: row.name_ar,
    name_en: row.name_en,
    verification: row.verification,
    is_enabled: Boolean(row.is_enabled),
    evidence_note: row.evidence_note ?? null,
    last_verified_at: row.last_verified_at ?? null,
  };
}

/** صف الصادر بلا payload — الحمولة تبقى في القاعدة لا في الشبكة. */
function publicOutboxRow(row) {
  return {
    id: row.id,
    provider_code: row.provider_code,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    status: row.status,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    next_attempt_at: row.next_attempt_at,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
    last_error_code: row.last_error_code ?? null,
    payload_sha256: row.payload_sha256,
  };
}

function publicEventRow(row) {
  return {
    id: row.id,
    outbox_id: row.outbox_id,
    provider_code: row.provider_code,
    direction: row.direction,
    outcome: row.outcome,
    attempt: row.attempt,
    http_status: row.http_status,
    duration_ms: row.duration_ms,
    error_code: row.error_code ?? null,
    occurred_at: row.occurred_at,
    actor_user_id: row.actor_user_id,
    metadata: row.metadata ?? {},
  };
}

module.exports = {
  PROVIDER_CODES,
  VERIFICATION_LEVELS,
  OUTBOX_STATUSES,
  KEY_NAME_RE,
  PROVIDER_CATALOG,
  staticProviders,
  canEnableProvider,
  retryIdempotencyKey,
  isSelfReview,
  clampLimit,
  publicProvider,
  publicOutboxRow,
  publicEventRow,
};
