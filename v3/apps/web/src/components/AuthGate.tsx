import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
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
    refreshSession,
    resetPassword,
    setupMfa,
    useAuthState,
    verifyMfa,
} from '../lib/auth';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './auth-premium.css';

/**
 * بوابة الدخول — نفس سلّم المصادقة في القديم (`frontend/app/js/v2/screens/login.js`):
 * كلمة المرور ← عامل ثانٍ (TOTP/رمز استرداد أو مفتاح مرور) ← تسجيل عاملٍ
 * ثانٍ إلزامي برمز QR ← رموز الاسترداد ← تدوير كلمة مرور إلزامي.
 *
 * كل تذكرة (mfa 5 دقائق، تسجيل 15 دقيقة) تُستهلك عند النجاح؛ انتهاؤها يعيد
 * المستخدم لخطوة كلمة المرور برسالة صريحة بدل تعليقه أمام خطأ غامض.
 */

type Pane = 'password' | 'mfa' | 'enroll' | 'codes' | 'forgot' | 'change';
const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

function messageOf(cause: unknown, fallback: string): string {
    return cause instanceof Error && cause.message ? cause.message : fallback;
}

function isTicketExpired(cause: unknown): boolean {
    return cause instanceof AuthError && (cause.code === 'MFA_TICKET_EXPIRED' || cause.code === 'TOKEN_INVALID');
}

/** Same shared session bootstrap as the legacy app; no authentication changes. */
export function AuthGate({ children, kiosk = false }: { children: ReactNode; kiosk?: boolean }) {
    const auth = useAuthState();
    const [booting, setBooting] = useState(true);
    const authenticated = Boolean(auth.token);

    useEffect(() => {
        let alive = true;
        void bootstrapSession().finally(() => {
            if (alive) setBooting(false);
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (!authenticated) return;

        let lastActivityAt = Date.now();
        let lastRefreshAttemptAt = Date.now();
        let refreshing = false;

        const refresh = () => {
            if (refreshing) return;
            refreshing = true;
            lastRefreshAttemptAt = Date.now();
            void refreshSession().finally(() => {
                refreshing = false;
            });
        };
        const markActivity = () => {
            const now = Date.now();
            lastActivityAt = now;
            if (now - lastRefreshAttemptAt >= SESSION_REFRESH_INTERVAL_MS) refresh();
        };
        const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'input'] as const;
        for (const event of activityEvents) {
            window.addEventListener(event, markActivity, { passive: true });
        }
        const timer = window.setInterval(() => {
            const now = Date.now();
            if (
                document.visibilityState === 'visible' &&
                now - lastActivityAt <= SESSION_ACTIVITY_WINDOW_MS &&
                now - lastRefreshAttemptAt >= SESSION_REFRESH_INTERVAL_MS
            ) {
                refresh();
            }
        }, SESSION_REFRESH_INTERVAL_MS);

        return () => {
            window.clearInterval(timer);
            for (const event of activityEvents) {
                window.removeEventListener(event, markActivity);
            }
        };
    }, [authenticated]);

    if (booting) {
        return (
            <div className="grid min-h-screen place-items-center bg-canvas">
                <p role="status" className="text-body-md text-muted">
                    جارٍ التحقّق من الجلسة…
                </p>
            </div>
        );
    }
    if (!auth.token) return <LoginScreen kiosk={kiosk} />;
    return <>{children}</>;
}

function LoginScreen({ kiosk = false }: { kiosk?: boolean }) {
    const [pane, setPane] = useState<Pane>('password');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [ticket, setTicket] = useState('');
    const [methods, setMethods] = useState({ totp: true, passkey: false });
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const [mfaCode, setMfaCode] = useState('');
    const [recoveryMode, setRecoveryMode] = useState(false);
    const [recoveryCode, setRecoveryCode] = useState('');

    const [enrollment, setEnrollment] = useState<MfaSetup | null>(null);
    const [enrollCode, setEnrollCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
    const [pendingSession, setPendingSession] = useState<AuthSession | null>(null);

    const [forgotCode, setForgotCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    async function beginEnrollment(nextTicket: string) {
        setPane('enroll');
        setEnrollment(null);
        setError('');
        setBusy(true);
        try {
            setEnrollment(await setupMfa(nextTicket));
        } catch (cause) {
            if (isTicketExpired(cause)) {
                backToPassword('انتهت مهلة التسجيل — أعد إدخال كلمة المرور.');
                return;
            }
            setError(messageOf(cause, 'تعذّر تجهيز تسجيل المصادقة الثنائية'));
        } finally {
            setBusy(false);
        }
    }

    function handleOutcome(outcome: AuthOutcome) {
        switch (outcome.kind) {
            case 'session':
                // `useAuthState` يرى التوكن فتنتقل البوابة إلى التطبيق.
                setPassword('');
                setMfaCode('');
                setRecoveryCode('');
                return;
            case 'mfa':
                setTicket(outcome.ticket);
                setMethods(outcome.methods);
                setNotice(outcome.message ?? 'أدخل رمز المصادقة الثنائية لإكمال الدخول.');
                setError('');
                setPane('mfa');
                return;
            case 'enroll':
                setTicket(outcome.ticket);
                setNotice('');
                void beginEnrollment(outcome.ticket);
                return;
            case 'password_change':
                setTicket(outcome.ticket);
                setNotice(outcome.message ?? 'كلمة المرور الحالية يجب تدويرها قبل الدخول إلى مساحة العمل.');
                setError('');
                setPane('change');
                return;
        }
    }

    function backToPassword(message: string) {
        setPane('password');
        setTicket('');
        setMethods({ totp: true, passkey: false });
        setEnrollment(null);
        setEnrollCode('');
        setRecoveryCodes([]);
        setPendingSession(null);
        setMfaCode('');
        setRecoveryCode('');
        setNotice(message);
        setError('');
        setBusy(false);
    }

    async function onLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) {
            return;
        }
        setBusy(true);
        setError('');
        setNotice('');
        try {
            handleOutcome(await login(username.trim(), password));
        } catch (cause) {
            setError(messageOf(cause, 'تعذّر تسجيل الدخول'));
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
        if (recoveryMode ? recovery === '' : !/^\d{6}$/.test(code)) {
            setError(recoveryMode ? 'أدخل رمز الاسترداد كما ظهر عند التسجيل' : 'الرمز مكوّن من 6 أرقام');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await verifyMfa(ticket, recoveryMode ? { recoveryCode: recovery } : { code });
        } catch (cause) {
            if (isTicketExpired(cause)) {
                backToPassword('انتهت مهلة التحقق — أعد إدخال كلمة المرور.');
                return;
            }
            setError(messageOf(cause, 'تعذّر التحقق من الرمز — حاول مجددًا'));
        } finally {
            setBusy(false);
        }
    }

    async function onPasskey() {
        if (busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await loginWithPasskey(ticket);
        } catch (cause) {
            if (isTicketExpired(cause)) {
                backToPassword('انتهت مهلة التحقق — أعد إدخال كلمة المرور.');
                return;
            }
            setError(messageOf(cause, 'تعذّر التحقق بالجهاز — حاول مجددًا'));
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
            setError('أدخل الرمز الظاهر في التطبيق (6 أرقام)');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await confirmMfa(ticket, code);
            setPendingSession(result.session);
            setRecoveryCodes(result.recoveryCodes);
            setNotice('');
            setPane('codes');
        } catch (cause) {
            if (isTicketExpired(cause)) {
                backToPassword('انتهت مهلة التسجيل — أعد إدخال كلمة المرور.');
                return;
            }
            setError(messageOf(cause, 'تعذّر تأكيد الرمز — تحقّق من ساعة الجهاز وحاول مجددًا'));
        } finally {
            setBusy(false);
        }
    }

    function enterAfterCodes() {
        if (!pendingSession) {
            backToPassword('تعذّر إكمال الجلسة — أعد تسجيل الدخول.');
            return;
        }
        applySession(pendingSession);
        setPassword('');
        setPendingSession(null);
        setRecoveryCodes([]);
    }

    async function copyCodes() {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join('\n'));
            setNotice('تم نسخ رموز الاسترداد — احفظها في مكان آمن.');
        } catch {
            setNotice('تعذّر النسخ التلقائي — انسخ الرموز يدويًا.');
        }
    }

    async function onForgot(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) {
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('كلمتا المرور غير متطابقتين');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await resetPassword(username.trim(), forgotCode.trim(), newPassword);
            setPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setForgotCode('');
            setPane('password');
            setNotice('تم تعيين كلمة المرور — سجّل الدخول بها الآن.');
        } catch (cause) {
            setError(messageOf(cause, 'تعذّر تغيير كلمة المرور — تحقّق من الرمز'));
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
            setError('كلمتا المرور غير متطابقتين');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const outcome = await changePassword(ticket, password, newPassword);
            setNewPassword('');
            setConfirmPassword('');
            handleOutcome(outcome);
        } catch (cause) {
            if (isTicketExpired(cause)) {
                backToPassword('انتهت جلسة تدوير كلمة المرور — أعد تسجيل الدخول.');
                return;
            }
            setError(messageOf(cause, 'تعذّر تغيير كلمة المرور'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className={`erp-login${kiosk ? ' erp-login--kiosk' : ' erp-login--luxe-flat'}`} dir="rtl">
            {kiosk ? (
                <main className="erp-login__form-area">
                    <div className="erp-login__kiosk-brand">
                        <span className="erp-login__kiosk-mark" aria-hidden="true">K</span>
                        <span>Karim POS</span>
                    </div>
                    <section className="erp-login__form" aria-live="polite">
                        {pane === 'password' ? (
                            <form onSubmit={onLogin} aria-busy={busy}>
                                <PaneHeader
                                    eyebrow="CASHIER ACCESS"
                                    title="دخول الكاشير"
                                    subtitle="سجّل الدخول بحساب الكاشير لبدء الوردية. لا تظهر هنا إلا بيانات الكاشير."
                                />
                                <div className="mt-lg flex flex-col gap-md">
                                    <Input id="erp-v3-username" label="اسم المستخدم" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-password" label="كلمة المرور" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} size="lg" disabled={busy} />
                                </div>
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</Button>
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => { setError(''); setNotice(''); setPane('forgot'); }}>نسيت كلمة المرور؟</Button>
                                </div>
                                <p className="erp-login__note">سجّل بحساب خاص بالكاشير. لإدارة الحساب، تواصل مع مسؤول النظام.</p>
                            </form>
                        ) : null}
                        {pane === 'mfa' ? (
                            <form onSubmit={(event) => { event.preventDefault(); void onVerifyMfa(); }} aria-busy={busy}>
                                <PaneHeader eyebrow="SECOND FACTOR" title="خطوة التحقق الثانية" subtitle="حسابك محمي بمصادقة ثنائية. أكمل التحقق للمتابعة." />
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg flex flex-col gap-md">
                                    {recoveryMode ? (
                                        <Input id="erp-v3-recovery" label="رمز الاسترداد" name="recovery" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} size="lg" disabled={busy} hint="أدخله كما ظهر عند التسجيل — كل رمز يعمل مرة واحدة." />
                                    ) : (
                                        <Input id="erp-v3-mfa" label="رمز التطبيق" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} size="lg" disabled={busy} hint="6 أرقام من تطبيق المصادقة — تتغيّر كل 30 ثانية." />
                                    )}
                                </div>
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>تحقق ودخول</Button>
                                    {methods.passkey ? (
                                        <Button type="button" variant="secondary" size="lg" fullWidth disabled={busy || recoveryMode} onClick={() => void onPasskey()}>
                                            الدخول بالبصمة أو Face ID
                                        </Button>
                                    ) : null}
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => { setRecoveryMode((current) => !current); setError(''); }}>{recoveryMode ? 'استخدام رمز التطبيق' : 'استخدام رمز استرداد'}</Button>
                                    <Button type="button" variant="ghost" size="sm" fullWidth disabled={busy} onClick={() => backToPassword('')}>العودة لتسجيل الدخول</Button>
                                </div>
                            </form>
                        ) : null}
                        {pane === 'forgot' ? (
                            <form onSubmit={onForgot} aria-busy={busy}>
                                <PaneHeader eyebrow="ACCOUNT RECOVERY" title="استرجاع كلمة المرور" subtitle="اطلب رابطًا عبر مدير النظام — لاحقًا استقبل رمز مرة واحدة." />
                                <div className="mt-lg flex flex-col gap-md">
                                    <Input id="erp-v3-forgot-username" label="اسم المستخدم" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-forgotcode" label="رمز الاسترداد" name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={forgotCode} onChange={(event) => setForgotCode(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-newpassword" label="كلمة المرور الجديدة" name="newpassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-confirmpassword" label="تأكيد كلمة المرور" name="confirmpassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} size="lg" disabled={busy} />
                                </div>
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التحقق…' : 'تعيين كلمة المرور'}</Button>
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>إلغاء</Button>
                                </div>
                            </form>
                        ) : null}
                        {pane === 'enroll' ? (
                            <form onSubmit={(event) => { event.preventDefault(); void onConfirmEnrollment(); }} aria-busy={busy}>
                                <PaneHeader eyebrow="ENROLLMENT" title="تسجيل المصادقة الثنائية" subtitle="إدارة المنشأة تطلب عاملًا ثانيًا. امسح رمز QR بتطبيق المصادقة ثم أدخل الرمز الظاهر." />
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg grid place-items-center rounded-md border border-hairline-strong bg-surface p-md">{enrollment ? <img src={enrollment.qrDataUrl ?? undefined} alt="رمز QR لتسجيل المصادقة الثنائية" width={200} height={200} /> : <p className="text-body-sm text-muted">جارٍ توليد الرمز…</p>}</div>
                                <div className="mt-lg flex flex-col gap-md">
                                    <Input id="erp-v3-enrollcode" label="رمز التطبيق" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={enrollCode} onChange={(event) => setEnrollCode(event.target.value.replace(/\D/g, '').slice(0, 6))} size="lg" disabled={busy} hint="6 أرقام من تطبيق المصادقة" />
                                </div>
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التحقق…' : 'تأكيد التسجيل'}</Button>
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>تأجيل</Button>
                                </div>
                            </form>
                        ) : null}
                        {pane === 'change' ? (
                            <form onSubmit={onChangePassword} aria-busy={busy}>
                                <PaneHeader eyebrow="PASSWORD CHANGE" title="تدوير كلمة المرور" subtitle="يجب تغيير كلمة المرور وفق طلب المنشأة. أكّد التغيير للمتابعة." />
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg flex flex-col gap-md">
                                    <Input id="erp-v3-change-current" label="كلمة المرور" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-change-new" label="كلمة المرور الجديدة" name="newpassword" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-change-confirm" label="تأكيد كلمة المرور" name="confirmpassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} size="lg" disabled={busy} />
                                </div>
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التغيير…' : 'تغيير ومتابعة'}</Button>
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>رجوع</Button>
                                </div>
                            </form>
                        ) : null}
                        {pane === 'codes' ? (
                            <section aria-labelledby="erp-v3-codes-title">
                                <PaneHeader eyebrow="RECOVERY CODES" title="احفظ رموز الاسترداد" subtitle="احفظ هذه الرموز في مكان آمن — كل رمز يعمل مرة واحدة فقط." />
                                <ol className="mt-lg grid grid-cols-1 gap-sm sm:grid-cols-2">{recoveryCodes.map((code, index) => <li key={index} className="rounded-md border border-hairline bg-surface-sunken p-sm font-mono text-center text-body-md" dir="ltr">{code}</li>)}</ol>
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="button" variant="secondary" fullWidth onClick={() => void copyCodes()}>نسخ الرموز</Button>
                                        <Button type="button" fullWidth onClick={enterAfterCodes}>حفظتها — دخول</Button>
                                </div>
                            </section>
                        ) : null}
                    </section>
                </main>
            ) : (
                /* ── صفحة الدخول الفخامة — خانة واحدة واسعة، حتى الشعارات لا تُحجر ── */
                <main className="erp-login__luxe-flat" aria-label="تسجيل الدخول">
                    <div className="erp-luxe-eyebrow-bar">
                        <span>KARIM ERP · YOUR WORKSPACE · Riyadh 2026</span>
                        <span className="erp-luxe-toprail" lang="en" dir="ltr">AL SHURFA AL ALAMI</span>
                    </div>
                    <div className="erp-luxe-outer" aria-hidden="true" />
                    <section className="erp-luxe-hero">
                        <img className="erp-luxe-logo" src="/app/assets/karim-logo.png" alt="مطاعم الشرفة العالمي — AL SHURFA AL ALAMI RESTAURANTS" loading="eager" decoding="sync" width={280} height={280} />
                        <p className="erp-luxe-brand-cloud" lang="en" dir="ltr">AL SHURFA AL ALAMI · RESTAURANTS GROUP</p>
                        <span className="erp-luxe-rule" aria-hidden="true" />
                        <p className="erp-luxe-h1">تفاصيل <em>أكثر وضوحًا.</em><br />قرارات <em>أكثر ثقة.</em></p>
                        <p className="erp-luxe-sub">كل تفاصيل يومك — من الكاشير والبصمة إلى الحسابات والمخزون — في مكان واحد، بأعلى معايير الاحترافية.</p>
                        <div className="erp-luxe-chips">
                            <span>٧ فروع بالسعودية</span>
                            <span>فواتير إلكترونية</span>
                            <span>بصمة + Face ID</span>
                            <span>تقارير KPIs</span>
                        </div>
                    </section>
                    <section className="erp-luxe-shellgrid">
                        <aside className="erp-luxe-story">
                            <p className="erp-luxe-story-eyebrow" lang="en" dir="ltr">ABOUT THE SYSTEM</p>
                            <h2>لاحظ كل شيء في لمحة واحدة — بدون وش وراء شاشات متعددة.</h2>
                            <p>من الكاشير والبصمة للرواتب والمخزون — كل قرار مدير مطاعم يثق في نظام متكامل، أكثر رقمية من أي يوم سبق.</p>
                        </aside>
                        <section className="erp-login__form erp-login__form--luxe-card" aria-live="polite">
                            {pane === 'password' ? (
                                <form onSubmit={onLogin} aria-busy={busy}>
                                    <PaneHeader eyebrow="YOUR WORKSPACE" title="Karim ERP — الإصدار الثالث" subtitle="سجّل الدخول إلى مساحة عملك باستخدام حساب المنشأة." />
                                    <div className="mt-lg flex flex-col gap-md">
                                        <Input id="erp-v3-username" label="اسم المستخدم" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} size="lg" disabled={busy} />
                                        <Input id="erp-v3-password" label="كلمة المرور" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} size="lg" disabled={busy} />
                                    </div>
                                    <PaneAlerts error={error} notice={notice} />
                                    <div className="mt-lg flex flex-col gap-sm">
                                        <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</Button>
                                        <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => { setError(''); setNotice(''); setPane('forgot'); }}>نسيت كلمة المرور؟</Button>
                                    </div>
                                    <p className="erp-login__note">صلاحياتك تحدّد الشاشات والإجراءات المتاحة لك. لإدارة حسابك، تواصل مع مسؤول النظام.</p>
                                </form>
                            ) : null}
                            {pane === 'mfa' ? (
                                <form onSubmit={(event) => { event.preventDefault(); void onVerifyMfa(); }} aria-busy={busy}>
                                    <PaneHeader eyebrow="SECOND FACTOR" title="خطوة التحقق الثانية" subtitle="حسابك محمي بمصادقة ثنائية. أكمل التحقق للمتابعة." />
                                    <PaneAlerts error={error} notice={notice} />
                                    <div className="mt-lg flex flex-col gap-md">
                                        {recoveryMode ? (
                                            <Input id="erp-v3-recovery" label="رمز الاسترداد" name="recovery" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} size="lg" disabled={busy} hint="أدخله كما ظهر عند التسجيل — كل رمز يعمل مرة واحدة." />
                                        ) : (
                                            <Input id="erp-v3-mfa" label="رمز التطبيق" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} size="lg" disabled={busy} hint="6 أرقام من تطبيق المصادقة — تتغيّر كل 30 ثانية." />
                                        )}
                                    </div>
                                    <div className="mt-lg flex flex-col gap-sm">
                                        <Button type="submit" size="lg" fullWidth loading={busy}>تحقق ودخول</Button>
                                    {methods.passkey ? (
                                        <Button type="button" variant="secondary" size="lg" fullWidth disabled={busy || recoveryMode} onClick={() => void onPasskey()}>
                                            الدخول بالبصمة أو Face ID
                                        </Button>
                                    ) : null}
                                        <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => { setRecoveryMode((current) => !current); setError(''); }}>{recoveryMode ? 'استخدام رمز التطبيق' : 'استخدام رمز استرداد'}</Button>
                                        <Button type="button" variant="ghost" size="sm" fullWidth disabled={busy} onClick={() => backToPassword('')}>العودة لتسجيل الدخول</Button>
                                    </div>
                                </form>
                            ) : null}
                            {pane === 'forgot' ? (
                                <form onSubmit={onForgot} aria-busy={busy}>
                                    <PaneHeader eyebrow="ACCOUNT RECOVERY" title="استرجاع كلمة المرور" subtitle="اطلب رابطًا عبر مدير النظام." />
                                    <div className="mt-lg flex flex-col gap-md">
                                        <Input id="erp-v3-forgot-username-luxe" label="اسم المستخدم" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} size="lg" disabled={busy} />
                                        <Input id="erp-v3-forgotcode" label="رمز الاسترداد" name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} value={forgotCode} onChange={(event) => setForgotCode(event.target.value)} size="lg" disabled={busy} />
                                        <Input id="erp-v3-newpassword" label="كلمة المرور الجديدة" name="newpassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} size="lg" disabled={busy} />
                                        <Input id="erp-v3-confirmpassword" label="تأكيد كلمة المرور" name="confirmpassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} size="lg" disabled={busy} />
                                    </div>
                                    <PaneAlerts error={error} notice={notice} />
                                    <div className="mt-lg flex flex-col gap-sm">
                                        <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التحقق…' : 'تعيين كلمة المرور'}</Button>
                                        <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>إلغاء</Button>
                                    </div>
                                </form>
                            ) : null}
                            {pane === 'enroll' ? (
                                <form onSubmit={(event) => { event.preventDefault(); void onConfirmEnrollment(); }} aria-busy={busy}>
                                    <PaneHeader eyebrow="ENROLLMENT" title="تسجيل المصادقة الثنائية" subtitle="امسح رمز QR بتطبيق المصادقة ثم أدخل الرمز الظاهر." />
                                    <PaneAlerts error={error} notice={notice} />
                                    <div className="mt-lg flex flex-col items-center gap-sm rounded-md border border-hairline-strong bg-surface p-md">
                                        {enrollment ? <img src={enrollment.qrDataUrl ?? undefined} alt="رمز QR لتسجيل المصادقة الثنائية" width={200} height={200} /> : <p className="text-body-sm text-muted">جارٍ توليد الرمز…</p>}
                                        {enrollment?.secret ? (
                                            <small className="text-caption text-muted">السر يدوي: <code dir="ltr" className="select-all rounded bg-surface-sunken px-2 py-1 font-mono">{enrollment.secret}</code></small>
                                        ) : null}
                                    </div>
                                    <div className="mt-lg flex flex-col gap-md">
                                        <Input id="erp-v3-enrollcode" label="رمز التطبيق" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={enrollCode} onChange={(event) => setEnrollCode(event.target.value.replace(/\D/g, '').slice(0, 6))} size="lg" disabled={busy} hint="6 أرقام من تطبيق المصادقة" />
                                    </div>
                                    <div className="mt-lg flex flex-col gap-sm">
                                        <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التحقق…' : 'تأكيد التسجيل'}</Button>
                                        <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>تأجيل</Button>
                                    </div>
                                </form>
                            ) : null}
                            {pane === 'change' ? (
                            <form onSubmit={onChangePassword} aria-busy={busy}>
                                <PaneHeader eyebrow="PASSWORD CHANGE" title="تدوير كلمة المرور" subtitle="يجب تغيير كلمة المرور وفق طلب المنشأة. أكّد التغيير للمتابعة." />
                                <PaneAlerts error={error} notice={notice} />
                                <div className="mt-lg flex flex-col gap-md">
                                    <Input id="erp-v3-change-current" label="كلمة المرور" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-change-new" label="كلمة المرور الجديدة" name="newpassword" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} size="lg" disabled={busy} />
                                    <Input id="erp-v3-change-confirm" label="تأكيد كلمة المرور" name="confirmpassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} size="lg" disabled={busy} />
                                </div>
                                <div className="mt-lg flex flex-col gap-sm">
                                    <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'جارٍ التغيير…' : 'تغيير ومتابعة'}</Button>
                                    <Button type="button" variant="ghost" size="md" fullWidth disabled={busy} onClick={() => backToPassword('')}>رجوع</Button>
                                </div>
                            </form>
                        ) : null}
                        {pane === 'codes' ? (
                                <section aria-labelledby="erp-v3-codes-title">
                                    <PaneHeader eyebrow="RECOVERY CODES" title="احفظ رموز الاسترداد" subtitle="احفظ هذه الرموز في مكان آمن — كل رمز يعمل مرة واحدة فقط." />
                                    <ol id="erp-v3-codes-title" className="mt-lg grid grid-cols-1 gap-sm sm:grid-cols-2">{recoveryCodes.map((code, index) => <li key={index} className="rounded-md border border-hairline bg-surface-sunken p-sm font-mono text-center text-body-md" dir="ltr">{code}</li>)}</ol>
                                    <div className="mt-lg flex flex-col gap-sm">
                                        <Button type="button" variant="secondary" fullWidth onClick={() => void copyCodes()}>نسخ الرموز</Button>
                                        <Button type="button" fullWidth onClick={enterAfterCodes}>حفظتها — دخول</Button>
                                    </div>
                                </section>
                            ) : null}
                        </section>
                    </section>
                    <footer className="erp-luxe-foot">
                        <span className="erp-luxe-rail" aria-hidden="true" />
                        <p className="erp-luxe-foot-text" lang="en" dir="ltr">AL SHURFA AL ALAMI · RESTAURANTS GROUP · Riyadh 2026</p>
                        <span className="erp-luxe-rail" aria-hidden="true" />
                    </footer>
                </main>
            )}
</div>
    );
}

function PaneHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
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
                <p role="alert" className="mt-md rounded-md border border-danger/30 bg-danger-soft p-sm text-body-sm text-danger-text">
                    {error}
                    <span className="mt-xs block text-caption">تأكد من بياناتك، أو تواصل مع مسؤول النظام إذا تكرّر الخطأ.</span>
                </p>
            ) : null}
            {!error && notice ? (
                <p role="status" className="mt-md rounded-md border border-hairline-strong bg-surface p-sm text-body-sm text-ink-secondary">
                    {notice}
                </p>
            ) : null}
        </>
    );
}
