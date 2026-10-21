'use strict';
/**
 * server-control-maintenance.js — راية الصيانة المشتركة بين لوحة التحكم
 * والمراقبين (watchdog.js / steel-watchdog.ps1).
 * ────────────────────────────────────────────────────────────────────────────
 * الإيقاف من الواجهة لا يجوز أن يعود تلقائيًا بعد 5 دقائق بسبب المراقب.
 * يكتب المشرف ملفًا ذريًا بحالةٍ صريحة، ويقرأه كل مراقب قبل أي إصلاح.
 * الحالات العابرة (stopping/starting/restarting) تُحترم لمدة محدودة فقط؛
 * لو ماتت الخدمة المرافقة أثناء العملية فلا تبقى راية عالقة إلى الأبد.
 */
const fs = require('fs');
const path = require('path');

const STATES = new Set(['stopped', 'stopping', 'starting', 'restarting']);
const TRANSIENT = new Set(['stopping', 'starting', 'restarting']);
const STALE_MS = 10 * 60 * 1000;

function readMaintenance(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || !STATES.has(String(parsed.state))) {return null;}
        return parsed;
    } catch (_) {return null;}
}

/** كتابة ذرية: tmp ثم rename، فلا يقرأ المراقب ملفًا نصف مكتوب. */
function writeMaintenance(file, state, meta = {}) {
    if (!STATES.has(state)) {throw new Error(`invalid maintenance state: ${state}`);}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const payload = { state, at: new Date().toISOString(), ...meta };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return payload;
}

function clearMaintenance(file) {
    try {fs.rmSync(file, { force: true });} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
}

/**
 * قرار المراقب: هل يمتنع عن إحياء ERP؟
 *   stopped  → نعم دائمًا (قرار مشغّل صريح).
 *   عابرة    → نعم خلال 10 دقائق، ثم تُعدّ عالقة ويُستأنف الإصلاح.
 */
function maintenanceDecision(record, now = Date.now()) {
    if (!record) {return { skip: false, reason: null };}
    if (record.state === 'stopped') {return { skip: true, reason: 'stopped' };}
    if (!TRANSIENT.has(record.state)) {return { skip: false, reason: null };}
    const at = Date.parse(record.at || '');
    if (!Number.isFinite(at)) {return { skip: true, reason: `${record.state}:no-timestamp` };}
    if (now - at > STALE_MS) {return { skip: false, reason: `${record.state}:stale` };}
    return { skip: true, reason: record.state };
}

module.exports = {
    MAINTENANCE_STATES: STATES,
    STALE_MS,
    readMaintenance,
    writeMaintenance,
    clearMaintenance,
    maintenanceDecision,
};
