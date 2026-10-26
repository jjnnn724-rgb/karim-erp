/**
 * zkteco/index.js — وحدة مزامنة البصمة المدمجة في Karim ERP
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام في server.js:
 *   const { router, ensureZktecoSchema, attendanceEngine } = require('./zkteco');
 *   app.use('/api/zkteco', zktecoRouter);
 *   ensureZktecoSchema().then(() => attendanceEngine.start(io));
 *   // عند الإيقاف الآمن: attendanceEngine.stop();
 */

'use strict';

const { AttendanceSyncEngine, matchUserToEmployee } = require('./engine');
const { ensureZktecoSchema } = require('./schema');
const { router } = require('./routes');
const { ZKClient, ZKError, ZKConnectionError, ZKTimeoutError, ZKAuthenticationError, ZKProtocolError, DeviceNotZKTecoError } = require('./client');
const proto = require('./protocol');

const attendanceEngine = new AttendanceSyncEngine();

module.exports = {
    router,
    ensureZktecoSchema,
    attendanceEngine,
    matchUserToEmployee,
    ZKClient,
    ZKError, ZKConnectionError, ZKTimeoutError, ZKAuthenticationError, ZKProtocolError, DeviceNotZKTecoError,
    proto,
};
