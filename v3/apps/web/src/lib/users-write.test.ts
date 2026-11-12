import { describe, expect, it } from 'vitest';
import { resetCodeSchema, userResetVisible } from './users-write';

describe('users-write reset code', () => {
    it('يقتصر رمز الاستعادة على admin وmanager', () => {
        expect(userResetVisible('admin')).toBe(true);
        expect(userResetVisible('manager')).toBe(true);
        expect(userResetVisible('hr')).toBe(false);
        expect(userResetVisible('cashier')).toBe(false);
        expect(userResetVisible(null)).toBe(false);
    });

    it('يقرأ رد الرمز كما يعيده الخادم', () => {
        const parsed = resetCodeSchema.parse({
            ok: true,
            username: 'ali',
            user_name: 'علي',
            code: '123456',
            expires_in_seconds: 600,
            message: 'الرمز للاستخدام مرة واحدة',
        });
        expect(parsed.code).toBe('123456');
        expect(parsed.username).toBe('ali');
        expect(() => resetCodeSchema.parse({ ok: true })).toThrow();
    });
});
