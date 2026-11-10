import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';
import { expectNoAxeViolations, installDomPolyfills } from './test-utils';

installDomPolyfills();

describe('PageHeader (re-export من components/PageHeader)', () => {
    it('يعرض عنوان h1 ووصفًا وإجراءات', () => {
        render(
            <PageHeader
                title="لوحة المحاسب"
                english="Accountant dashboard"
                description="ملخص الفترة الحالية"
                actions={<button type="button">تصدير</button>}
            />,
        );

        expect(screen.getByRole('heading', { level: 1, name: /لوحة المحاسب/ })).toBeTruthy();
        expect(screen.getByText('Accountant dashboard')).toBeTruthy();
        expect(screen.getByText('ملخص الفترة الحالية')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'تصدير' })).toBeTruthy();
    });

    it('بلا مخالفات axe', async () => {
        const { container } = render(<PageHeader title="عنوان" description="وصف" />);
        await expectNoAxeViolations(container);
    });

    it('بدون إجراءات لا يُRender منطقة إجراءات', () => {
        render(<PageHeader title="بلا إجراءات" description="وصف" />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('العنوان الإنجليزي يُRender', () => {
        render(<PageHeader title="العربية" english="Arabic" />);
        expect(screen.getByText('Arabic')).toBeTruthy();
    });

    it('يُRender وصفًا عندما يُمرر', () => {
        render(<PageHeader title="عنوان" description="وصف توضيحي" />);
        expect(screen.getByText('وصف توضيحي')).toBeTruthy();
    });
});
