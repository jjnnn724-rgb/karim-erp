/**
 * v2-report-viewer.test.js — عقد عارض المستندات داخل V2
 * ═══════════════════════════════════════════════════════════════════════
 * المصدر: features/report-viewer.js القديم (نافذة وهمية + overlay + iframe)
 * والعله: WebView لا يفتح window.open للطباعة. الاختبار عقود مصادر:
 * الشريط والأزرار والوصولية، النافذة الوهمية، انتظار load قبل الطباعة،
 * وربط الشاشات العشر التي كانت تفتح نافذة فارغة.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const VIEWER = path.join(V2, 'report-viewer.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-report-viewer.css');
const PAGE = path.join(APP, 'v2.html');
const LEGACY = path.join(APP, 'js', 'features', 'report-viewer.js');
const PRINT_BRANDING = path.join(APP, 'js', 'core', 'print-branding.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const pageRev = () => (read(PAGE).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

const SCREENS = [
    'cfo', 'cashier-monitor', 'dispatch', 'employee-portal', 'employees',
    'oracle-data', 'reports', 'veg-requests', 'wh-prs', 'pnl',
];

describe('عارض المستندات — النافذة الوهمية', () => {
    test('يصدّر الفتح والإغلاق', () => {
        const v = read(VIEWER);
        expect(v).toContain('export function openInAppReport(title, url)');
        expect(v).toContain('export function closeReportViewer()');
    });

    test('نفس واجهة window القديمة: write/writeln/open/close + print/focus/close', () => {
        const v = read(VIEWER);
        for (const method of ['open()', 'write(', 'writeln(', 'close()', 'print:', 'focus()']) {
            expect(v).toContain(method);
        }
        expect(v).toContain("querySelector() {return null;}");
    });

    test('open() يمسح القطع فلا تختلط صفحة الانتظار بالمستند النهائي', () => {
        expect(read(VIEWER)).toMatch(/open\(\) \{chunks\.length = 0;\}/);
        expect(read(VIEWER)).toContain("frame.srcdoc = html");
    });

    test('وضع الرابط الجاهز يستخدم iframe.src (طباعة P&L)', () => {
        const v = read(VIEWER);
        expect(v).toContain('if (url) {');
        expect(v).toContain('target.src = url');
    });
});

describe('عارض المستندات — الطباعة والوصولية', () => {
    test('الطباعة تنتظر load الإطار ثم تنادي contentWindow.print', () => {
        const v = read(VIEWER);
        expect(v).toContain("frame.addEventListener('load'");
        expect(v).toContain('if (printPending)');
        expect(v).toContain('loadedSeq = renderSeq');
        expect(v).toContain('frame.contentWindow.focus()');
        expect(v).toContain('frame.contentWindow.print()');
    });

    test('رفض الطباعة يظهر تنبيهًا واضحًا بدل فشل صامت', () => {
        const v = read(VIEWER);
        expect(v).toContain("window.toast(message, 'warning')");
        expect(v).toContain('الطباعة غير مدعومة داخل التطبيق');
    });

    test('حوار نمطي: role=dialog وaria-modal وعنوان الربط وiframe مسمّى', () => {
        const v = read(VIEWER);
        expect(v).toContain("host.setAttribute('role', 'dialog')");
        expect(v).toContain("host.setAttribute('aria-modal', 'true')");
        expect(v).toContain("host.setAttribute('aria-labelledby', TITLE_ID)");
        expect(v).toContain("frame.setAttribute('title'");
        /* عقد الإغلاق: X في أعلى الشريط وحده. لا Escape ولا نقرة على الخلفية،
           فمستندٌ قيد القراءة أو الطباعة لا يُفقد بضغطة عابرة. */
        expect(v).toContain('erp-icon-btn erp-modal-x');
        expect(v).toContain("closeBtn.setAttribute('data-v2-report-action', 'close')");
        expect(v).toContain("closeBtn.addEventListener('click', closeReportViewer)");
        expect(v).not.toContain('onEscape');
        expect(v).not.toContain("keydown");
    });

    test('التركيز يعود إلى العنصر الذي فتح العارض', () => {
        const v = read(VIEWER);
        expect(v).toContain('lastFocus = previousFocus');
        expect(v).toContain('lastFocus.focus()');
        expect(v).toContain('lastFocus = null');
    });

    test('لا innerHTML ولا معالج سطري في العارض نفسه', () => {
        const v = read(VIEWER);
        expect(v).not.toMatch(/\.innerHTML\s*=/);
        expect(v).not.toMatch(/onclick\s*=/i);
        expect(v).not.toContain('insertAdjacentHTML');
    });

    test('adds the restaurant logo to generated and same-origin report documents', () => {
        const branding = read(PRINT_BRANDING);
        expect(branding).toContain("const LOGO_PATH = 'assets/al-shurfa-logo.png'");
        expect(branding).toContain("doc.querySelector('[data-company-print-logo]");
        expect(branding).toContain("window.addEventListener('beforeprint'");
        expect(read(VIEWER)).toContain(`import { addV2PrintBranding } from './print-branding.js?v=${pageRev()}'`);
        expect(read(VIEWER)).toContain('addV2PrintBranding(frame.contentDocument)');
        expect(read(LEGACY)).toMatch(/import \{ addCompanyPrintLogo \} from '\.\.\/core\/print-branding\.js\?v=\d+\.\d+\.\d+'/);
        expect(read(LEGACY)).toContain('addCompanyPrintLogo(frame.contentDocument)');
    });

    test('V2 print uses the uploaded settings logo without changing legacy branding', () => {
        const branding = read(path.join(V2, 'print-branding.js'));
        // الرموز تصل إلى المستند المطبوع كوسوم svg بلا عرضٍ/ارتفاع (icons.js)؛
        // بلا تقييدها تتمدّد إلى عرض الصفحة كله — قيس حيًّا 1200x1200 لكل رمز.
        expect(branding).toMatch(/svg \{ max-width: 100%; \}/);
        expect(branding).toMatch(/svg\.ji \{ width: 1em; height: 1em;/);
        expect(branding).toContain('export function setV2PrintLogo(value)');
        expect(branding).toContain('export function installV2PrintBranding()');
        expect(branding).toContain('configuredLogo');
        expect(branding).toContain("document.querySelector('[data-v2-shell-logo]')");
        const layout = read(path.join(V2, 'layout', 'app-layout.js'));
        expect(layout).toContain('data-v2-shell-logo');
        expect(layout).toContain('src="assets/al-shurfa-mark.png"');
        expect(layout).toContain('data-v2-shell-logo-fallback');
        expect(layout).toContain('data-v2-shell-logo-fallback data-i="store" hidden');
        expect(branding).toContain('image.onerror = () =>');
        expect(branding).toContain('image.hidden = true;');
        // The 46px plaque keeps the emblem mark; the configured logo is print-only.
        expect(branding).not.toContain('image.src = src;');
        expect(branding).toContain('image.src = logoSource();');
        const preview = read(path.join(V2, 'preview.js'));
        expect(preview).toContain('fetchMainSettingsFull');
        expect(preview).toContain('setV2PrintLogo(current && current.logoB64)');
        expect(preview).toContain('installV2PrintBranding()');
    });

    test('العارض واجهة فقط — لا شبكة ولا fetch', () => {
        const v = read(VIEWER).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(v).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(v).not.toContain('apiFetch');
    });
});

describe('عارض المستندات — الربط بالشاشات', () => {
    test('كل شاشة طباعة تستورد العارض بمراجعة الصفحة', () => {
        const rev = pageRev();
        expect(rev).toBeTruthy();
        for (const id of SCREENS) {
            const src = read(path.join(V2, 'screens', `${id}.js`));
            const m = src.match(/import \{ openInAppReport \} from '\.\.\/report-viewer\.js\?v=([0-9.]+)'/);
            expect(m && m[1]).toBe(rev);
        }
    });

    test('لا نافذة فارغة باقية في مسارات المستندات', () => {
        for (const id of SCREENS) {
            const src = read(path.join(V2, 'screens', `${id}.js`));
            expect(src).not.toContain("window.open('', '_blank')");
        }
    });

    test('رسائل حجب النوافذ القديمة أُزيلت من مسارات الطباعة', () => {
        for (const id of SCREENS) {
            const src = read(path.join(V2, 'screens', `${id}.js`));
            expect(src).not.toContain('اسمح بالنوافذ المنبثقة');
        }
    });

    test('dispatch يحتفظ بكتابة صفحة الانتظار ثم المستند الكامل', () => {
        const src = read(path.join(V2, 'screens', 'dispatch.js'));
        expect(src).toContain('const w = openInAppReport(`إذن صرف #${raw.id}`)');
        expect(src).toContain("w.document.write('<!DOCTYPE html>");
        expect(src).toContain('w.document.open();');
        expect(src).toContain('w.document.close();');
    });

    test('الطباعة المباشرة بعد close تُطلب عبر الطباعة المؤجلة في العارض', () => {
        const src = read(path.join(V2, 'screens', 'wh-prs.js'));
        expect(src).toContain('w.print();');
        expect(read(VIEWER)).toContain('printPending = true');
    });

    test('P&L يفتح الرابط داخل العارض لا نافذة خارجية', () => {
        const src = read(path.join(V2, 'screens', 'pnl.js'));
        expect(src).toContain("openInAppReport('قائمة الأرباح والخسائر'");
        expect(src).not.toContain("'_blank', 'noopener'");
    });

    test('يبقى العارض القديم متوافقًا مع الواجهة العامة', () => {
        expect(read(LEGACY)).toContain('export function openInAppReport(title, url)');
        expect(read(LEGACY)).toContain("window.openInAppReport = openInAppReport");
    });
});

describe('عارض المستندات — الأصول', () => {
    test('ورقة الأنماط مسجلة في الصفحة بمراجعة الصفحة', () => {
        const html = read(PAGE);
        const rev = pageRev();
        expect(html).toContain(`css/v2/erp-report-viewer.css?v=${rev}`);
    });

    test('التوكنات فقط: صفر hex وصفر rgb خام', () => {
        const css = read(CSS);
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(css).not.toMatch(/\brgba?\(/i);
        expect(css).toContain('var(--erp-z-modal)');
    });

    test('الطبقة تحمل .erp-v2 لتصلها التوكنات خارج الشجرة', () => {
        expect(read(VIEWER)).toContain('`erp-v2 ${OVERLAY_CLASS}`');
        expect(read(CSS)).toContain('.erp-v2');
    });
});
