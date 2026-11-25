import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, Card, DataTable, Input, StateLoading, ToastProvider } from '../../../../../frontend/v4/design-system';

describe('v4 design-system surface — عقد بدائي', () => {
    it('Button: تسمية ARIA وقابلية التركيز بلوحة المفاتيح', () => {
        render(<Button aria-label="حفظ">حفظ</Button>);
        const btn = screen.getByRole('button', { name: 'حفظ' });
        expect(btn.tagName).toBe('BUTTON');
        btn.focus();
        expect(document.activeElement).toBe(btn);
    });

    it('Input: مرتبط بتسمية صريحة', () => {
        render(<label htmlFor="v4-name">الاسم</label>);
        render(<Input id="v4-name" aria-label="الاسم" />);
        expect(screen.getByRole('textbox', { name: 'الاسم' })).toBeTruthy();
    });

    it('Card: منطقة دلالية باسم', () => {
        render(<Card aria-label="بطاقة">محتوى</Card>);
        expect(screen.getByRole('region', { name: 'بطاقة' })).toBeTruthy();
    });

    it('DataTable: حالة التحميل تُعلن للمستخدم', () => {
        render(<DataTable columns={[]} rows={[]} rowKey={() => 0} caption="جدول تجريبي" state="loading" />);
        expect(document.querySelector('[role="status"], [aria-busy="true"], .erp-table__skeleton')).toBeTruthy();
    });

    it('StateLoading: نص صريح بدل فراغ', () => {
        render(<StateLoading label="جارٍ التحميل" />);
        expect(screen.getByText(/جارٍ التحميل/)).toBeTruthy();
    });

    it('ToastProvider: سياق متاح', () => {
        expect(ToastProvider).toBeTypeOf('function');
    });

    it('tokens.css: بلا ألوان خام، وخصائص منطقية للاتجاهين', () => {
        const css = readFileSync(resolve(process.cwd(), '../../../frontend/v4/design-system/tokens.css'), 'utf8');
        expect(css).toContain('padding-inline');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/\b(?:rgb|hsl|oklch)\(/i);
        expect(css).toContain('var(--erp-c-');
    });
});
