import { afterEach, describe, expect, it } from 'vitest';
import { isUiFlagOn, setUiFlag } from './ui-flags';

afterEach(() => {
    localStorage.removeItem('karim_ui_flag_probe');
});

describe('ui flags — قابلية الرجوع للواجهة القديمة', () => {
    it('الافتراضي مغلق', () => {
        expect(isUiFlagOn('probe')).toBe(false);
        expect(isUiFlagOn('probe', true)).toBe(true);
    });

    it('التشغيل والإيقاف فوريان', () => {
        setUiFlag('probe', true);
        expect(isUiFlagOn('probe')).toBe(true);
        setUiFlag('probe', false);
        expect(isUiFlagOn('probe')).toBe(false);
    });

    it('اسم فارغ لا يقرأ التخزين', () => {
        expect(isUiFlagOn('')).toBe(false);
    });
});
