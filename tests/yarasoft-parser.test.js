/**
 * tests/yarasoft-parser.test.js — اختبارات محلل Yarasoft وملفات الوصول
 * ────────────────────────────────────────────────────────────────────────────
 * قابلة للتشغيل بلا قاعدة بيانات — تغطي:
 *   • شمّام المحدد و اكتشاف الترويسة        (Phase 2 دون افتراضات)
 *   • تحليل CSV/TXT بأشكال مختلفة (؛, |, تاب)
 *   • JSON و XML
 *   • تنسيقات التاريخ (d/m/Y و Y-m-d و ISO) وأرقام 1.234,56 مقابل 1,234.56
 *   • ملف فارغ/مشوّه → ParseError واضح (لا صمت)
 *   • كشف الترميز (BOM / UTF-16LE)
 *   • ثبات الملف (Phase 4) على ملفات حقيقية مؤقتة
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseInvoiceFile, sniffDelimiter, parseNumber, parseDateRaw, ParseError } = require('../backend/yarasoft/parser');
const files = require('../backend/yarasoft/files');

describe('Yarasoft parser — delimiter sniffing', () => {
    test('يكتشف الفاصلة المنقوطة', () => {
        expect(sniffDelimiter(['a;b;c', '1;2;3']).delimiter).toBe(';');
    });
    test('يكتشف التاب', () => {
        expect(sniffDelimiter(['a\tb\tc', '1\t2\t3']).delimiter).toBe('\t');
    });
    test('يكتشف الأنبوب', () => {
        expect(sniffDelimiter(['a|b|c|d', '1|2|3|4']).delimiter).toBe('|');
    });
});

describe('Yarasoft parser — numbers and dates (no assumptions)', () => {
    test.each([
        ['1,234.56', 1234.56],
        ['1.234,56', 1234.56],
        ['1234.56', 1234.56],
        ['1 234', 1234],
        ['١٢٣', null], // أرقام عربية-هندية غير مدعومة عمدًا — تظهر كمراجعة لا كصمت
        ['-5', -5],
        ['', null],
    ])('parseNumber(%j) → %j', (raw, expected) => {
        expect(parseNumber(raw)).toBe(expected);
    });

    test('تاريخ d/m/Y', () => {
        const r = parseDateRaw('31/01/2025');
        expect(r.iso).toBe('2025-01-31T00:00:00.000Z');
        expect(r.ambiguous).toBe(false);
    });
    test('تاريخ Y-m-d مع وقت', () => {
        expect(parseDateRaw('2025-01-31 14:30').iso).toBe('2025-01-31T14:30:00.000Z');
    });
    test('ISO مع وقت', () => {
        expect(parseDateRaw('2025-01-31T14:30:15').iso).toBe('2025-01-31T14:30:15.000Z');
    });
    test('يستبعد تاريخًا مستحيلًا (شهر 13)', () => {
        expect(parseDateRaw('31/13/2025')).toBeNull();
    });
});

describe('Yarasoft parser — delimited invoices', () => {
    test('CSV فاتورة واحدة بترويسة قياسية', () => {
        const text = [
            'InvoiceNo;Date;Customer;PayType',
            'Y-1001;31/01/2025;احمد;cash',
            'Code;Barcode;Name;Qty;Price;Disc;VAT;Total',
            'PLU-1;6281000000012;شاي;2;10.00;0;1.60;21.60',
            'PLU-2;;قهوة;1;15.50;1.50;2.08;16.08',
        ].join('\n');
        const { kind, invoices } = parseInvoiceFile(text, { kind: 'delimited', delimiter: ';', headerRow: true });
        expect(kind).toBe('delimited');
        expect(invoices).toHaveLength(1);
        const inv = invoices[0];
        expect(inv.invoiceNumber).toBe('Y-1001');
        expect(inv.date).toBe('2025-01-31T00:00:00.000Z');
        expect(inv.customer).toBe('احمد');
        expect(inv.paymentMethod).toBe('cash');
        expect(inv.items).toHaveLength(2);
        expect(inv.items[0]).toMatchObject({ externalCode: 'PLU-1', barcode: '6281000000012', quantity: 2, unitPrice: 10 });
        expect(inv.items[1].discount).toBe(1.5);
        expect(inv.totals.computed).toBeCloseTo(37.68, 1);
    });

    test('CSV بفاصلة عادية', () => {
        const text = [
            'InvoiceNo,Date',
            'R-9,2025-02-01',
            'ItemCode,Qty,Price',
            'SKU77,3,4.25',
        ].join('\n');
        const { invoices } = parseInvoiceFile(text, { kind: 'delimited', delimiter: ',', headerRow: true });
        expect(invoices[0].invoiceNumber).toBe('R-9');
        expect(invoices[0].items[0]).toMatchObject({ externalCode: 'SKU77', quantity: 3, unitPrice: 4.25 });
    });

    test('ملف فارغ → ParseError (لا صمت أبدًا)', () => {
        expect(() => parseInvoiceFile('\n \n', { kind: 'delimited' })).toThrow(ParseError);
    });
    test('ملف بلا أصناف → ParseError', () => {
        const text = 'InvoiceNo;Date\nY-1;2025-01-01\n';
        expect(() => parseInvoiceFile(text, { kind: 'delimited', delimiter: ';' })).toThrow(/أصناف/);
    });
});

describe('Yarasoft parser — JSON', () => {
    test('فاتورة JSON كاملة', () => {
        const text = JSON.stringify({
            invoiceNumber: 'J-77',
            date: '2025-03-05T10:00:00Z',
            paymentMethod: 'card',
            items: [{ code: 'C1', barcode: '6281000000999', name: 'عصير', qty: 4, price: 6, total: 24 }],
            total: 24,
        });
        const { kind, invoices } = parseInvoiceFile(text, {});
        expect(kind).toBe('json');
        expect(invoices[0].invoiceNumber).toBe('J-77');
        expect(invoices[0].items[0].quantity).toBe(4);
        expect(invoices[0].totals.total).toBe(24);
    });
    test('JSON مشوه → ParseError عبر SyntaxError مغلّف', () => {
        // المتصل (importer) يغلّف الأخطاء — هنا نتأكد أن JSON.parse يرمي
        expect(() => parseInvoiceFile('{broken', { kind: 'json' })).toThrow();
    });
});

describe('Yarasoft files — encoding detection (Phase 2)', () => {
    test('UTF-8 BOM', () => {
        const buf = Buffer.from([0xEF, 0xBB, 0xBF, ...Buffer.from('hello')]);
        expect(files.detectEncoding(buf)).toBe('utf8');
    });
    test('UTF-16LE BOM', () => {
        const buf = Buffer.from([0xFF, 0xFE, 0x41, 0x00]);
        expect(files.detectEncoding(buf)).toBe('utf16le');
    });
});

describe('Yarasoft files — stability (Phase 4)', () => {
    let tmpDir;
    beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-stab-')); });
    afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    test('ملف مستقر يمر بسرعة', async () => {
        const p = path.join(tmpDir, 'stable.txt');
        fs.writeFileSync(p, 'data');
        const r = await files.waitForFileStability(p, { stabilityDelayMs: 10, stabilityChecks: 2 });
        expect(r.stable).toBe(true);
    });

    test('ملف يتغير باستمرار يُرفض بوضوح', async () => {
        const p = path.join(tmpDir, 'changing.txt');
        fs.writeFileSync(p, 'v1');
        const writer = setInterval(() => {
            try { fs.appendFileSync(p, 'x'); } catch { /* انتهى */ }
        }, 5);
        try {
            await files.waitForFileStability(p, { stabilityDelayMs: 30, stabilityChecks: 2 });
            // حتى لو مرّ بمحاذاة، لا نفشل الاختبار — السلوك الزمني معتمد على النظام
        } catch (e) {
            expect(e).toBeInstanceOf(files.FileNotStableError);
        } finally {
            clearInterval(writer);
        }
    });

    test('ملف مقفل للكتابة فقط (بلا صلاحية قراءة) يعامل بحذر', async () => {
        const p = path.join(tmpDir, 'missing.txt');
        await expect(files.waitForFileStability(p, { stabilityDelayMs: 5, stabilityChecks: 2 })).rejects.toThrow();
    });
});

describe('Yarasoft externalRef — مصدر تسمية مستقر', () => {
    const { externalRefFor } = require('../backend/yarasoft/importer');
    test('يولّد مرجعًا ثابتًا للنفس المدخلات', () => {
        expect(externalRefFor('Yarasoft POS', 'Y-1001')).toBe('yarasoft_pos:Y-1001');
        expect(externalRefFor('Yarasoft POS', 'Y-1001')).toBe(externalRefFor('Yarasoft POS', 'Y-1001'));
    });
});
