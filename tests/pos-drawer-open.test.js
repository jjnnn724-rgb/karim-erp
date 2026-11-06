/**
 * pos-drawer-open.test.js — فتح درج النقدية بضغطة زر
 * ══════════════════════════════════════════════════════════════════════
 * الدرج يفتح بنبضة ESC/POS تُرسل لطابعة الإيصالات. ما يُثبَّت هنا:
 *   1) النبضة نفسها (ESC p 0) بالبايتات — لا "نجاح وهمي" بلا نبضة.
 *   2) الفشل مغلق: بلا وردية أو بلا طابعة متصلة لا يوجد 200، ورسالة عربية.
 *   3) كل فتحة تُكتب في سجل التدقيق (من، ومتى، ومن أي قسم).
 *   4) طابعة قسم غير مسجّلة: تراجع ذكي لطابعة إيصالات متصلة أخرى.
 *   5) زر الترويسة في شاشة الكاشير يستدعي هذا المسار، والمسار مثبّت شرطيّا
 *      بـ jwtAuth + أدوار التشغيل.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let mockUser = { id: 501, role: 'cashier', name: 'أحمد السيد' };
let mockShiftRows = [];
let mockPrinterRows = [];

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = mockUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/cashier-module/print-worker', () => ({
    sendToPrinter: jest.fn(),
}));

jest.mock('../backend/cashier-module/audit-middleware', () => ({
    writeAuditLog: jest.fn(),
}));

jest.mock('../backend/cashier-module/db-pool', () => ({
    pool: {
        query: jest.fn(async (sql) => {
            if (/FROM pos_shift_sessions/.test(sql)) {return { rows: mockShiftRows };}
            if (/FROM pos_printers/.test(sql)) {return { rows: mockPrinterRows };}
            return { rows: [] };
        }),
    },
}));

const { sendToPrinter } = require('../backend/cashier-module/print-worker');
const { writeAuditLog } = require('../backend/cashier-module/audit-middleware');
const { router, DRAWER_PULSE, resolveDepartmentId } = require('../backend/cashier-module/drawer-routes');
const express = require('express');

let server;
let baseUrl;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/pos', router);
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

let userIdSeq = 500;
beforeEach(() => {
    jest.clearAllMocks();
    // معرّف جديد لكل اختبار: خنق الفتح (1.5s) لكل مستخدم يجب ألا يتسرب بين الاختبارات
    mockUser = { id: ++userIdSeq, role: 'cashier', name: 'أحمد السيد' };
    mockShiftRows = [];
    mockPrinterRows = [];
});

const post = (body, headers = {}) => fetch(`${baseUrl}/api/pos/drawer/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

const onlineReceiptPrinter = { id: 'pos-7', kind: 'receipt', is_online: true, connection_type: 'network', address: '192.168.1.50:9100' };

describe('نبضة ESC/POS', () => {
    test('النبضة القياسية ESC p 0 بـ50ms تشغيل و500ms انتظار', () => {
        expect([...DRAWER_PULSE]).toEqual([0x1B, 0x70, 0x00, 0x19, 0xFA]);
    });
});

describe('فتح الدرج — المسار', () => {
    test('نجاح: يرسل النبضة نفسها ويكتب أثر تدقيق ويعيد معرف الطابعة', async () => {
        mockPrinterRows = [onlineReceiptPrinter];
        sendToPrinter.mockResolvedValue();
        writeAuditLog.mockResolvedValue();

        const res = await post({ department_id: 7 });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.printer_id).toBe('pos-7');
        expect(sendToPrinter).toHaveBeenCalledTimes(1);
        expect(sendToPrinter.mock.calls[0][1]).toBe(DRAWER_PULSE);
        expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'pos_drawer_open',
            tableName: 'pos_printers',
            actor: expect.objectContaining({ userId: mockUser.id }),
        }));
    });

    test('بلا وردية مفتوحة: 409 برسالة عربية، ولا نبضة', async () => {
        mockShiftRows = [];
        const res = await post({});
        const body = await res.json();
        expect(res.status).toBe(409);
        expect(body.error).toBe('NO_OPEN_SHIFT');
        expect(body.message).toContain('افتح وردية');
        expect(sendToPrinter).not.toHaveBeenCalled();
    });

    test('بلا طابعة إيصالات متصلة: 409 ولا نجاح وهمي', async () => {
        mockPrinterRows = [{ ...onlineReceiptPrinter, is_online: false }];
        const res = await post({ department_id: 7 });
        const body = await res.json();
        expect(res.status).toBe(409);
        expect(body.error).toBe('NO_PRINTER');
        expect(sendToPrinter).not.toHaveBeenCalled();
    });

    test('فشل الإرسال: 503، والطابعة تُعلَّم غير متصلة، ولا تدقيق لفتحة لم تحدث', async () => {
        mockPrinterRows = [onlineReceiptPrinter];
        sendToPrinter.mockRejectedValue(new Error('ECONNREFUSED'));

        const res = await post({ department_id: 7 });
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body.error).toBe('PRINTER_UNREACHABLE');
        expect(writeAuditLog).not.toHaveBeenCalled();
        const { pool } = require('../backend/cashier-module/db-pool');
        const offlineUpdate = pool.query.mock.calls.find(([sql]) => /is_online = false/.test(sql));
        expect(offlineUpdate).toBeTruthy();
    });

    test('تراجع ذكي: طابعة القسم غائبة → أول طابعة إيصالات متصلة', async () => {
        mockPrinterRows = [onlineReceiptPrinter];
        sendToPrinter.mockResolvedValue();
        writeAuditLog.mockResolvedValue();

        const res = await post({ department_id: 99 });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.printer_id).toBe('pos-7');
        expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ fallback: true, department_id: 99 }),
        }));
    });

    test('تكرار خلال 1.5 ثانية: 429 بلا نبضة ثانية', async () => {
        mockPrinterRows = [onlineReceiptPrinter];
        sendToPrinter.mockResolvedValue();
        writeAuditLog.mockResolvedValue();
        mockUser = { id: ++userIdSeq, role: 'cashier', name: 'سريع' };

        const first = await post({ department_id: 7 });
        const second = await post({ department_id: 7 });
        const body = await second.json();

        expect(first.status).toBe(200);
        expect(second.status).toBe(429);
        expect(body.error).toBe('DRAWER_THROTTLED');
        expect(sendToPrinter).toHaveBeenCalledTimes(1);
    });
});

describe('تحديد القسم', () => {
    test('department_id في الطلب له الأولوية ويُقرأ رقمًا', async () => {
        await expect(resolveDepartmentId({ headers: {}, user: { id: 1 } }, { department_id: '7' })).resolves.toBe(7);
    });

    test('بلا وردية مفتوحة → null (يفشل المسار مغلقًا)', async () => {
        mockShiftRows = [];
        await expect(resolveDepartmentId({ headers: {}, user: { id: 1 } }, {})).resolves.toBeNull();
    });
});

describe('الربط في الخادم والواجهة', () => {
    const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

    test('المسار مركّب تحت /api/pos محميًا بالدور', () => {
        const indexSrc = read('backend', 'cashier-module', 'index.js');
        expect(indexSrc).toMatch(/drawerRoutes/);
        expect(indexSrc).toMatch(/app\.use\('\/api\/pos',\s*drawerRoutes\.router\)/);
        const drawerSrc = read('backend', 'cashier-module', 'drawer-routes.js');
        expect(drawerSrc).toMatch(/router\.post\('\/drawer\/open',\s*jwtAuth,\s*requireRole/);
        expect(drawerSrc).toMatch(/'admin',\s*'manager',\s*'cashier'/);
    });

    test('زر الترويسة في pos.js يرسل department_id الحالي', () => {
        const posJs = read('frontend', 'app', 'js', 'pos.js');
        expect(posJs).toMatch(/\/api\/pos\/drawer\/open/);
        expect(posJs).toMatch(/department_id:\s*currentDepartment/);
    });
});
