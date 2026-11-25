import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSignatureName, paintTypedSignature, SignaturePad } from './SignaturePad';

/**
 * لوحة التوقيع المشتركة — حارسة البج الأصلي:
 * كان V3 يطلب رسم التوقيع يدويًا على لوحة فارغة، فيتوقف استلام المخزن عند
 * «تعذر رسم التوقيع». العقد الآن مطابق لـV2: الاسم يُرسم تلقائيًا من الحساب،
 * والقيمة تُرسل كـ`data:image/png;base64,…` كما يتحقق الخادم.
 */

const SIGNATURE = 'data:image/png;base64,AAAA';

function stubCanvas(hasContext = true): void {
    const context = new Proxy({}, { get: () => () => undefined });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        hasContext ? (context as unknown as CanvasRenderingContext2D) : null,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(SIGNATURE);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SignaturePad — توقيع باسم الحساب كما في V2', () => {
    it('يطبّع الاسم بنفس تطبيع الخادم', () => {
        expect(normalizeSignatureName('  أحمد   علي ')).toBe('أحمد علي');
        expect(normalizeSignatureName(null)).toBe('');
    });

    it('يرسم الاسم تلقائيًا ويرسل بصمة PNG بلا أي رسم يدوي', () => {
        stubCanvas();
        const onChange = vi.fn();
        render(<SignaturePad label="توقيع المستلم" name="أحمد علي" onChange={onChange} testId="sig" />);

        expect(screen.getByLabelText('توقيع المستلم — توقيع أحمد علي')).toBeTruthy();
        expect(onChange).toHaveBeenCalledWith(SIGNATURE);
        expect(screen.getByText(/التوقيع جاهز باسم حسابك/)).toBeTruthy();
    });

    it('بلا اسم لا يدّعي توقيعًا — يرسل null بوضوح', () => {
        stubCanvas();
        const onChange = vi.fn();
        render(<SignaturePad label="توقيع" name="" onChange={onChange} />);

        expect(onChange).toHaveBeenCalledWith(null);
        expect(screen.getByText(/اضبط اسم الحساب/)).toBeTruthy();
    });

    it('لو تعذّر سياق الرسم لا يرسل قيمة (فشل مغلق)', () => {
        stubCanvas(false);
        const onChange = vi.fn();
        render(<SignaturePad label="توقيع" name="أحمد علي" onChange={onChange} />);

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('الرسم بالإصبع/الماوس فوق الاسم يُحدّث التوقيع', () => {
        stubCanvas();
        const onChange = vi.fn();
        render(<SignaturePad label="توقيع" name="أحمد علي" onChange={onChange} testId="sig" />);
        onChange.mockClear();

        fireEvent.pointerDown(screen.getByTestId('sig'), { clientX: 10, clientY: 10, pointerId: 1 });
        expect(onChange).toHaveBeenCalledWith(SIGNATURE);
    });

    it('«إعادة التوقيع» يعيد رسم الاسم بعد الشخبطة', () => {
        stubCanvas();
        const onChange = vi.fn();
        render(<SignaturePad label="توقيع" name="أحمد علي" onChange={onChange} />);
        onChange.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'إعادة التوقيع' }));
        expect(onChange).toHaveBeenCalledWith(SIGNATURE);
    });

    it('paintTypedSignature يرفض canvas بلا سياق بدل رمي استثناء', () => {
        const canvas = document.createElement('canvas');
        vi.spyOn(canvas, 'getContext').mockReturnValue(null);
        expect(paintTypedSignature(canvas, 'أحمد')).toBe(false);
    });

    /**
     * عيب سابق: القلم كان `#0f172a` مكتوبًا صلبًا فلا يتبع الوضع الداكن ولا
     * رموز الهوية. الاختبار يثبّت أن اللون يأتي من `--erp-ink`سواء في رسم
     * الاسم أو في شخبطة المستخدم.
     */
    it('قلم الشخبطة يقرأ لون الحبر من الرمز لا من قيمة صبغية', () => {
        const painted: Record<string, unknown> = {};
        const context = new Proxy(painted, {
            get: (target, prop) => (prop in target ? target[prop as string] : () => undefined),
            set: (target, prop, value) => {
                target[prop as string] = value;
                return true;
            },
        });
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(SIGNATURE);
        const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
            () =>
                ({
                    getPropertyValue: (name: string) => (name === '--erp-ink' ? 'rgb(32, 37, 45)' : ''),
                }) as unknown as CSSStyleDeclaration,
        );

        const onChange = vi.fn();
        render(<SignaturePad label="توقيع" name="أحمد علي" onChange={onChange} testId="sig" />);
        fireEvent.pointerDown(screen.getByTestId('sig'), { clientX: 10, clientY: 10, pointerId: 1 });

        expect(painted['strokeStyle']).toBe('rgb(32, 37, 45)');
        styleSpy.mockRestore();
    });
});
