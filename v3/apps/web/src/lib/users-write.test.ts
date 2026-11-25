import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetCodeSchema, updateUser, USER_TEXT, userResetVisible, userUpdateSchema } from './users-write';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('users-write optional password update', () => {
    const input = { name: 'Test User', role: 'employee' };

    it.each([undefined, '', 'TestPassword123'])('accepts an optional strong password: %s', (password) => {
        expect(userUpdateSchema.parse({ ...input, password }).password).toBe(password);
    });

    it.each(['short1', 'abcdefghijkl', '123456789012', '            '])('rejects a weak nonempty password: %s', (password) => {
        const result = userUpdateSchema.safeParse({ ...input, password });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['password'], message: USER_TEXT.passwordWeak }));
        }
    });

    it.each([undefined, '', 'TestPassword123'])('sends a password only when nonempty: %s', async (password) => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            new Response(JSON.stringify({ id: 42 }), { headers: { 'Content-Type': 'application/json' } }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await updateUser(42, { ...input, password });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/users/42', expect.objectContaining({ method: 'PUT' }));
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body).toEqual({ ...input, dept_code: null, ...(password ? { password } : {}) });
        if (!password) {
            expect(body).not.toHaveProperty('password');
        }
    });
});

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
