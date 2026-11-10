import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addShelfSuccess,
    createShelf,
    deleteShelf,
    deleteShelfConfirm,
    deleteShelfSuccess,
    emptyShelfForm,
    normalizeShelfForm,
    shelfCodeExists,
    shelfToForm,
    updateShelf,
    updateShelfSuccess,
    validateShelfForm,
} from './shelves';

/**
 * كتابة الرفوف — تحرس الرسائل والقواعد المنقولة حرفيًّا من
 * `v2/data/shelves-repo.js` و`v2/screens/shelves.js`، والحمولات الفعلية
 * التي تُرسل للخادم (نفس البوابة ونفس شكل الجسم).
 */

vi.mock('./auth', () => ({ getAccessToken: () => 'test-token', getAppKey: () => null }));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('رفوف — التحقق ونفس رسائل V2', () => {
    it('الاسم والكود مطلوبان برسائل V2 الحرفية', () => {
        const errors = validateShelfForm(emptyShelfForm());
        expect(errors).toEqual([
            { field: 'name', message: 'حقول مطلوبة ناقصة: name' },
            { field: 'code', message: 'الكود مطلوب — معرّف الرف كما في الشاشة القديمة' },
        ]);
    });

    it('الحدود: 255 للاسم، 50 للكود، 255 للموقع، والسعة رقم ≥ 0', () => {
        expect(validateShelfForm({ name: 'ا'.repeat(256), code: 'A' })[0]?.message).toBe(
            'الحقل "name" أطول من المسموح (الحد الأقصى 255 حرفًا)',
        );
        expect(validateShelfForm({ name: 'رف', code: 'A'.repeat(51) })[0]?.message).toBe(
            'الحقل "code" أطول من المسموح (الحد الأقصى 50 حرفًا)',
        );
        expect(validateShelfForm({ name: 'رف', code: 'A', location: 'م'.repeat(256) })[0]?.message).toBe(
            'الحقل "location" أطول من المسموح (الحد الأقصى 255 حرفًا)',
        );
        expect(validateShelfForm({ name: 'رف', code: 'A', capacity: 'abc' })[0]?.message).toBe(
            'الحقل "capacity" يجب أن يكون رقمًا',
        );
        expect(validateShelfForm({ name: 'رف', code: 'A', capacity: '-1' })[0]?.message).toBe(
            'الحقل "capacity" يجب أن يكون رقمًا',
        );
        expect(validateShelfForm({ name: 'رف', code: 'A', capacity: '0' })).toEqual([]);
        expect(validateShelfForm({ name: 'رف', code: 'A', capacity: '' })).toEqual([]);
    });

    it('كود مكرّر يُرفض محليًّا قبل الخادم (خلافًا لتحديث الرف نفسه)', () => {
        const shelves = [
            { id: '1', name: 'أ', code: 'A1' },
            { id: '2', name: 'ب', code: 'B2' },
        ];
        expect(shelfCodeExists(shelves, 'a1')).toBe(true);
        expect(shelfCodeExists(shelves, 'a1', '1')).toBe(false);
        expect(shelfCodeExists(shelves, 'C3')).toBe(false);
    });

    it('التطبيع: كود بأحرف كبيرة، موقع فارغ = null، سعة افتراضية 50، وأيقونة V2', () => {
        expect(normalizeShelfForm({ name: ' رف ', code: 'a1', location: ' ', capacity: '' })).toEqual({
            name: 'رف',
            code: 'A1',
            location: null,
            capacity: 50,
            icon: '<i class=ji data-i=archive></i>',
        });
        expect(normalizeShelfForm({ name: 'رف', code: 'a1', location: 'مخزن', capacity: '7' })).toMatchObject({
            location: 'مخزن',
            capacity: 7,
        });
        expect(normalizeShelfForm({ name: 'رف', code: 'a1', capacity: 'abc' })).toMatchObject({ capacity: 50 });
    });

    it('تهيئة النموذج من رف قائم ونموذج فارغ بسعة 50', () => {
        expect(emptyShelfForm()).toEqual({ name: '', code: '', location: '', capacity: '50' });
        expect(shelfToForm({ id: '1', name: 'أ', code: 'A1', location: 'م', capacity: 12 })).toEqual({
            name: 'أ',
            code: 'A1',
            location: 'م',
            capacity: '12',
        });
    });
});

describe('رفوف — رسائل النجاح والتأكيد الحرفية', () => {
    it('رسائل V2', () => {
        expect(addShelfSuccess('رف أ')).toBe('تمت إضافة الرف «رف أ»');
        expect(updateShelfSuccess('رف أ')).toBe('تم تحديث الرف «رف أ»');
        expect(deleteShelfSuccess('رف أ')).toBe('تم حذف الرف «رف أ»');
        expect(deleteShelfConfirm('رف أ', 3)).toBe(
            'حذف الرف «رف أ»؟ ستُزال تعيينات أصنافه (3 صنفًا) ولن تُحذف الأصناف نفسها.',
        );
    });
});

describe('رفوف — البوابة نفسها (POST/PUT/DELETE /api/shelves)', () => {
    function stubFetch(): ReturnType<typeof vi.fn> {
        const fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        );
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('createShelf يرسل قائمة السماح كاملة بما فيها الأيقونة', async () => {
        const fetchMock = stubFetch();
        await createShelf({ name: 'رف', code: 'ab', location: '', capacity: '12' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/shelves');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({
            name: 'رف',
            code: 'AB',
            location: null,
            capacity: 12,
            icon: '<i class=ji data-i=archive></i>',
        });
    });

    it('updateShelf لا يرسل الكود ولا الأيقونة أبدًا', async () => {
        const fetchMock = stubFetch();
        await updateShelf('7', { name: 'رف', code: 'ab', location: 'مخزن', capacity: '5' });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/shelves/7');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(String(init.body))).toEqual({ name: 'رف', location: 'مخزن', capacity: 5 });
    });

    it('deleteShelf يستخدم DELETE على المعرّف نفسه', async () => {
        const fetchMock = stubFetch();
        await deleteShelf('7');
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/shelves/7');
        expect(init.method).toBe('DELETE');
    });
});
