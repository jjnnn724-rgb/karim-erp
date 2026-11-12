'use strict';

const round2 = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
};

const INPUT_CREDIT_ADJUSTMENT_SOURCES = new Set(['purchase_credit_note', 'purchase_return']);

function calculateVatMovement(rows, accounts) {
    const totals = {
        output_vat: 0,
        output_vat_reversals: 0,
        input_vat: 0,
        input_vat_adjustments: 0,
        unclassified_output_debits: 0,
        unclassified_input_credits: 0,
    };

    for (const row of rows) {
        const sourceType = String(row.source_type || '');
        if (sourceType === 'vat_settlement') {
            continue;
        }

        const debit = Number(row.debit) || 0;
        const credit = Number(row.credit) || 0;
        if (row.account_code === accounts.payable_account) {
            totals.output_vat += credit;
            if (sourceType === 'pos_void') {
                totals.output_vat_reversals += debit;
            } else {
                totals.unclassified_output_debits += debit;
            }
        }
        if (row.account_code === accounts.recoverable_account) {
            totals.input_vat += debit;
            if (INPUT_CREDIT_ADJUSTMENT_SOURCES.has(sourceType)) {
                totals.input_vat_adjustments += credit;
            } else {
                totals.unclassified_input_credits += credit;
            }
        }
    }

    const outputVat = round2(totals.output_vat);
    const outputVatReversals = round2(totals.output_vat_reversals);
    const inputVat = round2(totals.input_vat);
    const inputVatAdjustments = round2(totals.input_vat_adjustments);
    const netTax = round2(outputVat - outputVatReversals - inputVat + inputVatAdjustments);

    return {
        output_vat: outputVat,
        output_vat_reversals: outputVatReversals,
        input_vat: inputVat,
        input_vat_adjustments: inputVatAdjustments,
        net_payable: Math.max(0, netTax),
        carry_forward_credit: Math.max(0, round2(-netTax)),
        unclassified_vat_movements: {
            output_debits: round2(totals.unclassified_output_debits),
            input_credits: round2(totals.unclassified_input_credits),
        },
    };
}

function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = { calculateVatMovement, isValidDateOnly };
