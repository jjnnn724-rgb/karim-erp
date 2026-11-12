import { z } from "zod";
import { fetchJson } from "./api";
import { getAccessToken } from "./auth";

/**
 * مدد (WPS) والتأمينات (GOSI) وقوى (Qiwa) — طبقة V3 لعقد GATE 06.
 *
 * المصدر الحقيقي هو `backend/integration/wps-routes.js` و`wps.js`؛ هذه الطبقة
 * تستهلك العقود كما هي ولا تخترع شيئًا:
 *
 *   GET  /api/integration/wps/requirements?month=YYYY-MM
 *   GET  /api/integration/wps/readiness?month=YYYY-MM
 *   PUT  /api/integration/wps/employees/:id/bank
 *   POST /api/integration/wps/export
 *   GET  /api/integration/gosi/rates
 *   GET  /api/integration/gosi/preview?month=&rate_set=
 *   GET  /api/integration/qiwa/readiness
 *
 * ثوابت ADR-008 المنقولة نصًّا:
 *  1. **مدد يبقى BLOCKED** — لا نداء خارجي، ولا رفع تلقائي، ولا وسم «مقبول».
 *  2. الكشف الناتج **كشف أجور للمراجعة البشرية** وليس ملف SIF.
 *  3. نسب التأمينات **مجموعات صريحة** كلها `verified:false`؛ لا افتراض تلقائي
 *     (الخادم يرفض `gosi/preview` بلا `rate_set` — 422)، ولا تُطبَّق على قيد.
 *  4. الكتابة الوحيدة هي بيانات مصرفية للموظف (IBAN/جنسية/رقم تأمينات) بصلاحية
 *     `compliance.configure` = admin وحده، ويسبقها تحقق محلي مطابق للخادم.
 */

/* ─── الثوابت والأدوار ─────────────────────────────────────────────────── */

/** قراءة الشاشة: admin/manager (نفس `VIEW_ROLES` في الخادم). */
export const MUDAD_VIEW_ROLES = ["admin", "manager"] as const;
/** الكتابة (configure + submit): admin وحده — لا كتابة لمدير. */
export const MUDAD_WRITE_ROLES = ["admin"] as const;

/** مجموعات النسب المعروفة؛ الاختيار صريح دائمًا — لا قيمة افتراضية. */
export const GOSI_RATE_SET_IDS = [
	"legacy_before_2024_07",
	"new_registrant_2026",
] as const;

/** بوابات رسمية للفتح اليدوي فقط — لا ربط API. */
export const OFFICIAL_PORTALS = [
	{ id: "mudad", label: "مدد — حماية الأجور", url: "https://www.mudad.com.sa" },
	{ id: "gosi", label: "التأمينات الاجتماعية", url: "https://www.gosi.gov.sa" },
	{ id: "qiwa", label: "قوى — خدمات العمل", url: "https://www.qiwa.sa" },
] as const;

export const SA_IBAN_RE = /^SA\d{22}$/;
export const SAUDI_ID_RE = /^[12]\d{9}$/;
export const ISO2_RE = /^[A-Z]{2}$/;
export const GOSI_NUMBER_RE = /^[0-9]{6,12}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/* ─── مخططات الاستجابة (نفس أسماء حقول الخادم) ─────────────────────────── */

const idValue = z
	.union([z.string(), z.number()])
	.transform((value) => String(value));
const nullableText = z.string().nullable().optional();
const numericValue = z
	.union([z.string(), z.number()])
	.nullable()
	.optional()
	.transform((value) => {
		const parsed = Number(value ?? 0);
		return Number.isFinite(parsed) ? parsed : 0;
	});

const providerSchema = z
	.object({
		code: z.string(),
		verification: z.string(),
		is_enabled: z.boolean().optional(),
		direct_integration: z.boolean().optional(),
	})
	.passthrough();

export const wpsRequirementSchema = z
	.object({
		id: z.string(),
		title_ar: z.string(),
		requirement: z.string(),
		status: z.string(),
		source: z.string().optional(),
		detail: z.string().optional(),
	})
	.passthrough();

export type WpsRequirement = z.infer<typeof wpsRequirementSchema>;

export const wpsRequirementsResponseSchema = z
	.object({
		month: z.string(),
		provider: providerSchema,
		requirements: z.array(wpsRequirementSchema),
		note: z.string().optional(),
		generated_at: z.string().optional(),
	})
	.passthrough();

export type WpsRequirementsResponse = z.infer<
	typeof wpsRequirementsResponseSchema
>;

const readinessSummarySchema = z
	.object({
		month: z.string(),
		employees: numericValue,
		ready: numericValue,
		missing_id: numericValue,
		missing_salary: numericValue,
		missing_iban: numericValue,
		unknown_nationality: numericValue,
		missing_payroll_line: numericValue,
		posted: z.boolean(),
		employer_identifier: z.boolean(),
	})
	.passthrough();

export type WpsReadinessSummary = z.infer<typeof readinessSummarySchema>;

export const wpsReadinessEmployeeSchema = z
	.object({
		employee_id: idValue,
		name: nullableText,
		id_number_masked: nullableText,
		iban_masked: nullableText,
		nationality: nullableText,
		salary: numericValue,
		has_line: z.boolean().optional(),
		issues: z.array(z.string()).default([]),
		ready: z.boolean(),
	})
	.passthrough()
	.superRefine((employee, context) => {
		if (Object.hasOwn(employee, "id_number")) {
			context.addIssue({
				code: "custom",
				message: "خادم مدد أعاد رقم هوية غير محجوب.",
			});
		}
	});

export type WpsReadinessEmployee = z.infer<typeof wpsReadinessEmployeeSchema>;

export const wpsReadinessResponseSchema = z
	.object({
		month: z.string(),
		summary: readinessSummarySchema,
		blockers: z.array(z.string()),
		export_ready: z.boolean(),
		employees: z.array(wpsReadinessEmployeeSchema),
		truncated: z.boolean().optional(),
		note: z.string().optional(),
		generated_at: z.string().optional(),
	})
	.passthrough();

export type WpsReadinessResponse = z.infer<typeof wpsReadinessResponseSchema>;

const ratePairSchema = z
	.object({ employee_bp: z.number(), employer_bp: z.number() })
	.passthrough();

export const gosiRateSetSchema = z
	.object({
		id: z.string(),
		label_ar: z.string(),
		verified: z.boolean(),
		saudi: ratePairSchema,
		expat: ratePairSchema,
		note: z.string().optional(),
	})
	.passthrough();

export type GosiRateSet = z.infer<typeof gosiRateSetSchema>;

export const gosiRatesResponseSchema = z
	.object({
		rates: z.array(gosiRateSetSchema),
		verified: z.boolean().optional(),
		note: z.string().optional(),
		minimum_contributory_wage_note: z.string().optional(),
	})
	.passthrough();

export type GosiRatesResponse = z.infer<typeof gosiRatesResponseSchema>;

export const gosiPreviewLineSchema = z
	.object({
		employee_id: idValue,
		name: nullableText,
		category: z.string(),
		wage: z.number(),
		basis: z.string(),
		employee: z.number(),
		employer: z.number(),
		total: z.number(),
		below_minimum: z.boolean(),
	})
	.passthrough();

export type GosiPreviewLine = z.infer<typeof gosiPreviewLineSchema>;

export const gosiPreviewUnknownSchema = z
	.object({ employee_id: idValue, name: nullableText, reason: z.string() })
	.passthrough();

export const gosiPreviewResponseSchema = z
	.object({
		month: z.string(),
		rate_set: z
			.object({ id: z.string(), label_ar: z.string(), verified: z.boolean() })
			.passthrough(),
		basis: z.string(),
		estimate: z.boolean(),
		lines: z.array(gosiPreviewLineSchema),
		unclassified: z.array(gosiPreviewUnknownSchema),
		totals: z
			.object({ employee: z.number(), employer: z.number(), total: z.number() })
			.passthrough(),
		warnings: z.array(z.string()).default([]),
		generated_at: z.string().optional(),
	})
	.passthrough();

export type GosiPreviewResponse = z.infer<typeof gosiPreviewResponseSchema>;

export const qiwaCheckSchema = z
	.object({
		id: z.string(),
		label_ar: z.string(),
		ok: z.boolean(),
		detail: z.string(),
	})
	.passthrough();

export const qiwaReadinessResponseSchema = z
	.object({
		provider: providerSchema,
		checks: z.array(qiwaCheckSchema),
		ready: z.boolean(),
		note: z.string().optional(),
		generated_at: z.string().optional(),
	})
	.passthrough();

export type QiwaReadinessResponse = z.infer<typeof qiwaReadinessResponseSchema>;

export const bankUpdateResponseSchema = z
	.object({
		ok: z.boolean().optional(),
		employee_id: idValue,
		name: nullableText,
		iban_masked: nullableText,
		nationality: nullableText,
		gosi_number_present: z.boolean().optional(),
		audited: z.boolean().optional(),
	})
	.passthrough();

export type BankUpdateResponse = z.infer<typeof bankUpdateResponseSchema>;

export const wpsExportResponseSchema = z
	.object({
		ok: z.boolean().optional(),
		month: z.string(),
		rows: numericValue,
		sha256: z.string(),
		filename: z.string(),
		audited: z.boolean().optional(),
		note: z.string().optional(),
		csv: z.string(),
	})
	.passthrough();

export type WpsExportResponse = z.infer<typeof wpsExportResponseSchema>;

/* ─── المسارات والجلب ──────────────────────────────────────────────────── */

function monthQuery(month: string): string {
	return encodeURIComponent(isValidMonth(month) ? month : previousMonth());
}

export function wpsRequirementsPath(month: string): string {
	return `/api/integration/wps/requirements?month=${monthQuery(month)}`;
}

export function wpsReadinessPath(month: string): string {
	return `/api/integration/wps/readiness?month=${monthQuery(month)}`;
}

export function gosiPreviewPath(month: string, rateSet: string): string {
	return `/api/integration/gosi/preview?month=${monthQuery(month)}&rate_set=${encodeURIComponent(rateSet)}`;
}

export function fetchWpsRequirements(
	month: string,
	signal?: AbortSignal,
): Promise<WpsRequirementsResponse> {
	return fetchJson(
		wpsRequirementsResponseSchema,
		wpsRequirementsPath(month),
		getAccessToken(),
		signal ? { signal } : {},
	);
}

export function fetchWpsReadiness(
	month: string,
	signal?: AbortSignal,
): Promise<WpsReadinessResponse> {
	return fetchJson(
		wpsReadinessResponseSchema,
		wpsReadinessPath(month),
		getAccessToken(),
		signal ? { signal } : {},
	);
}

export function fetchGosiRates(
	signal?: AbortSignal,
): Promise<GosiRatesResponse> {
	return fetchJson(
		gosiRatesResponseSchema,
		"/api/integration/gosi/rates",
		getAccessToken(),
		signal ? { signal } : {},
	);
}

export function fetchGosiPreview(
	month: string,
	rateSet: string,
	signal?: AbortSignal,
): Promise<GosiPreviewResponse> {
	return fetchJson(
		gosiPreviewResponseSchema,
		gosiPreviewPath(month, rateSet),
		getAccessToken(),
		signal ? { signal } : {},
	);
}

export function fetchQiwaReadiness(
	signal?: AbortSignal,
): Promise<QiwaReadinessResponse> {
	return fetchJson(
		qiwaReadinessResponseSchema,
		"/api/integration/qiwa/readiness",
		getAccessToken(),
		signal ? { signal } : {},
	);
}

/* ─── التحقق المحلي (مطابق لدوال الخادم) ───────────────────────────────── */

export function normalizeIban(value: string | null | undefined): string {
	return String(value ?? "")
		.replace(/[\s-]/g, "")
		.toUpperCase();
}

/** IBAN سعودي: 24 حرفًا + بادئة SA + مجموع تحقق mod-97 = 1 (نفس `wps.js`). */
export function isValidSaudIban(value: string | null | undefined): boolean {
	const iban = normalizeIban(value);
	if (!SA_IBAN_RE.test(iban)) {
		return false;
	}
	const rearranged = iban.slice(4) + iban.slice(0, 4);
	let remainder = 0;
	for (const character of rearranged) {
		const code =
			character >= "A" && character <= "Z"
				? String(character.charCodeAt(0) - 55)
				: character;
		for (const digit of code) {
			remainder = (remainder * 10 + Number(digit)) % 97;
		}
	}
	return remainder === 1;
}

export function isValidSaudiId(value: string | null | undefined): boolean {
	return SAUDI_ID_RE.test(String(value ?? "").trim());
}

export function isValidGosiNumber(value: string | null | undefined): boolean {
	const text = String(value ?? "").trim();
	return text === "" || GOSI_NUMBER_RE.test(text);
}

export function normalizeNationality(
	value: string | null | undefined,
): string | null {
	const code = String(value ?? "")
		.trim()
		.toUpperCase();
	return ISO2_RE.test(code) ? code : null;
}

export type NationalityCategory = "saudi" | "expat" | "unknown";

/** التصنيف التأميني — لا تخمين: رمز غائب/غير صحيح = unknown. */
export function nationalityCategory(
	value: string | null | undefined,
): NationalityCategory {
	const code = normalizeNationality(value);
	if (!code) {
		return "unknown";
	}
	return code === "SA" ? "saudi" : "expat";
}

export type BankForm = {
	iban: string;
	nationality: string;
	gosiNumber: string;
};
export type BankPayload = {
	iban?: string;
	nationality?: string;
	gosiNumber?: string;
};

/**
 * تحقق نموذج بيانات الصرف قبل الإرسال:
 *  - IBAN الفارغ لا يُرسل (لتعديل حقل واحد فقط)، وغير الصالح يوقف الإرسال.
 *  - الجنسية رمز ISO من حرفين.
 *  - رقم التأمينات 6–12 رقمًا، والفارغ لا يُرسل (لا مسح ضمني في هذا النموذج).
 *  - حمولة فارغة تمامًا = لا شيء لتحديثه (نفس `NOTHING_TO_UPDATE`).
 */
export function validateBankForm(
	form: BankForm,
): { ok: true; payload: BankPayload } | { ok: false; message: string } {
	const iban = normalizeIban(form.iban);
	const nationality = String(form.nationality ?? "")
		.trim()
		.toUpperCase();
	const gosiNumber = String(form.gosiNumber ?? "").trim();
	const payload: BankPayload = {};

	if (iban) {
		if (!isValidSaudIban(iban)) {
			return {
				ok: false,
				message: "IBAN سعودي غير صحيح — 24 حرفًا يبدأ بـSA ومجموع تحقق صالح.",
			};
		}
		payload.iban = iban;
	}
	if (nationality) {
		if (!ISO2_RE.test(nationality)) {
			return { ok: false, message: "الجنسية رمز ISO من حرفين، مثل SA." };
		}
		payload.nationality = nationality;
	}
	if (gosiNumber) {
		if (!GOSI_NUMBER_RE.test(gosiNumber)) {
			return {
				ok: false,
				message: "رقم التأمينات يجب أن يكون من 6 إلى 12 رقمًا.",
			};
		}
		payload.gosiNumber = gosiNumber;
	}
	if (!payload.iban && !payload.nationality && !payload.gosiNumber) {
		return {
			ok: false,
			message: "أدخل IBAN أو الجنسية أو رقم التأمينات أولًا.",
		};
	}
	return { ok: true, payload };
}

export async function updateEmployeeBank(
	id: string,
	payload: BankPayload,
): Promise<BankUpdateResponse> {
	return fetchJson(
		bankUpdateResponseSchema,
		`/api/integration/wps/employees/${encodeURIComponent(id)}/bank`,
		getAccessToken(),
		{
			method: "PUT",
			body: payload,
		},
	);
}

/** توليد كشف المراجعة — بلا رفع؛ النتيجة CSV نصّي يُنزّل محليًا. */
export async function exportWpsReview(
	month: string,
): Promise<WpsExportResponse> {
	return fetchJson(
		wpsExportResponseSchema,
		"/api/integration/wps/export",
		getAccessToken(),
		{
			method: "POST",
			body: { month: monthQuery(month) },
		},
	);
}

/* ─── الشهر (ADR-05) ───────────────────────────────────────────────────── */

export function isValidMonth(value: string | null | undefined): boolean {
	return MONTH_RE.test(String(value ?? "").trim());
}

/** الشهر السابق — نفس `previousMonth()` في `wps-routes.js` (بلا تحويل UTC). */
export function previousMonth(now: Date = new Date()): string {
	const date = new Date(now.getTime());
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	date.setDate(1);
	date.setMonth(date.getMonth() - 1);
	return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/* ─── التسميات (عربية واحدة، بلا قاموس ثانٍ) ────────────────────────────── */

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

const STATUS_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
	DONE: { label: "مكتمل", tone: "success" },
	TODO: { label: "قيد الاستكمال", tone: "warning" },
	PARTIAL: { label: "جزئي", tone: "warning" },
	MISSING: { label: "ناقص", tone: "danger" },
	BLOCKED: { label: "محجوب", tone: "neutral" },
};

export function requirementStatusLabel(status: string): {
	label: string;
	tone: BadgeTone;
} {
	return (
		STATUS_LABELS[status] ?? { label: status || "غير معروف", tone: "neutral" }
	);
}

export const WPS_BLOCKER_LABELS: Readonly<Record<string, string>> = {
	EMPLOYER_ID_MISSING: "السجل التجاري للمنشأة غير مضبوط في إعدادات الهيئة.",
	PAYROLL_MONTH_NOT_POSTED: "مسير الشهر غير مُقفل (posted).",
	EMPLOYEES_MISSING_ID: "موظفون بلا هوية/إقامة صحيحة (10 أرقام تبدأ بـ1 أو 2).",
	EMPLOYEES_MISSING_SALARY: "موظفون بلا راتب أساسي موجب.",
	EMPLOYEES_MISSING_IBAN: "موظفون بلا IBAN سعودي صالح.",
	EMPLOYEES_NATIONALITY_UNKNOWN: "موظفون بلا جنسية معروفة (رمز ISO من حرفين).",
	PAYROLL_LINES_MISSING: "صفوف رواتب ناقصة داخل المسير المُقفل.",
};

export function blockerLabel(code: string): string {
	return WPS_BLOCKER_LABELS[code] ?? code;
}

export const WPS_ISSUE_LABELS: Readonly<Record<string, string>> = {
	ID_MISSING: "هوية/إقامة ناقصة",
	SALARY_MISSING: "راتب أساسي ناقص",
	IBAN_MISSING: "IBAN غير صالح",
	NATIONALITY_UNKNOWN: "جنسية غير معروفة",
	PAYROLL_LINE_MISSING: "بند المسير ناقص",
};

export function issueLabel(code: string): string {
	return WPS_ISSUE_LABELS[code] ?? code;
}

export const NATIONALITY_CATEGORY_LABELS: Readonly<
	Record<NationalityCategory, string>
> = {
	saudi: "سعودي",
	expat: "وافد",
	unknown: "غير معروف",
};

export const GOSI_REASON_LABELS: Readonly<Record<string, string>> = {
	NATIONALITY_UNKNOWN: "الجنسية غير معروفة",
	WAGE_MISSING: "الأجر غير متوفر",
	RATE_UNAVAILABLE: "النسب غير متاحة",
};

export function gosiReasonLabel(code: string): string {
	return GOSI_REASON_LABELS[code] ?? code;
}

export const GOSI_BASIS_LABELS: Readonly<Record<string, string>> = {
	payroll: "وعاء المسير",
	employee_salary: "الراتب الأساسي (تقديري)",
	employee_salary_estimate: "الراتب الأساسي (تقديري)",
};

export function gosiBasisLabel(code: string): string {
	return GOSI_BASIS_LABELS[code] ?? code;
}

/** نسبة مئوية من نقاط الأساس: 975bp → 9.75%. */
export function ratePercent(basisPoints: number): string {
	const value = Number(basisPoints);
	return Number.isFinite(value) ? `${(value / 100).toFixed(2)}%` : "—";
}

/** مبلغ عرض من الخادم — يبقى رقمًا في العقد ويُنسَّق نصًّا للعرض فقط. */
export function moneyText(value: number | null | undefined): string {
	const amount = Number(value ?? 0);
	return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

/** نسبة الجاهزية للعرض — 0 عند غياب الموظفين، ولا قسمة على صفر. */
export function readinessPercent(summary: WpsReadinessSummary): number {
	if (!summary.employees) {
		return 0;
	}
	return Math.round((summary.ready / summary.employees) * 100);
}

/**
 * تنزيل نصّ محليًا (كشف CSV من الخادم). لا شبكة ولا رفع:
 * `Blob` + رابط مؤقت ثم إزالته. في بيئة بلا DOM تُترك العملية بلا أثر.
 */
export function downloadTextFile(
	filename: string,
	text: string,
	type = "text/csv;charset=utf-8",
): void {
	if (
		typeof document === "undefined" ||
		typeof URL === "undefined" ||
		typeof URL.createObjectURL !== "function"
	) {
		return;
	}
	const blob = new Blob([text], { type });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// الإبطال بعد أن يلتقط المتصفح الرابط — فورًا قد يقطع التنزيل في بعض المتصفحات.
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1000);
}
