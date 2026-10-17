/**
 * v2-invoice-void.test.js — ذيل P1-4: إلغاء فاتورة شراء + حذف جماعي
 * ═══════════════════════════════════════════════════════════════════════
 * البابان عكسيان/جماعيان، لذا العقد هنا صريح:
 *   • البوابة مرآة الخادم: requireRole('admin') على المسارين، وعبارة
 *     الحذف الجماعي الحرفية `حذف كل الفواتير` (warehouse-routes.js).
 *   • المستودع لا يرسل `force` أبدًا (الخادم يرفضه 409 أصلًا).
 *   • الشاشة ترسم الإلغاء والحذف لأدمن + العلم المستقل v2invoicevoid فقط؛
 *     والعلم OFF افتراضيًا (اختباراته في v2-write-flags).
 *   • لا شبكة في الشاشة: الكتابة عبر purchase-invoices-write-repo وحده.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'frontend', 'app', 'js', 'v2');
const WRITE_REPO = path.join(V2, 'data', 'purchase-invoices-write-repo.js');
const SCREEN = path.join(V2, 'screens', 'invoices.js');
const SERVER = path.join(ROOT, 'backend', 'warehouse-routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadRepo(apiFetch) {
    const src = read(WRITE_REPO)
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const ctx = { console, JSON, String, Number, Boolean, Error, Promise, apiFetch };
    vm.createContext(ctx);
    vm.runInContext(
        `${src}\n;Object.assign(globalThis, {voidPurchaseInvoice, clearAllPurchaseInvoices, INVOICE_VOID_ROLES, CLEAR_ALL_CONFIRM});`,
        ctx,
        { filename: WRITE_REPO }
    );
    return ctx;
}

const screenSrc = read(SCREEN);
const serverSrc = read(SERVER);

describe('الخادم — البابان وقفل الأدمن', () => {
    test('void: POST + admin فقط، وforce مرفوض نصًّا', () => {
        expect(serverSrc).toContain("router.post('/purchase-invoices/:id/void', jwtAuth, requireRole('admin')");
        expect(serverSrc).toContain("FORCE_VOID_FORBIDDEN");
        expect(serverSrc).toContain('لا يجوز حذف دفعات أو مستند مالي قسريًا');
    });

    test('clear-all: POST + admin فقط، وعبارة التأكيد الحرفية', () => {
        expect(serverSrc).toContain("router.post('/purchase-invoices/clear-all', jwtAuth, requireRole('admin')");
        expect(serverSrc).toContain("confirm !== 'حذف كل الفواتير'");
        expect(serverSrc).toContain('CONFIRM_REQUIRED');
    });
});

describe('المستودع — مسارات وبوابة الأدوار', () => {
    test('الدور مرآة requireRole: admin وحده', () => {
        const repo = loadRepo(async () => ({}));
        expect(repo.INVOICE_VOID_ROLES).toEqual(['admin']);
    });

    test('void: POST /warehouse/purchase-invoices/:id/void بجسد فارغ — بلا force', async () => {
        const calls = [];
        const repo = loadRepo(async (p, opts) => { calls.push({ p, opts }); return { ok: true }; });
        await repo.voidPurchaseInvoice(9);
        expect(calls).toHaveLength(1);
        expect(calls[0].p).toBe('/warehouse/purchase-invoices/9/void');
        expect(calls[0].opts.method).toBe('POST');
        expect(JSON.parse(calls[0].opts.body)).toEqual({});
        expect(calls[0].opts.body).not.toMatch(/force/);
    });

    test('void: معرّف غير صالح لا يلمس الشبكة', async () => {
        const calls = [];
        const repo = loadRepo(async (p) => { calls.push(p); return {}; });
        for (const bad of [null, undefined, '', 'abc', 0, -2, 2.5]) {
            await expect(repo.voidPurchaseInvoice(bad)).rejects.toThrow('معرف الفاتورة غير صحيح');
        }
        expect(calls).toHaveLength(0);
    });

    test('clear-all: الجسد هو العبارة الحرفية وحدها', async () => {
        const calls = [];
        const repo = loadRepo(async (p, opts) => { calls.push({ p, opts }); return { ok: true }; });
        await repo.clearAllPurchaseInvoices();
        expect(calls[0].p).toBe('/warehouse/purchase-invoices/clear-all');
        expect(calls[0].opts.method).toBe('POST');
        expect(JSON.parse(calls[0].opts.body)).toEqual({ confirm: 'حذف كل الفواتير' });
        expect(repo.CLEAR_ALL_CONFIRM).toBe('حذف كل الفواتير');
        expect(calls[0].opts.body).not.toMatch(/force/);
    });
});

describe('الشاشة — لا تُرسم إلا لأدمن + العلم', () => {
    test('الاستيراد من مستودع الكتابة والعلم، ولا apiFetch في الشاشة', () => {
        expect(screenSrc).toMatch(/from '\.\.\/data\/purchase-invoices-write-repo\.js\?v=/);
        expect(screenSrc).toMatch(/voidPurchaseInvoice, clearAllPurchaseInvoices, INVOICE_VOID_ROLES/);
        expect(screenSrc).toMatch(/invoiceVoidWriteEnabled/);
        expect(screenSrc).not.toMatch(/\bapiFetch\s*\(/);
        expect(screenSrc).not.toMatch(/\bfetch\s*\(/);
    });

    test('بوابة مزدوجة: admin + العلم المستقل', () => {
        expect(screenSrc).toMatch(/canWrite\(ctx\.role, INVOICE_VOID_ROLES\) && invoiceVoidWriteEnabled\(\)/);
    });

    test('زرّ الإلغاء danger + trash، ويظهر تحت canVoid وحدها', () => {
        expect(screenSrc).toMatch(/erp-btn--sm erp-btn--danger" data-v2-act="void"/);
        expect(screenSrc).toMatch(/data-i="trash"/);
        expect(screenSrc).toMatch(/aria-label="حذف الفاتورة \$\{esc\(row\.number\)\}"/);
    });

    test('منطقة الخطر: مربع تأكيد، زر معطّل ابتداءً، ونص «لا يمكن التراجع»', () => {
        expect(screenSrc).toMatch(/data-v2-clear-ok/);
        expect(screenSrc).toMatch(/data-v2-clear-go disabled/);
        expect(screenSrc).toContain('لا يمكن التراجع');
        expect(screenSrc).toMatch(/btn\.disabled = !ok\.checked/);
    });

    test('التأكيدان يذكران الرقم والنهائية؛ والحذف الجماعي يطلب العدد', () => {
        expect(screenSrc).toMatch(/confirmFn\(`حذف فاتورة الشراء \$\{row\.number\} \(\$\{total\}\)؟/);
        expect(screenSrc).toMatch(/confirmFn\(`حذف كل فواتير الشراء \(\$\{formatInt\(rows\.length\)\}\) نهائيًا؟/);
        expect(screenSrc).toContain('ستُعكس كمياتها من المخزون ولا يمكن التراجع');
    });

    test('رسالة الخادم تُعرض، ومسار عكس الدفعة اليدوية يُرشد إليه', () => {
        expect(screenSrc).toContain('افتح «المشتريات › المدفوعات» واعكس الدفعة يدويًا ثم أعد الإلغاء');
        expect(screenSrc).toMatch(/notify\(`\$\{msg\}\$\{guide\}`, 'error'\)/);
    });

    test('النجاح يعرض أعداد الخادم: الأصناف المعكوسة والدفعات التلقائية والقيود', () => {
        expect(screenSrc).toMatch(/res\.reversedItems/);
        expect(screenSrc).toMatch(/res\.deletedPayments/);
        expect(screenSrc).toMatch(/res\.deletedInvoices/);
        expect(screenSrc).toMatch(/res\.reversedLedgerRows/);
    });

    test('لا inline handlers، والتحميل يعيد رسم المنطقة ويخفيها عند الخطأ', () => {
        expect(screenSrc).not.toMatch(/\sonclick=/i);
        expect((screenSrc.match(/paintDanger\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(screenSrc).toMatch(/if \(!canVoid \|\| rows\.length === 0\) \{holder\.innerHTML = ''; return;\}/);
    });
});
