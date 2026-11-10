import { expect, test } from "@playwright/test";
import {
	dialogMetrics,
	enter,
	expectDialogClosed,
	expectDialogUsable,
	hasLiveCreds,
	horizontalOverflow,
	pageScrollTop,
	SKIP_NO_CREDS,
	watchConsole,
	wheelAt,
} from "../../support/harness";

/**
 * نوافذ القرار — العيب الذي أُصلح: نافذة على شكل شريط ضيق وأزرار اعتماد
 * لا تُبلغ. القاعدة المقاسة هنا: عرض كافٍ، ذيل داخل الشاشة دائمًا، جسم
 * يمرّر وحده، وإغلاق بـEscape.
 */

test.describe("النوافذ — سطح مكتب", () => {
	test.skip(!hasLiveCreds, SKIP_NO_CREDS);
	test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, "سطح مكتب فقط");

	test("اعتماد الصرف: الذيل مثبّت والجسم يمرّر", async ({ page }) => {
		const watch = watchConsole(page);
		await enter(page, "/v3/dispatch");

		const approve = page.getByRole("button", { name: /اعتماد وصرف/ }).first();
		await expect(approve).toBeVisible({ timeout: 45_000 });
		await approve.click();
		// اترك محتوى النافذة يستقر (خطوط/لوحة توقيع) قبل أخذ خط الأساس.
		await page.waitForTimeout(600);

		const opened = await dialogMetrics(page);
		expectDialogUsable(opened, 640);
		expect(
			opened.width,
			"عرض النافذة لا يتجاوز العمود المقروء",
		).toBeLessThanOrEqual(760);

		if (opened.bodyScrollHeight > opened.bodyClientHeight) {
			const center = await page.evaluate(() => {
				const body = document.querySelector<HTMLElement>(".erp-dialog__body");
				if (!body) return null;
				const box = body.getBoundingClientRect();
				return {
					x: Math.round(box.left + box.width / 2),
					y: Math.round(box.top + box.height / 2),
				};
			});
			if (!center) throw new Error("لا جسم للنافذة");
			await wheelAt(page, center.x, center.y, 600);

			const scrolled = await page.evaluate(
				() =>
					document.querySelector<HTMLElement>(".erp-dialog__body")?.scrollTop ??
					0,
			);
			expect(scrolled, "جسم النافذة يمرّر بعجلة الفأرة").toBeGreaterThan(0);

			const after = await dialogMetrics(page);
			// الذيل مثبّت: موضعه لا يتحرك بالتمرير (سماحية 2px لتقريب البكسل).
			expect(
				Math.abs((after.footTop ?? 0) - (opened.footTop ?? 0)),
				"الذيل بقي في مكانه بعد التمرير",
			).toBeLessThanOrEqual(2);
			expect(after.bottom, "النافذة ما زالت داخل الشاشة").toBeLessThanOrEqual(
				after.viewportHeight,
			);
		}

		await expectDialogClosed(page);
		expect(watch.errors).toEqual([]);
		watch.stop();
	});

	test("إنشاء طلب صرف: حقول عريضة وأزرار ظاهرة", async ({ page }) => {
		await enter(page, "/v3/dispatch");

		const create = page.getByRole("button", { name: "طلب صرف جديد" }).first();
		await expect(create).toBeVisible({ timeout: 45_000 });
		await create.click();
		await page.waitForTimeout(600);

		const metrics = await dialogMetrics(page);
		expectDialogUsable(metrics, 640);

		const fieldWidth = await page.evaluate(() => {
			const input = document.querySelector<HTMLElement>(
				'[data-slot="dialog-content"] input, [data-slot="dialog-content"] textarea',
			);
			return input ? Math.round(input.getBoundingClientRect().width) : 0;
		});
		expect(fieldWidth, "عرض حقل الإدخال").toBeGreaterThanOrEqual(280);

		await expectDialogClosed(page);
	});

	test("إضافة موظف: الحقول مقروءة والذيل في الشاشة", async ({ page }) => {
		await enter(page, "/v3/employees");

		const add = page
			.getByRole("button", { name: /إضافة موظف|موظف جديد/ })
			.first();
		await expect(add).toBeVisible({ timeout: 45_000 });
		await add.click();
		await page.waitForTimeout(600);

		const metrics = await dialogMetrics(page);
		expectDialogUsable(metrics, 640);

		const fieldWidth = await page.evaluate(() => {
			const input = document.querySelector<HTMLElement>(
				'[data-slot="dialog-content"] input, [data-slot="dialog-content"] select',
			);
			return input ? Math.round(input.getBoundingClientRect().width) : 0;
		});
		expect(fieldWidth, "عرض حقل الموظف").toBeGreaterThanOrEqual(240);

		await expectDialogClosed(page);
	});

	test("التمرير من أي مكان: فوق الجداول واللوحات يحرّك الصفحة", async ({
		page,
	}) => {
		await enter(page, "/v3/dispatch");

		const scrollable = await page.evaluate(
			() =>
				(document.scrollingElement?.scrollHeight ?? 0) -
				(document.scrollingElement?.clientHeight ?? 0),
		);
		test.skip(scrollable < 500, "الصفحة أقصر من أن تُقاس بالتمرير");

		// نقاط داخل منطقة المحتوى بعيدًا عن القائمة الجانبية والهيدر.
		const viewport = page.viewportSize();
		if (!viewport) throw new Error("لا أبعاد للعرض");
		const points: readonly [number, number][] = [
			[0.5, 0.5],
			[0.3, 0.35],
			[0.7, 0.65],
			[0.55, 0.8],
		];
		// انتظر أول صفوف الشاشة كي يكون المحتوى (لا الهيكل الفارغ) هو المقاس.
		await page.waitForTimeout(2_500);

		for (const [fx, fy] of points) {
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.waitForTimeout(150);
			await wheelAt(page, viewport.width * fx, viewport.height * fy, 250);
			const top = await pageScrollTop(page);
			expect(top, `تمرير عند النقطة ${fx}/${fy}`).toBeGreaterThanOrEqual(180);
		}

		expect(await horizontalOverflow(page), "فائض أفقي بعد التمرير").toBe(0);
	});

	test("القائمة الجانبية تمرّر نفسها ثم تسلسل للصفحة", async ({ page }) => {
		await enter(page, "/v3/");
		// توجد نسختان (سطح مكتب/جوال) في الشجرة؛ نأخذ الظاهرة فقط.
		const nav = page.locator(".erp-shell__nav-scroll:visible").first();
		await expect(nav).toBeVisible();

		const scrollable = await nav.evaluate(
			(el) => el.scrollHeight > el.clientHeight,
		);
		test.skip(!scrollable, "قائمة الجانب أقصر من أن تمرّر في هذه الجلسة");

		const box = await nav.boundingBox();
		if (!box) throw new Error("لا قائمة جانبية");
		await wheelAt(page, box.x + box.width / 2, box.y + box.height / 2, 240);
		const navTop = await nav.evaluate((el) => Math.round(el.scrollTop));
		expect(navTop, "القائمة تمرّر محتواها أولًا").toBeGreaterThan(0);
	});
});

test.describe("النوافذ — جوال", () => {
	test.skip(!hasLiveCreds, SKIP_NO_CREDS);
	test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, "جوال فقط");

	test("اعتماد الصرف على 390: عرض كامل وأزرار لمس 44", async ({ page }) => {
		const watch = watchConsole(page);
		await enter(page, "/v3/dispatch");

		const approve = page.getByRole("button", { name: /اعتماد وصرف/ }).first();
		await expect(approve).toBeVisible({ timeout: 45_000 });
		await approve.click();
		await page.waitForTimeout(600);

		const m = await dialogMetrics(page);
		expectDialogUsable(m, 350);
		expect(
			m.right - m.left,
			"النافذة تشغل عرض الشاشة بهوامش",
		).toBeGreaterThanOrEqual(350);

		const close = m.buttons.find((button) => button.label === "إغلاق");
		expect(close?.height ?? 0, "زر الإغلاق 44px لمسًا").toBeGreaterThanOrEqual(
			44,
		);

		for (const label of ["إلغاء", "تأكيد الموافقة"]) {
			const button = m.buttons.find((candidate) => candidate.label === label);
			expect(button, `زر ${label} موجود`).toBeDefined();
			expect(button?.height ?? 0, `ارتفاع زر ${label}`).toBeGreaterThanOrEqual(
				44,
			);
			expect(
				button?.bottom ?? Infinity,
				`زر ${label} داخل الشاشة`,
			).toBeLessThanOrEqual(m.viewportHeight);
		}

		await expectDialogClosed(page);
		expect(await horizontalOverflow(page)).toBe(0);
		expect(watch.errors).toEqual([]);
		watch.stop();
	});
});
