/**
 * حالة الانتقال إلى V3 — يحقنها الخادم في `index.html` عند الخدمة
 * (`backend/v3-static.js` يقرأ `backend/rollout.js`)، فتُقرأ من الوثيقة
 * بلا طلبٍ إضافي. غياب الوسم (تطوير/اختبارات) يعني مدخلًا أساسيًا:
 * لا شارة «معاينة» وهمية على نسخة تشغيلية.
 */
export function isV3Preview(doc: Document = document): boolean {
    return doc.querySelector('meta[name="v3-primary"]')?.getAttribute('content') === '0';
}
