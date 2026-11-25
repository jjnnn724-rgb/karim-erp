/**
 * pos-settings-permissions.test.ts — قفل الصلاحيات لترس ضبط الكاشير.
 * القاعدة: الكاشير = صفر أدوات؛ الأدوات محصورة للأدوار الأعلى منه.
 */
import { describe, expect, it } from 'vitest';
import {
    canEditPosPrices,
    canManagePosItems,
    canOpenPosSettings,
} from './PosSettingsPanel';

describe('ترس ضبط الكاشير — قفل الصلاحيات', () => {
    it('الكاشير لا يرى الترس ولا الأدوات', () => {
        expect(canOpenPosSettings('cashier')).toBe(false);
        expect(canManagePosItems('cashier')).toBe(false);
        expect(canEditPosPrices('cashier')).toBe(false);
    });

    it('دور غير معروف أو null = لا شيء (fail-closed)', () => {
        expect(canOpenPosSettings(undefined)).toBe(false);
        expect(canOpenPosSettings(null)).toBe(false);
        expect(canOpenPosSettings('')).toBe(false);
        expect(canOpenPosSettings('kitchen')).toBe(false);
        expect(canOpenPosSettings('sous_chef')).toBe(false);
        expect(canOpenPosSettings('auditor')).toBe(false);
    });

    it('admin/manager يديرون الأصناف (يطابق requireRole في الـbackend)', () => {
        expect(canManagePosItems('admin')).toBe(true);
        expect(canManagePosItems('manager')).toBe(true);
        expect(canManagePosItems('accountant')).toBe(false);
    });

    it('admin/accountant فقط يغيّرون الأسعار (يطابق POST /pos/products/:id/price)', () => {
        expect(canEditPosPrices('admin')).toBe(true);
        expect(canEditPosPrices('accountant')).toBe(true);
        expect(canEditPosPrices('manager')).toBe(false);
    });

    it('ترس الضبط يظهر لأي دور له أداة واحدة على الأقل — ومش للكاشير', () => {
        expect(canOpenPosSettings('admin')).toBe(true);
        expect(canOpenPosSettings('manager')).toBe(true);
        expect(canOpenPosSettings('accountant')).toBe(true);
        expect(canOpenPosSettings('cashier')).toBe(false);
    });
});
