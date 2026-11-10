import { v3ChartResponseSchema, v3JournalResponseSchema } from '@karim/shared';
import { canonicalize } from '@karim/testing';
import chartCapture from '../../../../packages/testing/fixtures/accounting/chart.json';
import journalCapture from '../../../../packages/testing/fixtures/accounting/journal.json';

/**
 * التقاطات حقيقية — ملفات `packages/testing/fixtures` نفسها (مستودعة في Git).
 *
 * لماذا استيراد JSON لا `loadFixture`؟ لأن `loadFixture` يقرأ القرص عبر
 * `import.meta.url`، وهذا في وضع المحاكاة (jsdom) مسار خادمٍ لا مسار ملف،
 * فلا يصل إلى القرص. الاستيراد المباشر يقرأ الملف نفسه بلا نسخة ثانية.
 *
 * `canonicalize` يطبّق قواعد ADR المعلنة (ADR-04/05/06) على الجسد القديم
 * فيصير بالشكل الذي يُصدره v3 فعلًا: المال نصٌّ والتاريخ `YYYY-MM-DD`.
 * فاختبار الواجهة يجرّب البيانات نفسها التي تصِل إلى المتصفح.
 */

export const chartCaptureBody = v3ChartResponseSchema.parse(canonicalize(chartCapture.body));

export const journalCaptureBody = v3JournalResponseSchema.parse(canonicalize(journalCapture.body));
