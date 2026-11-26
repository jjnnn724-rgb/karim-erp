'use strict';
/** auth/service — منطق الرموز/الجلسات/كلمة المرور (واجهة مستقرة). */
const legacy = require('../../cashier-module/jwt-middleware');
const pure = require('./pure');

module.exports = {
    isStrongPassword: pure.isStrongPassword,
    publicUserOf: pure.publicUserOf,
    signAccessToken: legacy.signAccessToken,
    verifyAccessToken: legacy.verifyAccessToken,
    issueRefreshToken: legacy.issueRefreshToken,
    signMfaTicket: legacy.signMfaTicket,
    verifyMfaTicket: legacy.verifyMfaTicket,
    mfaGatePayload: legacy.mfaGatePayload,
    MFA_TICKET_TTL: legacy.MFA_TICKET_TTL,
    ACCESS_TTL: legacy.ACCESS_TTL,
    ACCESS_TTL_SECONDS: legacy.ACCESS_TTL_SECONDS,
    REFRESH_TTL_DAYS: legacy.REFRESH_TTL_DAYS,
    REFRESH_GRACE_SECONDS: legacy.REFRESH_GRACE_SECONDS,
};
