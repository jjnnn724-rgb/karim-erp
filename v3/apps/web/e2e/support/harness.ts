import {
	type ConsoleMessage,
	expect,
	type Page,
	type Response,
} from "@playwright/test";

/**
 * أدوات الحزمة الحية — الدخول، رصد الكونسول، قياس النوافذ.
 *
 * الشروط تُقاس كشروط لا كأرقام من البيانات: أي تغيّرٍ في السجلات الحقيقية
 * لا يكسر الاختبار ما دامت القاعدة (الذيل داخل الشاشة، الجسم يمرّر…).
 */

export const LIVE = {
	user: process.env.V3_E2E_USER ?? "",
	pass: process.env.V3_E2E_PASS ?? "",
	cashierUser: process.env.V3_E2E_CASHIER_USER ?? "",
	cashierPass: process.env.V3_E2E_CASHIER_PASS ?? "",
};

export const hasLiveCreds = Boolean(LIVE.user && LIVE.pass);
export const hasCashierCreds = Boolean(LIVE.cashierUser && LIVE.cashierPass);

export const SKIP_NO_CREDS = "يتطلب V3_E2E_USER / V3_E2E_PASS (خادم تحقق حي)";
export const SKIP_NO_CASHIER =
	"يتطلب V3_E2E_CASHIER_USER / V3_E2E_CASHIER_PASS";

/**
 * ردود متوقّعة لا تُعد أخطاء: لا وردية مفتوحة (404 مقصود). الفحص على
 * **عنوان** الاستجابة لأن رسالة الكونسول لا تحمله.
 */
const BENIGN = [/\/api\/pos\/shifts\/active/, /\/favicon\.ico$/];

export interface ConsoleWatch {
	readonly errors: string[];
	stop: () => void;
}

export function watchConsole(page: Page): ConsoleWatch {
	const errors: string[] = [];
	const onConsole = (message: ConsoleMessage): void => {
		if (message.type() !== "error") return;
		// رسالة عامة بلا عنوان؛ الدقة تأتي من `response` أدناه.
		if (message.text().includes("Failed to load resource")) return;
		errors.push(`console: ${message.text()}`);
	};
	const onResponse = (response: Response): void => {
		if (response.status() < 400) return;
		const url = response.url();
		if (BENIGN.some((pattern) => pattern.test(url))) return;
		errors.push(`http ${response.status()}: ${new URL(url).pathname}`);
	};
	const onPageError = (error: Error): void => {
		errors.push(`pageerror: ${error.message}`);
	};
	page.on("console", onConsole);
	page.on("response", onResponse);
	page.on("pageerror", onPageError);
	return {
		errors,
		stop: () => {
			page.off("console", onConsole);
			page.off("response", onResponse);
			page.off("pageerror", onPageError);
		},
	};
}

export async function login(
	page: Page,
	username: string = LIVE.user,
	password: string = LIVE.pass,
): Promise<void> {
	await page.goto("/v3/", { waitUntil: "domcontentloaded" });
	const user = page.locator("#erp-v3-username");
	await expect(user).toBeVisible({ timeout: 30_000 });
	await user.fill(username);
	await page.locator("#erp-v3-password").fill(password);
	await page.locator('form button[type="submit"]').click();
	await page.waitForTimeout(1_200);
	const alert = page.getByRole("alert");
	if (await alert.isVisible().catch(() => false)) {
		// يفرّق بين ردّ خادم صريح (مثل RATE_LIMIT_EXCEEDED) وبين تعليق صامت.
		throw new Error(
			`تعذّر الدخول: ${(await alert.textContent())?.trim() ?? ""}`,
		);
	}
	await expect(page.locator(".erp-shell")).toBeAttached({ timeout: 60_000 });
	// لوحات التحكم تستعلم بعد الجلسة؛ مهلة قصيرة كي تستقر الشبكة قبل القياس.
	await page.waitForTimeout(1_500);
}

/** دخول شاشةٍ بجلسة محفوظة (`storageState`) — بلا استهلاك محاولة تسجيل دخول. */
export async function enter(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: "domcontentloaded" });
	await expect(page.locator(".erp-shell")).toBeAttached({ timeout: 60_000 });
	await page.waitForTimeout(1_500);
}

export async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
}

export async function pageScrollTop(page: Page): Promise<number> {
	return page.evaluate(() =>
		Math.round(document.scrollingElement?.scrollTop ?? 0),
	);
}

export async function wheelAt(
	page: Page,
	x: number,
	y: number,
	deltaY: number,
): Promise<void> {
	await page.mouse.move(x, y);
	await page.mouse.wheel(0, deltaY);
	await page.waitForTimeout(300);
}

export interface DialogMetrics {
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly bodyScrollHeight: number;
	readonly bodyClientHeight: number;
	readonly footTop: number | null;
	readonly buttons: readonly {
		readonly label: string;
		readonly height: number;
		readonly top: number;
		readonly bottom: number;
	}[];
}

/** يصف نافذة منفتحة (`[data-slot="dialog-content"]`) وذيلها وأزرارها. */
export async function dialogMetrics(page: Page): Promise<DialogMetrics> {
	const value = await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>(
			'[data-slot="dialog-content"]',
		);
		if (!el) return null;
		const body = el.querySelector<HTMLElement>(".erp-dialog__body") ?? el;
		const foot = el.querySelector<HTMLElement>(".erp-dialog__foot");
		const rect = el.getBoundingClientRect();
		return {
			width: Math.round(rect.width),
			height: Math.round(rect.height),
			top: Math.round(rect.top),
			bottom: Math.round(rect.bottom),
			left: Math.round(rect.left),
			right: Math.round(rect.right),
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			bodyScrollHeight: body.scrollHeight,
			bodyClientHeight: body.clientHeight,
			footTop: foot ? Math.round(foot.getBoundingClientRect().top) : null,
			buttons: [...el.querySelectorAll("button")].map((button) => {
				const box = button.getBoundingClientRect();
				return {
					label: (button.textContent || button.getAttribute("aria-label") || "")
						.trim()
						.slice(0, 24),
					height: Math.round(box.height),
					top: Math.round(box.top),
					bottom: Math.round(box.bottom),
				};
			}),
		};
	});
	if (!value) throw new Error("لا توجد نافذة مفتوحة لقياسها");
	return value;
}

export async function expectDialogClosed(page: Page): Promise<void> {
	await page.keyboard.press("Escape");
	await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
}

/** نافذة قابلة للاستخدام: داخل الشاشة، والذيل والأزرار ظاهرة بلا تمرير الصفحة. */
export function expectDialogUsable(
	metrics: DialogMetrics,
	minWidth: number,
): void {
	expect(metrics.width, "عرض النافذة").toBeGreaterThanOrEqual(minWidth);
	expect(metrics.top, "أعلى النافذة داخل الشاشة").toBeGreaterThanOrEqual(0);
	expect(metrics.bottom, "أسفل النافذة داخل الشاشة").toBeLessThanOrEqual(
		metrics.viewportHeight,
	);
	expect(metrics.left, "يسار النافذة داخل الشاشة").toBeGreaterThanOrEqual(0);
	expect(metrics.right, "يمين النافذة داخل الشاشة").toBeLessThanOrEqual(
		metrics.viewportWidth,
	);
	const footButtons = metrics.buttons.filter(
		(button) => button.bottom <= metrics.viewportHeight,
	);
	expect(
		footButtons.some((button) => /إلغاء|تأكيد|إضافة|إرسال/.test(button.label)),
		"زر إجراء في الذيل داخل الشاشة",
	).toBe(true);
}
