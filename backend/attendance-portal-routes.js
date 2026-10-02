/**
 * attendance-portal-routes.js — بوابة البصمة الذاتية للموظف (Express wiring)
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md §5
 * الخطة: docs/PLAN-safe-rollout-playbook-v1.md (الخطوة S2)
 *
 * قواعد صارمة:
 *   • كل الحكم الأمني في punch-portal-logic.js (نقي ومُختبَر) — هنا توصيل فقط.
 *   • كل محاولة (ناجحة أو مرفوضة) تُسجَّل في punch_attempts — الشفافية جزء من العدالة.
 *   • الميزة تولد مغلقة (punch_portal_enabled=false) — فتحها قرار إداري من الإعدادات.
 *   • الزمن المرجعي = ساعة السيرفر دائمًا (لا نثق بساعة الجهاز).
 *   • الموقع يُقرأ لحظة البصمة فقط — لا تتبع خلفي بأي شكل.
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { evaluatePunch, resolvePunchSettings, evaluateFaceMatch, isValidFaceDescriptor, assessTeleport } = require('./punch-portal-logic');
const { createRateLimiter } = require('./rate-limiter');

const router = express.Router();

// SECURITY: limiter مخصص للبصمة — 300/دقيقة لكل IP (يستوعب طابور الصباح كله عبر
// NAT مشترك واحد، ويمنع السكربتات). القفل السلوكي (5 رفض/10د لكل مستخدم) يبقى طبقة ثانية.
const punchLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: Number(process.env.PUNCH_RATE_LIMIT_MAX) || 300,
    message: 'محاولات كثيرة جدًا — انتظر قليلًا',
});

// ─── الإعدادات الحية (من punch_settings — التغيير ينعكس بلا إعادة تشغيل) ────

async function loadPunchSettings() {
    try {
        const { rows } = await pool.query('SELECT key, value FROM punch_settings');
        return resolvePunchSettings(rows, process.env);
    } catch (e) {
        logger.error('[punch-portal] تعذر قراءة الإعدادات — الافتراضي: الميزة مغلقة:', e.message);
        // fail-safe: أي خلل في الإعدادات = الميزة مغلقة
        return resolvePunchSettings([], process.env);
    }
}

/** ربط الحساب بملف الموظف — بلا ملف موظف لا توجد بصمة ذاتية */
async function getEmployeeForUser(userId) {
    const { rows } = await pool.query(
        'SELECT id, name, "employeeId" FROM employees WHERE "userId" = $1 LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function getBoundDevice(userId) {
    const { rows } = await pool.query(
        'SELECT device_id FROM punch_devices WHERE user_id = $1 AND active = TRUE LIMIT 1',
        [userId]
    );
    return rows[0]?.device_id || null;
}

/** سجل التدقيق: يُكتب لكل محاولة — فشل التسجيل نفسه لا يمنع رفض محاولة خطرة */
let _punchAuditColsEnsured = false;
async function ensurePunchAuditCols() {
    if (_punchAuditColsEnsured) {return;}
    _punchAuditColsEnsured = true;
    try {
        await pool.query(`ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
                          ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);
                          ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS trust_score INTEGER;
                          ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS trust_signals TEXT;
                          ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS teleport_kmh NUMERIC(10,1);`);
    } catch (e) { logger.warn('[punch-portal] audit cols skipped:', e.message); }
}
async function auditAttempt(entry) {
    try {
        await ensurePunchAuditCols();
        await pool.query(
            `INSERT INTO punch_attempts
                (user_id, username, employee_id, remote_ip, network_ok, has_location,
                 accuracy_m, fix_age_s, distance_m, radius_m, device_id, decision, reject_code, engine_result, face_distance,
                 lat, lng, trust_score, trust_signals, teleport_kmh)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [entry.userId, entry.username, entry.employeeId, entry.remoteIp, entry.networkOk,
                entry.hasLocation, entry.accuracyM, entry.fixAgeS, entry.distanceM,
                entry.radiusM, entry.deviceId, entry.decision, entry.rejectCode,
                entry.engine_result ? JSON.stringify(entry.engine_result) : null,
                entry.faceDistance ?? null,
                entry.bestLat ?? null, entry.bestLng ?? null,
                entry.trustScore ?? null,
                Array.isArray(entry.trustSignals) ? entry.trustSignals.join(',') : (entry.trustSignals ?? null),
                entry.teleportKmh ?? null]
        );
    } catch (e) {
        logger.error('[punch-portal] فشل تدقيق المحاولة (لا يوقف الحكم):', e.message);
    }
}

// ─── حالة البوابة للموظف (تقرأها الواجهة قبل عرض الزر) ──────────────────────

router.get('/status', jwtAuth, async (req, res, next) => {
    try {
        const settings = await loadPunchSettings();
        const employee = await getEmployeeForUser(req.user.id);
        const boundDevice = settings.deviceBinding && employee
            ? await getBoundDevice(req.user.id) : null;
        const faceTemplate = settings.faceEnabled && employee
            ? (await pool.query('SELECT 1 FROM punch_face_templates WHERE user_id = $1 AND active = TRUE', [req.user.id])).rows[0]
            : null;
        const faceV2On = settings.faceV2Enabled === true;
        const faceV2Template = faceV2On && employee
            ? (await pool.query('SELECT 1 FROM punch_face_templates_v2 WHERE user_id = $1 AND active = TRUE', [req.user.id])).rows[0]
            : null;
        // القبول الفعّال: v1 مسجل — أو v2 مسجل والمحرك مفعّل (إصلاح 2026-10-01:
        // البوابة كانت تنظر لقالب v1 فقط فتحجب المسجل بـ v2 رغم جاهزيته)
        const faceEnrolledEffective = Boolean(faceTemplate) || (faceV2On && Boolean(faceV2Template));
        res.json({
            ok: true,
            enabled: settings.portalEnabled,
            geofence: settings.geofenceEnabled,
            deviceBinding: settings.deviceBinding,
            radiusMeters: settings.radiusMeters,
            hasEmployeeProfile: Boolean(employee),
            employeeName: employee?.name || null,
            deviceBound: Boolean(boundDevice),
            mobileV2: process.env.MOBILE_UI_V2 !== 'false', // مفتاح واجهة الجوال (افتراضي: مفعّل)
            faceEnabled: settings.faceEnabled === true,
            faceEnrolled: faceEnrolledEffective,
            faceV2: {
                enabled: faceV2On,
                enrolled: Boolean(faceV2Template),
            },
        });
    } catch (e) { next(e); }
});

// ─── البصمة الذاتية ─────────────────────────────────────────────────────────

router.post('/punch', punchLimiter, jwtAuth, requireRole('admin', 'hr', 'dept_head', 'cashier', 'kitchen', 'warehouse', 'employee'), async (req, res, next) => {
    try {
        const settings = await loadPunchSettings();

        // IP الاتصال الفعلي. SECURITY: عبر Cloudflare Tunnel يصل الطلب من 127.0.0.1 —
        // tرويسات cf-* التي يضعها cloudflared تحمل IP العميل الحقيقي، وحضورها تعني
        // أن الطلب من الإنترنت (لا من LAN): يُستخدم IP الحقيقي في الحكم والتدقيق.
        const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
        const viaTunnel = Boolean(cfIp || req.headers['cf-ray']);
        const remoteIp = cfIp || req.socket?.remoteAddress || req.ip || '';
        const deviceId = String(req.headers['x-device-id'] || req.body?.deviceId || '').trim().slice(0, 80) || null;

        const loc = req.body?.location || null;
        // إشارات الجهاز (بلجن أندرويد v2): MOCK_APP_SELECTED = إشارة ضبط (تطبيق
        // مُختار في خيارات المطور) تُسجَّل للتدقيق ولا ترفض — الرفض القاطع يحتاج
        // دليلًا على القراءة نفسها (mocked) ويُحسم في punch-portal-logic.
        const spoofSignals = Array.isArray(loc?.spoofSignals)
            ? loc.spoofSignals.map((s) => String(s).slice(0, 40)).filter(Boolean).slice(0, 5)
            : [];
        // الإصلاحات المتعددة تمر خامًا — السيرفر يحللها بنفسه (تجميد/انتقال/تشتت)
        const evaluateInput = {
            remoteIp,
            viaTunnel,
            deviceId,
            location: Array.isArray(loc?.fixes) && loc.fixes.length
                ? { fixes: loc.fixes, mocked: loc.mocked === true }
                : loc ? {
                    lat: Number(loc.lat),
                    lng: Number(loc.lng),
                    accuracy: Number(loc.accuracy),
                    fixAgeS: Number.isFinite(Number(loc.fixAgeS)) ? Number(loc.fixAgeS) : 0,
                    mocked: loc.mocked === true,
                } : null,
            boundDeviceId: null, // يُملأ بعد الربط أدناه
        };

        const settings2 = { ...settings };
        // L4: جلب الجهاز المربوط (قبل الحكم حتى يُسجَّل في التفاصيل)
        const employee = await getEmployeeForUser(req.user.id);
        if (settings.deviceBinding) {
            const bound = employee ? await getBoundDevice(req.user.id) : null;
            evaluateInput.boundDeviceId = bound;
        }

        const verdict = evaluatePunch(settings2, evaluateInput);

        // الإشارات الموثقة: ناتج المحرك (تجميد/واقعية…) + إشارات الجهاز المفصولة
        const baseSignals = Array.isArray(verdict.details.trustSignals) ? verdict.details.trustSignals : [];
        const mergedTrustSignals = (baseSignals.length || spoofSignals.length)
            ? [...spoofSignals, ...baseSignals]
            : null;

        const auditBase = {
            userId: req.user.id,
            username: req.user.username || null,
            employeeId: employee?.id ?? null,
            remoteIp,
            networkOk: verdict.details.networkOk,
            hasLocation: verdict.details.hasLocation,
            accuracyM: verdict.details.accuracyM,
            fixAgeS: verdict.details.fixAgeS,
            distanceM: verdict.details.distanceM,
            radiusM: settings.radiusMeters,
            deviceId,
            bestLat: verdict.details.bestLat ?? null,
            bestLng: verdict.details.bestLng ?? null,
            trustScore: verdict.details.trustScore ?? null,
            trustSignals: mergedTrustSignals,
        };

        // قفل مؤقت: موجة رفض متكررة = محاولة عبث — يُوقف ولا يُحاكي
        if (settings.maxRejects10m > 0) {
            const rejects = (await pool.query(
                "SELECT COUNT(*)::int AS n FROM punch_attempts WHERE user_id = $1 AND decision = 'rejected' AND attempted_at > NOW() - INTERVAL '10 minutes'",
                [req.user.id])).rows[0].n;
            if (rejects >= settings.maxRejects10m) {
                await auditAttempt({ userId: req.user.id, username: req.user.username || null, decision: 'rejected', rejectCode: 'PUNCH_LOCKED', remoteIp });
                return res.status(429).json({ ok: false, error: 'PUNCH_LOCKED', message: 'محاولات مرفوضة متكررة — البصمة مقفلة 10 دقائق' });
            }
        }

        // الأسباب البنيوية قبل لمس محرك الحضور
        if (verdict.rejectCode === 'PUNCH_PORTAL_DISABLED') {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: verdict.rejectCode });
            return res.status(403).json({ ok: false, error: verdict.rejectCode, message: 'البصمة الذاتية عبر البوابة غير مفعّلة حاليًا' });
        }
        if (!employee) {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_NO_EMPLOYEE_PROFILE' });
            return res.status(422).json({ ok: false, error: 'PUNCH_NO_EMPLOYEE_PROFILE', message: 'لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية' });
        }
        if (verdict.decision !== 'accepted') {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: verdict.rejectCode });
            const messages = {
                PUNCH_OUT_OF_NETWORK: 'لا يمكن البصمة من خارج شبكة المطعم',
                PUNCH_LOCATION_REQUIRED: 'تعذر الحصول على موقعك — فعّل تحديد الموقع وأعد المحاولة',
                PUNCH_LOCATION_MOCKED: 'تم رصد محاولة موقع مزيف — البصمة مرفوضة',
                PUNCH_LOCATION_WEAK: 'إشارة الموقع ضعيفة أو قديمة — انتظر لحظات وأعد المحاولة قرب نافذة مفتوحة',
                PUNCH_OUT_OF_RANGE: 'أنت خارج نطاق المطعم — البصمة متاحة من داخل المطعم فقط',
                PUNCH_DEVICE_REQUIRED: 'معرّف الجهاز مفقود — سجل الدخول من التطبيق من جديد',
                PUNCH_DEVICE_MISMATCH: 'هذا الجهاز غير مربوط بحسابك — تواصل مع الموارد البشرية لفك الربط',
            };
            const statusMap = {
                PUNCH_OUT_OF_NETWORK: 403, PUNCH_OUT_OF_RANGE: 403,
                PUNCH_LOCATION_MOCKED: 403, PUNCH_DEVICE_MISMATCH: 403,
                PUNCH_LOCATION_REQUIRED: 422, PUNCH_LOCATION_WEAK: 422,
                PUNCH_DEVICE_REQUIRED: 422,
            };
            return res.status(statusMap[verdict.rejectCode] || 403).json({
                ok: false, error: verdict.rejectCode,
                message: messages[verdict.rejectCode] || 'تم رفض البصمة',
                distanceM: verdict.details.distanceM,
                radiusM: settings.radiusMeters,
            });
        }

        // فحص التنقل المستحيل (2026-10-01): آخر بصمة مقبولة لهذا الموظف vs الحالية —
        // قفزة آلاف الكيلومترات بدقائق = مشاركة حساب أو تزييف متنقل. يعمل فقط عند
        // تفعيل الجيوفانس (توجد إحداثيات للمقارنة) ومفتاح punch_teleport_check.
        if (settings.teleportCheck && settings.geofenceEnabled
            && Number.isFinite(verdict.details.bestLat) && Number.isFinite(verdict.details.bestLng)) {
            try {
                const last = (await pool.query(
                    `SELECT lat, lng, attempted_at FROM punch_attempts
                      WHERE user_id = $1 AND decision = 'accepted' AND lat IS NOT NULL AND lng IS NOT NULL
                      ORDER BY attempted_at DESC LIMIT 1`,
                    [req.user.id])).rows[0];
                if (last && Number.isFinite(Number(last.lat))) {
                    const tp = assessTeleport(
                        { lat: Number(last.lat), lng: Number(last.lng), atMs: new Date(last.attempted_at).getTime() },
                        { lat: verdict.details.bestLat, lng: verdict.details.bestLng, nowMs: Date.now() },
                        Number(settings.maxTeleportKmh) || 250);
                    if (tp.teleport) {
                        await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_LOCATION_TELEPORT', teleportKmh: tp.speedKmh });
                        return res.status(403).json({
                            ok: false, error: 'PUNCH_LOCATION_TELEPORT',
                            message: `تنقل مستحيل: بصمتك الأخيرة كانت على بعد ${tp.distanceM >= 1000 ? (Math.round(tp.distanceM / 100) / 10 + ' كم') : Math.round(tp.distanceM) + ' م'} — تواصل مع الإدارة`,
                        });
                    }
                }
            } catch (e) { logger.warn('[punch-portal] teleport check skipped:', e.message); }
        }

        // L5-v2: التحقق بالوجه بمحرك ArcFace 512-d على السيرفر (Apache-2.0) —
        // يُفعَّل إداريًا ويحل محل v1 فقط لمن لديه قالب v2 (ترحيل تدريجي آمن:
        // من لا قالب v2 له يسقط تلقائيًا إلى v1 أدناه).
        // إصلاح 2026-10-01: إن وُجد قالب v2 لكن اللقطة لم تصل (كاميرا قديمة/
        // شبكة ضعيفة) نسقط إلى v1 بدل الرفض الفوري — أي دليل هوية أفضل من لا شيء.
        let faceDistance = null;
        let faceV2Handled = false;
        if (settings.faceV2Enabled) {
            try {
                const faceV2 = require('./face-engine-v2');
                if (faceV2.modelAvailable()) {
                    const tpl2 = (await pool.query(
                        'SELECT embeddings FROM punch_face_templates_v2 WHERE user_id = $1 AND active = TRUE', [req.user.id]
                    )).rows[0];
                    const img = req.body?.faceImage;
                    if (tpl2 && img) {
                        let sim = null;
                        let faceFound = false;
                        try {
                            const buf = Buffer.from(String(img).replace(/^data:image\/\w+;base64,/, ''), 'base64');
                            const emb = await faceV2.embedFaceImage(buf);
                            if (emb) {
                                faceFound = true;
                                sim = faceV2.matchEmbedding(emb, tpl2.embeddings);
                            }
                        } catch (_) { sim = null; }
                        if (faceFound && sim !== null) {
                            // وجه واضح + نتيجة — الحكم هنا نهائي (مطابق أو مرفوض)
                            faceV2Handled = true;
                            const thrV2 = Number(settings.faceV2Threshold) || 0.42;
                            if (sim < thrV2) {
                                faceDistance = Math.round((1 - sim) * 10000) / 10000;
                                await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_FACE_MISMATCH', faceDistance });
                                return res.status(403).json({ ok: false, error: 'PUNCH_FACE_MISMATCH', message: 'الوجه غير مطابق لصاحب الحساب — البصمة مرفوضة' });
                            }
                            faceDistance = Math.round((1 - sim) * 10000) / 10000;
                        }
                        // بلا وجه واضح في اللقطة (إضاءة/زاوية) → نسقط إلى v1 بدل الرفض
                    }
                }
            } catch (_) { /* أي خلل في v2 يسقط إلى v1 — لا حجب تشغيلي */ }
        }

        // L5: التحقق من الوجه (إن فُعّل إداريًا) — مطابقة المتجه على السيرفر
        if (!faceV2Handled && settings.faceEnabled) {
            const tpl = (await pool.query(
                'SELECT descriptor FROM punch_face_templates WHERE user_id = $1 AND active = TRUE', [req.user.id]
            )).rows[0];
            if (!tpl) {
                await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_FACE_NOT_ENROLLED' });
                return res.status(403).json({ ok: false, error: 'PUNCH_FACE_NOT_ENROLLED', message: 'لم يتم تسجيل وجهك بعد — راجع الموارد البشرية لتسجيل الوجه' });
            }
            const candidate = req.body?.faceDescriptor;
            const faceRes = evaluateFaceMatch(candidate, tpl.descriptor, settings.faceThreshold);
            faceDistance = faceRes.distance ?? null;
            if (!faceRes.ok) {
                const code = faceRes.rejectCode || 'PUNCH_FACE_MISMATCH';
                await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: code, faceDistance });
                const messages = {
                    PUNCH_FACE_INVALID: 'بيانات الوجه غير سليمة — أعد المحاولة أمام إضاءة جيدة',
                    PUNCH_FACE_NOT_ENROLLED: 'لم يتم تسجيل وجهك بعد — راجع الموارد البشرية',
                    PUNCH_FACE_MISMATCH: 'الوجه غير مطابق لصاحب الحساب — البصمة مرفوضة',
                };
                return res.status(403).json({ ok: false, error: code, message: messages[code] || 'الوجه غير مطابق' });
            }
        }

        // L4: أول بصمة ناجحة تربط الجهاز
        if (settings.deviceBinding && deviceId) {
            const bound = await getBoundDevice(req.user.id);
            if (!bound) {
                await pool.query(
                    `INSERT INTO punch_devices (user_id, device_id, bound_ip)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (user_id, device_id) DO UPDATE SET active = TRUE, last_seen_at = NOW()`,
                    [req.user.id, deviceId, remoteIp]
                );
            }
        }

        // الزمن المرجعي = ساعة السيرفر بتوقيت العمل (آسيا/الرياض) — نفس منطق الأجهزة
        const now = new Date();
        const riyadh = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const parts = {};
        for (const p of riyadh.formatToParts(now)) {parts[p.type] = p.value;}
        const wall = {
            date: `${parts.year}-${parts.month}-${parts.day}`,
            hour: Number(parts.hour) % 24,
            minute: Number(parts.minute),
            time: `${parts.hour}:${parts.minute}`,
        };

        // القلب: نفس محرك الحضور الذكي القائم — لا منطق موازٍ إطلاقًا
        // intent: نيّة الموظف من زر الواجهة (0=حضور/1=انصراف كأعلام أجهزة
        // البصمة) — المحرك الذكي يعالجها كتلميح وقد يتجاوزها وفق التسلسل
        const intent = String(req.body?.intent || '').toLowerCase();
        const punchState = intent === 'in' ? 0 : intent === 'out' ? 1 : null;
        const { engine } = require('./attendance-engine');
        const result = await engine.processPunch({
            employeeId: employee.id,
            punchState,
            instant: now,
            wall,
            device: { name: 'بوابة الجوال' },
            source: 'portal',
        });

        if (!result.action || result.error) {
            await auditAttempt({ ...auditBase, decision: 'rejected', rejectCode: 'PUNCH_ENGINE_ERROR' });
            return res.status(422).json({ ok: false, error: 'PUNCH_ENGINE_ERROR', message: 'تعذر تسجيل البصمة — راجع الإدارة' });
        }

        await auditAttempt({
            ...auditBase,
            decision: 'accepted',
            faceDistance,
            engine_result: { action: result.action, decision: result.decision },
        });

        return res.json({
            ok: true,
            action: result.action, // 'check_in' | 'check_out' (من محرك الحضور الذكي)
            decision: result.decision,
            at: now.toISOString(),
        });
    } catch (e) {
        logger.error('[punch-portal] punch failed:', e.message);
        return next(e);
    }
});

// ─── تسجيل محاولات رُفضت على الجهاز قبل الوصول للسيرفر ───────────────────────
// الرفض الأصلي (بلجن أندرويد) يحسم على الجهاز — يُسجَّل هنا كي لا يوجد رفض صامت
// خارج punch_attempts (الشفافية جزء من العدالة). السبب machine-parseable من
// قائمة بيضاء صارمة، والتفصيل الحر مقتطع. المحاولة تعدّ في القفل السلوكي 10د.
const CLIENT_REJECT_CODES = new Set([
    'PUNCH_LOCATION_MOCKED_CLIENT',
    'PUNCH_LOCATION_UNAVAILABLE_CLIENT',
]);
router.post('/punch/client-reject', punchLimiter, jwtAuth, requireRole('admin', 'hr', 'dept_head', 'cashier', 'kitchen', 'warehouse', 'employee'), async (req, res, next) => {
    try {
        const raw = String(req.body?.reason || '');
        const rejectCode = CLIENT_REJECT_CODES.has(raw) ? raw : 'PUNCH_CLIENT_REJECTED';
        // SECURITY: التفصيل يُعرض للإدارة في سجل المحاولات — قائمة سماح صارمة
        // (أكواد الآلة: lastKnown:GPS / live:network:clean …) تمنع حقن HTML/JS
        // مخزّن. أي حرف خارجها يُحذف، لا "تهريب" ولا ترميز نصف حلول.
        const detail = String(req.body?.detail || '')
            .replace(/[^A-Za-z0-9:_.\- ]/g, '').trim().slice(0, 120) || null;
        const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
        const remoteIp = cfIp || req.socket?.remoteAddress || req.ip || '';
        const employee = await getEmployeeForUser(req.user.id);
        await auditAttempt({
            userId: req.user.id,
            username: req.user.username || null,
            employeeId: employee?.id ?? null,
            remoteIp,
            hasLocation: false,
            decision: 'rejected',
            rejectCode,
            trustSignals: detail ? `CLIENT_DETAIL:${detail}` : 'CLIENT_DEVICE',
        });
        return res.json({ ok: true });
    } catch (e) { next(e); }
});

// ─── لوحة الإدارة (S7–S8): إعدادات البصمة + سجل المحاولات — admin/hr ────────

/** مواصفة المفاتيح المسموحة — أي مفتاح آخر يُرفض (لا حقن إعدادات) */
const PUNCH_SETTING_KEYS = {
    punch_portal_enabled:   { type: 'bool' },
    punch_geofence_enabled: { type: 'bool' },
    punch_device_binding:   { type: 'bool' },
    punch_selfie_enabled:   { type: 'bool' },
    punch_radius_meters:    { type: 'int', min: 50, max: 500 },
    punch_max_accuracy_m:   { type: 'int', min: 10, max: 200 },
    punch_max_fix_age_s:    { type: 'int', min: 5, max: 120 },
    punch_teleport_check:   { type: 'bool' },
    punch_max_teleport_kmh: { type: 'int', min: 50, max: 1000 },
    punch_face_enabled:     { type: 'bool' },
    punch_face_threshold:   { type: 'float', min: 0.3, max: 0.9 },
    punch_face_v2_enabled:  { type: 'bool' },
    punch_face_v2_threshold:{ type: 'float', min: 0.2, max: 0.8 },
    punch_restaurant_lat:   { type: 'float', min: -90, max: 90, nullable: true },
    punch_restaurant_lng:   { type: 'float', min: -180, max: 180, nullable: true },
};

function validatePunchSettingValue(key, value) {
    const spec = PUNCH_SETTING_KEYS[key];
    if (!spec) {return { error: 'UNKNOWN_KEY' };}
    if (spec.type === 'bool') {
        if (typeof value === 'boolean') {return { value: String(value) };}
        const s = String(value).trim().toLowerCase();
        if (['true', 'false', '1', '0', 'on', 'off'].includes(s)) {return { value: ['true', '1', 'on'].includes(s) ? 'true' : 'false' };}
        return { error: 'INVALID_BOOL' };
    }
    if (value === '' || value === null) {
        return spec.nullable ? { value: null } : { error: 'REQUIRED' };
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
        return { error: 'OUT_OF_RANGE', min: spec.min, max: spec.max };
    }
    return { value: String(n) };
}

// حالة الإعدادات الكاملة (admin/hr)
router.get('/settings-admin', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT key, value, updated_at, updated_by FROM punch_settings ORDER BY key');
        res.json({ ok: true, settings: rows });
    } catch (e) { next(e); }
});

// تحديث الإعدادات — ينعكس فورًا (كل طلب بصمة يقرأها حيًا) بلا إعادة تشغيل
router.put('/settings-admin', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const body = req.body || {};
        const updates = Object.entries(body).filter(([k]) => k in PUNCH_SETTING_KEYS);
        if (!updates.length) {
            return res.status(422).json({ ok: false, error: 'NO_VALID_KEYS', message: 'لا توجد مفاتيح إعدادات صالحة في الطلب' });
        }
        const errors = [];
        for (const [key, raw] of updates) {
            const v = validatePunchSettingValue(key, raw);
            if (v.error) {errors.push({ key, error: v.error, min: v.min, max: v.max });}
        }
        if (errors.length) {
            return res.status(422).json({ ok: false, error: 'INVALID_SETTINGS', errors });
        }
        for (const [key, raw] of updates) {
            const v = validatePunchSettingValue(key, raw);
            await pool.query(
                `INSERT INTO punch_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
                [key, v.value, req.user.username || req.user.name || String(req.user.sub || '') || null]
            );
        }
        const { rows } = await pool.query('SELECT key, value, updated_at, updated_by FROM punch_settings ORDER BY key');
        res.json({ ok: true, settings: rows });
    } catch (e) { next(e); }
});

// سجل المحاولات — فلاتر: decision / reject / username، حد أقصى 200 صف
router.get('/attempts', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const conds = [];
        const params = [];
        if (req.query.decision === 'accepted' || req.query.decision === 'rejected') {
            params.push(req.query.decision); conds.push(`decision = $${params.length}`);
        }
        if (req.query.reject) {
            params.push(String(req.query.reject).slice(0, 60)); conds.push(`reject_code = $${params.length}`);
        }
        if (req.query.username) {
            params.push(String(req.query.username).slice(0, 100)); conds.push(`username = $${params.length}`);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        params.push(limit);
        const { rows } = await pool.query(
            `SELECT id, username, employee_id, attempted_at, remote_ip, network_ok, has_location,
                    accuracy_m, fix_age_s, distance_m, radius_m, device_id, decision, reject_code,
                    lat, lng, trust_score, trust_signals, teleport_kmh
              FROM punch_attempts ${where}
              ORDER BY attempted_at DESC LIMIT $${params.length}`,
            params
        );
        // ملخص سريع للتنبيهات (آخر 24 ساعة)
        const summary = (await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE decision = 'rejected' AND attempted_at > NOW() - INTERVAL '24 hours')::int AS rejected_24h,
                COUNT(*) FILTER (WHERE decision = 'accepted' AND attempted_at > NOW() - INTERVAL '24 hours')::int AS accepted_24h,
                COUNT(*) FILTER (WHERE reject_code = 'PUNCH_DEVICE_MISMATCH' AND attempted_at > NOW() - INTERVAL '7 days')::int AS device_mismatch_7d,
                COUNT(*) FILTER (WHERE reject_code = 'PUNCH_OUT_OF_RANGE' AND attempted_at > NOW() - INTERVAL '7 days')::int AS out_of_range_7d
             FROM punch_attempts`
        )).rows[0];
        res.json({ ok: true, attempts: rows, summary });
    } catch (e) { next(e); }
});

// ─── تسجيل/إزالة قالب الوجه (L5) — admin/hr فقط ─────────────────────────────

// تسجيل وجه موظف: descriptor من 128 قيمة يُحسب في المتصفح من كاميرا حية —
// لا صور تُرفع ولا تُخزن (الخصوصية §5.5). التسجيل الجديد يُبطل القالب القديم.
// UPGRADE 2026-10-01: يقبل descriptors (حتى 8 عينات متنوعة) — المطابقة لاحقًا
// بأقل مسافة بين العينات تحل شكوى «سجّل الوجه ولا يقبل» الناتجة عن عينة واحدة
// حساسة للإضاءة/الكاميرا. يقبل descriptor المفرد للتوافق مع العملاء القديمة.
router.post('/face/enroll', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const { targetUserId, descriptor, descriptors } = req.body || {};
        if (!targetUserId) {return res.status(422).json({ ok: false, error: 'TARGET_REQUIRED', message: 'حدد الموظف المستهدف' });}
        const samples = Array.isArray(descriptors) ? descriptors : (descriptor ? [descriptor] : null);
        if (!Array.isArray(samples) || samples.length < 1 || samples.length > 8 || !samples.every(isValidFaceDescriptor)) {
            return res.status(422).json({ ok: false, error: 'FACE_DESCRIPTOR_INVALID', message: 'بيانات الوجه غير سليمة — أعد التسجيل أمام إضاءة جيدة' });
        }
        const user = (await pool.query('SELECT id, username, name, active FROM users WHERE id = $1', [targetUserId])).rows[0];
        if (!user || !user.active) {return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND', message: 'الحساب غير موجود أو غير نشط' });}
        await pool.query('UPDATE punch_face_templates SET active = FALSE WHERE user_id = $1 AND active = TRUE', [targetUserId]);
        const ins = await pool.query(
            `INSERT INTO punch_face_templates (user_id, descriptor, enrolled_by) VALUES ($1, $2, $3) RETURNING id, enrolled_at`,
            [targetUserId, JSON.stringify(samples), req.user.username || req.user.name || null]
        );
        logger.info('[punch-portal] face enrolled', { userId: targetUserId, samples: samples.length, by: req.user.username });
        res.json({ ok: true, id: ins.rows[0].id, enrolledAt: ins.rows[0].enrolled_at, user: { id: user.id, name: user.name } });
    } catch (e) { next(e); }
});

// إزالة قالب وجه موظف (المحركان معًا — إصلاح 2026-10-01: القديم كان يبقي قالب v2)
router.delete('/face/enroll/:userId', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const r = await pool.query(
            'UPDATE punch_face_templates SET active = FALSE WHERE user_id = $1 AND active = TRUE RETURNING id',
            [Number(req.params.userId)]
        );
        let removedV2 = 0;
        try {
            const r2 = await pool.query(
                'UPDATE punch_face_templates_v2 SET active = FALSE WHERE user_id = $1 AND active = TRUE RETURNING id',
                [Number(req.params.userId)]
            );
            removedV2 = r2.rows.length;
        } catch (_) { /* قاعدة قديمة بلا جدول v2 */ }
        res.json({ ok: true, removed: r.rows.length, removedV2 });
    } catch (e) { next(e); }
});

// ─── تسجيل وجه v2 (ArcFace 512-d على السيرفر) — admin/hr فقط ────────────────
// العميل يرسل 1-8 لقطات وجه مقصوصة (base64) — السيرفر ينتج المتجهات ويخزنها.
// لا صور تُخزَّن (الخصوصية §5.5): تُستهلك لحظيًا في الانتاج وتُهمل.
router.post('/face/enroll-v2', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const faceV2 = require('./face-engine-v2');
        if (!faceV2.modelAvailable()) {
            return res.status(503).json({ ok: false, error: 'FACE_V2_MODEL_MISSING', message: 'نموذج الوجه v2 غير مثبت على الخادم' });
        }
        const { targetUserId, images } = req.body || {};
        if (!targetUserId) {return res.status(422).json({ ok: false, error: 'TARGET_REQUIRED', message: 'حدد الموظف المستهدف' });}
        if (!Array.isArray(images) || images.length < 1 || images.length > 8) {
            return res.status(422).json({ ok: false, error: 'FACE_IMAGES_INVALID', message: 'أرسل من 1 إلى 8 لقطات وجه' });
        }
        const user = (await pool.query('SELECT id, username, name, active FROM users WHERE id = $1', [targetUserId])).rows[0];
        if (!user || !user.active) {return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND', message: 'الحساب غير موجود أو غير نشط' });}
        const embeddings = [];
        for (const img of images) {
            const buf = Buffer.from(String(img).replace(/^data:image\/\w+;base64,/, ''), 'base64');
            if (!buf.length) {
                return res.status(422).json({ ok: false, error: 'FACE_IMAGES_INVALID', message: 'إحدى اللقطات غير سليمة' });
            }
            const emb = await faceV2.embedFaceImage(buf);
            if (!emb) {
                return res.status(422).json({ ok: false, error: 'NO_FACE_IN_IMAGE', message: 'إحدى اللقطات لا تحتوي وجهًا واضحًا — أعد التسجيل' });
            }
            embeddings.push(emb);
        }
        await pool.query('UPDATE punch_face_templates_v2 SET active = FALSE WHERE user_id = $1 AND active = TRUE', [targetUserId]);
        const ins = await pool.query(
            `INSERT INTO punch_face_templates_v2 (user_id, embeddings, enrolled_by) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET embeddings = EXCLUDED.embeddings, active = TRUE, enrolled_at = NOW(), enrolled_by = EXCLUDED.enrolled_by, model = 'arcface-r100-omz' RETURNING id, enrolled_at`,
            [targetUserId, JSON.stringify(embeddings), req.user.username || req.user.name || null]
        );
        logger.info('[punch-portal] face v2 enrolled', { userId: targetUserId, samples: embeddings.length, by: req.user.username });
        res.json({ ok: true, id: ins.rows[0].id, samples: embeddings.length, dim: faceV2.EMB_DIM, enrolledAt: ins.rows[0].enrolled_at });
    } catch (e) { next(e); }
});

// قائمة الوجوه المسجلة (admin/hr) — للوحة الإدارة (v1 + v2 مع وسم المحرك)
router.get('/face/list', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const { rows } = await pool.query(
            `SELECT t.user_id, u.username, u.name, t.enrolled_at, t.enrolled_by, t.active, 'v1' AS engine
              FROM punch_face_templates t LEFT JOIN users u ON u.id = t.user_id
              WHERE t.active = TRUE
             UNION ALL
             SELECT t.user_id, u.username, u.name, t.enrolled_at, t.enrolled_by, t.active, 'v2' AS engine
              FROM punch_face_templates_v2 t LEFT JOIN users u ON u.id = t.user_id
              WHERE t.active = TRUE
              ORDER BY enrolled_at DESC`
        );
        res.json({ ok: true, faces: rows });
    } catch (e) { next(e); }
});

module.exports = router;
