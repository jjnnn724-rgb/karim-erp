// -*- coding: utf-8 -*-
/**
 * verify-punch-live.mjs — تحقق حي E2E لبوابة البصمة ضد السيرفر الفعلي (node scripts/verify-punch-live.mjs)
 * يوقّع توكن HS256 حقيقي لحساب اختبار (chef/9001 — بلا ملف موظف حتى لا
 * تُنشأ سجلات حضور فعلية)، ثم يمرر سيناريوهات GPS متنوعة ويتحقق من كود
 * الرفض المتوقع لكل واحدة، وينظف صفوف الاختبار من punch_attempts فورًا.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('file:///C:/Users/RemoteHome/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/cashier-module/jwt-middleware.js');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const ENV = {};
for (const line of readFileSync('C:/Users/RemoteHome/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) {ENV[m[1]] = m[2];}
}

const BASE = 'https://127.0.0.1:5000/api/attendance/portal';
const R = { lat: 21.4196655, lng: 39.8251076 }; // إحداثيات المطعم من punch_settings
const TEST_UID = 1789955417769512; // emp-002 — بملف موظف، بلا قالب وجه/جهاز مربوط (لا آثار جانبية)

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // شهادة محلية self-signed

const TOKEN = jwt.sign(
    { sub: String(TEST_UID), role: 'employee', name: 'emp-002', sid: null, pwd_change: false },
    ENV.JWT_ACCESS_SECRET, { expiresIn: '10m', algorithm: 'HS256' }
);

const db = new Client({
    host: ENV.DB_HOST || '127.0.0.1', port: ENV.DB_PORT || 5432,
    database: ENV.DB_NAME, user: ENV.DB_USER, password: ENV.DB_PASSWORD,
});

async function api(method, path, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'x-api-key': ENV.API_KEY || '' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, body: json };
}

/** جلسة GPS سليمة: 6 قراءات، دقة تتقارب 28→9م، اهتزاز طبيعي ~±30م، حساسات */
function goodFixes(distM = 0) {
    const now = Date.now();
    const accs = [28, 24, 19, 15, 11, 9];
    return accs.map((accuracy, i) => ({
        lat: R.lat + distM / 111320 + (Math.random() - 0.5) * 0.0006,
        lng: R.lng + distM / 102000 + (Math.random() - 0.5) * 0.0006,
        accuracy, fixAgeS: 3 + i,
        alt: 12 + Math.random() * 2, altAcc: 8,
        heading: 20 + i, speed: 0.4 + Math.random() * 0.3,
        t: now - (accs.length - i) * 1600,
        mocked: false,
    }));
}

const results = [];
async function scenario(name, location, expected, extra = {}) {
    await db.query('DELETE FROM punch_attempts WHERE user_id = $1', [TEST_UID]);
    const r = await api('POST', '/punch', { deviceId: 'e2e-test-device', intent: null, location, ...extra });
    const code = r.body?.error || 'ACCEPTED';
    const pass = code === expected;
    results.push({ name, expected, got: code, status: r.status, pass,
        dist: r.body?.distanceM ?? '', msg: (r.body?.message || '').slice(0, 60) });
    return r;
}

// ─── التنفيذ ────────────────────────────────────────────────────────────────
await db.connect();

// 0) حالة البوابة
const st = await api('GET', '/status');
results.push({ name: 'status (مهيأ وجيوفانس مفعّل)', expected: 'enabled+geofence', pass: st.body?.enabled === true && st.body?.geofence === true,
    got: `enabled=${st.body?.enabled} geofence=${st.body?.geofence} radius=${st.body?.radiusMeters}m` });

// 1) جلسة سليمة داخل المطعم → كل الطبقات الجغرافية تقبل (emp-002 له ملف موظف،
//    الوجه مفعّل بلا قالب → FACE_NOT_ENROLLED قبل محرك الحضور = لا سجل حضور يتولد)
await scenario('جلسة GPS سليمة داخل النطاق', { fixes: goodFixes(), mocked: false }, 'PUNCH_FACE_NOT_ENROLLED');

// 2) نفس الجلسة + إشارة mockAppSelected (بلجن v2) → تُقبل جغرافيًا وتُسجَّل الإشارة
await scenario('سليمة + إشارة تطبيق مزيف مُعد (لا ترفض)', { fixes: goodFixes(), mocked: false, spoofSignals: ['MOCK_APP_SELECTED'] }, 'PUNCH_FACE_NOT_ENROLLED');
const sig = (await db.query(`SELECT trust_signals FROM punch_attempts WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [TEST_UID])).rows[0];
results.push({ name: 'تسجيل MOCK_APP_SELECTED في التدقيق', expected: 'MOCK_APP_SELECTED ⊆ trust_signals', pass: (sig?.trust_signals || '').includes('MOCK_APP_SELECTED'), got: sig?.trust_signals || 'NONE' });

// 3) قراءة معلّمة mocked=true → رفض قاطع
const mockedFixes = goodFixes(); mockedFixes[3].mocked = true;
await scenario('قراءة معلّمة mocked → رفض قاطع', { fixes: mockedFixes, mocked: false }, 'PUNCH_LOCATION_MOCKED');

// 4) تجميد كامل (إحداثيات متطابقة تمامًا) → FROZEN
const frozenFixes = goodFixes().map(() => ({ lat: R.lat, lng: R.lng, accuracy: 10, fixAgeS: 4, t: Date.now() }));
await scenario('تجميد (إحداثيات متطابقة تمامًا)', { fixes: frozenFixes, mocked: false }, 'PUNCH_LOCATION_FROZEN');

// 5) دقة ثابتة + تشتت شبه صفر + بلا حساسات = بصمة Fake GPS → MOCKED
const flatFixes = [1, 2, 3, 4, 5, 6].map((i) => ({
    lat: R.lat + (Math.random() - 0.5) * 0.000004, lng: R.lng + (Math.random() - 0.5) * 0.000004,
    accuracy: 12, fixAgeS: 3 + i, t: Date.now() - (6 - i) * 1600,
}));
await scenario('دقة ثابتة+تشتت<3م+بلا حساسات (Fake GPS)', { fixes: flatFixes, mocked: false }, 'PUNCH_LOCATION_MOCKED');

// 6) خارج النطاق (1.5 كم) → OUT_OF_RANGE
const far = await scenario('خارج نطاق المطعم (1.5 كم)', { fixes: goodFixes(1500), mocked: false }, 'PUNCH_OUT_OF_RANGE');
results[results.length - 1].dist = far.body?.distanceM;

// 7) دقة أسوأ من 50م → WEAK
await scenario('دقة ضعيفة (80م)', { fixes: goodFixes().map((f) => ({ ...f, accuracy: 80 })), mocked: false }, 'PUNCH_LOCATION_WEAK');

// 8) قراءة قديمة (120 ث > الحد 30) → WEAK
await scenario('قراءة قديمة (120 ثانية)', { fixes: goodFixes().map((f) => ({ ...f, fixAgeS: 100 + f.fixAgeS })), mocked: false }, 'PUNCH_LOCATION_WEAK');

// 9) انتقال مستحيل (500م في ثانيتين) → FROZEN (كود السرعة)
const tel = goodFixes(); tel[5] = { ...tel[4], lat: tel[4].lat + 0.0045, t: tel[4].t + 2000 };
await scenario('انتقال مستحيل (900 كم/س)', { fixes: tel, mocked: false }, 'PUNCH_LOCATION_FROZEN');

// 10) قراءة واحدة صارمة الجودة (≤30م) → تُقبل بتصميم 2026-10-02 مع توثيق SINGLE_FIX_FALLBACK
await scenario('قراءة واحدة سليمة (≤30م) → قبول موثّق', { fixes: [{ ...goodFixes()[0], accuracy: 22 }], mocked: false }, 'PUNCH_FACE_NOT_ENROLLED');
const sf = (await db.query(`SELECT trust_signals FROM punch_attempts WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [TEST_UID])).rows[0];
results.push({ name: 'توثيق SINGLE_FIX_FALLBACK للمراجعة', expected: 'SINGLE_FIX_FALLBACK ⊆ trust_signals', pass: (sf?.trust_signals || '').includes('SINGLE_FIX_FALLBACK'), got: sf?.trust_signals || 'NONE' });

// 10ب) قراءة واحدة دقتها فوق الحد الصارم (45م > 30) → رفض
await scenario('قراءة واحدة ضعيفة (45م > الحد الصارم)', { fixes: [{ ...goodFixes()[0], accuracy: 45 }], mocked: false }, 'PUNCH_LOCATION_WEAK');

// 11) endpoint تسجيل رفض الجهاز — سبب من القائمة
const cr1 = await api('POST', '/punch/client-reject', { reason: 'PUNCH_LOCATION_MOCKED_CLIENT', detail: 'live:gps' });
results.push({ name: 'client-reject (سبب موثق)', expected: 'ok:true', pass: cr1.body?.ok === true, got: JSON.stringify(cr1.body) });

// 12) endpoint بتسبب غير معروف → fallback آمن
const cr2 = await api('POST', '/punch/client-reject', { reason: 'SOMETHING_ELSE', detail: '<script>x</script>' });
const crRow = (await db.query(`SELECT reject_code, trust_signals FROM punch_attempts WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [TEST_UID])).rows[0];
results.push({ name: 'client-reject (سبب غريب→fallback+تعقيم)', expected: 'PUNCH_CLIENT_REJECTED', pass: crRow?.reject_code === 'PUNCH_CLIENT_REJECTED' && !/[<>\"'&]/.test(crRow?.trust_signals || ''), got: `${crRow?.reject_code} | ${(crRow?.trust_signals || '').slice(0, 40)}` });

// 13) من غير توكن → 401
const noAuth = await fetch(BASE + '/punch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
results.push({ name: 'بلا توكن → 401', expected: '401', pass: noAuth.status === 401, got: String(noAuth.status) });

// 14) القفل السلوكي: 5 رفض متتابعة ثم المحاولة السادسة → PUNCH_LOCKED
for (let i = 0; i < 5; i++) { await api('POST', '/punch/client-reject', { reason: 'PUNCH_LOCATION_MOCKED_CLIENT' }); }
const locked = await api('POST', '/punch', { deviceId: 'e2e-test-device', location: { fixes: goodFixes(), mocked: false } });
results.push({ name: 'القفل السلوكي بعد 5 رفض', expected: 'PUNCH_LOCKED(429)', pass: locked.body?.error === 'PUNCH_LOCKED' && locked.status === 429, got: `${locked.body?.error}(${locked.status})` });

// تنظيف: كل صفوف مستخدم الاختبار (اختبارات صناعية — لا مكان لها في سجل الإنتاج)
const del = await db.query('DELETE FROM punch_attempts WHERE user_id = $1', [TEST_UID]);

await db.end();

// ─── التقرير ────────────────────────────────────────────────────────────────
let fails = 0;
console.log('\n==================== تقرير الاختبار الحي ====================');
for (const r of results) {
    const mark = r.pass === true ? '✅' : r.pass === false ? '❌' : '⏳';
    if (r.pass === false) {fails++;}
    console.log(`${mark} ${r.name}`);
    console.log(`     → متوقع: ${r.expected} | الفعلي: ${r.got}${r.dist ? ` | المسافة: ${r.dist}م` : ''}${r.msg ? ` | "${r.msg}"` : ''}`);
}
console.log('=============================================================');
console.log(`النتيجة: ${results.filter((r) => r.pass === true).length}/${results.length} ناجحة — حُذفت ${del.rowCount} صف اختبار`);
process.exit(fails ? 1 : 0);
