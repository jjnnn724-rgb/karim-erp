/**
 * audit-engine/checks/index.js — مجمّع كل فحوصات النطاقات
 * ────────────────────────────────────────────────────────────────────────────
 * يصدّر مصفوفة واحدة بكل الفحوصات + قائمة النطاقات المتاحة.
 */
'use strict';

const security = require('./security');
const database = require('./database');
const config = require('./config');
const resilience = require('./resilience');
const integrations = require('./integrations');
const backups = require('./backups');

const checks = [
    ...security,
    ...database,
    ...config,
    ...resilience,
    ...integrations,
    ...backups,
];

const DOMAINS = ['security', 'database', 'config', 'resilience', 'integrations', 'backups'];

module.exports = { checks, DOMAINS };
