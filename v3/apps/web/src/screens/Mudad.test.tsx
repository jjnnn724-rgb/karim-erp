import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previousMonth } from "../lib/mudad";
import { ToastProvider } from "../ui/Toast";
import { Mudad } from "./Mudad";

/**
 * سطح V3 لمدد — يقرأ المسارات السبعة (بلا gosi/preview قبل اختيار النسب)
 * ولا يرسل أي كتابة تلقائيًا. النسب لا تُفترض: القائمة تبدأ بلا اختيار.
 */

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function renderScreen() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ToastProvider>
				<Mudad />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("مدد والتأمينات وقوى", () => {
	it("يعرض المتطلبات والجاهزية والنسب وقوى من الخادم بلا أي كتابة", async () => {
		const calls: { url: string; method: string | undefined }[] = [];
		const month = previousMonth();
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, method: init?.method });
			if (url.includes("/wps/requirements")) {
				return json({
					month,
					provider: {
						code: "mudad",
						verification: "BLOCKED",
						is_enabled: false,
						direct_integration: false,
					},
					requirements: [
						{
							id: "employee_iban",
							title_ar: "IBAN سعودي لكل موظف",
							requirement: "IBAN صحيح 24 حرفًا يبدأ بـSA.",
							status: "TODO",
							detail: "1 من 2",
						},
					],
					note: "ليست قبولًا من مدد",
				});
			}
			if (url.includes("/wps/readiness")) {
				return json({
					month,
					summary: {
						month,
						employees: 2,
						ready: 1,
						missing_id: 0,
						missing_salary: 0,
						missing_iban: 1,
						unknown_nationality: 0,
						missing_payroll_line: 0,
						posted: true,
						employer_identifier: true,
					},
					blockers: ["EMPLOYEES_MISSING_IBAN"],
					export_ready: false,
					employees: [
						{
							employee_id: 7,
							name: "أحمد علي",
							id_number_masked: "******7890",
							iban_masked: "SA03**********7519",
							nationality: "SA",
							salary: 5000,
							has_line: true,
							issues: [],
							ready: true,
						},
						{
							employee_id: 8,
							name: "منى حسن",
							id_number_masked: "******7890",
							iban_masked: null,
							nationality: "EG",
							salary: 4000,
							has_line: true,
							issues: ["IBAN_MISSING"],
							ready: false,
						},
					],
					truncated: false,
					note: "عرض جاهزية فقط",
				});
			}
			if (url.includes("/gosi/rates")) {
				return json({
					rates: [
						{
							id: "legacy_before_2024_07",
							label_ar: "مسجّل قبل 2024-07-03",
							verified: false,
							saudi: { employee_bp: 975, employer_bp: 1175 },
							expat: { employee_bp: 0, employer_bp: 200 },
						},
					],
					verified: false,
					note: "النسب غير موثّقة داخل النظام",
				});
			}
			if (url.includes("/qiwa/readiness")) {
				return json({
					provider: {
						code: "qiwa",
						verification: "UNVERIFIED",
						direct_integration: false,
					},
					checks: [
						{
							id: "contracts",
							label_ar: "عقود سارية مسجّلة محليًا",
							ok: true,
							detail: "3 من 3 موظف",
						},
					],
					ready: true,
					note: "جاهزية بيانات محلية فقط",
				});
			}
			return json({ error: "NOT_FOUND" });
		});
		vi.stubGlobal("fetch", fetchMock);

		renderScreen();

		expect(await screen.findByText("IBAN سعودي لكل موظف")).toBeTruthy();
		expect(screen.getAllByText("أحمد علي").length).toBeGreaterThan(0);
		expect(screen.getAllByText("******7890").length).toBeGreaterThan(0);
		expect(screen.queryByText("1234567890")).toBeNull();
		expect(screen.getAllByText("SA03**********7519").length).toBeGreaterThan(0);
		expect(screen.getByText(/موظفون بلا IBAN سعودي صالح/)).toBeTruthy();
		expect(screen.getAllByText("مسجّل قبل 2024-07-03").length).toBeGreaterThan(
			0,
		);
		expect(screen.getByText("غير موثّقة")).toBeTruthy();
		expect(screen.getByText("عقود سارية مسجّلة محليًا")).toBeTruthy();
		expect(
			screen.getByText(
				"لا افتراض تلقائي للنسب — اختر مجموعة صراحةً لعرض الحساب التقديري.",
			),
		).toBeTruthy();

		const portal = screen.getByRole("link", { name: /مدد — حماية الأجور/ });
		expect(portal.getAttribute("href")).toBe("https://www.mudad.com.sa");
		expect(portal.getAttribute("rel")).toContain("noopener");

		expect(
			calls.some((call) => call.url.includes(`/wps/readiness?month=${month}`)),
		).toBe(true);
		expect(calls.some((call) => call.url.includes("/gosi/preview"))).toBe(
			false,
		);
		expect(calls.every((call) => !call.method || call.method === "GET")).toBe(
			true,
		);
	});
});
