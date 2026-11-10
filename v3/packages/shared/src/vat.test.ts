import { describe, expect, test } from 'vitest';
import { addMoney } from './money.js';
import {
    buildVatSettlementPlan,
    monthPeriod,
    resolveVatReturnPeriod,
    splitVatNet,
    VAT_DEFAULT_ACCOUNTS,
    VAT_SETTLEMENT_MEMO_PAYABLE,
    VAT_SETTLEMENT_MEMO_RECOVERABLE,
    validateVatSettlementPeriod,
    vatMovementNet,
} from './vat.js';

/**
 * اختبارات ضريبة القيمة المضافة:
 *  · **ذهبية** — متجهات من سلوك القديم الحرفي (`backend/accounting-routes.js`)
 *    والالتقاط `artifacts/fixtures/vat-return.json` (أكتوبر 2026).
 *  · **خصائص** — مولد بذرة ثابتة يفحص ثوابت تنطبق على أي مدخلات، لا أمثلة فقط:
 *    توازن سطور التصفية، عدم سلبية الأرصدة، استقرار التكرار مرتين، والتقريب
 *    بعد الجمع لا قبله.
 */

describe('buildVatSettlementPlan — ذهبية من القديم', () => {
    test('مستحق 1000 قابل للاسترداد 400 ⇒ إطفاء 400 ويتبقى 600 على 2100', () => {
        const plan = buildVatSettlementPlan({ payableBalance: '1000.00', recoverableBalance: '400.00' });
        expect(plan).toEqual({
            clearing: '400.00',
            net_payable_after: '600.00',
            carry_forward_after: '0.00',
            lines: [
                {
                    account_code: '2100',
                    debit: '400.00',
                    credit: '0.00',
                    memo: VAT_SETTLEMENT_MEMO_PAYABLE,
                },
                {
                    account_code: '1150',
                    debit: '0.00',
                    credit: '400.00',
                    memo: VAT_SETTLEMENT_MEMO_RECOVERABLE,
                },
            ],
        });
    });

    test('قابل للاسترداد 81517.48 بلا مستحق (واقع أكتوبر) ⇒ لا إطفاء ولا سطور', () => {
        const plan = buildVatSettlementPlan({ payableBalance: '0.00', recoverableBalance: '81517.48' });
        expect(plan).toEqual({
            clearing: '0.00',
            net_payable_after: '0.00',
            carry_forward_after: '81517.48',
            lines: [],
        });
    });

    test('رصيد سالب يُعامل صفرًا مثل `Math.max(x, 0)` القديمة', () => {
        const plan = buildVatSettlementPlan({ payableBalance: '-50.00', recoverableBalance: '100.00' });
        expect(plan.clearing).toBe('0.00');
        expect(plan.net_payable_after).toBe('0.00');
        expect(plan.carry_forward_after).toBe('100.00');
        expect(plan.lines).toEqual([]);
    });

    test('الحسابان يُقرآن من خريطة `resolveAccounts` إن وُجدا', () => {
        const plan = buildVatSettlementPlan({
            payableBalance: '10.00',
            recoverableBalance: '10.00',
            accounts: { payable_account: '2105', recoverable_account: '1155' },
        });
        expect(plan.lines.map((line) => line.account_code)).toEqual(['2105', '1155']);
        // الدوال الافتراضية لا تتغير بالخريطة — الثابتان القديمان نفسهما.
        expect(VAT_DEFAULT_ACCOUNTS).toEqual({ payable_account: '2100', recoverable_account: '1150' });
    });
});

describe('صافي الإقرار', () => {
    test('مخرجات 0 ومدخلات 81517.48 ⇒ ترحيل 81517.48 ولا مستحق', () => {
        const net = vatMovementNet('0.00', '81517.48');
        expect(net).toBe('-81517.48');
        expect(splitVatNet(net)).toEqual({ net_payable: '0.00', carry_forward_credit: '81517.48' });
    });

    test('مخرجات أكبر من المدخلات ⇒ مستحق بلا ترحيل', () => {
        const net = vatMovementNet('1150.00', '1000.00');
        expect(net).toBe('150.00');
        expect(splitVatNet(net)).toEqual({ net_payable: '150.00', carry_forward_credit: '0.00' });
    });

    test('تساوٍ ⇒ صفران', () => {
        expect(splitVatNet(vatMovementNet('75.25', '75.25'))).toEqual({
            net_payable: '0.00',
            carry_forward_credit: '0.00',
        });
    });
});

describe('الشهر والفترة — تقويم الرياض', () => {
    test('آخر يوم في الشهر صحيح لكل الحالات الحدّية (فبراير كبيس وديسمبر)', () => {
        expect(monthPeriod('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
        expect(monthPeriod('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(monthPeriod('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(monthPeriod('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });

    test('شهر غير صالح يُرفض لا يُخمَّن', () => {
        expect(() => monthPeriod('2026-13')).toThrow(RangeError);
        expect(() => monthPeriod('2026-1')).toThrow(RangeError);
    });

    test('رفض الشهر الجاري (422 LEDGER_VAT_PERIOD_OPEN) وقبول المنتهي', () => {
        const open = validateVatSettlementPeriod({ month: '2026-11', today: '2026-11-07' });
        expect(open).toEqual({
            ok: false,
            status: 422,
            error: 'LEDGER_VAT_PERIOD_OPEN',
            message: 'لا تُصفّى فترة لم تنتهِ بعد',
        });

        // آخر يوم من الشهر = منتهٍ بالفعل، لا مفتوح.
        expect(validateVatSettlementPeriod({ month: '2026-10', today: '2026-10-31' })).toEqual({
            ok: true,
            month: '2026-10',
            from: '2026-10-01',
            to: '2026-10-31',
        });
    });

    test('الفترة المقفولة 423 بنفس رسالة accounting-periods', () => {
        expect(validateVatSettlementPeriod({ month: '2026-10', today: '2026-11-07', closed: true })).toEqual({
            ok: false,
            status: 423,
            error: 'PERIOD_CLOSED',
            message: 'الفترة 2026-10 مقفلة — افتحها أولًا من الإغلاق الشهري',
        });
    });

    test('صيغة الشهر تُفحص أولًا حتى لو كانت الفترة مقفولة', () => {
        expect(validateVatSettlementPeriod({ month: '10-2026', today: '2026-11-07', closed: true })).toMatchObject({
            ok: false,
            status: 422,
            error: 'LEDGER_MONTH_INVALID',
        });
    });
});

describe('resolveVatReturnPeriod — افتراضيات القديم', () => {
    test('بلا مدخلات: أول الشهر حتى اليوم بتوقيت الرياض', () => {
        expect(resolveVatReturnPeriod({ today: '2026-11-07' })).toEqual({
            ok: true,
            from: '2026-11-01',
            to: '2026-11-07',
        });
    });

    test('المدخلات الصحيحة تمر كما هي', () => {
        expect(resolveVatReturnPeriod({ from: '2026-10-01', to: '2026-10-31', today: '2026-11-07' })).toEqual({
            ok: true,
            from: '2026-10-01',
            to: '2026-10-31',
        });
    });

    test('تاريخ غير صالح يُستبدل بالافتراضي (سلوك القديم) و from>to 422', () => {
        expect(resolveVatReturnPeriod({ from: '2026-02-31', to: '', today: '2026-11-07' })).toEqual({
            ok: true,
            from: '2026-11-01',
            to: '2026-11-07',
        });
        expect(resolveVatReturnPeriod({ from: '2026-11-05', to: '2026-10-01' })).toEqual({
            ok: false,
            status: 422,
            error: 'LEDGER_PERIOD_INVALID',
            message: 'بداية الفترة بعد نهايتها',
        });
    });
});

describe('خصائص — مولد بذرة ثابتة (1000 حالة)', () => {
    /** LCG ثابت: الاختبار قابل لإعادة الإنتاج حرفيًا عند الفشل. */
    function seeded(seed: number): () => number {
        let state = seed >>> 0;
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 2 ** 32;
        };
    }

    /** مبلغ عشري (±) بحدود NUMERIC(14,2) — بما فيه 0 والحد الأقصى. */
    function randomMoney(random: () => number): string {
        const sign = random() < 0.2 ? -1 : 1;
        const integer = Math.floor(random() * 100_000_000);
        const fraction = Math.floor(random() * 100);
        return `${sign < 0 ? '-' : ''}${integer}.${String(fraction).padStart(2, '0')}`;
    }

    test('سطور التصفية متوازنة دائمًا، والأرصدة غير سالبة، والإطفاء في الحد الأدنى', () => {
        const random = seeded(20261107);
        for (let index = 0; index < 1000; index += 1) {
            const payable = randomMoney(random);
            const recoverable = randomMoney(random);
            const plan = buildVatSettlementPlan({ payableBalance: payable, recoverableBalance: recoverable });
            const payableCents = Math.max(Number(payable.replace('.', '')), 0);
            const recoverableCents = Math.max(Number(recoverable.replace('.', '')), 0);
            const clearingCents = Number(plan.clearing.replace('.', ''));

            expect(clearingCents).toBe(Math.min(payableCents, recoverableCents));
            expect(Number(plan.net_payable_after.replace('.', ''))).toBeGreaterThanOrEqual(0);
            expect(Number(plan.carry_forward_after.replace('.', ''))).toBeGreaterThanOrEqual(0);
            // لا سطرين إلا عند وجود مبلغ قابل للإطفاء.
            expect(plan.lines.length).toBe(clearingCents > 0 ? 2 : 0);
            if (plan.lines.length === 2) {
                const [debitLine, creditLine] = plan.lines;
                if (!debitLine || !creditLine) {
                    throw new Error('خطة بسطرين بلا سطرين');
                }
                expect(addMoney(debitLine.debit, creditLine.debit)).toBe(plan.clearing);
                expect(addMoney(debitLine.credit, creditLine.credit)).toBe(plan.clearing);
                expect(debitLine.debit).toBe(creditLine.credit);
                expect(creditLine.debit).toBe('0.00');
                expect(debitLine.credit).toBe('0.00');
            }
            // التصفية تُطفئ الحد الأدنى بالكامل: أحد الطرفين يصبح صفرًا.
            expect(plan.net_payable_after === '0.00' || plan.carry_forward_after === '0.00').toBe(true);
        }
    });

    test('الاستقرار: تشغيل الخطة مرتين بنفس المدخلات يُنتج نفس الكائن', () => {
        const random = seeded(424242);
        for (let index = 0; index < 200; index += 1) {
            const input = { payableBalance: randomMoney(random), recoverableBalance: randomMoney(random) };
            expect(buildVatSettlementPlan(input)).toEqual(buildVatSettlementPlan(input));
        }
    });

    test('التقريب بعد الجمع: مجموع سطور بحانتين عشريتين يُقارَن بالطرح الدقيق', () => {
        const random = seeded(7);
        for (let index = 0; index < 500; index += 1) {
            const lines = Array.from({ length: 1 + Math.floor(random() * 12) }, () => randomMoney(random));
            // الجمع بالمليم لا يقرّب أي سطر منفردًا ثم يجمع تقريبًا ثانيًا.
            const total = addMoney(...lines);
            const cents = lines.reduce((sum, line) => sum + BigInt(line.replace('.', '')), 0n);
            const magnitude = cents < 0n ? -cents : cents;
            const sign = cents < 0n ? '-' : '';
            expect(total).toBe(`${sign}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`);

            const input = randomMoney(random);
            expect(vatMovementNet(total, input)).toBe(
                (() => {
                    const difference = cents - BigInt(input.replace('.', ''));
                    const diffMagnitude = difference < 0n ? -difference : difference;
                    return `${difference < 0n ? '-' : ''}${diffMagnitude / 100n}.${String(diffMagnitude % 100n).padStart(2, '0')}`;
                })(),
            );
        }
    });

    test('فصل الصافي: أحد الطرفين صفر دائمًا وفرقهما هو الصافي', () => {
        const random = seeded(99);
        for (let index = 0; index < 500; index += 1) {
            const net = randomMoney(random);
            const split = splitVatNet(net);
            expect(split.net_payable === '0.00' || split.carry_forward_credit === '0.00').toBe(true);
            expect(vatMovementNet(split.net_payable, split.carry_forward_credit)).toBe(net);
        }
    });
});
