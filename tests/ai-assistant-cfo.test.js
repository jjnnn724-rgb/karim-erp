/**
 * ai-assistant-cfo.test.js — المدير المالي: أرقام من النظام، بلا اختراع
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   1) وضع «cfo» في المساعد، وهو يجمع من مجمّعات النظام (لا استعلامات جديدة).
 *   2) قواعد الإنذار الاحترافية: منذ متى لم يُقفل · الوردية المفتوحة ·
 *      الحضور الناقص (مع استثناء الوردية الجارية) · الأصناف السالبة ·
 *      المقارنة بمصدر واحد · المصروفات الصفر المشبوه.
 *   3) لا أرقام مخترعة: كل رقم في التقرير يأتي من استعلام.
 *   4) لا إكراه: من يقرأ التقرير لا يلمس الأصناف (المخزن خط أحمر للمالك).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CFO = path.join(ROOT, 'backend', 'ai-assistant', 'cfo.js');
const ASSISTANT = path.join(ROOT, 'backend', 'ai-assistant', 'assistant.js');
const cfo = fs.readFileSync(CFO, 'utf8');
const assistant = fs.readFileSync(ASSISTANT, 'utf8');

describe('المدير المالي — المراجعة', () => {
    test('وضع cfo في المساعد ويجمع من مجمّع CFO', () => {
        expect(assistant).toMatch(/const MODES = \['knowledge', 'diagnose', 'code', 'cfo'\]/);
        expect(assistant).toMatch(/require\('\.\/cfo'\)/);
        expect(assistant).toMatch(/mode === 'cfo'/);
        expect(assistant).toMatch(/cfoReview\(input\.pool/);
    });

    test('يجمع من مجمّعات النظام القائمة (لا SQL جديد لترقام المبيعات)', () => {
        expect(cfo).toMatch(/collectDailyReport\(pool, day\)/);
        expect(cfo).toMatch(/collectBriefing\(pool, day\)/);
        expect(cfo).toMatch(/pos_day_closes/);
    });

    test('قواعد الإنذار الاحترافية موجودة', () => {
        expect(cfo).toMatch(/إقفال اليوم لم يُسجَّل/);         // الإقفال
        expect(cfo).toMatch(/وردية مفتوحة/);                    // النقد
        expect(cfo).toMatch(/حضور ناقص يستوجب مراجعة الرواتب/);   // الرواتب
        expect(cfo).toMatch(/رصيده سالب/);                      // ثقة التكلفة
        expect(cfo).toMatch(/انخفض.*عن أمس/);                   // مقارنة بمصدر واحد
        expect(cfo).toMatch(/المصروفات صفر في يوم تشغيل/);       // صفر مشبوه
    });

    test('الوردية الجارية ليست شذوذًا (حكم المدقق)', () => {
        expect(cfo).toMatch(/وردياتٌ جارية الآن/);
        expect(cfo).toMatch(/mins > 12 \* 60/);   // أقدم من وردية كاملة = نقص حقيقي
    });

    test('الإنذار من «انفصال المصادر» لا يُطلق إنذارًا كاذبًا (POS بلا حركة أسبوعًا = YaraSoft)', () => {
        expect(cfo).toMatch(/posEverActive/);
        expect(cfo).toMatch(/لا إنذار على ذلك/);
    });

    test('«منذ متى» يُحسب بالتاريخ الصحيح', () => {
        expect(cfo).toMatch(/lastCloseIso/);
        expect(cfo).toMatch(/daysSince/);
        expect(cfo).toMatch(/Number\.isNaN\(t\) \? null/);   // تاريخ فاسد ⇒ لا «NaN يوم»
    });

    test('لا مبالغ مكتوبة في الكود (كل رقم يأتي من القاعدة)', () => {
        // لا مبلغ حرفي (رقم + ر.س) في الكود — المبالغ تُبنى من بياناتِ الاستعلام.
        const literals = [...cfo.matchAll(/(\d+(?:\.\d+)?)\s*ر\.س/g)].map((m) => m[0]);
        if (literals.length) {throw new Error('مبالغ مكتوبة في كود المراجعة: ' + literals.join(', '));}
    });
});
