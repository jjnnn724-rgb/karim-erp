/**
 * notifications.test.js — الإشعارات الفورية الموجّهة (Task 20)
 * ─────────────────────────────────────────────────────────────
 * يغطي: تحديد مستهدفي الإشعار (أدوار/أقسام/هويات/أسماء)، استثناء
 * الفاعل، دمج المكرر، استبعاد غير النشطين، بناء صف الإشعار، تقسيم
 * المعرفات، شرط الملكية، ونصوص سلسلة اعتماد طلبات الصرف.
 */

const {
    resolveNotificationTargets,
    buildNotificationRow,
    emitNotificationRows,
} = require('../backend/notification-service');
const {
    parseNotificationIds,
    ownershipScope,
} = require('../backend/notification-routes');
const { buildChainNotification } = require('../backend/dispatch-notifier');

const USERS = [
    { id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', dept_code: null, active: true },
    { id: 2, username: 'chef', name: 'الشيف العمومي', role: 'kitchen', dept_code: null, active: true },
    { id: 3, username: 'keeper', name: 'أمين المخازن', role: 'warehouse', dept_code: null, active: true },
    { id: 4, username: 'head_salads', name: 'رئيس السلطات', role: 'dept_head', dept_code: 'salads', active: true },
    { id: 5, username: 'head_sweets', name: 'رئيس الحلواني', role: 'dept_head', dept_code: 'sweets', active: true },
    { id: 6, username: 'old_user', name: 'مستخدم موقوف', role: 'kitchen', dept_code: null, active: false },
];

describe('تحديد مستهدفي الإشعار', () => {
    test('الأدوار تصل لكل من يحمل الدور النشط فقط', () => {
        const targets = resolveNotificationTargets(USERS, { targetRoles: ['kitchen'] });
        // المستخدم 6 يحمل الدور نفسه لكنه موقوف — يُستبعد
        expect(targets.map(t => t.id)).toEqual([2]);
    });

    test('الأقسام تصل لربط القسم فقط', () => {
        const targets = resolveNotificationTargets(USERS, { targetDeptCodes: ['salads'] });
        expect(targets.map(t => t.id)).toEqual([4]);
    });

    test('الهويات المباشرة تصل للمستخدم المحدد', () => {
        const targets = resolveNotificationTargets(USERS, { targetUserIds: [3, '3'] });
        expect(targets.map(t => t.id)).toEqual([3]); // مكرر مدمج
    });

    test('الأسماء (اسم الدخول أو الاسم الظاهر) تصل لصاحبها', () => {
        const byUsername = resolveNotificationTargets(USERS, { targetUsernames: ['head_sweets'] });
        expect(byUsername.map(t => t.id)).toEqual([5]);
        const byName = resolveNotificationTargets(USERS, { targetUsernames: ['رئيس السلطات'] });
        expect(byName.map(t => t.id)).toEqual([4]);
    });

    test('الفاعل لا يُشعَر نفسه حتى لو طابق شرط الهدف', () => {
        const targets = resolveNotificationTargets(USERS, { targetRoles: ['kitchen'], actorUserId: 2 });
        expect(targets.map(t => t.id)).toEqual([]);
        const targets2 = resolveNotificationTargets(USERS, { targetRoles: ['kitchen'], actorUserId: 1 });
        expect(targets2.map(t => t.id)).toEqual([2]);
    });

    test('المستهدف المشترك بين دور وهوية يظهر مرة واحدة فقط', () => {
        const targets = resolveNotificationTargets(USERS, { targetRoles: ['kitchen'], targetUserIds: [2], actorUserId: 1 });
        expect(targets.map(t => t.id)).toEqual([2]);
    });

    test('بلا أهداف يعيد قائمة فارغة', () => {
        expect(resolveNotificationTargets(USERS, {})).toEqual([]);
        expect(resolveNotificationTargets(USERS, { targetRoles: [] })).toEqual([]);
    });

    test('المقارنة غير حساسة لحالة الأحرف', () => {
        const targets = resolveNotificationTargets(USERS, { targetDeptCodes: ['SALADS'], targetRoles: ['KITCHEN'] });
        expect(targets.map(t => t.id).sort()).toEqual([2, 4]);
    });
});

describe('بناء صف الإشعار', () => {
    test('النوع الصحيح يُحترم والغريب يسقط إلى info', () => {
        expect(buildNotificationRow({ id: 10, type: 'success', title: 'تم', message: 'اعتماد', userId: 4 }).type).toBe('success');
        expect(buildNotificationRow({ id: 10, type: 'weird', title: 'تم', message: 'اعتماد', userId: 4 }).type).toBe('info');
    });

    test('العنوان الطويل يُقص عند 255 حرفاً', () => {
        const row = buildNotificationRow({ id: 10, title: 'ا'.repeat(300), message: 'x', userId: 1 });
        expect(row.title.length).toBe(255);
    });

    test('بلا عنوان ولا رسالة يعيد null', () => {
        expect(buildNotificationRow({ id: 10, title: '  ', message: '' })).toBeNull();
    });

    test('المرجع والرابط يُحفظان مع الطالب', () => {
        const row = buildNotificationRow({ id: 10, title: 'صرف', message: 'م', entity: 'dispatches', entityId: 99, link: 'dispatch', userId: 3 });
        expect(row.entity).toBe('dispatches');
        expect(row.entity_id).toBe('99');
        expect(row.link).toBe('dispatch');
        expect(row.user_id).toBe(3);
        expect(row.read).toBe(false);
    });
});

describe('بث الإشعارات عبر Socket.IO', () => {
    test('يبث لغرفة كل مستخدم هدف فقط', () => {
        const sent = [];
        const io = { to(room) { sent.push(room); return { emit(event) { sent.push(event); } }; } };
        const rows = [
            buildNotificationRow({ id: 1, title: 'أ', message: 'م', userId: 2 }),
            buildNotificationRow({ id: 2, title: 'ب', message: 'م', userId: 3 }),
        ];
        const count = emitNotificationRows(io, rows);
        expect(count).toBe(2);
        expect(sent.filter(r => String(r).startsWith('user:')).sort()).toEqual(['user:2', 'user:3']);
    });

    test('بلا io أو صفوف لا يرمي ولا يبث', () => {
        expect(emitNotificationRows(null, [])).toBe(0);
        expect(emitNotificationRows({}, null)).toBe(0);
    });
});

describe('مسارات الإشعارات — أدوات نقية', () => {
    test('تقسيم المعرفات يقبض الأعداد الصحيحة الموجبة فقط ويدمج التكرار', () => {
        expect(parseNotificationIds([1, '2', 2, 0, -5, 1.5, 'x', null])).toEqual([1, 2]);
    });

    test('شرط الملكية يشمل إشعاراتي والإشعارات العامة القديمة', () => {
        const scope = ownershipScope(7);
        expect(scope.clause).toContain('user_id = $1');
        expect(scope.clause).toContain('user_id IS NULL');
        expect(scope.params).toEqual([7]);
    });
});

describe('نصوص سلسلة اعتماد طلبات الصرف', () => {
    const dispatch = { id: 77, deptName: 'قسم السلطات', creatorUserId: 4, createdBy: 'head_salads' };

    test('تقديم رئيس قسم يوجَّه للشيف العمومي', () => {
        const spec = buildChainNotification(dispatch, 'created_pending_chef');
        expect(spec.targetRoles).toEqual(['kitchen']);
        expect(spec.title).toContain('طلب صرف جديد');
        expect(spec.message).toContain('قسم السلطات');
    });

    test('التوجيه المباشر يوجَّه للمخازن', () => {
        const spec = buildChainNotification(dispatch, 'created_direct');
        expect(spec.targetRoles).toEqual(['warehouse']);
    });

    test('اعتماد الشيف يوجَّه للمخازن ولمقدم الطلب معاً', () => {
        const spec = buildChainNotification(dispatch, 'chef_approved');
        expect(spec.targetRoles).toEqual(['warehouse']);
        expect(spec.targetCreator).toBe(true);
        expect(spec.type).toBe('success');
    });

    test('رفض الشيف يحمل السبب ويوجَّه لمقدم الطلب', () => {
        const spec = buildChainNotification(dispatch, 'chef_rejected', { reason: 'كمية غير منطقية' });
        expect(spec.targetCreator).toBe(true);
        expect(spec.message).toContain('كمية غير منطقية');
    });

    test('صرف المخازن يُشعِر مقدم الطلب والشيف', () => {
        const spec = buildChainNotification(dispatch, 'warehouse_approved');
        expect(spec.targetRoles).toEqual(['kitchen']);
        expect(spec.targetCreator).toBe(true);
    });

    test('الاستلام والإرجاع يخاطبان المخازن والشيف', () => {
        expect(buildChainNotification(dispatch, 'received').targetRoles.sort()).toEqual(['kitchen', 'warehouse']);
        expect(buildChainNotification(dispatch, 'returned').targetRoles.sort()).toEqual(['kitchen', 'warehouse']);
    });

    test('حدث مجهول يعيد null بلا أخطاء', () => {
        expect(buildChainNotification(dispatch, 'unknown_event')).toBeNull();
        expect(buildChainNotification(null, 'created_direct')).not.toBeNull();
    });
});
