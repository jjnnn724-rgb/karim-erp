import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';

/**
 * مسار التنقّل — من خريطة العناوين لا من نصّ الشاشة.
 * يحتاج مُوجِّهًا لأن رابط «الرئيسية» رابط SPA حقيقي، والمُوجِّه يرسم لا حقًا.
 */

function renderAt(pathname: string, showHome = true) {
    const rootRoute = createRootRoute({
        component: () => <Breadcrumbs pathname={pathname} showHome={showHome} />,
    });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
    const warehouseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/warehouse' });
    const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute, warehouseRoute]),
        history: createMemoryHistory({ initialEntries: [pathname] }),
    });
    return render(<RouterProvider router={router} />);
}

describe('مسار التنقّل', () => {
    it('يعرض الرئيسية › المجموعة › الشاشة مع aria-current للشاشة الحالية', async () => {
        const { container } = renderAt('/warehouse');

        const nav = await screen.findByRole('navigation', { name: 'مسار التنقّل' });
        expect(nav).toBeTruthy();
        expect(screen.getByRole('link', { name: 'الرئيسية' })).toBeTruthy();

        // «المخزون» تظهر مرّتين: اسم المجموعة ثم الشاشة الحالية.
        expect(screen.getAllByText('المخزون')).toHaveLength(2);
        const current = container.querySelector('[aria-current="page"]');
        expect(current?.textContent).toBe('المخزون');
    });

    it('الرئيسية: عنصر حالي واحد بلا رابط', async () => {
        const { container } = renderAt('/');

        await screen.findByRole('navigation', { name: 'مسار التنقّل' });
        expect(screen.queryByRole('link')).toBeNull();
        const current = container.querySelector('[aria-current="page"]');
        expect(current?.textContent).toBe('الرئيسية');
    });

    it('مسار غير معروف ⇒ لا مسار تنقّل (بلا رابط كاذب)', async () => {
        const { container } = renderAt('/not-a-screen');

        // لا مسار للتنقّل، لكن الجذر يرسم فراغًا.
        expect(container.textContent).toBe('');
        expect(screen.queryByRole('navigation', { name: 'مسار التنقّل' })).toBeNull();
    });

    it('showHome=false يخفي رابط الرئيسية ويُبقي الشاشة الحالية', async () => {
        const { container } = renderAt('/warehouse', false);

        await screen.findByRole('navigation', { name: 'مسار التنقّل' });
        expect(screen.queryByRole('link', { name: 'الرئيسية' })).toBeNull();
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('المخزون');
    });
});
