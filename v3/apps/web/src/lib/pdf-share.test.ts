import { describe, expect, it } from 'vitest';
import { buildFilename, canShareFiles, slicePages } from './pdf-share';

/**
 * عقد PDF المنقول من `js/v2/pdf-share.js`: اسم الملف وتقطيع صفحات A4.
 * لا نختبر التوليد نفسه هنا (يحتاج canvas + jsPDF حقيقيين) — يُختبر في E2E؛
 * هذه الاختبارات تحرس الصيغة التي يعتمد عليها التحميل والمشاركة.
 */

describe('pdf-share — اسم الملف', () => {
    it('يبني الاسم بنفس صيغة V2: العنوان + التاريخ + الوقت', () => {
        expect(buildFilename('تقرير المبيعات', new Date(2026, 10, 9, 2, 5))).toBe(
            'تقرير المبيعات 2026-11-09 02-05.pdf',
        );
    });

    it('يستبدل محارف المسارات الممنوعة ويضغط المسافات', () => {
        expect(buildFilename('  تقرير / أ*ب:c"د  ', new Date(2026, 0, 1, 23, 59))).toBe(
            'تقرير أ ب c د 2026-01-01 23-59.pdf',
        );
    });

    it('يعود إلى «تقرير» عند العنوان الفارغ ويقصّ الطويل', () => {
        expect(buildFilename('', new Date(2026, 0, 1, 0, 0))).toBe('تقرير 2026-01-01 00-00.pdf');
        const long = buildFilename('ا'.repeat(120), new Date(2026, 0, 1, 0, 0));
        expect(long.startsWith('ا'.repeat(60))).toBe(true);
    });
});

describe('pdf-share — تقطيع صفحات A4', () => {
    it('يقطّع اللوحة الطويلة إلى صفحات كاملة وأخيرة أقصر', () => {
        const pages = slicePages(1000, 3300, 595.28, 841.89);
        expect(pages).toHaveLength(3);
        expect(pages[0]).toEqual({ y: 0, h: 1414 });
        expect(pages[1]).toEqual({ y: 1414, h: 1414 });
        expect(pages[2]).toEqual({ y: 2828, h: 472 });
    });

    it('لا يُعيد صفحات عند مدخلات ناقصة', () => {
        expect(slicePages(0, 10, 595, 842)).toEqual([]);
        expect(slicePages(1000, 3300, 0, 842)).toEqual([]);
    });
});

describe('pdf-share — المشاركة', () => {
    it('لا مشاركة ملفات في بيئة اختبار بلا navigator.share', () => {
        expect(canShareFiles()).toBe(false);
    });
});
