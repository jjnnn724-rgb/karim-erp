/**
 * whatsapp-engine/schema.js — مخطط محرك واتساب داخل PostgreSQL المثبت
 * ────────────────────────────────────────────────────────────────────────────
 * نفس نهج yarasoft/schema.js: DDL مُضمّن idempotent + ملف الترحيل 053.
 * لا SQLite — منع الازدواج بقيود فريدة على مستوى القاعدة.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');

let applied = null;

const SEED_RULES = [
    // [name, match_type, pattern, response, priority]
    ['تحية', 'exact', 'السلام عليكم', 'وعليكم السلام ورحمة الله — مطاعم الشرفه العالمي ترحب بكم. أرسلوا «مساعدة» لعرض الأوامر.', 10],
    ['greeting', 'exact', 'hello', 'Hello — Al Shorfa Restaurants. Send "help" for commands.', 10],
    ['مساعدة', 'exact', 'مساعدة', 'الأوامر: مساعدة — تقرير — مخزن — مخزون <صنف> — حضور — حضور <اسم> — حضور الموظف <رقم> بتاريخ <تاريخ> — دخول وخروج <اسم> اليوم — مين حضر اليوم؟ — مين ما حضرش اليوم؟ — إيرادات اليوم — إيرادات أمس — إيرادات هذا الأسبوع — إيرادات هذا الشهر — إيرادات من <تاريخ> إلى <تاريخ> — مصاريف اليوم — مصاريف أمس — موظفين — رواتب — إجازات — وثائق — نواقص — حالة طلب <رقم> — ساعات العمل — تقفيل اليوم.', 20],
    ['help', 'exact', 'help', 'Commands: help — order <number> — hours.', 20],
    ['ساعات العمل', 'exact', 'ساعات العمل', 'يوميًا من 9 صباحًا حتى 12 منتصف الليل.', 30],
    ['حالة طلب', 'command', 'حالة طلب', '', 40],
    ['order status', 'command', 'order', '', 40],
    ['تقرير المدير', 'command', 'تقرير', '', 50],
    ['مخزن', 'command', 'مخزن', '', 51],
    ['حضور', 'command', 'حضور', '', 52],
    ['موظفين', 'command', 'موظفين', '', 53],
    ['رواتب', 'command', 'رواتب', '', 54],
    ['إجازات', 'command', 'إجازات', '', 55],
    ['وثائق', 'command', 'وثائق', '', 56],
    ['نواقص', 'command', 'نواقص', '', 57],
    ['إيراد', 'command', 'إيراد', '', 58],
    ['ايراد', 'command', 'ايراد', '', 58],
    ['تقفيل', 'command', 'تقفيل', '', 59],
    ['مبيعات الكاشير', 'command', 'مبيعات', '', 60],
];

async function seedRules() {
    for (const [name, matchType, pattern, response, priority] of SEED_RULES) {
        await pool.query(
            `INSERT INTO wa_rules (name, match_type, pattern, response, priority, enabled)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (name, match_type, pattern) DO NOTHING`,
            [name, matchType, pattern, response, priority]
        );
    }
}

async function ensureWhatsappSchema() {
    if (applied) {return applied;}
    applied = (async () => {
        const migrations = ['053_wa_engine.sql', '055_wa_professional.sql', '056_wa_media.sql', '057_wa_inbox_workspace.sql', '058_wa_campaigns.sql', '059_wa_scheduler_nlu.sql'];
        for (const migration of migrations) {
            const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'migrations', migration), 'utf8');
            await pool.query(sql);
        }
        await seedRules();
        logger.info('[WHATSAPP] تم تطبيق مخطط محرك واتساب (idempotent)');
        return true;
    })();
    try { return await applied; }
    catch (e) { applied = null; throw e; }
}

module.exports = { ensureWhatsappSchema };
