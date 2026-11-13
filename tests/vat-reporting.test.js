'use strict';

const { calculateVatMovement, isValidDateOnly } = require('../backend/vat-reporting');

describe('calculateVatMovement', () => {
    const accounts = { payable_account: '2100', recoverable_account: '1150' };

    test('uses posted sales, POS voids and purchase tax while excluding settlement entries', () => {
        const result = calculateVatMovement([
            { account_code: '2100', source_type: 'pos_sale', debit: 0, credit: 30 },
            { account_code: '2100', source_type: 'pos_void', debit: 5, credit: 0 },
            { account_code: '1150', source_type: 'purchase_invoice', debit: 12, credit: 0 },
            { account_code: '1150', source_type: 'purchase_credit_note', debit: 0, credit: 2 },
            { account_code: '2100', source_type: 'vat_settlement', debit: 20, credit: 0 },
            { account_code: '1150', source_type: 'vat_settlement', debit: 0, credit: 20 },
        ], accounts);

        expect(result).toEqual({
            output_vat: 30,
            output_vat_reversals: 5,
            input_vat: 12,
            input_vat_adjustments: 2,
            net_payable: 15,
            carry_forward_credit: 0,
            unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
        });
    });

    test('surfaces tax-account movements that the report cannot classify', () => {
        const result = calculateVatMovement([
            { account_code: '2100', source_type: 'manual', debit: 4, credit: 0 },
            { account_code: '1150', source_type: 'manual', debit: 0, credit: 1 },
        ], accounts);

        expect(result.unclassified_vat_movements).toEqual({ output_debits: 4, input_credits: 1 });
        expect(result.net_payable).toBe(0);
        expect(result.carry_forward_credit).toBe(0);
    });
});

describe('isValidDateOnly', () => {
    test('accepts real calendar days and rejects normalized or malformed dates', () => {
        expect(isValidDateOnly('2019-01-31')).toBe(true);
        expect(isValidDateOnly('2019-02-29')).toBe(false);
        expect(isValidDateOnly('2019-13-01')).toBe(false);
        expect(isValidDateOnly('2019-1-01')).toBe(false);
    });
});
