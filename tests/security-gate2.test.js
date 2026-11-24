/**
 * security-gate2.test.js — حرّاس إصلاحات البوابة 2
 * ─────────────────────────────────────────────────────────────────────────────
 * يثبت أن الإصلاحات المعتمدة باقية: بوابة app_state للمقابس المصادقة،
 * فحص رقم البصمة قبل توليد البطاقة، تجزئة النسخ بثًّا، إغلاق fail-open
 * لفحص الحساب، ومنع أعمدة كلمات المرور من أدوات المساعد.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

jest.mock('../backend/shared-pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../backend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { pool } = require('../backend/shared-pool');
const { readTable, searchTable } = require('../backend/ai-assistant/tools');

describe('أدوات المساعد — كلمات المرور لا تخرج', () => {
    beforeEach(() => {pool.query.mockReset();});

    test('read_table يحذف password وpassword_vault من الصفوف والأعمدة', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [{}] }) // exists
            .mockResolvedValueOnce({ rows: [
                { column_name: 'id' }, { column_name: 'name' },
                { column_name: 'password' }, { column_name: 'password_vault' },
            ] })
            .mockResolvedValueOnce({ rows: [{ id: 1, name: 'أحمد', password: 'hash', password_vault: 'vault' }] });

        const out = await readTable('users');
        expect(out.columns).toEqual(['id', 'name']);
        expect(out.rows[0]).toEqual({ id: 1, name: 'أحمد' });
    });

    test('search_table لا يبحث في أعمدة كلمات المرور', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [
                { column_name: 'name', data_type: 'text' },
                { column_name: 'password', data_type: 'character varying' },
            ] })
            .mockResolvedValueOnce({ rows: [{ id: 2, name: 'سارة', password: 'hash' }] });

        const out = await searchTable('users', 'سارة');
        const sql = pool.query.mock.calls[1][0];
        expect(sql).not.toMatch(/"password"/);
        expect(out.rows[0].password).toBeUndefined();
    });
});

describe('حرّاس المصدر — لا تراجع صامت', () => {
    const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const sys = fs.readFileSync(path.join(ROOT, 'backend', 'system-routes.js'), 'utf8');
    const jwt = fs.readFileSync(path.join(ROOT, 'backend', 'cashier-module', 'jwt-middleware.js'), 'utf8');

    test('request_sync يرفض المقبس غير المصادق قبل قراءة app_state', () => {
        const handler = server.slice(server.indexOf("socket.on('request_sync'"), server.indexOf("socket.on('broadcast_notification'"));
        expect(handler).toMatch(/socket\.data\.authed/);
        expect(handler.indexOf('socket.data.authed')).toBeLessThan(handler.indexOf('SELECT state_data'));
    });

    test('رقم البصمة يُفحص قبل استدعاء توليد البطاقة', () => {
        const block = server.slice(server.indexOf("if (entity === 'employees') {\n                const fp"), server.indexOf("res.status(201).json(publicRow)"));
        expect(block).toMatch(/\^\[A-Za-z0-9_-\]\{1,64\}\$/);
        expect(block.indexOf('A-Za-z0-9_-')).toBeLessThan(block.indexOf('generate-card.js'));
    });

    test('رفع النسخة يجزّئ بثًّا لا بقراءة كاملة في الذاكرة', () => {
        expect(sys).toMatch(/await sha256File\(full\)/);
        expect(sys).not.toMatch(/update\(fs\.readFileSync\(full\)\)/);
    });

    test('فحص الحساب النشط fail-closed برمز 503', () => {
        expect(jwt).toMatch(/ACCOUNT_CHECK_UNAVAILABLE/);
        expect(jwt).not.toMatch(/fail-open/);
    });

    test('رسائل توكن الدخول لا تُعيد رسالة المكتبة الخام', () => {
        expect(jwt).not.toMatch(/message:\s*err\.message/);
    });
});
