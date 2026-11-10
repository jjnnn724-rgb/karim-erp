import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, clampConfirmText, inferConfirmTone, useConfirm } from './ConfirmProvider';

function Probe({ onAnswer }: { onAnswer: (value: boolean) => void }) {
    const confirm = useConfirm();
    return (
        <button
            type="button"
            onClick={() => {
                void confirm('حذف الرف «رف أ»؟', { confirmLabel: 'حذف' }).then(onAnswer);
            }}
        >
            افتح
        </button>
    );
}

describe('تأكيد الإجراء — عقد V2 (v2/confirm.js)', () => {
    it('الدلالة تُستنتج من نصّنا: كلمات الحذف = danger', () => {
        expect(inferConfirmTone('حذف الرف «أ»؟')).toBe('danger');
        expect(inferConfirmTone('تعطيل الفرع؟')).toBe('danger');
        expect(inferConfirmTone('متابعة العملية؟')).toBe('warning');
    });

    it('يقصّ النصّ الطويل عند 400 محرف', () => {
        expect(clampConfirmText('ا'.repeat(500))).toHaveLength(400);
        expect(clampConfirmText(null)).toBe('');
    });

    it('«تأكيد» يُعيد true و«إلغاء» يُعيد false — نفس الأزرار الافتراضية', async () => {
        let answer: boolean | null = null;
        render(
            <ConfirmProvider>
                <Probe
                    onAnswer={(value) => {
                        answer = value;
                    }}
                />
            </ConfirmProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'افتح' }));
        expect(screen.getByText('حذف الرف «رف أ»؟')).toBeTruthy();
        expect(screen.getByText('تأكيد الإجراء')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
        await waitFor(() => {
            expect(answer).toBe(true);
        });
    });

    it('الإلغاء يُعيد false ويُغلق النافذة', async () => {
        let answer: boolean | null = null;
        render(
            <ConfirmProvider>
                <Probe
                    onAnswer={(value) => {
                        answer = value;
                    }}
                />
            </ConfirmProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'افتح' }));
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        await waitFor(() => {
            expect(answer).toBe(false);
        });
        expect(screen.queryByText('حذف الرف «رف أ»؟')).toBeNull();
    });

    it('التركيز الابتدائي على «إلغاء» كي لا يؤكّد Enter عملية مدمّرة', () => {
        render(
            <ConfirmProvider>
                <Probe onAnswer={() => undefined} />
            </ConfirmProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'افتح' }));
        expect(document.activeElement?.textContent).toBe('إلغاء');
    });
});
