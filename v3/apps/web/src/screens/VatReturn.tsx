import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PrintActions } from "../components/PrintActions";
import {
	KpiCard,
	RangeControls,
	ReportHeader,
	SectionCard,
} from "../components/Reports";
import { StateError, StateLoading } from "../components/TableState";
import {
	errorMessage,
	moneyOf,
	num,
	presetRange,
	rangeProblem,
} from "../lib/reporting";
import { fetchVatReturn } from "../lib/vat-return";

export function VatReturn() {
	const [draft, setDraft] = useState(() => presetRange("month"));
	const [range, setRange] = useState(draft);
	const [problem, setProblem] = useState("");
	const reportQuery = useQuery({
		queryKey: ["accounting", "vat-return", range.from, range.to],
		queryFn: ({ signal }) => fetchVatReturn(range.from, range.to, signal),
	});

	const report = reportQuery.data;

	function apply() {
		const message = rangeProblem(draft.from, draft.to, 366);
		setProblem(message);
		if (!message) {
			setRange(draft);
		}
	}

	const unclassifiedOutputDebits = num(
		report?.unclassified_vat_movements.output_debits,
	);
	const unclassifiedInputCredits = num(
		report?.unclassified_vat_movements.input_credits,
	);
	const purchaseVatDifference =
		num(report?.purchases_crosscheck.vat) - num(report?.input_vat);

	return (
		<div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
			<ReportHeader
				title="مسودة مراجعة ضريبة القيمة المضافة"
				english="VAT Return Review"
				description="ملخص داخلي مبني على القيود المحاسبية المرحّلة فقط؛ لا يقدّم أو يرسل إقرارًا رسميًا."
				pending={reportQuery.isFetching}
				onRefresh={() => {
					void reportQuery.refetch();
				}}
			/>
			<div data-erp-print-hide>
				<PrintActions title="مسودة مراجعة ضريبة القيمة المضافة" />
			</div>

			<SectionCard title="فترة المراجعة" english="Review period">
				<div className="flex flex-col gap-sm p-sm">
					<RangeControls
						from={draft.from}
						to={draft.to}
						onFrom={(value) => {
							setDraft((current) => ({ ...current, from: value }));
						}}
						onTo={(value) => {
							setDraft((current) => ({ ...current, to: value }));
						}}
						onApply={apply}
						pending={reportQuery.isFetching}
					/>
					{problem ? (
						<p role="alert" className="text-body-sm text-danger-text">
							{problem}
						</p>
					) : null}
				</div>
			</SectionCard>

			{reportQuery.isPending ? (
				<StateLoading label="جارٍ تجميع قيود الضريبة المرحّلة…" />
			) : null}
			{reportQuery.isError ? (
				<StateError
					message={errorMessage(reportQuery.error)}
					onRetry={() => {
						void reportQuery.refetch();
					}}
				/>
			) : null}

			{report ? (
				<>
					<p className="text-body-sm text-muted">
						الفترة: <span dir="ltr">{report.from}</span> —{" "}
						<span dir="ltr">{report.to}</span>
					</p>

					{unclassifiedOutputDebits > 0 ||
					unclassifiedInputCredits > 0 ||
					Math.abs(purchaseVatDifference) > 0.01 ? (
						<aside
							role="alert"
							className="rounded-lg border border-warning bg-surface p-sm text-body-sm text-warning-text"
						>
							<strong>
								توجد حركات ضريبية غير مصنّفة وتحتاج مراجعة قبل اعتماد الأرقام.
							</strong>
							<div className="mt-xs flex flex-wrap gap-md">
								<span>
									مدين غير مصنّف على ضريبة المخرجات:{" "}
									{moneyOf(unclassifiedOutputDebits)}
								</span>
								<span>
									دائن غير مصنّف على ضريبة المدخلات:{" "}
									{moneyOf(unclassifiedInputCredits)}
								</span>
								{Math.abs(purchaseVatDifference) > 0.01 ? (
									<span>
										فرق ضريبة فواتير الشراء عن الأستاذ:{" "}
										{moneyOf(purchaseVatDifference)}
									</span>
								) : null}
							</div>
						</aside>
					) : null}

					<div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-5">
						<KpiCard
							label="ضريبة المخرجات المرحّلة"
							english="Posted output VAT"
							value={moneyOf(report.output_vat)}
							hint="ائتمانات حساب ضريبة المخرجات"
						/>
						<KpiCard
							label="عكس مبيعات ملغاة"
							english="POS void reversals"
							value={moneyOf(report.output_vat_reversals)}
							hint="مدين قيود إلغاء الكاشير المرحّلة"
						/>
						<KpiCard
							label="ضريبة المدخلات المرحّلة"
							english="Posted input VAT"
							value={moneyOf(report.input_vat)}
							hint="مدين حساب ضريبة المدخلات"
						/>
						<KpiCard
							label="تعديلات ضريبة المدخلات"
							english="Input VAT adjustments"
							value={moneyOf(report.input_vat_adjustments)}
							hint="إشعارات المورد المصنّفة"
						/>
						<KpiCard
							label={
								report.net_payable > 0 ? "صافي مستحق مبدئي" : "رصيد دائن مبدئي"
							}
							english="Preliminary net"
							value={moneyOf(
								report.net_payable > 0
									? report.net_payable
									: report.carry_forward_credit,
							)}
							hint="للمراجعة فقط — ليس إقرارًا معتمدًا"
						/>
					</div>

					<SectionCard
						title="مطابقة فواتير الشراء"
						english="Posted purchase cross-check"
					>
						<div className="grid gap-sm p-sm sm:grid-cols-3">
							<KpiCard
								label="الفواتير المرتبطة بقيود مرحّلة"
								english="Posted invoices"
								value={String(report.purchases_crosscheck.count)}
								hint="استُبعدت الفواتير الافتتاحية وغير المرحّلة"
							/>
							<KpiCard
								label="صافي المشتريات"
								english="Net purchases"
								value={moneyOf(report.purchases_crosscheck.net)}
								hint="من سجل الفواتير التي لها قيد مرحّل"
							/>
							<KpiCard
								label="فرق ضريبة الفواتير عن الأستاذ"
								english="Invoice-to-ledger difference"
								value={moneyOf(purchaseVatDifference)}
								hint="المشتريات المسجلة ناقص مدخلات الأستاذ"
							/>
						</div>
					</SectionCard>

					<SectionCard
						title="أرصدة حسابات الضريبة"
						english="Posted control-account balances"
					>
						<div className="grid gap-sm p-sm sm:grid-cols-2">
							<KpiCard
								label="رصيد حساب ضريبة المخرجات"
								english="Output VAT balance"
								value={moneyOf(report.payable_balance)}
								hint="الرصيد المرحّل حتى نهاية الفترة"
							/>
							<KpiCard
								label="رصيد حساب ضريبة المدخلات"
								english="Input VAT balance"
								value={moneyOf(report.recoverable_balance)}
								hint="الرصيد المرحّل حتى نهاية الفترة"
							/>
						</div>
					</SectionCard>

					<p className="rounded-lg border border-hairline bg-surface p-sm text-body-sm text-muted">
						هذه الشاشة للمراجعة الداخلية فقط. لا تتضمن إرسالًا إلى زاتكا، ولا
						تثبت الامتثال النظامي؛ راجع الإشعارات الدائنة والمدينة والحركات غير
						المصنّفة والمستندات الأصلية قبل استخدام الأرقام رسميًا.
					</p>
				</>
			) : null}
		</div>
	);
}
