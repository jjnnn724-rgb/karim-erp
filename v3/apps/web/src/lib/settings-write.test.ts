import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    backupVisible,
    punchVisible,
    resetAllSystem,
    saveKotSettings,
    saveMainSettings,
    savePunchSettings,
    settingsWriteVisible,
    zatcaWriteVisible,
} from './settings-write';

vi.mock('./auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => 'test-key',
}));

interface Captured {
    url: string;
    method: string;
    body: unknown;
}

function captureFetch(): Captured[] {
    const calls: Captured[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
            });
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }),
    );
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('عقد كتابة الإعدادات', () => {
    it('يرسل تعديلاً جزئيًا للشعار فقط دون حقول أخرى', async () => {
        const calls = captureFetch();
        await saveMainSettings('main_settings', { logoB64: null });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toContain('/api/settings/main_settings');
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.body).toEqual({ logoB64: null });
    });

    it('يحوّل إعدادات KOT إلى أسماء الخادم kot_*', async () => {
        const calls = captureFetch();
        await saveKotSettings({ enabled: true, copies: 2, include_notes: false });

        expect(calls[0]?.url).toContain('/api/pos/kot/settings');
        expect(calls[0]?.body).toEqual({
            kot_enabled: true,
            kot_copies: 2,
            kot_include_notes: false,
        });
    });

    it('يمرّر مفاتيح البصمة المعدّلة كما هي', async () => {
        const calls = captureFetch();
        await savePunchSettings({ punch_radius_m: '150', punch_auto_rebind: false });

        expect(calls[0]?.url).toContain('/api/attendance/portal/settings-admin');
        expect(calls[0]?.body).toEqual({ punch_radius_m: '150', punch_auto_rebind: false });
    });

    it('يبني جسم التصفير الكامل بالعبارة والسبب والنطاق', async () => {
        const calls = captureFetch();
        await resetAllSystem('تصفير تجريبي كامل', true);

        expect(calls[0]?.url).toContain('/api/warehouse/system/reset-all');
        expect(calls[0]?.body).toEqual({
            confirmation: 'CONFIRM PRODUCTION RESET',
            reason: 'تصفير تجريبي كامل',
            force: true,
            scope: 'full',
        });
    });

    it('يطابق بوابات الأدوار بوابات الخادم', () => {
        expect(settingsWriteVisible('admin')).toBe(true);
        expect(settingsWriteVisible('manager')).toBe(false);
        expect(zatcaWriteVisible('manager')).toBe(true);
        expect(zatcaWriteVisible('accountant')).toBe(false);
        expect(punchVisible('hr')).toBe(true);
        expect(punchVisible('manager')).toBe(false);
        expect(backupVisible('admin')).toBe(true);
        expect(backupVisible('hr')).toBe(false);
    });
});
