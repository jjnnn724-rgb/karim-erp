/**
 * yarasoft/index.js — وحدة تكامل Yarasoft POS المدمجة في Karim ERP
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام في server.js:
 *   const { router, ensureYarasoftSchema, yarasoftEngine, setEngine } = require('./yarasoft');
 *   app.use('/api/yarasoft', yarasoftRouter);
 *   setEngine(yarasoftEngine);
 *   ensureYarasoftSchema().then(() => yarasoftEngine.start(io));
 *   // عند الإيقاف الآمن: yarasoftEngine.stop();
 *
 * ملاحظة أمنية: لا تُعرض ملفات الفواتير عبر HTTP إطلاقًا (مواصفة الأمان) —
 * المسارات تخدم الحالة/السجل/الربط/المراجعة فقط.
 */

'use strict';

const { YarasoftEngine } = require('./engine');
const { ensureYarasoftSchema } = require('./schema');
const { router, setEngine } = require('./routes');
const { loadConfig, joinShare } = require('./config');
const { parseInvoiceFile, suggestProfile, ParseError } = require('./parser');
const { resolveItems, upsertMapping } = require('./mapping');

const yarasoftEngine = new YarasoftEngine();
setEngine(yarasoftEngine);

module.exports = {
    router,
    ensureYarasoftSchema,
    yarasoftEngine,
    YarasoftEngine,
    loadConfig,
    joinShare,
    parseInvoiceFile,
    suggestProfile,
    ParseError,
    resolveItems,
    upsertMapping,
};
