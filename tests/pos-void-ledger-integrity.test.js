'use strict';

/**
 * pos-void-ledger-integrity.test.js — سلامة القيد العكسي عند إلغاء فاتورة كاشير.
 * ────────────────────────────────────────────────────────────────────────────
 * الحادثة الأصلية: الإلغاء يعكس المخزون والتحصيل ويترك قيد البيع حيًا في
 * الأستاذ (يرحّل «بأفضل جهد» بعد COMMIT، وبسطور الإيراد والضريبة والصندوق
 * فقط) → التكلفة 5000/1200 والبنك 1010 لا يُعكسان، وفشل الترحيل يُبتلع.
 * الآن القيد العكسي داخل نفس المعاملة ويقلب سطور البيع الأصلية كاملة.
 */

const fs = require('fs');
const path = require('path');
const {
    reverseJournalLines,
    buildFallbackVoidLines,
    totals,
} = require('../backend/cashier-module/pos-void-lines');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HISTORY = read('backend', 'cashier-module', 'pos-orders-history.js');
const VOID_BLOCK = HISTORY.slice(
    HISTORY.indexOf("router.post('/:id/void'"),
    HISTORY.indexOf('function escHtml')
);

describe('قلب سطور قيد البيع', () => {
    const saleLines = [
        { account_code: '1010', debit: 50, credit: 0, memo: 'تحصيل غير نقدي' },
        { account_code: '1000', debit: 65, credit: 0, memo: 'تحصيل نقدي' },
        { account_code: '5000', debit: 30, credit: 0, memo: 'تكلفة مكونات' },
        { account_code: '1200', debit: 0, credit: 30, memo: 'تخفيض مخزون' },
        { account_code: '4000', debit: 0, credit: 100, memo: 'مبيعات' },
        { account_code: '2100', debit: 0, credit: 15, memo: 'ضريبة' },
    ];

    test('يقلب مدين↔دائن ويحافظ على الحسابات الستة (بنك، نقد، تكلفة، مخزون، إيراد، ضريبة)', () => {
        const rev = reverseJournalLines(saleLines);
        const codes = rev.map((l) => l.account_code).sort();
        expect(codes).toEqual(['1000', '1010', '1200', '2100', '4000', '5000']);
        const by = Object.fromEntries(rev.map((l) => [l.account_code, l]));
        expect(by['1000'].credit).toBe(65);
        expect(by['1010'].credit).toBe(50);
        expect(by['5000'].credit).toBe(30);
        expect(by['1200'].debit).toBe(30);
        expect(by['4000'].debit).toBe(100);
        expect(by['2100'].debit).toBe(15);
    });

    test('القيد العكسي متوازن بنفس مبالغ الأصل', () => {
        const rev = reverseJournalLines(saleLines);
        const t = totals(rev);
        expect(t.debit).toBe(145);
        expect(t.credit).toBe(145);
        expect(t.debit).toBe(totals(saleLines).debit);
    });

    test('يحافظ على مراكز التكلفة ويُهمل السطور الصفرية', () => {
        const rev = reverseJournalLines([
            { account_code: '4000', debit: 0, credit: 10, cost_center_code: 'CC-01' },
            { account_code: '1000', debit: 10, credit: 0 },
            { account_code: '2100', debit: 0, credit: 0 },
            { account_code: '', debit: 5, credit: 0 },
        ]);
        expect(rev.map((l) => l.account_code)).toEqual(['4000', '1000']);
        expect(rev[0].cost_center_code).toBe('CC-01');
    });

    test('مدخلات غير صالحة لا تُسقط الدالة', () => {
        expect(reverseJournalLines(null)).toEqual([]);
        expect(reverseJournalLines([{ account_code: '4000' }])).toEqual([]);
    });
});

describe('القيد العكسي المُعاد بناؤه (بلا قيد بيع أصلي)', () => {
    test('نقدي فقط: Dr 4000/2100/1200 ← Cr 5000/1000 ومتوازن', () => {
        const lines = buildFallbackVoidLines({
            invoiceCounter: 77, total: 115, tax: 15, cogs: 30,
            payments: [{ method: 'cash', amount: 115, direction: 'in' }],
        });
        const t = totals(lines);
        expect(t.debit).toBe(t.credit);
        const by = Object.fromEntries(lines.map((l) => [l.account_code, l]));
        expect(by['4000'].debit).toBe(100);
        expect(by['2100'].debit).toBe(15);
        expect(by['1200'].debit).toBe(30);
        expect(by['5000'].credit).toBe(30);
        expect(by['1000'].credit).toBe(115);
        expect(by['1010']).toBeUndefined();
    });

    test('مختلط: الشبكة تُرد على 1010 والنقد على 1000', () => {
        const lines = buildFallbackVoidLines({
            invoiceCounter: 78, total: 115, tax: 15, cogs: 30,
            payments: [
                { method: 'cash', amount: 65, direction: 'in' },
                { method: 'card', amount: 50, direction: 'in' },
            ],
        });
        const by = Object.fromEntries(lines.map((l) => [l.account_code, l]));
        expect(by['1010'].credit).toBe(50);
        expect(by['1000'].credit).toBe(65);
        expect(totals(lines).debit).toBe(totals(lines).credit);
    });

    test('صفوف «الباقي» (direction=out) لا تُضخّم الرد', () => {
        const lines = buildFallbackVoidLines({
            invoiceCounter: 79, total: 90, tax: 0, cogs: 0,
            payments: [
                { method: 'cash', amount: 100, direction: 'in' },
                { method: 'cash', amount: 10, direction: 'out' },
            ],
        });
        const by = Object.fromEntries(lines.map((l) => [l.account_code, l]));
        expect(by['1000'].credit).toBe(90);
        expect(totals(lines).debit).toBe(90);
    });

    test('شبكة أكبر من الإجمالي لا تتجاوز قيمة الفاتورة', () => {
        const lines = buildFallbackVoidLines({
            invoiceCounter: 80, total: 50, tax: 0, cogs: 0,
            payments: [{ method: 'card', amount: 80, direction: 'in' }],
        });
        const by = Object.fromEntries(lines.map((l) => [l.account_code, l]));
        expect(by['1010'].credit).toBe(50);
        expect(by['1000']).toBeUndefined();
        expect(totals(lines).debit).toBe(50);
    });

    test('فاتورة صفرية بلا تكلفة لا تُنتج قيدًا', () => {
        expect(buildFallbackVoidLines({
            invoiceCounter: 81, total: 0, tax: 0, cogs: 0, payments: [],
        })).toEqual([]);
    });
});

describe('عقد مسار الإلغاء: قيد عكسي ذرّي وكامل', () => {
    test('المسار موجود ومحمي بأدوار الإدارة', () => {
        expect(VOID_BLOCK).toContain("requireRole('admin', 'manager')");
    });

    test('يرفض الإلغاء في شهر مالي مقفل قبل أي عكس (423)', () => {
        expect(VOID_BLOCK).toContain('PERIOD_CLOSED');
        expect(VOID_BLOCK).toContain('res.status(423)');
        const periodIdx = VOID_BLOCK.indexOf('PERIOD_CLOSED');
        expect(periodIdx).toBeGreaterThan(-1);
        expect(periodIdx).toBeLessThan(VOID_BLOCK.indexOf('postInventoryLedgerEntry'));
    });

    test('يرحّل القيد العكسي على نفس اتصال المعاملة قبل COMMIT (لا best-effort)', () => {
        expect(VOID_BLOCK).toContain('postJournal(client,');
        expect(VOID_BLOCK).not.toContain('postJournal(pool,');
        expect(VOID_BLOCK).not.toContain('best-effort');
        const postIdx = VOID_BLOCK.indexOf('postJournal(client,');
        const commitIdx = VOID_BLOCK.indexOf("await client.query('COMMIT')");
        expect(postIdx).toBeGreaterThan(-1);
        expect(commitIdx).toBeGreaterThan(postIdx);
    });

    test('يقلب قيد البيع الأصلي بدل إعادة اختراع الإيراد والضريبة فقط', () => {
        expect(VOID_BLOCK).toContain('reverseJournalLines');
        expect(VOID_BLOCK).toMatch(/FROM journal_lines WHERE entry_id = \$1/);
        expect(VOID_BLOCK).toContain("source_type: 'pos_void'");
    });

    test('بلا قيد أصلي يبني العكس من التكلفة الفعلية في دفتر المخزون', () => {
        expect(VOID_BLOCK).toContain('buildFallbackVoidLines');
        expect(VOID_BLOCK).toMatch(/reference_type = 'pos_order'.*quantity_delta < 0/s);
    });

    test('فشل الترحيل يُرجع المعاملة ويُبلّغ العميل (لا إلغاء بلا قيد)', () => {
        expect(VOID_BLOCK).toContain('LEDGER_REJECTED');
        expect(VOID_BLOCK).toContain("await client.query('ROLLBACK').catch(() => {});");
    });

    test('تاريخ القيد بتوقيت الرياض لا UTC', () => {
        expect(VOID_BLOCK).toContain('riyadhToday()');
        expect(VOID_BLOCK).not.toContain("new Date().toISOString().slice(0, 10)");
    });
});

describe('أتمتة الإصلاح تشمل الفواتير المُبلَّغة (reported)', () => {
    test('إقفال اليوم يعيد ترحيل قيود issued وreported', () => {
        const src = read('backend', 'cashier-module', 'day-close-routes.js');
        expect(src).toMatch(/o\.status IN \('issued','reported'\)\s+AND o\.created_at::date/);
    });

    test('أداة التسوية المالية تعيد ترحيل قيود issued وreported', () => {
        const src = read('scripts', 'finance-reconcile.js');
        expect(src).toContain("o.status IN ('issued','reported')");
    });
});

describe('اعتماد المسودات يحترم قفل الفترة', () => {
    test('الاستعلام يستخدم أعمدة الجدول الحقيقية (period/closed)', () => {
        const src = read('backend', 'accounting-periods.js');
        const block = src.slice(src.indexOf("router.post('/journal/:id/approve'"));
        expect(block).toContain('ap.period = to_char(journal_entries.date');
        expect(block).toContain('ap.closed = TRUE');
        expect(block).not.toContain('ap.month');
        expect(block).not.toContain("ap.status = 'closed'");
    });
});

describe('منسّق المحاسبة يكشف آثار الإلغاء غير المعكوس', () => {
    const src = read('scripts', 'accounting-reconciliation.js');

    test('فحص فاتورة ملغاة بلا قيد عكسي', () => {
        expect(src).toContain("'void_without_reversal'");
        expect(src).toMatch(/jv\.source_type = 'pos_void'/);
    });

    test('فحص قيد غير متوازن ومبيعات/مصاريف/أذون بلا قيد', () => {
        for (const key of ['unbalanced_journal_entries', 'sale_without_journal', 'expense_without_journal', 'dispatch_without_journal']) {
            expect(src).toContain(`'${key}'`);
        }
    });
});
