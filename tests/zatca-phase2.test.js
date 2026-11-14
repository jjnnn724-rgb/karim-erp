/**
 * zatca-phase2.test.js — التحقق من مخرجات هيئة الزكاة Phase-2 (الأجزاء القابلة للفحص محليًا)
 * ═══════════════════════════════════════════════════════════════════════════════════
 * ما لا يمكن أن يتحقق هنا: موافقة منصة fatoora على الشهادة الحقيقية أو توقيع CSID.
 * ما يُثبَّت هنا بدلًا عنه: بنية XML، وبنية TLV، والتوقيع الرقمي round-trip على المفتاح
 * المُولَّد في بيئة الاختبار، واشتقاق المفتاح العام بسلامة من الخاص.
 */
'use strict';

const crypto = require('crypto');

const { buildPhase2Tlv, parseTlv } = require('../backend/cashier-module/zatca-tlv');
const { loadKeyPair, signXml, verifyXml, canonicalXml, hashXml } = require('../backend/cashier-module/zatca-signer');

// تثبيت المفتاح لعزل الاختبار عن مفتاح مضيف-الأمتعة من البيئة
process.env.ZATCA_PRIVATE_KEY_PEM = '';
process.env.ZATCA_ECDSA_PRIVATE_KEY_B64 = '';

const { buildZatcaUblXml } = require('../backend/cashier-module/zatca-worker');

const sampleOrder = {
    id: 'order-uuid-1',
    invoice_counter: 1024,
    invoice_uuid: '11111111-2222-3333-4444-555555555555',
    created_at: '2026-11-14T10:00:00.000Z',
    subtotal: 168,
    discount_total: 0,
    tax_total: 25.2,
    total_amount: 193.2,
    notes: null,
    party_name: 'زبون زائر',
};

const sampleItems = [
    { product_name: 'برياني لحم', vat_rate: 15, quantity: 2, unit_price: 65, line_total: 130, vat_amount: 19.5 },
    { product_name: 'شيش طاووق', vat_rate: 15, quantity: 1, unit_price: 38, line_total: 38, vat_amount: 5.7 },
];

const samplePayments = [
    { method: 'cash', amount: 123, direction: 'in' },
    { method: 'card', amount: 70, direction: 'in' },
];

const sampleSeller = {
    seller_name: 'مطاعم الشرفة العالمي',
    vat_number: '300000000000003',
    crn: '1010XXXXXX',
    address: 'الرياض — طريق الملك عبدالله',
    branch_name: 'الفرع الرئيسي',
    name_ar: 'فرع الرياض',
};

describe('ZATCA Phase-2 TLV — بنيته تتفكك بلا خطأ ويطول الوسوم التسعة', () => {
    test('كل سجل = tag,len,value؛ الترتيب بالوسوم 1..9؛ Base64 يفكّ صحيحًا', () => {
        const invoiceHashHex = crypto.createHash('sha256').update('sample-xml').digest('hex');
        const kp = loadKeyPair();
        const signatureB64 = (() => {
            const s = crypto.createSign('SHA256');
            s.update('sample-xml');
            return s.sign(kp.privateKey, 'base64');
        })();
        const publicKeyB64 = kp.publicKeyDer ? Buffer.from(kp.publicKeyDer).toString('base64') : Buffer.from(kp.publicKey).toString('base64');

        const tlvB64 = buildPhase2Tlv({
            sellerName: sampleSeller.seller_name,
            vatNumber: sampleSeller.vat_number,
            timestamp: new Date(sampleOrder.created_at),
            total: sampleOrder.total_amount,
            vatTotal: sampleOrder.tax_total,
            invoiceHashHex,
            signatureB64,
            publicKeyB64,
            certificateDerB64: Buffer.from('fake-cert-bytes').toString('base64'),
        });

        const decoded = Buffer.from(tlvB64, 'base64');
        expect(decoded.length).toBeGreaterThan(10);

        const parsed = parseTlv(decoded);
        expect(parsed.map((r) => r.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

        const get = (tag) => parsed.find((r) => r.tag === tag)?.value;

        expect(get(1).toString('utf8')).toBe(sampleSeller.seller_name);
        expect(get(2).toString('utf8')).toBe(sampleSeller.vat_number);
        expect(get(3).toString('utf8')).toBe('2026-11-14T10:00:00Z');
        expect(get(4).toString('utf8')).toBe('193.20');
        expect(get(5).toString('utf8')).toBe('25.20');
        expect(Buffer.from(get(6))).toEqual(Buffer.from(invoiceHashHex, 'hex'));

        const certDigest = crypto.createHash('sha256').update(Buffer.from('fake-cert-bytes')).digest();
        expect(get(9)).toEqual(certDigest);
    });

    test('وسوم ناقصة المضيء — Tag 9 اختياري؛ لا يُخرج وسومًا فارغة', () => {
        const tlvB64 = buildPhase2Tlv({
            sellerName: 'س', vatNumber: '300000000000003', timestamp: new Date(),
            total: 1, vatTotal: 0.15, invoiceHashHex: '00'.repeat(32),
            signatureB64: Buffer.from('sig').toString('base64'),
            publicKeyB64: Buffer.from('pub').toString('base64'),
        });
        const parsed = parseTlv(Buffer.from(tlvB64, 'base64'));
        expect(parsed.map((r) => r.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
});

describe('ZATCA Phase-2 UBL — البنيان محفوظ بلا تلاعب بالأرقام', () => {
    test('الوسوم كلها موجودة والفوتر/المسؤول/الزبون في أماكنها', () => {
        const xml = buildZatcaUblXml(sampleOrder, sampleItems, samplePayments, sampleSeller);
        expect(xml).toContain('cbc:ProfileID>reporting:1.0<');
        expect(xml).toContain('InvoiceTypeCode name="0200000">388<');
        expect(xml).toContain('cbc:RegistrationName>مطاعم الشرفة العالمي<');
        expect(xml).toContain('CompanyID>300000000000003<');
        expect(xml).toContain('CompanyID>1010XXXXXX<');
        expect(xml).toContain('<cbc:Percent>15</cbc:Percent>');
        expect(xml).toContain('<cbc:LineExtensionAmount currencyID="SAR">168.00</cbc:LineExtensionAmount>');
        expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">193.20</cbc:PayableAmount>');
        // تغيير المخرجات يُخفي الزبون المسكّى — walk-in fallback
        const anonXml = buildZatcaUblXml({ ...sampleOrder, party_name: null, notes: null }, sampleItems, samplePayments, sampleSeller);
        expect(anonXml).toContain('>Walk-in<');

        // وسوم لا تحتوي عناصر فارغة وHTML-escaped
        const special = buildZatcaUblXml({ ...sampleOrder, party_name: 'أحمد & Co <admin>' }, sampleItems, samplePayments, sampleSeller);
        expect(special).toContain('أحمد &amp; Co &lt;admin&gt;');
        expect(special).not.toContain('أحمد & Co <admin>');
    });
});

describe('ZATCA Signer — round-trip حقيقي بالمفتاح المولَّد', () => {
    test('التوقيع يُتحقق بالمفتاح العام المطابق والمستقل؛ ومحتوى XML مائل يكسر التحقق', () => {
        const xml = '<Invoice><ID>1024</ID></Invoice>';
        const sig = signXml(xml);
        expect(verifyXml(xml, sig)).toBe(true);
        expect(verifyXml(xml + '<Extra/>', sig)).toBe(false);
    });

    test('canonicalXml يطوي الأسطر والفواصل — الفاتورة بما يتبقى توقيعها يتحقق على كل جهاز', () => {
        const messy = '<Invoice>\n    <ID>1024</ID>\n    <Item/>\n</Invoice>';
        const tidy = '<Invoice><ID>1024</ID><Item/></Invoice>';
        expect(canonicalXml(messy)).toBe(canonicalXml(tidy));
        expect(hashXml(messy).equals(hashXml(tidy))).toBe(true);
    });
});
