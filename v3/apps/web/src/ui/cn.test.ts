import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
    it('يجمع الأصناف الصحيحة ويُهمل الكاذبة', () => {
        expect(cn('a', undefined, false, null, 'b')).toBe('a b');
    });

    it('يعيد نصًّا فارغًا عندما لا يوجد صنف صحيح', () => {
        expect(cn()).toBe('');
        expect(cn(false, undefined)).toBe('');
    });
});
