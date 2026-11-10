import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MenuBoard } from './MenuBoard';

/** شاشة المنيو تستضيف صفحة الإدارة القديمة فقط — لا بيانات ولا كتابة. */
describe('شاشات المنيو', () => {
    it('تستضيف صفحة إدارة المنيو داخل إطار من نفس الأصل', () => {
        render(<MenuBoard />);

        const frame = screen.getByTitle('شاشات المنيو');
        expect(frame.tagName).toBe('IFRAME');
        expect(frame.getAttribute('src')).toBe('/app/menu-admin.html');
        expect(screen.getByRole('link', { name: 'عرض شاشة العرض' }).getAttribute('href')).toBe('/app/menu-board.html');
    });
});
