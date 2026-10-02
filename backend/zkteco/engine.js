/**
 * zkteco/engine.js — محرك مزامنة البصمة داخل خادم Karim ERP
 * ────────────────────────────────────────────────────────────────────────────
 * يعمل ضمن عملية الخادم نفسها (ليس خدمة منفصلة) ويجري دورة استطلاع دورية:
 *   1) يقرأ الأجهزة المفعّلة من قاعدة البيانات المثبتة
 *   2) يتصل بكل جهاز (مصافحة بروتوكول حقيقية) ويجمع السجلات الجديدة
 *   3) يخزن كل بصمة خام مرة واحدة بالضبط (attendance_logs — idempotent)
 *   4) يربط كل بصمة بموظف عبر "deviceUserId" (أو الرقم الوظيفي كبديل آمن)
 *   5) يملأ سجل الحضور/الانصراف اليومي (attendance) بأسلوب fill-only:
 *      لا يعدّل أبدًا أي قيمة مسجلة يدويًا أو عبر QR — صفر تعارض.
 *
 * نقطة التفتيش (device_sync_state) لا تعود للخلف (GREATEST) وتُلتزم فقط
 * بعد نجاح تخزين السجلات.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { ZKClient, ZKError } = require('./client');
const { shiftDateFor, prevDay, isLate, expectedEndTime, isEarlyLeave, lockGraceMinutes, graceMinutes, normalizeShiftStart, normalizeShiftKarim } = require('../shift-day');
const { engine, calculateTotalLateMinutes, autoCompleteEnabled: acEnabled, smartReconcileEnabled, maxReconcileDays, matchUserToEmployee: matchUtil, BUSINESS_TZ_OFFSET_MS } = require('../attendance-engine');
const proto = require('./protocol');

const AUTO_MATCH_DEFAULT = String(process.env.ZK_AUTO_MATCH_EMPLOYEE_ID ?? 'true') !== 'false';

// مفاتيح محلية للتوافق
const autoCompleteEnabled = acEnabled;

function pad2(n) { return String(n).padStart(2, '0'); }

/** تحويل وقت الجهاز المحلي (توقيت الرياض فعليًا) إلى لحظة زمنية صريحة */
function wallToInstant(wall) {
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
        - BUSINESS_TZ_OFFSET_MS);
}

/** مطابقة رقم جهاز بموظف: تطابق حرفي ثم رقمي (123 = 0123) */
function matchUserToEmployee(deviceUserId, byDeviceId, byEmployeeNo) {
    return matchUtil(deviceUserId, byDeviceId, byEmployeeNo);
}

class AttendanceSyncEngine {
    constructor() {
        this.running = false;
        this.timer = null;
        this._ticking = false;
        this._tickStartedAt = 0;
        this._watchdog = null;
        this.io = null;
        this.lastReconcileAt = 0;
        /** id → { syncing, lastAttemptAt, lastResultAt, lastError, consecutiveFailures } */
        this.states = new Map();
    }

    _state(id) {
        let st = this.states.get(id);
        if (!st) {
            st = { syncing: false, lastAttemptAt: 0, lastResultAt: 0, lastError: null, consecutiveFailures: 0, nextRetryAt: 0 };
            this.states.set(id, st);
        }
        return st;
    }

    /**
     * التراجع الأسي للمحاولات: جهاز يفشل باستمرار يُعاد محاولته بتباعد
     * بدل إغراق السجلات كل 5 ثوان. الحد الأقصى 10 دقائق بين المحاولات.
     * @param {number} failures عدد الفشلات المتتالية
     * @returns {number} مهلة بالملي ثانية قبل المحاولة التالية
     */
    _backoffMs(failures) {
        if (failures <= 0) {return 0;}
        // 30s → 1m → 2m → 4m → 8m → 10m (سقف)
        const base = 30 * 1000;
        const max = 10 * 60 * 1000;
        return Math.min(max, base * Math.pow(2, failures - 1));
    }

    start(io) {
        if (this.running) {return;}
        this.io = io || null;
        this.running = true;
        // أول دورة بعد 3 ثوان من الإقلاع (يتيح للخادم إتمام التهيئة)
        this.timer = setTimeout(() => {
            this._tick();
            this.timer = setInterval(() => this._tick(), 5000);
        }, 3000);
        // حرس الدورة: دورة عالقة أكثر من 5 دقائق (شبكة/استعلام) تُفك تلقائياً
        // حتى لا يتوقف سحب البصمات بصمت كما حدث في 2026-10-02
        this._watchdog = setInterval(() => {
            if (this._tickStartedAt && Date.now() - this._tickStartedAt > 5 * 60 * 1000) {
                logger.warn('[ZKTECO_ENGINE] دورة مزامنة عالقة أكثر من 5 دقائق — فك القفل تلقائياً');
                this._ticking = false;
                this._tickStartedAt = 0;
            }
        }, 60 * 1000);
        logger.info('[ZKTECO_ENGINE] محرك مزامنة البصمة يعمل داخل الخادم (دورة كل 5 ثوان)');
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); clearInterval(this.timer); this.timer = null; }
        if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; }
        this._ticking = false;
        this._tickStartedAt = 0;
        logger.info('[ZKTECO_ENGINE] أُوقف محرك مزامنة البصمة بأمان');
    }

    getStatus() {
        const devices = [];
        for (const [id, st] of this.states.entries()) {
            devices.push({
                id,
                syncing: st.syncing,
                lastAttemptAt: st.lastAttemptAt ? new Date(st.lastAttemptAt).toISOString() : null,
                lastResultAt: st.lastResultAt ? new Date(st.lastResultAt).toISOString() : null,
                lastError: st.lastError,
                consecutiveFailures: st.consecutiveFailures,
            });
        }
        return { running: this.running, devices };
    }

    async _tick() {
        if (!this.running || this._ticking) {return;}
        this._ticking = true;
        this._tickStartedAt = Date.now();
        const now = Date.now();
        try {
            const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE enabled = true ORDER BY id');
            for (const device of rows) {
                if (!this.running) {break;}
                const st = this._state(device.id);
                // حرس التعليق: مزامنة عالقة أكثر من دقيقتين (socket بلا رد) تُفك تلقائياً
                if (st.syncing && st.lastAttemptAt && now - st.lastAttemptAt > 120000) {
                    logger.warn('[ZKTECO_ENGINE] مزامنة عالقة أكثر من دقيقتين — فك القفل وإعادة المحاولة:', device.name || device.id);
                    st.syncing = false;
                }
                if (st.syncing) {continue;}
                const intervalMs = Math.max(5, Number(device.syncIntervalSeconds) || 30) * 1000;
                // التراجع الأسي: جهاز يفشل باستمرار يُعاد محاولته بتأخير متزايد
                const backoffMs = st.consecutiveFailures > 0 ? this._backoffMs(st.consecutiveFailures) : 0;
                const effectiveDelay = Math.max(intervalMs, backoffMs);
                if (now - st.lastAttemptAt < effectiveDelay) {continue;}
                try { await this.syncDevice(device); } catch (_) { /* مُسجلة داخل syncDevice */ }
            }
            // تعليم الأجهزة المعطلة بحالة واضحة (مرة لكل تغيير)
            await pool.query(
                `UPDATE attendance_devices SET status = 'disabled'
                 WHERE enabled = false AND status <> 'disabled'`
            ).catch(() => {});
            // مصالحة الحضور (نسيان دخول/خروج + ربط متأخر) — مرة كل ساعة
            if (!this.lastReconcileAt || now - this.lastReconcileAt > 3600 * 1000) {
                this.lastReconcileAt = now;
                try { await this.reconcileAttendance(); } catch (e) {
                    logger.warn('[ZKTECO_ENGINE] مصالحة الحضور فشلت:', e.message);
                }
            }
        } catch (error) {
            logger.error('[ZKTECO_ENGINE] دورة المزامنة فشلت:', error.message);
        } finally {
            this._ticking = false;
            this._tickStartedAt = 0;
        }
    }

    /** مزامنة جهاز واحد — تُستخدم أيضًا لمسار "مزامنة الآن" اليدوي */
    async syncDevice(device, { force = false } = {}) {
        const st = this._state(device.id);
        if (st.syncing) {return { ok: false, skipped: 'busy' };}
        if (!force && device.enabled === false) {return { ok: false, skipped: 'disabled' };}
        st.syncing = true;
        st.lastAttemptAt = Date.now();
        st.lastError = null;

        const client = new ZKClient({
            host: device.ipAddress,
            port: device.port,
            commKey: device.commKey,
            timeoutMs: Number(process.env.ZK_DEVICE_TIMEOUT_MS) || 8000,
        });
        try {
            await client.connect();
            const identity = await client.readIdentity();
            await this._persistIdentity(device, identity);

            const { records, sizes, users } = await client.getAttendance();

            // نقطة التفتيش: أول مزامنة تستورد التاريخ كاملًا، وما بعدها يقرأ
            // نافذة إعادة معالجة (الافتراضي 72 ساعة) لتغطية البصمات المتأخرة
            // (تصحيح ساعة الجهاز / انقطاع ثم عودة) — الجدول الفريد يمنع التكرار.
            const stateRow = (await pool.query(
                'SELECT "lastRecordTime" FROM device_sync_state WHERE "deviceId" = $1', [device.id]
            )).rows[0];
            const checkpoint = stateRow?.lastRecordTime ? new Date(stateRow.lastRecordTime) : null;
            const reprocessHours = Number(process.env.ZK_REPROCESS_HOURS ?? 72);
            const windowStart = checkpoint
                ? new Date(checkpoint.getTime() - Math.max(0, reprocessHours) * 3600 * 1000)
                : null;

            // تحويل اللحظة الداخلية (wall كـ UTC) إلى لحظة حقيقية بتوقيت العمل
            for (const r of records) {
                if (r.wall) {r.timestamp = wallToInstant(r.wall);}
            }
            const pending = windowStart
                ? records.filter(r => r.timestamp > windowStart)
                : records;
            // ترتيب زمني تصاعدي حتى يُملأ الحضور ثم الانصراف بالترتيب الطبيعي
            pending.sort((a, b) => a.timestamp - b.timestamp);

            const mapping = await this._loadEmployeeMapping();
            let inserted = 0;
            const insertedRows = [];
            const CHUNK = 300;
            for (let i = 0; i < pending.length; i += CHUNK) {
                const slice = pending.slice(i, i + CHUNK);
                const userIds = slice.map(r => String(r.deviceUserId));
                const times = slice.map(r => r.timestamp);
                const verify = slice.map(r => r.verifyType || 1);
                const punches = slice.map(r => r.status || 0);
                const employeeIds = slice.map((r) => {
                    const m = AUTO_MATCH_DEFAULT
                        ? matchUserToEmployee(r.deviceUserId, mapping.byDeviceId, mapping.byEmployeeNo)
                        : matchUserToEmployee(r.deviceUserId, mapping.byDeviceId, new Map());
                    return m.employeeId;
                });
                const res = await pool.query(
                    `INSERT INTO attendance_logs
                        ("deviceId", "deviceUserId", "employeeId", "attendanceTime", "verifyType", "punchState")
                     SELECT $1, u, e, t, v, p
                     FROM unnest($2::text[], $3::bigint[], $4::timestamptz[], $5::int[], $6::int[])
                          AS x(u, e, t, v, p)
                     ON CONFLICT ("deviceId", "deviceUserId", "attendanceTime") DO NOTHING
                     RETURNING id, "deviceUserId", "employeeId", "attendanceTime", "punchState"`,
                    [device.id, userIds, employeeIds, times, verify, punches]
                );
                inserted += res.rows.length;
                insertedRows.push(...res.rows);
            }

            // كتابة الحضور/الانصراف اليومي (fill-only) للسجلات الجديدة المرتبطة بموظفين
            let writeBacks = 0;
            const liveEvents = [];
            const brainCtx = { patterns: new Map(), last: new Map() };
            for (const row of insertedRows) {
                if (!row.employeeId) {
                    if (this.io) {this.io.emit('biometric:unmapped', {
                        deviceId: device.id, deviceUserId: row.deviceUserId,
                        time: row.attendanceTime, punchState: row.punchState,
                    });}
                    continue;
                }
                const wallParts = this._wallParts(row.attendanceTime);
                const empShift = mapping.byId.get(row.employeeId) || null;
                const action = await this._writeBackDailyAttendance({
                    employeeId: row.employeeId,
                    punchState: row.punchState,
                    instant: new Date(row.attendanceTime),
                    wall: wallParts,
                    device,
                    shift: empShift,
                    brain: brainCtx,
                });
                if (action) {writeBacks += 1;}
                liveEvents.push({
                    deviceId: device.id,
                    deviceName: device.deviceName || device.name,
                    deviceUserId: row.deviceUserId,
                    employeeId: row.employeeId,
                    punchState: row.punchState,
                    punchName: proto.PUNCH_STATE_NAMES[row.punchState] || `state_${row.punchState}`,
                    time: new Date(row.attendanceTime).toISOString(),
                    action,
                });
            }

            // أسماء الموظفين للأحداث الحية
            if (liveEvents.length && this.io) {
                const empInfo = await this._employeeInfoByIds(liveEvents.map(e => e.employeeId));
                for (const ev of liveEvents) {
                    ev.employeeId = ev.employeeId || null;
                    ev.employeeName = empInfo.get(ev.employeeId) || null;
                }
                if (liveEvents.length <= 50) {
                    for (const ev of liveEvents) {
                        this.io.emit('biometric:punch', ev);
                    }
                } else {
                    this.io.emit('biometric:synced', {
                        deviceId: device.id, deviceName: device.name,
                        inserted, writeBacks, at: new Date().toISOString(),
                    });
                }
            }

            // تخزين مستخدمي الجهاز (أسماء + أرقام) لصفحة الربط — قراءة فقط.
            // LOAD DISCIPLINE: this data only feeds a display page, so we do
            // NOT rewrite all N users every 30s (N sequential upserts = PG
            // churn that starves POS traffic). Full persist runs when the
            // device user count changes or every 10 minutes; otherwise only
            // users with genuinely new punches this cycle are touched.
            // Batches go through a single UNNEST query per chunk instead of
            // one round-trip per user.
            let storedUsers = 0;
            try {
                if (Array.isArray(users) && users.length) {
                    // البصمات الجديدة فقط (insertedRows) حتى لا يتضاعف العدّاد مع نافذة إعادة المعالجة
                    const punchCount = new Map();
                    for (const r of insertedRows) {
                        const k = String(r.deviceUserId);
                        punchCount.set(k, (punchCount.get(k) || 0) + 1);
                    }
                    // uid/privilege are INTEGER columns — some devices send values
                    // beyond int32 range ("integer out of range"). Clamp to
                    // NULL instead of failing the whole batch (card is BIGINT).
                    const INT32_MAX = 2147483647;
                    const toInt32 = (v, dflt) => {
                        const n = Number(v);
                        if (!Number.isFinite(n) || n < 0 || n > INT32_MAX) {return dflt;}
                        return Math.trunc(n);
                    };
                    const byUidStr = new Map();
                    for (const u of users) {
                        const k = String(u.userId ?? '').trim();
                        if (k && !byUidStr.has(k)) {byUidStr.set(k, u);}
                    }
                    const fullDue = (st.lastPersistUsers !== users.length)
                        || (Date.now() - (st.lastPersistAt || 0) > 10 * 60 * 1000);
                    // Subset to persist: everything when due, else only users
                    // with new punches this cycle (fresh display counters).
                    const subset = fullDue
                        ? [...byUidStr.values()]
                        : [...byUidStr.values()].filter((u) => punchCount.has(String(u.userId ?? '').trim()));
                    const CH = 500;
                    for (let ci = 0; ci < subset.length; ci += CH) {
                        const slice = subset.slice(ci, ci + CH);
                        const aUid = [], aUidStr = [], aName = [], aPriv = [], aCard = [], aPunch = [];
                        for (const u of slice) {
                            const k = String(u.userId ?? '').trim();
                            aUid.push(toInt32(u.uid, null));
                            aUidStr.push(k);
                            aName.push(String(u.name ?? '').slice(0, 255) || null);
                            aPriv.push(toInt32(u.privilege, 0));
                            aCard.push(Number(u.card) || null);
                            aPunch.push(punchCount.get(k) || 0);
                        }
                        try {
                            // EXCLUDED.punches carries ONLY this cycle's new
                            // punches (fixes the old double-count where the
                            // VALUES clause pre-added the stored total and the
                            // UPDATE added it again).
                            await pool.query(
                                `INSERT INTO zk_device_users ("deviceId", uid, "userId", name, privilege, card, punches, "lastSeenAt", "updatedAt")
                                 SELECT $1, u_uid, u_uidstr, u_name, u_priv, u_card, u_punch, NOW(), NOW()
                                   FROM unnest($2::int[], $3::text[], $4::text[], $5::int[], $6::bigint[], $7::int[])
                                        AS x(u_uid, u_uidstr, u_name, u_priv, u_card, u_punch)
                                 ON CONFLICT ("deviceId", "userId") DO UPDATE SET
                                    uid = EXCLUDED.uid, name = EXCLUDED.name, privilege = EXCLUDED.privilege,
                                    card = EXCLUDED.card, punches = zk_device_users.punches + EXCLUDED.punches,
                                    "lastSeenAt" = NOW(), "updatedAt" = NOW()`,
                                [device.id, aUid, aUidStr, aName, aPriv, aCard, aPunch]
                            );
                            storedUsers += slice.length;
                        } catch (chunkErr) {
                            logger.warn('[ZKTECO_ENGINE] persist users chunk skipped: ' + String(chunkErr.message).slice(0, 120));
                        }
                    }
                    if (fullDue) { st.lastPersistUsers = users.length; st.lastPersistAt = Date.now(); }
                }
            } catch (e) { logger.warn('[ZKTECO_ENGINE] persist users failed: ' + String(e.message).slice(0, 150)); }
            // نقطة التفتيش — GREATEST: لا تعود للخلف أبدًا.
            // صمام أمان: أي طابع زمني أبعد من الآن+7 أيام (سجل فاسد) لا يُلتزم أبدًا —
            // حادثة حقيقية: دفعة منحرفة بأعوام 2055-2062 ثبّتت المؤشر بالمستقبل وأوقفت المزامنة.
            const saneLimit = Date.now() + 7 * 86400000;
            let maxTs = null;
            for (const r of pending) {
                const t = r.timestamp instanceof Date ? r.timestamp.getTime() : Number(new Date(r.timestamp).getTime());
                if (Number.isFinite(t) && t <= saneLimit && (!maxTs || t > maxTs.getTime())) {maxTs = new Date(t);}
            }
            await this._updateCheckpoint(device.id, maxTs, records.length, inserted);
            await pool.query(
                `UPDATE attendance_devices
                 SET status = 'online', "lastSyncAt" = NOW(), "lastError" = NULL,
                     "totalSynced" = "totalSynced" + $2
                 WHERE id = $1`,
                [device.id, inserted]
            );

            st.lastResultAt = Date.now();
            st.consecutiveFailures = 0;
            logger.info(`[ZKTECO_ENGINE] ${device.name} (${device.ipAddress}): قراءة ${records.length} — جديد ${inserted} — مستخدمون ${sizes.users} — ربط حضور ${writeBacks}`);
            return { ok: true, read: records.length, inserted, writeBacks, users: sizes.users };
        } catch (error) {
            st.lastError = error.message;
            st.consecutiveFailures += 1;
            await pool.query(
                `UPDATE attendance_devices
                 SET status = 'offline', "lastError" = $2, "lastErrorAt" = NOW()
                 WHERE id = $1`,
                [device.id, error.message]
            ).catch(() => {});
            logger.warn(`[ZKTECO_ENGINE] فشل ${device.name} (${device.ipAddress}): ${error.message} :: ${(error.stack || '').split('\n').slice(1, 4).join(' | ')}`);
            throw error;
        } finally {
            st.syncing = false;
            try { await client.disconnect(); } catch (_) { /* لا شيء */ }
        }
    }

    async syncDeviceById(id, opts = {}) {
        const { rows } = await pool.query('SELECT * FROM attendance_devices WHERE id = $1', [id]);
        if (!rows[0]) {throw new ZKError('الجهاز غير موجود', 'ZK_DEVICE_NOT_FOUND');}
        return this.syncDevice(rows[0], { force: true, ...opts });
    }

    /** اختبار اتصال حقيقي: مصافحة + هوية + إحصاءات — دون تخزين */
    async probeDevice(device) {
        const client = new ZKClient({
            host: device.ipAddress,
            port: device.port,
            commKey: device.commKey,
            timeoutMs: Number(process.env.ZK_DEVICE_TIMEOUT_MS) || 8000,
        });
        try {
            await client.connect();
            const identity = await client.readIdentity();
            let sizes = null;
            let users = [];
            try {
                sizes = await client.readSizes();
                if (sizes && sizes.users) {users = await client.getUsers();}
            } catch (_) { /* الإحصاءات اختيارية في الفحص */ }
            if (!identity.firmware && !identity.serial && !identity.platform) {
                throw new ZKError(
                    'أجاب الجهاز على الاتصال لكن دون أي بيانات هوية ZK — ليس جهاز ZKTeco مؤكدًا',
                    'NOT_ZK_DEVICE');
            }
            await this._persistIdentity(device, identity).catch(() => {});
            return { ok: true, identity, sizes, users };
        } finally {
            try { await client.disconnect(); } catch (_) { /* لا شيء */ }
        }
    }

    // ─────────────────────────────── أدوات داخلية ──────────────────────────────
    async _persistIdentity(device, identity) {
        const serial = identity.serial ? String(identity.serial).slice(0, 100) : null;
        // تحذير عند تكرار نفس الرقم التسلسلي على أكثر من جهاز مُسجل
        if (serial) {
            const dup = await pool.query(
                'SELECT id, name FROM attendance_devices WHERE "deviceUid" = $1 AND id <> $2 LIMIT 1',
                [serial, device.id]
            );
            if (dup.rows[0]) {
                logger.warn(`[ZKTECO_ENGINE] تحذير: الرقم التسلسلي ${serial} مسجل أيضًا على الجهاز "${dup.rows[0].name}" — تأكد أن كل جهاز مُدخل مرة واحدة`);
            }
        }
        await pool.query(
            `UPDATE attendance_devices SET
                "deviceUid" = COALESCE($2, "deviceUid"),
                "deviceName" = COALESCE($3, "deviceName"),
                firmware = COALESCE($4, firmware),
                platform = COALESCE($5, platform)
             WHERE id = $1`,
            [device.id, serial, identity.deviceName, identity.firmware, identity.platform]
        );
    }

    async _loadEmployeeMapping() {
        const { rows } = await pool.query(
            'SELECT id, name, "deviceUserId", "employeeId", shift_start, shift_karim, auto_checkout FROM employees'
        );
        const byDeviceId = new Map();
        const byEmployeeNo = new Map();
        const byId = new Map();
        for (const row of rows) {
            const duid = row.deviceUserId != null ? String(row.deviceUserId).trim() : '';
            if (duid) {byDeviceId.set(duid, row.id);}
            const empNo = row.employeeId != null ? String(row.employeeId).trim() : '';
            if (empNo) {byEmployeeNo.set(empNo, row.id);}
            byId.set(row.id, {
                shiftStart: /^\d{1,2}:\d{2}$/.test(String(row.shift_start || '')) ? String(row.shift_start) : '09:00',
                shiftKarim: Number(row.shift_karim) > 0 ? Number(row.shift_karim) : 10,
                autoCheckout: row.auto_checkout === true,
                autoLock: row.auto_lock === true,
            });
        }
        return { byDeviceId, byEmployeeNo, byId, employees: rows };
    }

    async _employeeInfoByIds(ids) {
        const clean = [...new Set((ids || []).filter(Boolean))];
        if (!clean.length) {return new Map();}
        const { rows } = await pool.query(
            'SELECT id, name FROM employees WHERE id = ANY($1)', [clean]
        ).catch(() => ({ rows: [] }));
        return new Map(rows.map(r => [r.id, r.name]));
    }

    /** مكونات توقيت الرياض (ساعة العمل) من لحظة البصمة */
    _wallParts(instant) {
        const shifted = new Date(instant.getTime() + BUSINESS_TZ_OFFSET_MS);
        const y = shifted.getUTCFullYear();
        const mo = shifted.getUTCMonth() + 1;
        const d = shifted.getUTCDate();
        const h = shifted.getUTCHours();
        const mi = shifted.getUTCMinutes();
        return {
            year: y, month: mo, day: d, hour: h, minute: mi,
            date: `${y}-${pad2(mo)}-${pad2(d)}`,
            time: `${pad2(h)}:${pad2(mi)}`,
        };
    }

    /**
     * ملء سجل الحضور اليومي — fill-only + ورديات ليلية (تفويض للمحرك الموحد)
     * @returns {Promise<'check_in'|'check_out'|null>}
     */
    async _writeBackDailyAttendance({ employeeId, punchState, instant, wall, device, shift }) {
        const result = await engine.processPunch({
            employeeId, punchState, instant, wall, device, source: 'device'
        });
        if (result.action && this.io) {
            this.io.emit('attendance:updated', {
                action: result.action,
                source: 'device',
                employee: { id: employeeId },
                record: result.record,
            });
        }
        return result.action;
    }

    /**
     * مصالحة الحضور (مرة كل ساعة + عند الحاجة) — تفويض للمحرك الموحد
     */
    async reconcileAttendance() {
        return engine.reconcileAttendance();
    }

    async _updateCheckpoint(deviceId, maxTs, totalRead, totalNew) {
        // PostgreSQL GREATEST يتجاهل NULL — أول مزامنة تعتمد وقت آخر سجل،
        // وما بعدها لا يرتد للخلف أبدًا.
        await pool.query(
            `INSERT INTO device_sync_state
                ("deviceId", "lastRecordTime", "totalRead", "totalNew", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT ("deviceId") DO UPDATE SET
                "lastRecordTime" = GREATEST(device_sync_state."lastRecordTime", $2),
                "totalRead" = device_sync_state."totalRead" + $3,
                "totalNew" = device_sync_state."totalNew" + $4,
                "updatedAt" = NOW()`,
            [deviceId, maxTs, totalRead, totalNew]
        );
    }
}

module.exports = { AttendanceSyncEngine, matchUserToEmployee, wallToInstant };
