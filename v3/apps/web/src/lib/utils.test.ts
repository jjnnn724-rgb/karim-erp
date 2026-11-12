import { describe, expect, it } from 'vitest';
import { cn } from './utils';

/**
 * `cn` الخاصة بمكوّنات shadcn — الحارس على عدم حذف لون النص عند وجود
 * حجم خط مخصص (السبب الجذري لزر أساسي بنص داكن).
 */
describe('lib/utils cn', () => {
    it('يُبقي لون النص مع حجم خط مخصص', () => {
        const result = cn('text-body-sm', 'text-on-primary');
        expect(result).toContain('text-body-sm');
        expect(result).toContain('text-on-primary');
    });

    it('لا يدمج حجمين مخصصين معًا (آخر واحد يفوز)', () => {
        expect(cn('text-body-md', 'text-body-sm')).toBe('text-body-sm');
    });

    it('يُبقي الاثنين مهما كان الترتيب', () => {
        const result = cn('text-on-primary', 'text-button-md', 'text-ink');
        expect(result).toContain('text-button-md');
        expect(result).toContain('text-ink');
        expect(result).not.toContain('text-on-primary');
    });

    it('يهمل القيم الكاذبة', () => {
        expect(cn('a', false, null, undefined, 'b')).toBe('a b');
    });

    it('يدمج أصناف Tailwind القياسية كما هي', () => {
        expect(cn('text-sm', 'text-lg')).toBe('text-lg');
        expect(cn('px-2', 'px-4')).toBe('px-4');
    });
});
