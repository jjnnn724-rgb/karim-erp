/**
 * zatca-schema-resilience.test.js — تهيئة ZATCA لا تُسقط الإقلاع
 * ══════════════════════════════════════════════════════════════════════
 * الدرس (2026-10-21): ترحيلات 104/113 نقلت الجداول إلى دور التطبيق
 * karim_app، وبقيت الأنواع (enum) مع postgres ⇒ فشل:
 *     ERROR: must be owner of type pos_zatca_status  (SQLSTATE 42501)
 * فسقطت ensureZatcaSchema عند كل إقلاع، و[zatca-poller] أخطأ كل 15 ثانية
 * (عاصفة أخطاء ملأت السجل) — وزاد على ذلك أن الـlogger كان يبلع سبب
 * الخطأ (سلسلة ثانية في pino تُهمَل) فالسجل ما بيقولش حاجة.
 *
 * ما يُثبَّت هنا:
 *   1) ترحيل 114 موجود وينقل ملكية الأنواع (وليس يدويًا على الإنتاج).
 *   2) ensureZatcaSchema لا ترمي خطأً على فشل الـALTER: تكامل محدود
 *      أفضل من خادم ميت — والسبب يُسجَّل كحقل خطأ ظاهر.
 *   3) استدعاءات الـlogger في وحدة ZATCA تُرفق السبب كحقل (err) لا كسلسلة
 *      ثانية (وإلا ضاع السبب).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'database', 'migrations', '114_type_ownership.sql');
const MODULE = path.join(ROOT, 'backend', 'cashier-module', 'zatca-settings-routes.js');
const mig = fs.readFileSync(MIGRATION, 'utf8');
const src = fs.readFileSync(MODULE, 'utf8');

describe('تهيئة ZATCA — صلابة الإقلاع وملكية الأنواع', () => {
    test('ترحيل 114 ينقل ملكية الأنواع إلى دور التطبيق (idempotent)', () => {
        expect(fs.existsSync(MIGRATION)).toBe(true);
        expect(mig).toMatch(/ALTER TYPE public\.%I OWNER TO karim_app/);
        expect(mig).toMatch(/typtype IN \('e', 'd'\)/);
        expect(mig).toMatch(/typrelid = 0/);              // لا composite (نوع جدول)
        expect(mig).toMatch(/RAISE NOTICE/);              // إثبات/تنبيه لا صمت
    });

    test('فشل ALTER TYPE لا يُسقط الإقلاع (تكامل محدود لا خادم ميت)', () => {
        const block = src.slice(src.indexOf("for (const value of ['skipped_cancelled'"), src.indexOf('await pool.query(`\n                CREATE TABLE IF NOT EXISTS zatca_settings'));
        expect(block).toMatch(/logger\.warn\(/);
        expect(block).not.toMatch(/\{\s*throw e;\s*\}/);   // لا ترمي
        expect(block).toMatch(/err:\s*e/);                  // السبب في السجل
    });

    test('سبب الخطأ يُسجَّل كحقل — لا سلسلة ثانية تُهمَل', () => {
        expect(src).toMatch(/logger\.error\(\{ err: e \}, '\[zatca-poller\]'\)/);
        expect(src).toMatch(/logger\.error\(\{ err: e \}, '\[zatca-settings\] boot schema failed'\)/);
        expect(src).not.toMatch(/logger\.error\('\[zatca-poller\]', e\.message\)/);
        expect(src).not.toMatch(/logger\.error\('\[zatca-settings\] boot schema failed:', e\.message\)/);
    });

    test('جدول الإعدادات يُنشأ دائمًا (حتى لو تعذّر الـALTER)', () => {
        expect(src).toMatch(/CREATE TABLE IF NOT EXISTS zatca_settings/);
        expect(src).toMatch(/INSERT INTO zatca_settings \(id\) VALUES \(1\) ON CONFLICT \(id\) DO NOTHING/);
    });
});
