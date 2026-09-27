/**
 * whatsapp-engine/automation.js — التقارير المجدولة والتنبيهات الفورية
 * ────────────────────────────────────────────────────────────────────────────
 * - تقرير المدير الليلي: يُدفع تلقائيًا لأرقام الإدارة في وقت مضبوط (افتراضي 23:30
 *   Asia/Riyadh) — مرة واحدة يوميًا (idempotent بمفتاح التاريخ).
 * - تنبيهات فورية (مرة واحدة لكل حدث): جهاز البصمة offline، أقسام تنتظر اعتمادًا،
 *   فواتير فاشلة اليوم. تُصفَّر تلقائيًا بزوال السبب.
 * الإعدادات في wa_settings (تُضبط من صفحة واتساب) + قيم افتراضية من البيئة.
 */
'use strict';

const fs = require('fs');
const { logger } = require('../logger');
const store = require('./store');

// Flag يكتبها المراقب الخارجي قبل إعادة التشغيل — المحرك يبلّغ الإدارة مرة واحدة ثم يحذفه
const RECOVERY_FLAG = process.env.WATCHDOG_FLAG || 'C:/KarimData/watchdog/restart-flag.json';
async function checkRecoveryFlag(engine) {
    let flag = null;
    try {
        if (!fs.existsSync(RECOVERY_FLAG)) {return { skipped: true };}
        flag = JSON.parse(fs.readFileSync(RECOVERY_FLAG, 'utf8'));
    } catch (_) { return { skipped: true }; }
    try {
        const erp = require('./erp');
        const targets = await managerTargets();
        const when = String(flag?.at || '').slice(0, 16).replace('T', ' ');
        const text = `🚨 تنبيه النظام: رصد المراقب توقف السيرفر وأعاد تشغيله تلقائيًا (${when}).\nالحالة الآن: متصل ✅ — راجع لوحة التحكم للتأكد من سلامة العمليات.`;
        for (const jid of targets) {
            try { await erp.notify(engine, jid, text, { key: `svc-recovery:${flag?.at || Date.now()}`, by: null }); } catch (_) {}
        }
        try { await store.logEvent('svc_recovery_notified', when, `to ${targets.length}`); } catch (_) {}
        return { notified: targets.length };
    } finally {
        try { fs.rmSync(RECOVERY_FLAG, { force: true }); } catch (_) {}
    }
}

const DEFAULTS = {
    dailyReport: String(process.env.WHATSAPP_DAILY_REPORT || 'true').toLowerCase() !== 'false',
    dailyTime: (process.env.WHATSAPP_DAILY_REPORT_TIME || '23:30').trim(),
    alertDevice: true,
    alertUnmapped: true,
    alertFailed: true,
    alertDocs: true,
    alertShifts: true,
};

async function getSettings() {
    const s = { ...DEFAULTS };
    try {
        const raw = await store.getSetting('wa_automation');
        if (raw) {Object.assign(s, JSON.parse(raw));}
    } catch (_) {}
    if (!/^\d{2}:\d{2}$/.test(s.dailyTime)) {s.dailyTime = DEFAULTS.dailyTime;}
    return s;
}
async function saveSettings(patch) {
    const cur = await getSettings();
    const next = {
        dailyReport: patch.dailyReport !== undefined ? !!patch.dailyReport : cur.dailyReport,
        dailyTime: /^\d{2}:\d{2}$/.test(String(patch.dailyTime || '')) ? patch.dailyTime : cur.dailyTime,
        alertDevice: patch.alertDevice !== undefined ? !!patch.alertDevice : cur.alertDevice,
        alertUnmapped: patch.alertUnmapped !== undefined ? !!patch.alertUnmapped : cur.alertUnmapped,
        alertFailed: patch.alertFailed !== undefined ? !!patch.alertFailed : cur.alertFailed,
        alertDocs: patch.alertDocs !== undefined ? !!patch.alertDocs : cur.alertDocs,
        alertShifts: patch.alertShifts !== undefined ? !!patch.alertShifts : cur.alertShifts,
    };
    await store.setSetting('wa_automation', JSON.stringify(next));
    return next;
}

function parseClockTime(value) {
    const raw = String(value || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(raw)) {return null;}
    const [hours, minutes] = raw.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {return null;}
    return hours * 60 + minutes;
}

function shouldSendDailyBriefing(now, scheduledTime, lastSentDay, todayDay) {
    const targetMinutes = parseClockTime(scheduledTime);
    if (targetMinutes === null) {return false;}
    if (lastSentDay === todayDay) {return false;}
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= targetMinutes;
}

function riyadhNow() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const g = (t) => (parts.find((p) => p.type === t) || {}).value;
    return { day: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}:${g('minute')}` };
}

async function managerTargets() {
    const nums = await store.managerJids();
    return nums.map((n) => `${n}@s.whatsapp.net`);
}

async function pushBriefing(engine, day, tag) {
    const erp = require('./erp');
    const { collectBriefing, formatWhatsapp } = require('../manager-briefing');
    const gemini = require('./ai/gemini');
    const cfg = engine.getConfig();
    const b = await collectBriefing(store.pool, day || undefined);
    const bodyText = formatWhatsapp(b);
    // خلاصة تنفيذية بالذكاء الاصطناعي (مجاني — اختياري): تُبنى من بيانات التقرير فقط
    let exec = '';
    if (gemini.enabled()) {
        try {
            const g = await gemini.generateWithRetry({
                system: gemini.systemGuard(),
                prompt: 'اكتب «📌 خلاصة تنفيذية» من 3 أسطر فقط: أبرز رقم بالمقارنة، أهم مشكلة تشغيلية، وتوصية واحدة عملية. بلا مقدمات.',
                dataText: bodyText.slice(0, 3800),
                maxWords: 90,
            });
            if (g && g.text) {exec = '\n' + g.text + '\n' + '─'.repeat(14) + '\n';}
        } catch (e) { logger.warn('[WHATSAPP] executive summary skipped: ' + String(e.message).slice(0, 100)); }
    }
    const text = `🌙 التقرير الليلي ${b.day}\n` + exec + bodyText;
    void cfg;
    const targets = await managerTargets();
    let queued = 0;
    for (const jid of targets) {
        try {
            await erp.notify(engine, jid, text, { key: `daily-briefing:${b.day}:${tag || 'auto'}`, by: null });
            queued += 1;
        } catch (e) { logger.warn('[WHATSAPP] daily push failed for ' + jid + ': ' + String(e.message).slice(0, 120)); }
    }
    return { queued, day: b.day };
}

async function checkAlerts(engine) {
    const s = await getSettings();
    const targets = await managerTargets();
    if (!targets.length) {return { skipped: 'no-managers' };}
    const erp = require('./erp');
    const sent = [];
    const once = async (key, text) => {
        const flag = `wa_alert:${key}`;
        try {
            if (await store.getSetting(flag)) {return false;}
        } catch (_) {}
        for (const jid of targets) {
            try { await erp.notify(engine, jid, text, { key: `alert:${key}` }); } catch (_) {}
        }
        try { await store.setSetting(flag, new Date().toISOString()); } catch (_) {}
        sent.push(key);
        return true;
    };
    const clear = async (key) => {
        try { await store.pool.query(`DELETE FROM wa_settings WHERE key = $1`, [`wa_alert:${key}`]); } catch (_) {}
    };
    // 1) جهاز البصمة offline
    try {
        if (s.alertDevice) {
            const r = await store.pool.query(
                `SELECT name, "ipAddress" FROM attendance_devices WHERE enabled = true AND status = 'offline' LIMIT 5`);
            if (r.rows.length) {
                await once('device-offline', `⚠ جهاز البصمة غير متصل: ${r.rows.map((x) => `${x.name} (${x.ipAddress})`).join('، ')}\nالحضور يعمل بالـ QR واليدوي مؤقتًا.`);
            } else { await clear('device-offline'); }
        }
    } catch (e) { logger.warn('[WHATSAPP] alert device check failed: ' + String(e.message).slice(0, 120)); }
    // 2) أقسام تنتظر اعتمادًا
    try {
        if (s.alertUnmapped) {
            const r = await store.pool.query(`SELECT COUNT(*)::int AS c FROM yarasoft_unmapped_sections WHERE resolved = false`);
            if (Number(r.rows[0]?.c || 0) > 0) {
                await once('unmapped', `⚠ يوجد ${r.rows[0].c} قسم جديد من ياراسوفت بانتظار الاعتماد (صفحة واتساب ← أقسام الإيرادات).`);
            } else { await clear('unmapped'); }
        }
    } catch (e) { logger.warn('[WHATSAPP] alert unmapped check failed: ' + String(e.message).slice(0, 120)); }
    // 3) فواتير فاشلة اليوم
    try {
        if (s.alertFailed) {
            const r = await store.pool.query(
                `SELECT COUNT(*)::int AS c FROM invoice_import_log WHERE status = 'FAILED' AND created_at::date = CURRENT_DATE`);
            if (Number(r.rows[0]?.c || 0) > 0) {
                await once(`failed-${riyadhNow().day}`, `⚠ يوجد ${r.rows[0].c} فاتورة فاشلة اليوم في استيراد ياراسوفت — راجع السجل.`);
            }
        }
    } catch (e) { logger.warn('[WHATSAPP] alert failed check failed: ' + String(e.message).slice(0, 120)); }
    // 4) وثائق منتهية أو تنتهي خلال 7 أيام (مرة يوميًا)
    try {
        if (s.alertDocs) {
            const r = await store.pool.query(
                `SELECT COUNT(*) FILTER (WHERE ("iqamaExpiry" <> '' AND ("iqamaExpiry")::date < CURRENT_DATE)
                     OR ("healthCertExpiry" <> '' AND ("healthCertExpiry")::date < CURRENT_DATE)
                     OR ("healthEduExpiry" <> '' AND ("healthEduExpiry")::date < CURRENT_DATE))::int AS expired,
                    COUNT(*) FILTER (WHERE (("iqamaExpiry" <> '' AND ("iqamaExpiry")::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
                     OR ("healthCertExpiry" <> '' AND ("healthCertExpiry")::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
                     OR ("healthEduExpiry" <> '' AND ("healthEduExpiry")::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)))::int AS soon
                   FROM employees WHERE status = 'active'`);
            const { expired, soon } = r.rows[0] || {};
            if (Number(expired || 0) > 0 || Number(soon || 0) > 0) {
                await once(`docs-${riyadhNow().day}`, `⚠ الوثائق: ${expired} منتهية و${soon} تنتهي خلال 7 أيام — راجع «وثائق» في الشات أو لوحة HR.`);
            }
        }
    } catch (e) { logger.warn('[WHATSAPP] alert docs check failed: ' + String(e.message).slice(0, 120)); }
    // 5) ورديات مفتوحة من يوم سابق (نسيان تقفيل)
    try {
        if (s.alertShifts) {
            const r = await store.pool.query(
                `SELECT COUNT(*)::int AS c FROM pos_shift_sessions
                  WHERE status = 'open' AND opened_at::date < CURRENT_DATE`);
            if (Number(r.rows[0]?.c || 0) > 0) {
                await once('shifts-stale', `⚠ يوجد ${r.rows[0].c} وردية مفتوحة من يوم سابق — قفّلها من الكاشير قبل تقفيل اليوم.`);
            } else { await clear('shifts-stale'); }
        }
    } catch (e) { logger.warn('[WHATSAPP] alert shifts check failed: ' + String(e.message).slice(0, 120)); }
    return { sent };
}

async function processCampaigns(engine) {
    try {
        const { processCampaigns: run } = require('./campaigns');
        return await run(engine);
    } catch (e) {
        logger.error('[WHATSAPP] campaign loop failed: ' + String(e.message).slice(0, 200));
        return { error: e.message };
    }
}

function startAutomation(engine) {
    if (startAutomation._timer) {return;}
    const loop = async () => {
        try {
            const s = await getSettings();
            const connected = !!engine.connection?.isConnected();
            const now = riyadhNow();
            // التقرير الليلي: مرة واحدة يوميًا بعد الوقت المضبوط، مع تجاوز الفتحات عند إعادة الاتصال
            if (s.dailyReport) {
                let last = null;
                try { last = await store.getSetting('wa_daily_last'); } catch (_) {}
                const shouldSend = connected && shouldSendDailyBriefing(new Date(), s.dailyTime, last, now.day);
                if (shouldSend) {
                    try {
                        const r = await pushBriefing(engine, now.day, 'auto');
                        if (r.queued > 0) {
                            await store.setSetting('wa_daily_last', now.day);
                        }
                        logger.info(`[WHATSAPP] daily briefing pushed for ${now.day} → ${r.queued} chats`);
                        try { await store.logEvent('daily_pushed', now.day, `queued:${r.queued}`); } catch (_) {}
                    } catch (e) { logger.error('[WHATSAPP] daily briefing failed: ' + String(e.message).slice(0, 200)); }
                }
            }
            if (!connected) {return;}
            await checkAlerts(engine);
            await checkRecoveryFlag(engine);
            await processCampaigns(engine);
        } catch (e) { logger.error('[WHATSAPP] automation loop failed: ' + String(e.message).slice(0, 200)); }
    };
    startAutomation._timer = setInterval(() => { loop().catch(() => {}); }, 60000);
    if (startAutomation._timer.unref) {startAutomation._timer.unref();}
    // فحص أول بعد دقيقتين من الإقلاع (لا يزحم البدء)
    setTimeout(() => { loop().catch(() => {}); }, 120000);
}
function stopAutomation() {
    if (startAutomation._timer) { clearInterval(startAutomation._timer); startAutomation._timer = null; }
}

module.exports = { getSettings, saveSettings, pushBriefing, checkAlerts, processCampaigns, startAutomation, stopAutomation, riyadhNow };
