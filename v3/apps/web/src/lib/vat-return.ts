import { z } from "zod";
import { fetchJson } from "./api";
import { getAccessToken } from "./auth";

const taxAccountMovementsSchema = z
	.object({
		output_debits: z.number(),
		input_credits: z.number(),
	})
	.passthrough();

export const vatReturnSchema = z
	.object({
		from: z.string(),
		to: z.string(),
		output_vat: z.number(),
		output_vat_reversals: z.number(),
		input_vat: z.number(),
		input_vat_adjustments: z.number(),
		net_payable: z.number(),
		carry_forward_credit: z.number(),
		payable_balance: z.number(),
		recoverable_balance: z.number(),
		unclassified_vat_movements: taxAccountMovementsSchema,
		purchases_crosscheck: z
			.object({
				count: z.number(),
				net: z.number(),
				vat: z.number(),
			})
			.passthrough(),
	})
	.passthrough();

export type VatReturn = z.infer<typeof vatReturnSchema>;

export function fetchVatReturn(
	from: string,
	to: string,
	signal?: AbortSignal,
): Promise<VatReturn> {
	const params = new URLSearchParams({ from, to });
	return fetchJson<VatReturn>(
		vatReturnSchema,
		`/api/accounting/vat-return?${params.toString()}`,
		getAccessToken(),
		signal ? { signal } : {},
	);
}
