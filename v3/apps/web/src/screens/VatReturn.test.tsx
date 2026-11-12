import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VatReturn } from "./VatReturn";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("../components/PrintActions", () => ({ PrintActions: () => null }));

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
	unclassified_vat_movements: { output_debits: 4, input_credits: 1 },
	purchases_crosscheck: { count: 1, net: 80, vat: 12 },
};

describe("مسودة مراجعة ضريبة القيمة المضافة", () => {
	beforeEach(() => {
		useQueryMock.mockReturnValue({
			data: report,
			isFetching: false,
			isPending: false,
			isError: false,
			refetch: vi.fn(),
		});
	});

	it("تعرض فترة المراجعة وتنبه للحركات الضريبية غير المصنفة", () => {
		render(<VatReturn />);

		expect(
			screen.getByRole("heading", {
				name: /مسودة مراجعة ضريبة القيمة المضافة/,
			}),
		).toBeTruthy();
		expect(screen.getByText("مطابقة فواتير الشراء")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("غير مصنّفة");
	});
});
