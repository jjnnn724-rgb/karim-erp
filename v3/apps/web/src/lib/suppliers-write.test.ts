import { describe, expect, it } from 'vitest';
import { supplierBody, supplierCreateSchema, supplierDeleteVisible, supplierTaxError, supplierWriteVisible } from './suppliers-write';

describe('حقول ضريبة المورد — عقد الخادم', () => {
    it('الحمولة تستخدم الأسماء التي يقرأها الخادم لا الاسم القديم tax_number', () => {
        const body = supplierBody({
            name: 'مورد اختبار',
            phone: '0500000000',
            address: null,
            name_en: 'Test Supplier',
            category: 'بقوليات',
            tax_registration_status: 'REGISTERED',
            vat_number: '302212427200003',
            commercial_register: '7051115819',
            is_active: true,
        });
        expect(body).toMatchObject({
            tax_registration_status: 'REGISTERED',
            vat_number: '302212427200003',
            commercial_register: '7051115819',
            name_en: 'Test Supplier',
            is_active: true,
        });
        expect(body).not.toHaveProperty('tax_number');
        expect(body).not.toHaveProperty('active');
    });

    it('المورد غير المسجل يُرسل برقم ضريبي فارغ', () => {
        const body = supplierBody({
            name: 'مورد بدون ضريبة',
            phone: '0500000001',
            tax_registration_status: 'NOT_REGISTERED',
            vat_number: null,
        });
        expect(body.tax_registration_status).toBe('NOT_REGISTERED');
        expect(body.vat_number).toBeNull();
    });

    it('القيمة الافتراضية للحالة غير مسجل (لا تخمين)', () => {
        const parsed = supplierCreateSchema.parse({ name: 'مورد', phone: '0500000002' });
        expect(parsed.tax_registration_status).toBe('NOT_REGISTERED');
    });
});

describe('صلاحيات الموردين — مطابقة لبوابات الخادم', () => {
    it('أمين المخزن يملك إنشاء وتعديل وإيقاف وحذف مثل المدير', () => {
        for (const role of ['warehouse', 'admin', 'manager']) {
            expect(supplierWriteVisible(role)).toBe(true);
            expect(supplierDeleteVisible(role)).toBe(true);
        }
    });

    it('المحاسب والطاهي لا يملكان كتابة الموردين', () => {
        for (const role of ['accountant', 'sous_chef', 'kitchen', null]) {
            expect(supplierWriteVisible(role)).toBe(false);
            expect(supplierDeleteVisible(role)).toBe(false);
        }
    });
});

describe('supplierTaxError — مرآة تحقق الخادم', () => {
    it('مسجل بلا رقم 15 خانة ⇒ خطأ', () => {
        expect(supplierTaxError({ tax_registration_status: 'REGISTERED', vat_number: '123' })).toMatch(/15 رقمًا/);
        expect(supplierTaxError({ tax_registration_status: 'REGISTERED', vat_number: null })).toMatch(/15 رقمًا/);
    });

    it('مسجل برقم 15 خانة ⇒ لا خطأ', () => {
        expect(supplierTaxError({ tax_registration_status: 'REGISTERED', vat_number: '302212427200003' })).toBe('');
    });

    it('غير مسجل وله رقم ⇒ خطأ', () => {
        expect(supplierTaxError({ tax_registration_status: 'NOT_REGISTERED', vat_number: '302212427200003' })).toMatch(/اتركه فارغًا/);
        expect(supplierTaxError({ tax_registration_status: 'NOT_REGISTERED', vat_number: null })).toBe('');
    });

    it('معفى يقبل رقمًا صالحًا أو فارغًا', () => {
        expect(supplierTaxError({ tax_registration_status: 'EXEMPT', vat_number: '302212427200003' })).toBe('');
        expect(supplierTaxError({ tax_registration_status: 'EXEMPT', vat_number: '12' })).toMatch(/15 رقمًا/);
    });
});
