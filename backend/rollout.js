'use strict';
/**
 * backend/rollout.js — القلب المجدول إلى V3
 * ═══════════════════════════════════════════════════════════════════════════
 * الموعد في `frontend/v3/rollout.json` لا في الكود — يُقرأ حيًا عند كل نداء،
 * فتعديل الموعد لا يحتاج إعادة تشغيل. التجاوز اليدوي في الاتجاهين:
 *   V3_PRIMARY=1  → v3 فورًا قبل الموعد
 *   V3_PRIMARY=0  → تعطيل القلب حتى بعد الموعد
 * ولا قلب بلا بُنية على القرص: v3Entry = v3Primary && v3Ready.
 *
 * أُعيد بناء هذه الوحدة 2026-11 من عقد tests/v3-rollout.test.js المودَع
 * (الملف الأصلي فُقد من شجرة العمل — نفس نمط فقدان backend/v3 وقت التدقيق).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'frontend', 'v3', 'rollout.json');
const V3_DIR = path.join(ROOT, 'frontend', 'v3');

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

/** لحظة القلب (ms) من الملف حيًا — NaN إن غاب الموعد أو فسدت صيغته. */
function switchAt() {
    const raw = String(readConfig().switchAt ?? '');
    return Date.parse(raw);
}

/** هل V3 هو المدخل الآن؟ التجاوز البيئي يسبق الموعد في الاتجاهين. */
function v3Primary(now = Date.now()) {
    const override = String(process.env.V3_PRIMARY ?? '').trim().toLowerCase();
    if (override === '1' || override === 'true') {return true;}
    if (override === '0' || override === 'false') {return false;}
    const at = switchAt();
    return Number.isFinite(at) && now >= at;
}

/** بُنية V3 على القرص: index.html + أصل الدخول المشار إليه موجودان فعلًا. */
function v3Ready() {
    try {
        const index = path.join(V3_DIR, 'index.html');
        if (!fs.existsSync(index)) {return false;}
        const html = fs.readFileSync(index, 'utf8');
        const m = /src="[^"]*\/assets\/(index-[^"]+\.js)"/.exec(html);
        if (!m) {return false;}
        return fs.existsSync(path.join(V3_DIR, 'assets', m[1]));
    } catch (_) {
        return false;
    }
}

/** قرار المدخل: لا يتحول قبل الموعد، ولا بلا بُنية. */
function v3Entry(now = Date.now()) {
    return v3Primary(now) && v3Ready();
}

module.exports = { switchAt, v3Primary, v3Ready, v3Entry };
