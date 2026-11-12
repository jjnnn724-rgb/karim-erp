import { describe, expect, it } from "vitest";
import { vatReturnSchema } from "./vat-return";

describe("vatReturnSchema", () => {
	it("requires the complete posted-ledger review contract", () => {
		const report = {
			from: "2026-11-01",
			to: "2026-11-30",
			output_vat: 30,
			output_vat_reversals: 5,
			input_vat: 12,
			input_vat_adjustments: 2,
			net_payable: 15,
			carry_forward_credit: 0,
			payable_balance: 25,
			recoverable_balance: 10,
			unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
			purchases_crosscheck: { count: 1, net: 80, vat: 12 },
		};

		expect(vatReturnSchema.parse(report)).toEqual(report);
		expect(
			vatReturnSchema.safeParse({ ...report, output_vat_reversals: undefined })
				.success,
		).toBe(false);
	});
});
