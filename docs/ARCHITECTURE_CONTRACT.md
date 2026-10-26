# ARCHITECTURE_CONTRACT — KARIM ERP v7.1
**العقد المعماري الملزم — يترجم التوجيه الرئيسي إلى قرارات ملزمة على النظام المكتشَف**
أساسه: DISCOVERY_ARTIFACT.md (استكشاف فعلي 2026-09-27) — يخضع لقوانين التوجيه 01–20.

---

## C1. القرار المعماري الجوهري: EXTEND لا REPLACE

النظام يمتلك WebSocket حيًا (Socket.IO) وidempotency ناضجًا في POS ونظام نسخ احتياطي واختبار استعادة.
لذلك: بنية التوجيه (Outbox → Router → Delivery → Recovery → ACK) تُبنى **كطبقة فوق** الحالي،
والأحداث القديمة تظل تعمل كما هي إلى أن تُرحَّل قناة قناة عبر بوابة معتمدة.

## C2. مخطط الحدث الموحد (Envelope) — ملزم حرفيًا كما في التوجيه §4

```json
{
  "eventId": "uuid-v4", "sequence": 123456, "eventType": "SALE_POSTED",
  "eventVersion": 1, "occurredAt": "ISO-8601Z", "aggregateType": "sale",
  "aggregateId": "123", "branchId": null,
  "target": { "type": "permission|role|department|user|module", "value": "..." },
  "payload": {}
}
```
- `sequence` من `BIGSERIAL` عالمي — غياب رقم عند عميل **ليس** دليلًا على فقد (فلتر الصلاحيات).
- أي تغيير كاسر في payload ⇒ `eventVersion` جديد.

## C3. دورة الحياة والناشر — 7 خطوات إلزامية (§7)

CLAIM بقصيرة (SELECT...FOR UPDATE SKIP LOCKED → claim_id → COMMIT) ثم البث **خارج** معاملة DB؛
عند النجاح `published_at=NOW()`؛ عند الفشل `attempts++/last_error/claim_id=NULL` مع backoff متأرجح؛
استعادة المطالبات اليتيمة بعد lease. ممنوع حبس قفل صف أثناء عمل شبكة.

## C4. المكونات الجديدة (أسماء نهائية)

```
backend/realtime/
  outbox.js          — insertDomainEvent(client|null, {...}) داخل نفس معاملة العمل
  publisher.js       — دورة claim/publish فوق req.io الموجود + backoff + stale-claim recovery
  router.js          — Authorization Resolver: من DB (role/permission/dept) — الهدف تلميح يُتحقق منه
  recovery-routes.js — GET /api/rt/events?since&limit (auth + نفس فلتر الحي + ترقيم + rate limit)
database/migrations/
  067_event_infrastructure.sql — event_outbox + client_event_ack + rt_sequence view (IF NOT EXISTS فقط)
```

- `client_event_ack`: installation_id مرتبط بجلسة موثقة (JWT) — لا انتحال هوية (§17).
- Idempotency: تعميم نمط `pos_idempotency_keys` الموجود عبر جدول عام `idempotency_keys` بنفس الأشكال
  (NEW/IN_PROGRESS/COMPLETED/FAILED) — يُفعَّل على العمليات الحرجة قناة قناة (§14).
- الاحتفاظ (§8): hot window 7 أيام + أرشفة إلى `event_outbox_archive` قبل الحذف + dry-run — ينفذ في بوابة لاحقة.
- RESYNC_REQUIRED: thresholds 5000 حدث / 24 ساعة / 20 دفعة (§13) — تُضبط من env.

## C5. قنوات الترحيل (Event Migration Lanes)

| القناة | الحدث الحالي | الوجهة | البوابة |
|---|---|---|---|
| المبيعات | `sale:completed` مباشر | `SALE_POSTED` عبر outbox + إبقاء القديم كمرآة | G2 |
| الأقسام/الكيانات | `entity_changed` | `ENTITY_CHANGED` v1 | G3 |
| ياراسوفت | `yarasoft:oracle-sync` | `REVENUE_POSTED` | G3 |
| HR/الحضور | بلا أحداث | `ATTENDANCE_PUNCHED` | G3 |

القاعدة: أثناء الترحيل يُبث القديم والجديد معًا (dual-publish) — العميلان يظلان حيَّين — ثم تُقعد القديمة بعد التوافق.

## C6. ما لا يُمس في هذه المرحلة (حدود عدم الكسر)

1. لا تعديل على توقيعات `emit`/`emitEntityChange` أو مسارات API القائمة.
2. لا إزالة أي polling قبل إثبات الاستبدال (LAW 38).
3. لا DDL خارج الترحيلات. 4. لا بيانات اعتماد في العميل. 5. لا حذف أحداث ضمن النافذة الحية.

## C7. العميل الموحد والتحديث اللاني (§15–§36) — لاحقًا بعد بوابة

Electron موجود ⇒ يُوسَّع (contextIsolation/sandbox/CSP) بدل اختيار shell جديد.
KARIM-Updater.exe + latest.json + sha256 + توقيع pinned-public-key + staged/atomic/rollback —
تبنيها بوابة مستقلة بعد استقرار طبقة الأحداث (G4+).

## C8. بوابات الإيقاف (LAW 18)

- **G0 (منجز)**: نسخ احتياطي كامل للكود + تحقق نسخ DB اليومية + هذا العقد + DISCOVERY.
- **G1 (منجز في هذه الدفعة)**: ترحيل 067 + وحدة realtime/ + ربط أدنى + حدث إثبات `SALE_POSTED` dual-publish.
- **G2**: اعتماد القناة المالية كاملة + idempotency على أذون الصرف.
- **G3**: ترحيل بقية القنوات + ACK من العميل + recovery في الواجهة.
- **G4+**: التحديث اللاني + العميل الموحد + DR/PITR الرسمي.

## C9. تعريف النجاح (قبول لكل بوابة)

صفر انحدار وظيفي (كل الشاشات تعمل كما قبل) + دليل تنفيذي (ترحيل مطبق، سجلات، لقطات endpoint)
+ قدرة تراجع (استعادة مجلد الكود من النسخة + ترحيلات إضافية فقط لا تخرق).
