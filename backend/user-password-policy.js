'use strict';
/**
 * user-password-policy.js — تدوير إجباري لكلمة المرور عند تعيينها من غير صاحبها
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة: المدير/المسؤول يعيّن كلمة مرور الموظف بنفسه، فيعرفها معه. تركها
 * كما هي يعني أن «كلمة مرور المدير المشتركة» تبقى صالحة إلى الأبد.
 *
 * القاعدة:
 *   • كلمة مرور يضعها شخصٌ لحساب غيره ⇒ must_change_password = TRUE.
 *   • صاحب الحساب يغيّر كلمته بنفسه ⇒ لا إجبار (هي التي اختارها).
 *   • الطلب الصريح must_change_password=false/0 ⇒ يُحترم (كسرٌ مقصود).
 *   • المفتاح KARIM_FORCE_PASSWORD_CHANGE_ON_RESET=0 ⇒ يوقف القاعدة كليًا.
 */
/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {number|string} [opts.actorId]
 * @param {number|string} [opts.targetId]
 * @param {Record<string, any>|null} [opts.body]
 * @returns {boolean}
 */
function forcesPasswordRotation({ env = process.env, actorId, targetId, body } = {}) {
    if (String(env.KARIM_FORCE_PASSWORD_CHANGE_ON_RESET ?? '1') === '0') {return false;}
    const actor = Number(actorId);
    const target = Number(targetId);
    if (Number.isFinite(actor) && Number.isFinite(target) && actor === target) {return false;}
    const explicit = body ? body.must_change_password : undefined;
    if (explicit === false || explicit === 0 || explicit === 'false' || explicit === '0') {return false;}
    return true;
}

module.exports = { forcesPasswordRotation };
