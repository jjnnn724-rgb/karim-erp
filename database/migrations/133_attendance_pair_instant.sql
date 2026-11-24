-- ═══════════════════════════════════════════════════════════════════════════
-- 133_attendance_pair_instant.sql
-- طرفُ اليوم نصًّا وحظةً وجهٌ واحد للدليل: لا يُكتب نصٌّ بلا لحظته
-- ───────────────────────────────────────────────────────────────────────────
-- الواقعة (نوفمبر 2026، EMP-091): انصراف 20:26 ظهر في الكشف بينما checkOutAt
-- بقي NULL، فغاب اليوم عن كل استعلام نافذة يعتمد على اللحظات
-- (backend/attendance-engine.js:564)، وبقي صفّه «مفتوحًا» في نظر المحرك.
--
-- المسح على karim_erp: 22 صفًّا مخالفًا من 5,385 (12 دخولًا بلا لحظته،
-- 10 انصرافات بلا لحظتها) — 18 منها من source='builder' و4 من مصحّحات الواجهة
-- العامة (/api التي تبني SET من أعمدة يرسلها المتصفح ولا ترسل checkInAt إطلاقًا).
--
-- القرار في القاعدة لا في الكاتب: BEFORE.trigger على attendance يُشتقّ الناقص
-- من date + وقت الحائط بنفس اصطلاح التطبيق (UTC+3 ثابتة، لا توقيت القاهرة
-- المتغيّر)، ويدحرج الانصراف يومًا إن عبر منتصف الليل، ويُنظّف العكس
-- (نصٌّ مُمحٍ ⇒ لحظته تُمحى) حتى لا يبقى «شبح لحظة» يعدّه النافذة يومًا.
-- fail-open دائمًا: تاريخ أو وقت غير قابل للتحليل ⇒ لا كتابة ولا كسر للبصمة.
--
-- idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + backfill
-- مشروط بالصفوف المخالفة فقط.
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_attendance_pair_instant ON attendance;
--           DROP FUNCTION IF EXISTS fn_attendance_pair_instant();
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION fn_attendance_pair_instant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_day DATE;
    v_at  TIMESTAMPTZ;
    WALL_RE CONSTANT TEXT := '^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';
BEGIN
    BEGIN
        v_day := NEW.date::date;
    EXCEPTION WHEN OTHERS THEN
        RETURN NEW;   -- date ليس تاريخًا: لا قرار ولا كسر للكتابة
    END;

    -- 1) دخولٌ نصٌّ بلا لحظة ⇒ تُشتقّ من يوم الصفّ ووقت الحائط بتوقيت العمل.
    IF NEW."checkIn" IS NOT NULL AND NEW."checkInAt" IS NULL
       AND NEW."checkIn" ~ WALL_RE THEN
        NEW."checkInAt" := (v_day + NEW."checkIn"::time) AT TIME ZONE 'Asia/Riyadh';
    END IF;

    -- 2) انصرافٌ نصٌّ بلا لحظة ⇒ نفس الاشتقاق، ويدحرج يومًا إن سبق دخولَه
    --    (نفس قاعدة المحرك: وردية 13:00–12س تنصرافها 01:00 هو اليوم التالي).
    IF NEW."checkOut" IS NOT NULL AND NEW."checkOutAt" IS NULL
       AND NEW."checkOut" ~ WALL_RE THEN
        v_at := (v_day + NEW."checkOut"::time) AT TIME ZONE 'Asia/Riyadh';
        IF NEW."checkInAt" IS NOT NULL AND v_at < NEW."checkInAt" THEN
            v_at := v_at + INTERVAL '24 hours';
        END IF;
        -- بعد التدوير يبقى الانصراف قبل الدخول ⇒ الدليل متناقض: لا نَخترع لحظة.
        IF NEW."checkInAt" IS NULL OR v_at >= NEW."checkInAt" THEN
            NEW."checkOutAt" := v_at;
        END IF;
    END IF;

    -- 3) العكس: مَن محا النص محَت لحظته معه، حتى لا يبقى طرفٌ لا يُرى في
    --    الكشف لكنه يُعدّ في استعلامات النافذة (صفوف الأشباح).
    IF TG_OP = 'UPDATE' THEN
        IF NEW."checkIn" IS NULL AND OLD."checkIn" IS NOT NULL THEN
            NEW."checkInAt" := NULL;
        END IF;
        IF NEW."checkOut" IS NULL AND OLD."checkOut" IS NOT NULL THEN
            NEW."checkOutAt" := NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_pair_instant ON attendance;
CREATE TRIGGER trg_attendance_pair_instant
    BEFORE INSERT OR UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION fn_attendance_pair_instant();

-- ─── ترميم المخالفات القائمة ────────────────────────────────────────────────
-- التحريك عبر Trigger نفسه (بلا منطق مشتقّ هنا): وسمٌ في notes يُثبت أن
-- الترميم آليٌّ من الهجرة 133، والمحرّك المُجدوَل يصلح ما له بصمة حقيقية
-- بلحظتها الدقيقة في التشغيل التالي لأنه صار يقارن اللحظات أيضًا.
UPDATE attendance
   SET notes = COALESCE(notes, '') || ' | [ترميم 133: زُوّج طرف اليوم بلحظته المشتقّة من date+وقت الحائط]'
 WHERE ("checkIn" IS NOT NULL AND "checkInAt" IS NULL)
    OR ("checkOut" IS NOT NULL AND "checkOutAt" IS NULL);

COMMIT;
