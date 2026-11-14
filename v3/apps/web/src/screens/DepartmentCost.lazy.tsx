import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { DepartmentCost } from './DepartmentCost';

/** وضع القسم — تحليل التكلفة والصرف (admin/manager/accountant). */
export const Route = createLazyRoute('/dept-cost')({
    component: () => (
        <ScreenGate screen="dept-cost">
            <DepartmentCost />
        </ScreenGate>
    ),
});
