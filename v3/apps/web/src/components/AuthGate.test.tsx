import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * بوابة الدخول — كل لوحةٍ تُختبَر على حالتها الحقيقية كما يعيدها الخادم.
 * `../lib/auth` مُستبدلة كي ترسم البوابة وحدها: منطق الشبكة مغطّى في
 * `auth.test.ts`، وهنا نثبّت سلوك الواجهة بين الخطوات.
 */

const { MockAuthError, mocks } = vi.hoisted(() => {
	class MockAuthError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	}
	return {
		MockAuthError,
		mocks: {
			bootstrap: vi.fn(),
			login: vi.fn(),
			verifyMfa: vi.fn(),
			setupMfa: vi.fn(),
			confirmMfa: vi.fn(),
			applySession: vi.fn(),
			loginWithPasskey: vi.fn(),
			changePassword: vi.fn(),
			resetPassword: vi.fn(),
		},
	};
});

vi.mock("../lib/auth", () => ({
	AuthError: MockAuthError,
	useAuthState: () => ({ status: "anonymous", token: null, user: null }),
	bootstrapSession: mocks.bootstrap,
	login: mocks.login,
	verifyMfa: mocks.verifyMfa,
	setupMfa: mocks.setupMfa,
	confirmMfa: mocks.confirmMfa,
	applySession: mocks.applySession,
	loginWithPasskey: mocks.loginWithPasskey,
	changePassword: mocks.changePassword,
	resetPassword: mocks.resetPassword,
}));

import { AuthGate } from "./AuthGate";

const SESSION = {
	access_token: "access-1",
	refresh_token: "refresh-1",
	user: { id: "7", name: "قارئ", role: "accountant", username: "reader" },
};

const SETUP = {
	issuer: "Karim ERP",
	account: "admin",
	secret: "JBSWY3DPEHPK3PXP",
	otpauthUri: "otpauth://totp/Karim:admin?secret=JBSWY3DPEHPK3PXP",
	qrDataUrl: "data:image/png;base64,AAAA",
};

async function passwordLogin(): Promise<void> {
	fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
		target: { value: " reader " },
	});
	fireEvent.change(screen.getByLabelText("كلمة المرور"), {
		target: { value: "synthetic-password" },
	});
	fireEvent.click(screen.getByRole("button", { name: "دخول" }));
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.bootstrap.mockResolvedValue(false);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("بوابة الدخول", () => {
	it("تنتظر تمهيد الجلسة ثم تعرض الدخول", async () => {
		render(
			<AuthGate>
				<div>التطبيق</div>
			</AuthGate>,
		);

		expect(screen.getByRole("status").textContent).toContain("جارٍ التحقّق");
		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: /الإصدار الثالث/ }),
			).toBeTruthy();
		});
		expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
	});

	it("تسجّل الدخول وتنتقل لطلب رمز التطبيق عند mfa_required", async () => {
		mocks.login.mockResolvedValue({
			kind: "mfa",
			ticket: "ticket-1",
			methods: { totp: true, passkey: true },
			message: "أكمل التحقق",
		});
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");

		await passwordLogin();

		expect(mocks.login).toHaveBeenCalledWith("reader", "synthetic-password");
		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: "خطوة التحقق الثانية" }),
			).toBeTruthy();
		});
		expect(
			screen.getByRole("button", { name: "الدخول بالبصمة أو Face ID" }),
		).toBeTruthy();
		expect(screen.getByText("أكمل التحقق")).toBeTruthy();
	});

	it("تتحقق من رمز TOTP بتذكرة الخادم", async () => {
		mocks.login.mockResolvedValue({
			kind: "mfa",
			ticket: "ticket-1",
			methods: { totp: true, passkey: false },
		});
		mocks.verifyMfa.mockResolvedValue(undefined);
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		const code = await screen.findByLabelText("رمز التطبيق");
		fireEvent.change(code, { target: { value: "12345" } });
		fireEvent.click(screen.getByRole("button", { name: "تحقق ودخول" }));
		expect(mocks.verifyMfa).not.toHaveBeenCalled();

		fireEvent.change(code, { target: { value: "123456" } });
		fireEvent.click(screen.getByRole("button", { name: "تحقق ودخول" }));
		await waitFor(() => {
			expect(mocks.verifyMfa).toHaveBeenCalledWith("ticket-1", {
				code: "123456",
			});
		});
	});

	it("تتحول لرمز الاسترداد عند الطلب", async () => {
		mocks.login.mockResolvedValue({
			kind: "mfa",
			ticket: "ticket-1",
			methods: { totp: true, passkey: false },
		});
		mocks.verifyMfa.mockResolvedValue(undefined);
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		fireEvent.click(
			await screen.findByRole("button", { name: "استخدام رمز استرداد" }),
		);
		fireEvent.change(screen.getByLabelText("رمز الاسترداد"), {
			target: { value: "RECOVERY-1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "تحقق ودخول" }));

		await waitFor(() => {
			expect(mocks.verifyMfa).toHaveBeenCalledWith("ticket-1", {
				recoveryCode: "RECOVERY-1",
			});
		});
	});

	it("تدخل بمفتاح المرور من نفس التذكرة", async () => {
		mocks.login.mockResolvedValue({
			kind: "mfa",
			ticket: "ticket-1",
			methods: { totp: true, passkey: true },
		});
		mocks.loginWithPasskey.mockResolvedValue(undefined);
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		fireEvent.click(
			await screen.findByRole("button", { name: "الدخول بالبصمة أو Face ID" }),
		);

		await waitFor(() => {
			expect(mocks.loginWithPasskey).toHaveBeenCalledWith("ticket-1");
		});
	});

	it("تسجّل العامل الثاني وتعرض رموز الاسترداد قبل فتح الجلسة", async () => {
		mocks.login.mockResolvedValue({ kind: "enroll", ticket: "ticket-enroll" });
		mocks.setupMfa.mockResolvedValue(SETUP);
		mocks.confirmMfa.mockResolvedValue({
			session: SESSION,
			recoveryCodes: ["A-1", "B-2"],
		});
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		expect(
			await screen.findByAltText("رمز QR لتسجيل المصادقة الثنائية"),
		).toBeTruthy();
		expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
		expect(mocks.setupMfa).toHaveBeenCalledWith("ticket-enroll");

		fireEvent.change(screen.getByLabelText("رمز التطبيق"), {
			target: { value: "654321" },
		});
		fireEvent.click(screen.getByRole("button", { name: "تأكيد التسجيل" }));

		expect(
			await screen.findByRole("heading", { name: "احفظ رموز الاسترداد" }),
		).toBeTruthy();
		// رسالة «أكمل التسجيل» تخصّ شاشة التسجيل؛ بقاؤها هنا تشويشٌ مكرَّر.
		expect(screen.queryByRole("status")).toBeNull();
		expect(mocks.confirmMfa).toHaveBeenCalledWith("ticket-enroll", "654321");
		expect(mocks.applySession).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "حفظتها — دخول" }));
		expect(mocks.applySession).toHaveBeenCalledWith(SESSION);
	});

	it("تفرض تدوير كلمة المرور قبل الدخول", async () => {
		mocks.login.mockResolvedValue({
			kind: "password_change",
			ticket: "ticket-pwd",
			message: "يجب تدوير كلمة المرور",
		});
		mocks.changePassword.mockResolvedValue({ kind: "session" });
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		expect(
			await screen.findByRole("heading", { name: "تدوير كلمة المرور" }),
		).toBeTruthy();
		fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
			target: { value: "new-password-12" },
		});
		fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), {
			target: { value: "new-password-12" },
		});
		fireEvent.click(screen.getByRole("button", { name: "تغيير ومتابعة" }));

		await waitFor(() => {
			expect(mocks.changePassword).toHaveBeenCalledWith(
				"ticket-pwd",
				"synthetic-password",
				"new-password-12",
			);
		});
	});

	it("تعيد لخطوة كلمة المرور عند انتهاء التذكرة", async () => {
		mocks.login.mockResolvedValue({
			kind: "mfa",
			ticket: "ticket-1",
			methods: { totp: true, passkey: false },
		});
		mocks.verifyMfa.mockRejectedValue(
			new MockAuthError("MFA_TICKET_EXPIRED", "انتهت التذكرة"),
		);
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");
		await passwordLogin();

		fireEvent.change(await screen.findByLabelText("رمز التطبيق"), {
			target: { value: "123456" },
		});
		fireEvent.click(screen.getByRole("button", { name: "تحقق ودخول" }));

		await waitFor(() => {
			expect(
				screen.getByRole("heading", { name: /الإصدار الثالث/ }),
			).toBeTruthy();
		});
		expect(
			screen.getByText("انتهت مهلة التحقق — أعد إدخال كلمة المرور."),
		).toBeTruthy();
	});

	it("تستعيد كلمة المرور برمز المدير", async () => {
		mocks.resetPassword.mockResolvedValue(undefined);
		render(<AuthGate>{null}</AuthGate>);
		await screen.findByLabelText("اسم المستخدم");

		fireEvent.click(screen.getByRole("button", { name: "نسيت كلمة المرور؟" }));
		fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
			target: { value: "reader" },
		});
		fireEvent.change(screen.getByLabelText("رمز الاسترداد"), {
			target: { value: "RESET-1" },
		});
		fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
			target: { value: "new-password-12" },
		});
		fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور"), {
			target: { value: "new-password-12" },
		});
		fireEvent.click(screen.getByRole("button", { name: "تعيين كلمة المرور" }));

		await waitFor(() => {
			expect(mocks.resetPassword).toHaveBeenCalledWith(
				"reader",
				"RESET-1",
				"new-password-12",
			);
		});
		expect(
			await screen.findByText("تم تعيين كلمة المرور — سجّل الدخول بها الآن."),
		).toBeTruthy();
	});
});
