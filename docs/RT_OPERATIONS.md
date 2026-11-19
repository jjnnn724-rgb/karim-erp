# RT_OPERATIONS.md — Real-Time layer runbook (TASK 12, operator guide)

## 1. What runs where

- Publisher: in-process `setInterval(500ms)` started once from `server.js` (single Node process).
  Multi-process: safe via `SKIP LOCKED` + 30s claim lease (duplicate wakeups only).
- No new ports/processes. Static frontend needs no restart; backend changes need `Karim-RESTART.bat`.

## 2. Feature flags (outbox flags default OFF = legacy behavior; RT_REQUIRE_AUTH default ON since 2026-11)

| Flag | On means | Rollout order |
|---|---|---|
| `RT_EVT_KITCHEN / DISPATCH / PURCHASE / INVENTORY / HR / EXPENSE / PAYMENT` | write outbox row in business txn | one module/week, watch lag |
| `RT_REQUIRE_AUTH` (**default ON**) | sensitive socket emits → `erp:authed` only | shipped ON 2026-11: all daily clients send handshake JWT (realtime.js / v2/realtime.js / pos.js); public menu boards keep raw `menu_board_changed` + polling fallback. Opt-out: `false\|0\|off\|no` |
| `RT_FAIL_CLOSED` | outbox insert failure aborts txn | only after 2 weeks clean dead-letter=0 |

## 3. Monitoring (5-minute setup, no new infra)

- LB probes: `/live` (process), `/startup` (boot), `/ready` (DB+outbox+WS; 503 removes node).
- Daily human check: `GET /api/rt/health` (JWT) → `publisher.deadLettered` must be 0,
  `outboxLagSeconds` < 2. SQL: `SELECT COUNT(*) FROM event_outbox WHERE published_at IS NULL;`
  and `... AND attempts >= 20` (dead letters — investigate, never delete).
- Alerts (manual until monitoring exists): lag>10s warn, >60s critical; backup status file
  `database/backups/daily-backup-status.json` must be `ok` and fresh (<26h).

## 4. Backup & recovery (uses existing system)

- Daily 02:00 Task Scheduler (`DailyBackup.bat`, 30 retention, SHA-256 sidecars).
- Restore drill (monthly, mandatory): `node database/scripts/restore.js <file> --target-db karim_restore_test --yes`
  then `SELECT COUNT(*) FROM event_outbox` + app smoke. Record result in this file's log below.
- DB lost: restore latest verified backup → outbox rows come back with it → publisher resumes
  (claims expire via lease). Clients auto-resume via `/rt/events?since=`.

## 5. Upgrade / rollback

- Server: deploy files → `Karim-RESTART.bat` → check `/ready` 200 → spot-check POS sale + chat.
- Client: static files versioned (`?v=`); rollback = redeploy prior bundle (keep one backup copy).
- Flags rollback: unset env → restart (or `POST /api/system` restart if available).
- Rollback triggers: p95>1s 5min · lag>60s · /rt/* errors>1% · any failed acceptance below.

## 6. Acceptance after every restart (2 minutes)

1. `/api/health` 200 + database ok. 2. `/ready` 200. 3. POS test sale appears on manager screen.
4. Disconnect network 20s → reconnect → badge back to connected, no duplicate sale on refresh.
5. `POST /api/rt/ack` 200 (auth). 6. Backup status file fresh.

## 7. Known limitations (honest)

- No code signing yet (needs OV/EV cert purchase) — auto-update unverified.
- Offline action queue not built (flag reserved) — offline devices read-only until reconnect.
- Fail-open outbox until G2 verification (logged, metered via deadLettered).
- Legacy global emits remain until per-module Phase C removal.
- `sandbox:true` not set on Electron windows (needs EXE smoke test).

## 8. Restore-drill log

| Date | Backup file | Test DB | Result | By |
|---|---|---|---|---|
| 2026-11-19 | database/backups/dr-drill-2026-11-19T02-52-43.sql.kbak (AES-256-GCM، حُذف النص الصريح بعد التشفير، بصمة SHA-256) | karim_restore_test | **PASS** — استعادة كاملة من المشفّر: 181/181 جدولًا، تطابق صفوف (users 28، chart_of_accounts 124، journal_entries 12، journal_lines 24)؛ حُذفت قاعدة التمرين بعدها. ملاحظة تشغيلية: الاستعادة الأولى تتطلب إنشاء القاعدة الهدف فارغة أولًا (نسخة pre-restore تحتاج وجودها) | Hermes audit (خادم تحقق معزول على karim_erp_test، منفذ 5299) |
| 2026-11-19 | database/backups/dr-drill-prod-2026-11-19T19-54-48.sql.kbak (621.6MB مشفر + SHA-256) | karim_restore_test | **PASS — بحجم الإنتاج الكامل**: المصدر karim_erp (747MB، 238 جدولًا) قراءةً فقط عبر pg_dump (MVCC بلا أقفال كتابة). نسخ 48ث + استعادة 37ث = **RTO 85 ثانية**. تطابق 238/238 جدولًا وصفوف: users 177، chart_of_accounts 124، journal_entries 50244، journal_lines 100801، inventory 440، attendance 6914، employees 139. حُذفت قاعدة التمرين؛ النسخة المشفرة أُبقيت كنسخة احتياطية إنتاجية طازجة (ومرآها). الإنتاج لم يُكتب فيه حرف واحد | Hermes audit (أدوات المستودع نفسها: backup.js/restore.js) |

## 9. المراقبة والأهداف (SLO)
- فاحص آلي: `scripts/slo-check.js` (بلا اعتماديات) يقيس 6 أهداف مقابل `/api/metrics` الحي — exit 0 سليم / 1 خرق / 2 تعذر. الأهداف والحدود في `docs/SLO.md`.
- قياس حي موثق (2026-11-19، خادم التحقق): 5xx 0.24%، p95=125ms، lag p99=35.6ms، pool waiting=0، heap 61.8MB — **كل الأهداف محققة**.
- مجسّات اختراق آلية: `scripts/security-probes.js` (15 هجومًا: SQLi/XSS/JWT tamper/alg=none/traversal/CORS/headers/lockout/IDOR/mass-assignment/بث مجهول…) — **15/15 PASS** على المعزول. لا تُشغَّل ضد الإنتاج أبدًا (حارس اسم القاعدة مدمج).
