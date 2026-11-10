import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
	AuthError,
	type AuthOutcome,
	type AuthSession,
	applySession,
	bootstrapSession,
	changePassword,
	confirmMfa,
	login,
	loginWithPasskey,
	type MfaSetup,
	resetPassword,
	setupMfa,
	useAuthState,
	verifyMfa,
} from "../lib/auth";
import { APP_NAME } from "../lib/navigation";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import "./auth-premium.css";

/**
 * بوابة الدخول — نفس سلّم المصادقة في القديم (`frontend/app/js/v2/screens/login.js`):
 * كلمة المرور ← عامل ثانٍ (TOTP/رمز استرداد أو مفتاح مرور) ← تسجيل عاملٍ
 * ثانٍ إلزامي برمز QR ← رموز الاسترداد ← تدوير كلمة مرور إلزامي.
 *
 * كل تذكرة (mfa 5 دقائق، تسجيل 15 دقيقة) تُستهلك عند النجاح؛ انتهاؤها يعيد
 * المستخدم لخطوة كلمة المرور برسالة صريحة بدل تعليقه أمام خطأ غامض.
 */

type Pane = "password" | "mfa" | "enroll" | "codes" | "forgot" | "change";

function messageOf(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

function isTicketExpired(cause: unknown): boolean {
	return (
		cause instanceof AuthError &&
		(cause.code === "MFA_TICKET_EXPIRED" || cause.code === "TOKEN_INVALID")
	);
}

/** Same shared session bootstrap as the legacy app; no authentication changes. */
export function AuthGate({ children }: { children: ReactNode }) {
	const auth = useAuthState();
	const [booting, setBooting] = useState(true);

	useEffect(() => {
		let alive = true;
		void bootstrapSession().finally(() => {
			if (alive) setBooting(false);
		});
		return () => {
			alive = false;
		};
	}, []);

	if (booting) {
		return (
			<div className="grid min-h-screen place-items-center bg-canvas">
				<p role="status" className="text-body-md text-muted">
					جارٍ التحقّق من الجلسة…
				</p>
			</div>
		);
	}
	if (!auth.token) return <LoginScreen />;
	return <>{children}</>;
}

function LoginScreen() {
	const [pane, setPane] = useState<Pane>("password");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [ticket, setTicket] = useState("");
	const [methods, setMethods] = useState({ totp: true, passkey: false });
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const [mfaCode, setMfaCode] = useState("");
	const [recoveryMode, setRecoveryMode] = useState(false);
	const [recoveryCode, setRecoveryCode] = useState("");

	const [enrollment, setEnrollment] = useState<MfaSetup | null>(null);
	const [enrollCode, setEnrollCode] = useState("");
	const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
	const [pendingSession, setPendingSession] = useState<AuthSession | null>(
		null,
	);

	const [forgotCode, setForgotCode] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	async function beginEnrollment(nextTicket: string) {
		setPane("enroll");
		setEnrollment(null);
		setError("");
		setBusy(true);
		try {
			setEnrollment(await setupMfa(nextTicket));
		} catch (cause) {
			if (isTicketExpired(cause)) {
				backToPassword("انتهت مهلة التسجيل — أعد إدخال كلمة المرور.");
				return;
			}
			setError(messageOf(cause, "تعذّر تجهيز تسجيل المصادقة الثنائية"));
		} finally {
			setBusy(false);
		}
	}

	function handleOutcome(outcome: AuthOutcome) {
		switch (outcome.kind) {
			case "session":
				// `useAuthState` يرى التوكن فتنتقل البوابة إلى التطبيق.
				setPassword("");
				setMfaCode("");
				setRecoveryCode("");
				return;
			case "mfa":
				setTicket(outcome.ticket);
				setMethods(outcome.methods);
				setNotice(
					outcome.message ?? "أدخل رمز المصادقة الثنائية لإكمال الدخول.",
				);
				setError("");
				setPane("mfa");
				return;
			case "enroll":
				setTicket(outcome.ticket);
				setNotice("");
				void beginEnrollment(outcome.ticket);
				return;
			case "password_change":
				setTicket(outcome.ticket);
				setNotice(
					outcome.message ??
						"كلمة المرور الحالية يجب تدويرها قبل الدخول إلى مساحة العمل.",
				);
				setError("");
				setPane("change");
				return;
		}
	}

	function backToPassword(message: string) {
		setPane("password");
		setTicket("");
		setMethods({ totp: true, passkey: false });
		setEnrollment(null);
		setEnrollCode("");
		setRecoveryCodes([]);
		setPendingSession(null);
		setMfaCode("");
		setRecoveryCode("");
		setNotice(message);
		setError("");
		setBusy(false);
	}

	async function onLogin(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}
		setBusy(true);
		setError("");
		setNotice("");
		try {
			handleOutcome(await login(username.trim(), password));
		} catch (cause) {
			setError(messageOf(cause, "تعذّر تسجيل الدخول"));
		} finally {
			setBusy(false);
		}
	}

	async function onVerifyMfa() {
		if (busy) {
			return;
		}
		const code = mfaCode.trim();
		const recovery = recoveryCode.trim();
		if (recoveryMode ? recovery === "" : !/^\d{6}$/.test(code)) {
			setError(
				recoveryMode
					? "أدخل رمز الاسترداد كما ظهر عند التسجيل"
					: "الرمز مكوّن من 6 أرقام",
			);
			return;
		}
		setBusy(true);
		setError("");
		try {
			await verifyMfa(
				ticket,
				recoveryMode ? { recoveryCode: recovery } : { code },
			);
		} catch (cause) {
			if (isTicketExpired(cause)) {
				backToPassword("انتهت مهلة التحقق — أعد إدخال كلمة المرور.");
				return;
			}
			setError(messageOf(cause, "تعذّر التحقق من الرمز — حاول مجددًا"));
		} finally {
			setBusy(false);
		}
	}

	async function onPasskey() {
		if (busy) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			await loginWithPasskey(ticket);
		} catch (cause) {
			if (isTicketExpired(cause)) {
				backToPassword("انتهت مهلة التحقق — أعد إدخال كلمة المرور.");
				return;
			}
			setError(messageOf(cause, "تعذّر التحقق بالجهاز — حاول مجددًا"));
		} finally {
			setBusy(false);
		}
	}

	async function onConfirmEnrollment() {
		if (busy) {
			return;
		}
		const code = enrollCode.trim();
		if (!/^\d{6}$/.test(code)) {
			setError("أدخل الرمز الظاهر في التطبيق (6 أرقام)");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await confirmMfa(ticket, code);
			setPendingSession(result.session);
			setRecoveryCodes(result.recoveryCodes);
			setNotice("");
			setPane("codes");
		} catch (cause) {
			if (isTicketExpired(cause)) {
				backToPassword("انتهت مهلة التسجيل — أعد إدخال كلمة المرور.");
				return;
			}
			setError(
				messageOf(cause, "تعذّر تأكيد الرمز — تحقّق من ساعة الجهاز وحاول مجددًا"),
			);
		} finally {
			setBusy(false);
		}
	}

	function enterAfterCodes() {
		if (!pendingSession) {
			backToPassword("تعذّر إكمال الجلسة — أعد تسجيل الدخول.");
			return;
		}
		applySession(pendingSession);
		setPassword("");
		setPendingSession(null);
		setRecoveryCodes([]);
	}

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(recoveryCodes.join("\n"));
			setNotice("تم نسخ رموز الاسترداد — احفظها في مكان آمن.");
		} catch {
			setNotice("تعذّر النسخ التلقائي — انسخ الرموز يدويًا.");
		}
	}

	async function onForgot(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}
		if (newPassword !== confirmPassword) {
			setError("كلمتا المرور غير متطابقتين");
			return;
		}
		setBusy(true);
		setError("");
		try {
			await resetPassword(username.trim(), forgotCode.trim(), newPassword);
			setPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setForgotCode("");
			setPane("password");
			setNotice("تم تعيين كلمة المرور — سجّل الدخول بها الآن.");
		} catch (cause) {
			setError(messageOf(cause, "تعذّر تغيير كلمة المرور — تحقّق من الرمز"));
		} finally {
			setBusy(false);
		}
	}

	async function onChangePassword(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			return;
		}
		if (newPassword !== confirmPassword) {
			setError("كلمتا المرور غير متطابقتين");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const outcome = await changePassword(ticket, password, newPassword);
			setNewPassword("");
			setConfirmPassword("");
			handleOutcome(outcome);
		} catch (cause) {
			if (isTicketExpired(cause)) {
				backToPassword("انتهت جلسة تدوير كلمة المرور — أعد تسجيل الدخول.");
				return;
			}
			setError(messageOf(cause, "تعذّر تغيير كلمة المرور"));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="erp-login" dir="rtl">
			<aside className="erp-login__story" aria-label="عن النظام">
				<div className="erp-login__brand">
					<span className="erp-login__mark" aria-hidden="true">
						<svg
							aria-hidden="true"
							focusable="false"
							viewBox="0 0 24 24"
							width="28"
							height="28"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.3"
						>
							<path d="M5 19V5h14v14H5Z M9 19V9h6v10 M5 13h4 M15 13h4" />
							<path d="M3 21h18 M8 3h8" />
						</svg>
					</span>
					<span>{APP_NAME}</span>
				</div>
				<div className="erp-login__intro">
					<div className="erp-login__eyebrow" lang="en" dir="ltr">
						KARIM / ENTERPRISE RESOURCE PLANNING
					</div>
					<h2>
						تفاصيل أكثر وضوحًا.
						<br />
						قرارات أكثر ثقة.
					</h2>
					<p>
						المحاسبة والمخزون والموارد البشرية في مساحة عمل واحدة. مصمّمة لتفاصيل
						يومك.
					</p>
				</div>
				<p className="erp-login__footer">ليل الياقوت · نظام إدارة المطاعم</p>
			</aside>
			<main className="erp-login__form-area">
				<section className="erp-login__form" aria-live="polite">
					{pane === "password" ? (
						<form onSubmit={onLogin} aria-busy={busy}>
							<PaneHeader
								eyebrow="YOUR WORKSPACE"
								title="Karim ERP — الإصدار الثالث"
								subtitle="سجّل الدخول إلى مساحة عملك باستخدام حساب المنشأة."
							/>
							<div className="mt-lg flex flex-col gap-md">
								<Input
									id="erp-v3-username"
									label="اسم المستخدم"
									name="username"
									autoComplete="username"
									autoCapitalize="none"
									spellCheck={false}
									value={username}
									onChange={(event) => setUsername(event.target.value)}
									size="lg"
									disabled={busy}
								/>
								<Input
									id="erp-v3-password"
									label="كلمة المرور"
									name="password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									size="lg"
									disabled={busy}
								/>
							</div>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button type="submit" size="lg" fullWidth loading={busy}>
									{busy ? "جارٍ الدخول…" : "دخول"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="md"
									fullWidth
									disabled={busy}
									onClick={() => {
										setError("");
										setNotice("");
										setPane("forgot");
									}}
								>
									نسيت كلمة المرور؟
								</Button>
							</div>
							<p className="erp-login__note">
								صلاحياتك تحدّد الشاشات والإجراءات المتاحة لك. لإدارة حسابك، تواصل
								مع مسؤول النظام.
							</p>
						</form>
					) : null}

					{pane === "mfa" ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void onVerifyMfa();
							}}
							aria-busy={busy}
						>
							<PaneHeader
								eyebrow="SECOND FACTOR"
								title="خطوة التحقق الثانية"
								subtitle="حسابك محمي بمصادقة ثنائية. أكمل التحقق للمتابعة."
							/>
							<div className="mt-lg flex flex-col gap-md">
								{recoveryMode ? (
									<Input
										id="erp-v3-recovery"
										label="رمز الاسترداد"
										name="recovery"
										autoComplete="one-time-code"
										autoCapitalize="none"
										spellCheck={false}
										value={recoveryCode}
										onChange={(event) => setRecoveryCode(event.target.value)}
										size="lg"
										disabled={busy}
										hint="أدخله كما ظهر عند التسجيل — كل رمز يعمل مرة واحدة."
									/>
								) : (
									<Input
										id="erp-v3-mfa"
										label="رمز التطبيق"
										name="code"
										inputMode="numeric"
										autoComplete="one-time-code"
										maxLength={6}
										value={mfaCode}
										onChange={(event) =>
											setMfaCode(
												event.target.value.replace(/\D/g, "").slice(0, 6),
											)
										}
										size="lg"
										disabled={busy}
										hint="6 أرقام من تطبيق المصادقة — تتغيّر كل 30 ثانية."
									/>
								)}
							</div>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button type="submit" size="lg" fullWidth loading={busy}>
									تحقق ودخول
								</Button>
								{methods.passkey ? (
									<Button
										type="button"
										variant="secondary"
										size="lg"
										fullWidth
										disabled={busy || recoveryMode}
										onClick={() => void onPasskey()}
									>
										الدخول بالبصمة أو Face ID
									</Button>
								) : null}
								{methods.totp ? (
									<Button
										type="button"
										variant="ghost"
										size="md"
										fullWidth
										disabled={busy}
										onClick={() => {
											setRecoveryMode((current) => !current);
											setError("");
										}}
									>
										{recoveryMode
											? "استخدام رمز التطبيق"
											: "استخدام رمز استرداد"}
									</Button>
								) : null}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									fullWidth
									disabled={busy}
									onClick={() => backToPassword("")}
								>
									العودة لتسجيل الدخول
								</Button>
							</div>
						</form>
					) : null}

					{pane === "enroll" ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void onConfirmEnrollment();
							}}
							aria-busy={busy}
						>
							<PaneHeader
								eyebrow="ENROLLMENT"
								title="تسجيل المصادقة الثنائية"
								subtitle="إدارة المنشأة تطلب عاملًا ثانيًا. امسح رمز QR بتطبيق المصادقة ثم أدخل الرمز الظاهر."
							/>
							<div className="mt-lg flex flex-col gap-md">
								<div className="grid place-items-center rounded-md border border-hairline-strong bg-surface p-md">
									{enrollment?.qrDataUrl ? (
										<img
											src={enrollment.qrDataUrl}
											alt="رمز QR لتسجيل المصادقة الثنائية"
											width={200}
											height={200}
										/>
									) : (
										<p role="status" className="text-body-sm text-muted">
											{busy
												? "جارٍ تجهيز رمز QR…"
												: "تعذّر تجهيز رمز QR — استخدم المفتاح اليدوي."}
										</p>
									)}
								</div>
								{enrollment ? (
									<div className="flex flex-col gap-xs">
										<span className="text-caption text-muted">
											أو أدخل المفتاح يدويًا:
										</span>
										<code
											className="select-all break-all rounded-sm bg-surface-sunken p-xs font-mono text-body-sm text-ink"
											dir="ltr"
										>
											{enrollment.secret}
										</code>
									</div>
								) : null}
								<Input
									id="erp-v3-enroll-code"
									label="رمز التطبيق"
									name="code"
									inputMode="numeric"
									autoComplete="one-time-code"
									maxLength={6}
									value={enrollCode}
									onChange={(event) =>
										setEnrollCode(
											event.target.value.replace(/\D/g, "").slice(0, 6),
										)
									}
									size="lg"
									disabled={busy || !enrollment}
								/>
							</div>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button
									type="submit"
									size="lg"
									fullWidth
									loading={busy}
									disabled={!enrollment}
								>
									تأكيد التسجيل
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									fullWidth
									disabled={busy}
									onClick={() => backToPassword("")}
								>
									العودة لتسجيل الدخول
								</Button>
							</div>
						</form>
					) : null}

					{pane === "codes" ? (
						<div>
							<PaneHeader
								eyebrow="RECOVERY CODES"
								title="احفظ رموز الاسترداد"
								subtitle="تُعرض مرة واحدة فقط. كل رمز يصلح للدخول مرة واحدة بدل رمز التطبيق."
							/>
							<ol className="mt-lg grid grid-cols-2 gap-xs" dir="ltr">
								{recoveryCodes.map((code) => (
									<li
										key={code}
										className="rounded-sm border border-hairline bg-surface px-xs py-xxs text-center font-mono text-body-sm text-ink"
									>
										{code}
									</li>
								))}
							</ol>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button
									type="button"
									variant="secondary"
									size="md"
									fullWidth
									onClick={() => void copyCodes()}
								>
									نسخ الرموز
								</Button>
								<Button
									type="button"
									size="lg"
									fullWidth
									onClick={enterAfterCodes}
								>
									حفظتها — دخول
								</Button>
							</div>
						</div>
					) : null}

					{pane === "forgot" ? (
						<form onSubmit={onForgot} aria-busy={busy}>
							<PaneHeader
								eyebrow="ACCOUNT RECOVERY"
								title="استعادة كلمة المرور"
								subtitle="اطلب رمز استرداد من مسؤول النظام، ثم عيّن كلمة مرور جديدة."
							/>
							<div className="mt-lg flex flex-col gap-md">
								<Input
									id="erp-v3-forgot-username"
									label="اسم المستخدم"
									name="username"
									autoComplete="username"
									autoCapitalize="none"
									spellCheck={false}
									value={username}
									onChange={(event) => setUsername(event.target.value)}
									size="lg"
									disabled={busy}
								/>
								<Input
									id="erp-v3-forgot-code"
									label="رمز الاسترداد"
									name="code"
									autoComplete="one-time-code"
									autoCapitalize="none"
									spellCheck={false}
									value={forgotCode}
									onChange={(event) => setForgotCode(event.target.value)}
									size="lg"
									disabled={busy}
								/>
								<Input
									id="erp-v3-forgot-password"
									label="كلمة المرور الجديدة"
									name="new_password"
									type="password"
									autoComplete="new-password"
									value={newPassword}
									onChange={(event) => setNewPassword(event.target.value)}
									size="lg"
									disabled={busy}
								/>
								<Input
									id="erp-v3-forgot-confirm"
									label="تأكيد كلمة المرور"
									name="confirm_password"
									type="password"
									autoComplete="new-password"
									value={confirmPassword}
									onChange={(event) => setConfirmPassword(event.target.value)}
									size="lg"
									disabled={busy}
								/>
							</div>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button type="submit" size="lg" fullWidth loading={busy}>
									تعيين كلمة المرور
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									fullWidth
									disabled={busy}
									onClick={() => {
										setError("");
										setNotice("");
										setNewPassword("");
										setConfirmPassword("");
										setForgotCode("");
										setPane("password");
									}}
								>
									العودة لتسجيل الدخول
								</Button>
							</div>
						</form>
					) : null}

					{pane === "change" ? (
						<form onSubmit={onChangePassword} aria-busy={busy}>
							<PaneHeader
								eyebrow="PASSWORD ROTATION"
								title="تدوير كلمة المرور"
								subtitle="كلمة مرورك الحالية انتهت صلاحيتها أو تحتاج تغييرًا إلزاميًا. عيّن كلمة مرور جديدة قبل المتابعة."
							/>
							<div className="mt-lg flex flex-col gap-md">
								<Input
									id="erp-v3-change-password"
									label="كلمة المرور الجديدة"
									name="new_password"
									type="password"
									autoComplete="new-password"
									value={newPassword}
									onChange={(event) => setNewPassword(event.target.value)}
									size="lg"
									disabled={busy}
								/>
								<Input
									id="erp-v3-change-confirm"
									label="تأكيد كلمة المرور"
									name="confirm_password"
									type="password"
									autoComplete="new-password"
									value={confirmPassword}
									onChange={(event) => setConfirmPassword(event.target.value)}
									size="lg"
									disabled={busy}
								/>
							</div>
							<PaneAlerts error={error} notice={notice} />
							<div className="mt-lg flex flex-col gap-sm">
								<Button type="submit" size="lg" fullWidth loading={busy}>
									تغيير ومتابعة
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									fullWidth
									disabled={busy}
									onClick={() => backToPassword("")}
								>
									العودة لتسجيل الدخول
								</Button>
							</div>
						</form>
					) : null}
				</section>
			</main>
		</div>
	);
}

function PaneHeader({
	eyebrow,
	title,
	subtitle,
}: {
	eyebrow: string;
	title: string;
	subtitle: string;
}) {
	return (
		<header>
			<p className="erp-page-header__eyebrow" lang="en" dir="ltr">
				{eyebrow}
			</p>
			<h1 className="text-ink">{title}</h1>
			<p className="erp-login__subtitle">{subtitle}</p>
		</header>
	);
}

function PaneAlerts({ error, notice }: { error: string; notice: string }) {
	return (
		<>
			{error ? (
				<p
					role="alert"
					className="mt-md rounded-md border border-danger/30 bg-danger-soft p-sm text-body-sm text-danger-text"
				>
					{error}
					<span className="mt-xs block text-caption">
						تأكد من بياناتك، أو تواصل مع مسؤول النظام إذا تكرّر الخطأ.
					</span>
				</p>
			) : null}
			{!error && notice ? (
				<p
					role="status"
					className="mt-md rounded-md border border-hairline-strong bg-surface p-sm text-body-sm text-ink-secondary"
				>
					{notice}
				</p>
			) : null}
		</>
	);
}
