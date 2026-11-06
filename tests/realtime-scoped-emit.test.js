/**
 * realtime-scoped-emit.test.js — البثّ الحساس يمرّ عبر غرفة erp:authed
 * ───────────────────────────────────────────────────────────────────
 * القاعدة: كل بثّ حضور/بصمات/موظفين يمر عبر makeEmitScoped(io) — مع
 * RT_REQUIRE_AUTH=true يذهب لغرفة `erp:authed` فقط (أي socket بلا JWT لا يستلم
 * بيانات الحضور)، وإلا السلوك الإرثي (بثّ عام) كما هو. لا يجوز `io.emit` الخام
 * في المسارات الحساسة.
 *
 * regression: HR/push/zkteco/attendance-engine كانت تبثّ `attendance:updated`
 * وأحداث البصمات لكل socket متصل (إفصاح جماعي لبيانات الحضور).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { makeEmitScoped } = require('../backend/realtime/guard');

const ENV_KEY = 'RT_REQUIRE_AUTH';
const savedEnv = process.env[ENV_KEY];
afterEach(() => {
    if (savedEnv === undefined) {delete process.env[ENV_KEY];}
    else {process.env[ENV_KEY] = savedEnv;}
});

const mkIo = () => {
    const authedExceptEmit = jest.fn();
    const authedTarget = { emit: jest.fn(), except: jest.fn(() => ({ emit: authedExceptEmit })) };
    const globalExceptEmit = jest.fn();
    const io = {
        emit: jest.fn(),
        to: jest.fn(() => authedTarget),
        except: jest.fn(() => ({ emit: globalExceptEmit })),
    };
    return { io, authedTarget, authedExceptEmit, globalExceptEmit };
};

describe('makeEmitScoped — سلوك الوضعين', () => {
    it('RT_REQUIRE_AUTH=true → الغرفة erp:authed فقط، لا بثّ عام', () => {
        process.env[ENV_KEY] = 'true';
        const { io, authedTarget } = mkIo();
        makeEmitScoped(io)('attendance:updated', { action: 'check_in' });
        expect(io.to).toHaveBeenCalledWith('erp:authed');
        expect(authedTarget.emit).toHaveBeenCalledWith('attendance:updated', { action: 'check_in' });
        expect(io.emit).not.toHaveBeenCalled();
    });

    it('RT_REQUIRE_AUTH=true + exceptSocketId → except على غرفة erp:authed', () => {
        process.env[ENV_KEY] = 'true';
        const { io, authedTarget, authedExceptEmit } = mkIo();
        makeEmitScoped(io)('attendance:updated', { action: 'check_in' }, 'socket-9');
        expect(authedTarget.except).toHaveBeenCalledWith('socket-9');
        expect(authedExceptEmit).toHaveBeenCalledWith('attendance:updated', { action: 'check_in' });
        expect(io.emit).not.toHaveBeenCalled();
    });

    it('RT_REQUIRE_AUTH غير مفعّل → السلوك الإرثي (بثّ عام) كما كان', () => {
        delete process.env[ENV_KEY];
        const { io } = mkIo();
        makeEmitScoped(io)('attendance:updated', { action: 'check_in' });
        expect(io.emit).toHaveBeenCalledWith('attendance:updated', { action: 'check_in' });
        expect(io.to).not.toHaveBeenCalled();
    });

    it('الوضع الإرثي + exceptSocketId → io.except (لا يصل المُستثنى)', () => {
        delete process.env[ENV_KEY];
        const { io, globalExceptEmit } = mkIo();
        makeEmitScoped(io)('x', { y: 1 }, 'socket-7');
        expect(io.except).toHaveBeenCalledWith('socket-7');
        expect(globalExceptEmit).toHaveBeenCalledWith('x', { y: 1 });
    });

    it('io غائب (0) → دالة صامتة لا تُسقط المسار', () => {
        process.env[ENV_KEY] = 'true';
        expect(() => makeEmitScoped(null)('attendance:updated', {})).not.toThrow();
        expect(() => makeEmitScoped(undefined)('attendance:updated', {})).not.toThrow();
    });
});

describe('لا io.emit خام في المسارات الحساسة', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const sensitive = [
        'backend/attendance-push/processor.js',
        'backend/hr-routes.js',
        'backend/zkteco/engine.js',
        'backend/attendance-engine.js',
    ];
    for (const file of sensitive) {
        it(`${file} يمر عبر makeEmitScoped ولا يبثّ خامًا`, () => {
            const src = read(file);
            expect(src).toContain('makeEmitScoped');
            expect(src).not.toMatch(/(^|[^\w])io\.emit\(/);
            expect(src).not.toMatch(/this\.io\.emit\(/);
        });
    }
});
