/**
 * yarasoft-sync-recovery.test.js — عقد استرداد الصفوف العالقة في PROCESSING
 * ═══════════════════════════════════════════════════════════════════════
 * العامل قصير العمر (oracle-poll-worker) بحارس 8 دقائق، وقد يُقتل بين حجز
 * صف السجل وإتمام المعاملة — فيبقى عالقًا أبدًا في PROCESSING: يظهر
 * «معلّقًا» في /status ويعترض إعادة استيراد فواتيره. عقود هذا الملف قراءةُ
 * مصدرٍ خالصة (بلا تنفيذ ديناميكي):
 *   • التعافي موجود في sync-doctor ويُصدَّر باسمه.
 *   • الاستدعاء مربوط بالعامل بعد لحاق الفواتير.
 *   • الحجز قيد زمني ذرّي (لا صفوف تُسرق بين معالجين).
 *   • وجود الإيراد يُصحّح الحالة فقط — لا إعادة معالجة بمرجع مختلف.
 *   • الفاقد للبيانات يُعلَّم FAILED برسالة صريحة لا يبقى معلقًا.
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend', 'yarasoft');
const DOCTOR = path.join(BACKEND, 'sync-doctor.js');
const WORKER = path.join(__dirname, '..', 'scripts', 'oracle-poll-worker.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('استرداد الصفوف العالقة — عقد sync-doctor', () => {
    const doctor = read(DOCTOR);
    const worker = read(WORKER);

    test('التعافي معرَّف في الطبيب ومصدَّر باسمه', () => {
        expect(doctor).toMatch(/async function recoverStaleImports\(/);
        expect(doctor).toMatch(/module\.exports = \{[^}]*recoverStaleImports/);
    });

    test('العامل يستدعيه بعد لحاق الفواتير، ويحمي فشله بـtry/catch', () => {
        expect(worker).toMatch(/doctor\.recoverStaleImports\(/);
        expect(worker).toMatch(/recoverStaleImports\(\{ olderThanMinutes: 15/);
        // خطوة الاسترداد داخل حماية حتى لا يسقط بسببها سحب اللحظة كله.
        expect(worker).toMatch(/recovery error:/);
    });

    test('الحجز ذرّي: قيد زمني على صفوف PROCESSING القديمة مع RETURNING', () => {
        const claim = doctor.slice(doctor.indexOf('async function recoverStaleImports'));
        expect(claim).toMatch(/UPDATE invoice_import_log SET updated_at = NOW\(\)/);
        expect(claim).toMatch(/status = 'PROCESSING'/);
        expect(claim).toMatch(/updated_at < NOW\(\) - \(\$1 \|\| ' minutes'\)::interval/);
        expect(claim).toMatch(/RETURNING id, external_invoice_number, payload/);
    });

    test('حاجز الإيراد المسجَّل يسبق إعادة المعالجة — لا تكرار بمختلف البادئة', () => {
        const body = doctor.slice(doctor.indexOf('async function recoverStaleImports'));
        const guardAt = body.indexOf("SELECT id FROM revenues WHERE external_ref LIKE '%' || $1");
        const reprocessAt = body.indexOf('processOneInvoice({');
        expect(guardAt).toBeGreaterThan(-1);
        expect(reprocessAt).toBeGreaterThan(guardAt);
        // وجود الإيراد = تصحيح حالة فقط.
        expect(body).toMatch(/STATUS\.COMPLETED, 'COMPLETED'/);
    });

    test('الصف بلا payload لا يبقى معلقًا: FAILED برسالة صريحة', () => {
        const body = doctor.slice(doctor.indexOf('async function recoverStaleImports'));
        expect(body).toMatch(/STATUS\.FAILED/);
        expect(body).toMatch(/انقطعت المعالجة قبل حفظ بيانات الفاتورة/);
        expect(body).toMatch(/مبلغ غير صالح/);
    });

    /* انحدار 2026-10-27: pg يحلّل عمود jsonb إلى كائن أصلًا، فكان JSON.parse
       يرمي ويُسقط payloadً صالحًا إلى فرع «بلا بيانات» ويُعلّم فاتورة مسجَّلة
       FAILED بدل تصحيح حالتها إلى COMPLETED. */
    test('payload يُعامَل كائنًا jsonb أو نصًّا — لا يُسقط بسبب JSON.parse', () => {
        const body = doctor.slice(doctor.indexOf('async function recoverStaleImports'));
        expect(body).toMatch(/typeof rawPayload === 'string' \? JSON\.parse\(rawPayload\) : rawPayload/);
        // النص يُحلَّل والكائن يُمرَّر كما هو — لا فرض نصٍّ على jsonb.
        expect(body).toMatch(/const rawPayload = row\.payload/);
        // حاجز الإيراد يعمل حتى لو فقدنا payload (invoiceNumber من العمود).
        expect(body.indexOf("SELECT id FROM revenues WHERE external_ref LIKE"))
            .toBeLessThan(body.indexOf("await markFailed(row.id, 'انقطعت المعالجة"));
    });

    test('الاسترداد يعيد مسار الاستيراد نفسه لا مسارًا موازيًا', () => {
        const body = doctor.slice(doctor.indexOf('async function recoverStaleImports'));
        expect(body).toMatch(/resolveSection\(invoice\.srcTable, invoice\.sectionName, invoice\.date\)/);
        expect(body).toMatch(/filePath: `oracle:\$\{invoiceNumber\}`/);
        expect(body).toMatch(/device: resolution\.device/);
        // نفس معالج الفاتورة الوحيد — لا نسخة ثانية من منطق الترحيل.
        expect(body).toMatch(/const \{ STATUS, processOneInvoice \} = require\('\.\/importer'\)/);
    });
});
