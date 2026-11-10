import { describe, expect, it } from 'vitest';
import { type BranchRow, branchSchema, branchToRow, branchTotals, searchBranches } from './branches';

/**
 * عقد الفروع — مطابق لـ `frontend/app/js/v2/data/branches-repo.js`:
 * `is_active` منطقي، والصفّ يحمل الكود والاسمين والعملة والمنطقة والهاتف
 * والعنوان، والحالة تُسمّى كما في `status.js` (مفعّل/موقوف).
 */

function row(raw: Record<string, unknown>): BranchRow {
    return branchToRow(branchSchema.parse(raw));
}

const main = row({
    id: 1,
    code: 'MAIN',
    name_ar: 'الفرع الرئيسي',
    name_en: 'Main Branch',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    phone: null,
    address: null,
    is_active: true,
});

const cairo = row({
    id: 2,
    code: 'CAI-1',
    name_ar: 'فرع القاهرة',
    name_en: 'Cairo Branch',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    phone: '0223456789',
    address: 'وسط البلد',
    is_active: false,
});

const alex = row({
    id: 3,
    code: 'ALX_2',
    name_ar: 'فرع الإسكندرية',
    name_en: 'Alexandria',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    phone: '',
    address: '',
    is_active: 0,
});

describe('عقد الفروع — الشكل والصفّ', () => {
    it('يحوّل الصفّ ويسمّي الحالة، ويقبل id رقمًا ونصًا', () => {
        expect(main).toEqual({
            id: '1',
            code: 'MAIN',
            nameAr: 'الفرع الرئيسي',
            nameEn: 'Main Branch',
            currency: 'SAR',
            timezone: 'Asia/Riyadh',
            phone: '',
            address: '',
            active: true,
            statusLabel: 'مفعّل',
        });
        const stringId = branchToRow(branchSchema.parse({ ...main, id: '7', code: 'BR-7', is_active: 'false' }));
        expect(stringId.id).toBe('7');
        expect(stringId.active).toBe(false);
        expect(stringId.statusLabel).toBe('موقوف');
    });

    it('يعامل is_active الغائب أو 0 أو «false» كموقوف، وما عداه مفعّل', () => {
        for (const value of [false, 'false', 0]) {
            expect(branchSchema.parse({ id: 1, is_active: value }).is_active).toBe(false);
        }
        for (const value of [undefined, null, true, 'true', 1]) {
            expect(branchSchema.parse({ id: 1, is_active: value }).is_active).toBe(true);
        }
    });

    it('الحقول الغائبة تصير نصوصًا فارغة لا undefined', () => {
        const sparse = branchToRow(branchSchema.parse({ id: 9 }));
        expect(sparse.code).toBe('');
        expect(sparse.nameAr).toBe('');
        expect(sparse.currency).toBe('');
        expect(sparse.phone).toBe('');
        expect(Object.values(sparse).every((value) => value !== undefined)).toBe(true);
    });
});

describe('عقد الفروع — البحث', () => {
    const rows = [main, cairo, alex];

    it('يطابق الكود تامًّا أولًا ثم الاسم، ويعلن عدد المطابقات التامة', () => {
        const exact = searchBranches(rows, 'MAIN');
        expect(exact.rows.map((item) => item.code)).toEqual(['MAIN']);
        expect(exact.exact).toBe(1);
        expect(exact.folded).toBe(false);
        expect(searchBranches(rows, 'قاهرة').rows.map((item) => item.code)).toEqual(['CAI-1']);
    });

    it('يطبّع الحروف العربية ويعلن أن النتيجة جاءت بالتطبيع', () => {
        const hit = searchBranches(rows, 'الاسكندريه');
        expect(hit.rows.map((item) => item.code)).toEqual(['ALX_2']);
        expect(hit.folded).toBe(true);
    });

    it('كل كلمة يجب أن تلاقي موضعًا، والبحث بلا كلمة يعيد الكل', () => {
        expect(searchBranches(rows, 'فرع القاهرة').rows.map((item) => item.code)).toEqual(['CAI-1']);
        expect(searchBranches(rows, 'القاهرة SAR').rows).toEqual([]);
        const all = searchBranches(rows, '   ');
        expect(all.rows).toHaveLength(3);
        expect(all.matched).toBe(false);
    });
});

describe('عقد الفروع — المجاميع', () => {
    it('يعدّ المفعّل والموقوف ويعيد العملات مرتّبة بلا تكرار', () => {
        expect(branchTotals([main, cairo, alex])).toEqual({
            total: 3,
            active: 1,
            inactive: 2,
            currencies: ['EGP', 'SAR'],
        });
        expect(branchTotals([])).toEqual({ total: 0, active: 0, inactive: 0, currencies: [] });
    });
});
