import { moneyText } from './pos-ui';

/**
 * لوحة أرقام لمسية للنقدي المستلم — أول رقم يستبدل المبلغ التلقائي،
 * والأوراق النقدية تُضاف على المسطر بدل كتابة الرقم كاملًا في كل مرة.
 */

export interface PosNumpadProps {
    value: string;
    due: number;
    /** لم يلمس الكاشير المبلغ بعد، فالمعروض هو إجمالي الفاتورة التلقائي. */
    fresh: boolean;
    disabled: boolean;
    onChange: (value: string) => void;
}

const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as const;
const NOTES = [50, 100, 200] as const;

function appendDigit(raw: string, digit: string, fresh: boolean): string {
    let base = fresh ? '' : raw;
    if (base === '0' || base === '0.00') {
        base = '';
    }
    if (digit === '.') {
        return base.includes('.') ? base : `${base || '0'}.`;
    }
    const dot = base.indexOf('.');
    if (dot >= 0 && base.length - dot > 2) {
        return base;
    }
    const next = `${base}${digit}`.replace(/^0+(?=\d)/, '');
    if (next === '0' || next === '00') {
        return '0';
    }
    return next;
}

function amountOf(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function PosNumpad({ value, due, fresh, disabled, onChange }: PosNumpadProps) {
    return (
        <fieldset className="pos-numpad m-0 min-w-0 border-0 p-0" aria-label="لوحة الدفع السريع">
            <div className="pos-numpad__head">
                <span className="pos-numpad__label">النقدي المستلم</span>
                <output className="pos-numpad__display" dir="ltr">
                    {moneyText(amountOf(value))}
                </output>
            </div>
            <div className="pos-numpad__keys">
                {DIGITS.map((digit) => (
                    <button
                        key={digit}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                            onChange(appendDigit(value, digit, fresh));
                        }}
                    >
                        {digit}
                    </button>
                ))}
                <button
                    type="button"
                    disabled={disabled}
                    aria-label="مسافة للخلف"
                    onClick={() => {
                        onChange(value.slice(0, -1) || '0');
                    }}
                >
                    ⌫
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label="مسح المبلغ"
                    onClick={() => {
                        onChange('0');
                    }}
                >
                    C
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label="المبلغ المطلوب بالضبط"
                    onClick={() => {
                        onChange(due.toFixed(2));
                    }}
                >
                    المطلوب
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                        onChange(appendDigit(value, '00', fresh));
                    }}
                >
                    00
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                        onChange(appendDigit(value, '0', fresh));
                    }}
                >
                    0
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label="فاصلة عشرية"
                    onClick={() => {
                        onChange(appendDigit(value, '.', fresh));
                    }}
                >
                    .
                </button>
                <span aria-hidden="true" className="pos-numpad__spacer" />
            </div>
            <div className="pos-numpad__quick">
                {NOTES.map((note) => (
                    <button
                        key={note}
                        type="button"
                        disabled={disabled}
                        aria-label={`إضافة ${String(note)} إلى النقدي`}
                        onClick={() => {
                            const next = amountOf(value) + note;
                            onChange(next.toFixed(2));
                        }}
                    >
                        +{String(note)}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}
