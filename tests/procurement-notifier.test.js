/**
 * procurement-notifier.test.js — مُشعِر سلسلة طلبات الشراء
 * ─────────────────────────────────────────────────────────────────────────────
 * انحدار (2026-11-20): كان `finalStatus` مرجعًا غير معرّف داخل notifyRequestEvent
 * فيرمي ReferenceError يبتلعه catch ⇒ كل إشعارات طلبات الشراء تموت بصمت (0 إرسال).
 * كشفه type-ratchet (TS18004). هذه الاختبارات تثبت أن الإشعار يُرسل فعلًا.
 */

jest.mock('../backend/notification-service', () => ({
    notifyBestEffort: jest.fn(async () => 2),
}));
jest.mock('../backend/shared-pool', () => ({ pool: {} }));

const { notifyBestEffort } = require('../backend/notification-service');
const { buildRequestNotification, notifyRequestEvent } = require('../backend/procurement-notifier');

const req = { user: { id: 7, role: 'chef' }, io: null };
const pr = { id: 42, request_number: 'PR-42', created_by: 9, creator_name: 'مقدم الطلب' };

beforeEach(() => { notifyBestEffort.mockClear(); });

describe('notifyRequestEvent — الإرسال الفعلي (انحدار المرجع الميت)', () => {
    test('حدث إنشاء ⇒ إشعار واحد على الأقل يُرسل (لا يبتلع الخطأ بصمت)', async () => {
        const n = await notifyRequestEvent(req, pr, 'created_pending_chef');
        expect(n).toBeGreaterThan(0);
        expect(notifyBestEffort).toHaveBeenCalledTimes(1);
        const payload = notifyBestEffort.mock.calls[0][1];
        expect(payload.entity).toBe('purchaseRequests');
        expect(payload.entityId).toBe('42');
        expect(payload.category).toBe('procurement');
        expect(payload.actorUserId).toBe(7); // الفاعل مستثنى downstream
        expect(payload.targetUserIds).toContain(9); // مقدم الطلب مستهدف
    });

    test('رفض بسبب ⇒ السبب يظهر في نص الإشعار', async () => {
        await notifyRequestEvent(req, pr, 'chef_rejected', { reason: 'ميزانية غير كافية' });
        expect(notifyBestEffort).toHaveBeenCalledTimes(1);
        expect(notifyBestEffort.mock.calls[0][1].message).toContain('ميزانية غير كافية');
    });

    test('اعتماد المدير العام ⇒ يستهدف المخازن', async () => {
        await notifyRequestEvent(req, pr, 'gm_approved');
        expect(notifyBestEffort.mock.calls[0][1].targetRoles).toContain('warehouse');
    });

    test('حدث غير معروف ⇒ صفر إرسال بلا رمي', async () => {
        const n = await notifyRequestEvent(req, pr, 'nonexistent_event');
        expect(n).toBe(0);
        expect(notifyBestEffort).not.toHaveBeenCalled();
    });

    test('لا يرمي أبدًا حتى لو فشل الإشعار (best-effort)', async () => {
        notifyBestEffort.mockRejectedValueOnce(new Error('db down'));
        const n = await notifyRequestEvent(req, pr, 'created_pending_chef');
        expect(n).toBe(0);
    });
});

describe('buildRequestNotification — نقية', () => {
    test('created_approved يستهدف المخازن (الشيف أنشأه بنفسه — لا يستهدف منشئه)', () => {
        const spec = buildRequestNotification(pr, 'created_approved');
        expect(spec.targetRoles).toContain('warehouse');
        expect(spec.targetCreator).toBeFalsy();
    });
    test('رقم الطلب يظهر في النص', () => {
        const spec = buildRequestNotification(pr, 'created_pending_chef');
        expect(spec.message).toContain('PR-42');
    });
});
