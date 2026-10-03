# KARIM ERP — تقرير الجرد الشامل (المرحلة 1)
**التاريخ:** 2026-10-03 · **الوضع:** READ-ONLY · **ملفات معدلة:** صفر (هذا التقرير فقط)
**المرجع:** Enterprise 10/10 Master Directive v1.0 — Stage 1 Complete Inventory
**الإصدار المشغّل:** backend/package v4.8.0 (الموبايل versionName 4.9.1، SW CACHE_VERSION 4.23.0 — انظر المخاطر)
**الفروع:** `refactor/esm-migration` (الحالي)، `main`

---

## 0. ملخص تنفيذي

نظام ERP مطعم أحادي العملية (Single Express process) يعمل فعليًا في إنتاج حقيقي:
Node.js + Express خام فوق PostgreSQL 18 (بدون ORM) + vanilla ESM SPA + Capacitor/Android + Electron + PWA offline،
مع تكاملات خارجية حية: **ZKTeco** (بصمة TCP مباشر)، **Yarasoft/Oracle** (مرآة فواتير حية عبر oracledb)، **WhatsApp** (Baileys داخل العملية)، **ZATCA**، **Cloudflare/Tailscale/zrok/duckdns** (وصول خارجي).

**الحجم:** ~90,000 سطر كود (خلفية 46.7K + واجهة 24.2K + سكربتات تشغيل 8.9K + اختبارات 10.4K) — **200 جدول** قاعدة بيانات (527MB)، 94 ملف ترحيل، 68 جناح اختبار Jest + أطقم smoke/integration/e2e.

**الحالة العامة:** بنية تحتية ناضجة غير معتادة لحجم مشروع فردي (outbox، idempotency، circuit breaker، health probes، metrics، RBAC، audit) — لكن توجد **فجوات مالية جوهرية** (GL شبه فارغ) و**مخاطر أمنية حقيقية** (مفاتيح خاصة متتبعة في git) موثقة بالأدلة أدناه.

---

## 1. المستودع والتحكم بالإصدارات

| البند | الحقيقة | الدليل |
|---|---|---|
| مستودع Git | موجود (`.git/HEAD` → `refs/heads/refactor/esm-migration`) | `.git/HEAD` |
| الفروع | `main` + `refactor/esm-migration` | `.git/refs/heads/` |
| **أداة git** | **غير مثبتة على الجهاز** (`git` غير معروف في PATH) — لا يمكن تشغيل status/log/ls-files | فحص shell |
| آخر commits (من `.git/logs/HEAD`) | "security+finance: notifications route jwtAuth (hole closed)"، "quality: 9-of-10 plan phase 1-3"، "hardening milestone 2026-10-02" | `.git/logs/HEAD` |
| `.env` متتبع؟ | **لا** — `.gitignore` يستثنيه صراحة | `.gitignore` |
| **ملفات سرية متتبعة** ⚠️ | `tools/mkcert/CA/rootCA-key.pem` (مفتاح CA خاص!)، `android/app/release.keystore`، `docker-deploy/full-backup.sql` (نسخة DB كاملة) | `.git/index` parse |
| بقايا تشغيلية بالجذر | `*.tmp.txt/cjs/json`، `deleted_employees_20261001.csv` (تصدير PII)، `NUL` (158KB) | `dir` الجذر |
| نسخ كود أرشيفية | `karim-erp-backup-pre-v71/` (بالجذر الخارجي) + `backups/code-pre-v7.1-*/` (snapshot كامل بنسخ `.env` متعددة الأجيال) | `dir` |

---

## 2. حجم الكود

| المنطقة | ملفات | LOC | ملاحظة |
|---|---|---|---|
| `backend/` | 166 | **46,739** | ملف واحد `server.js` = 148K+ سطر (~30%) |
| `frontend/app/js/` | 44 | **24,178** | أكبر ملفين: warehouse.js 183KB، kitchen.js 174KB |
| `scripts/` | 66 | **8,884** | تشغيل/ترحيل/نسخ/تدقيق |
| `tests/` | 78 | **10,350** | 68 جناح Jest + harnesses |
| `database/migrations/` | 94 | — | SQL من 001 إلى 091 |

---

## 3. قاعدة البيانات (karim_erp — PostgreSQL 18)

### 3.1 الأشياء
| النوع | العدد |
|---|---|
| جداول أساسية | **200** |
| Views | 1 (`v_pos_cashier_dashboard`) |
| Foreign Keys | 135 |
| UNIQUE constraints | 59 |
| CHECK constraints | **893** (كثافة عالية جدًا — قيد على مستوى القاعدة) |
| Triggers | 24 (معظمها POS: تدقيق تلقائي، منع تعديل التدقيق، سلسلة هاش فواتير، توجيه إيرادات، التقاط حركة مخزون) |
| Indexes | 447 |
| Sequences | 54 |
| Extensions | `pgcrypto`, `pg_trgm` |
| حجم القاعدة | **527 MB** |

### 3.2 خريطة الجداول حسب الوحدة (أسماء فعلية من information_schema)
- **محاسبة:** `chart_of_accounts`, `journal_entries`, `journal_lines`, `accounting_periods`, `fiscal_years`, `cost_centers`, `budgets`, `fixed_assets`, `tax_config`
- **POS/مبيعات:** `pos_orders`, `pos_order_items`, `pos_invoice_payments`, `pos_shift_sessions`, `pos_day_closes`, `pos_cash_custody`, `pos_products`(+`pos_product_ingredients`, `pos_recipe_versions`), `pos_stock_movements`, `pos_refresh_tokens`, `pos_idempotency_keys`, `pos_zatca_invoice_queue`, `pos_audit_logs`, `orders`/`order_items` (قديمة)
- **مخزون:** `inventory`, `inventoryTx`, `inventory_ledger`, `inventory_locations`, `inventory_location_balances`, `inventory_transfers`(+items/events), `inventory_audits`(+items/workflow), `shelves`, `recipes`, `weightReadings`
- **مشتريات:** `purchaseInvoices`, `purchase_requests`(+events), `suppliers`, `supplier_payments`, `supplier_tax_audit`
- **مطبخ:** `kitchen_audits`, `kitchen_exceptions`, `kitchen_policies`, `kitchen_production_batches/distributions/events`, `kitchenReturns`, `dispatches`, `dispatch_workflow_events`
- **HR/حضور:** `employees`, `hrDepartments`, `departments`, `users`, `attendance`, `attendance_logs` (50K صف), `attendance_decisions`, `attendance_devices/tokens/push_queue`, `punch_devices/attempts/face_templates(_v2)/settings`, `leaveTypes`, `leaveRequests`, `leave_approval_workflows/events`, `payroll`, `payroll_runs`, `payroll_adjustments`, `salary_advances`, `advance_applications`, `employee_contracts/evaluations/shift_history`, `hr_card_settings`, `zk_device_users`
- **تكامل Yarasoft/Oracle:** **52 جدول `ora_*`** (مرآة staging) — الأكبر: `ora_cc_bill_enter3` (443,600)، `ora_e_invline` (441,625)، `ora_cc_bills3` (286,398) + `yarasoft_product_mapping`, `yarasoft_quality_quarantine`, `yarasoft_revenue_map`, `yarasoft_review_items`, `ys_mirror_orders`, `ys_daily_closings`, `ys_assets`, `ys_customers`, `invoice_import_log` (22K)
- **واتساب:** 25 جدول `wa_*` (`wa_events` 3.7K, `wa_outbox`, `wa_inbox`, `wa_conversation_history`, `wa_campaigns`, `wa_workflows`, `wa_nlu_analytics`...)
- **بنية تحتية:** `event_outbox` ✅ (Outbox transactional موجود)، `idempotency_keys` ✅، `client_event_ack`, `device_sync_state`, `schema_migrations` (**فارغ — 0 صفوف**)، `app_state`, `settings`, `notifications`, `internal_chat`, `admin_delete_audit`, `system_reset_audit`, `permission_audit`, `pos_password_reset_codes`
- **جداول تشغيلية يدوية:** 4 جداول `employees_backup_*_20261001` (بقايا عملية dedup — أرشيفية)

### 3.3 الترحيلات (Migrations)
- **94 ملف** `NNN_name.sql` من `001_schema.sql` إلى `091_attendance_on_leave.sql` — بفجوات (لا 085) وأرقام مكررة (`051`×2، `089`×2، لاحقات a/b).
- **آلية التتبع:** ملف `database/data/.migrations_applied` (**96 مدخلًا** — مطابق) عبر `database/scripts/run-migration.js` (`npm run migrate`; CI يشغله).
- ⚠️ جدول `schema_migrations` **بقاعدة البيانات فارغ تمامًا** — تتبع التطبيق يعيش **خارج القاعدة** (نقطة عمياء للتدقيق المباشر من SQL، وخلط بين آليتين).
- ⚠️ دليل انحراف DDL: تقرير الاكتشاف السابق وثّق جداول تُنشأ وقت التشغيل بلا ملف ترحيل (`attendance.on_leave` عولج لاحقًا في `091`، و`leave_approval_*` كانت runtime-DDL).

### 3.4 الأعداد الحية (أعلى 25 جدولًا)
`ora_cc_bill_enter3` 443,600 · `ora_e_invline` 441,625 · `ora_cc_bills3` 286,398 · `ora_e_invoices` 80,000 · `ora_acc_mov` 75,000 · `attendance_logs` 50,791 · `invoice_import_log` 22,396 · `revenues` 22,338 · `ys_mirror_orders` 5,818 · `wa_events` 3,724 · `attendance` 2,450 · `pos_refresh_tokens` 496 · `employees` 137 · **`journal_entries` 2 · `journal_lines` 4**

> 🔴 **إشارة مالية جوهرية:** دفتر اليومية العام يحتوي **قيدَين فقط** رغم 22K إيراد ونشاط POS حي — النواة المحاسبية مبنية (جداول + محرك + صفحة CFO) لكن التدفق الفعلي إليها شبه معدوم. يُحسم في Stage 2 (أي مسارات تُنشر فعلًا إلى GL؟).

### 3.5 النسخ الاحتياطي
- **3 آليات متوازية:** `scheduleBackup()` عند الإقلاع (throttle 15 ثانية)، مهمة مجدولة `KarimERP-NightlyBackup` (03:00، pg_dump -Fc + latest + إزالة >3 أيام)، `KarimERP-Backup` (02:00، شامل: DB+code+.env+SSL+Yarasoft إلى `C:\KarimData\backups`).
- موجودة فعلًا: `karim_erp-nightly-20261002/03.dump` + `latest.dump` + SQL مؤرخة ببصمات `.sha256` + مجلدات drills.
- أدوات استعادة: `restore.js`, `restore-windows.bat`, `restore-all.ps1` + اختبار `restore-safety.test.js` (68 جناح يشمل restore-safety وdaily-backup-schedule).

---

## 4. الخلفية (backend/ — 166 ملف، 46.7K LOC)

### 4.1 خريطة الوحدات (من dir + تقرير الاكتشاف V6.0 + قراءة الجلسة)
| منطقة | الملفات الرئيسية | الوظيفة |
|---|---|---|
| القلب | `server.js` (~148K سطر) | Express كامل: CRUD عام لـ **25 كيانًا** + مصادقة + real-time + dispatches workflow |
| HR | `hr-routes.js` (92K)، `attendance-engine.js` (64K)، `attendance-portal-routes.js`، `shift-day.js`، `shifts-engine.js`، `leave-workflow-routes.js` | حضور/انصراف 4 قنوات بصرية، تصنيف البصمات، ورديات ثابتة، إجازات 4 مراحل |
| مالي | `finance-routes.js`، `accounting-routes.js` (postJournal)، `accounting-periods.js`، `accounting-growth.js`، `tax-rule-service.js`، `budget-alerts.js` | P&L، دفتر يومية، فترات، ضرائب |
| مخزون/مستودع | `warehouse-routes.js` (185K — الأكبر)، `inventory-control-routes.js`، `inventory-transfer-routes.js`، `inventory-ledger.js`، `stocktaking-routes.js`، `procurement-routes.js` (52K) | حركات، جرد، تحويلات، مشتريات |
| مطبخ/كاشير | `cashier-module/` (14 ملف: complete-sale, pos-orders, day-close, zatca, escpos, kot...)، `kitchen-production-routes.js` | بيع POS كامل + ZATCA + طباعة |
| تكاملات | `zkteco/` (TCP client بروتوكول pyzk، port 4370)، `yarasoft/` (13 ملف: parser, oracle-*, importer...)، `whatsapp-engine/` (20 ملف: Baileys, AI chatbot, scheduler)، `oracle-poll-worker.js` (عامل منفصل) | البصمة، مرآة الفواتير، واتساب |
| تشغيلي | `middleware/` (security, circuit, health, idempotency, correlation)، `errors/`، `logger.js`، `metrics.js`، `rate-limiter.js`، `api-cache.js`، `graceful-shutdown.js`، `startup.js`، `shared-pool.js` | حماية/ملاحظة/مرونة |
| أخرى | `audit-engine/` (6 مجالات فحص)، `realtime/` (outbox, publisher, guard, router, recovery)، `services/`، `schema-registry.js` (قوائم حقول/أدوار الكيانات)، `db-constraints.js` + `db-validation-middleware.js`، `permissions.js`، `notification-service.js`، `manager-briefing.js`، `daily-report-service.js`، `face-engine-v2.js`، `dispatch-notifier.js`، `supervisor-policy.js` | حوكمة |

### 4.2 سطح API
- **CRUD عام** لـ 25 كيانًا: `users, hrDepartments, employees, attendance, leaveTypes, leaveRequests, payroll, departments, revenues, expenses, shelves, inventory, inventoryTx, dispatches, recipes, purchaseInvoices, kitchenReturns, weightReadings, notifications, settings, salary_advances, payroll_adjustments, employee_contracts, employee_evaluations, payroll_runs` — مع schema-registry (حقول مسموحة + أدوار لكل عملية + id محمي).
- **مسارات متخصصة:** `/api/auth/*`، `/api/hr/*` (بصمة/بطاقات/قسم/ورديات/إجازات)، `/api/attendance/portal`، `/api/warehouse/*`، `/api/pos` (كاشير)، `/api/reports`، `/api/accounting*`، `/api/finance`، `/api/procurement`، `/api/inventory-control`، `/api/stocktaking`، `/api/rt/*` (events/ack/version)، `/api/notifications`، `/api/permissions`، `/api/system`، `/api/health/*`، `/api/metrics`، `/api/manager/briefing`، `/api/chat/*`، `zkteco/`، `yarasoft/`، `whatsapp/`.
- **إجمالي المسارات:** 225 (وفق سكربت التدقيق `security-route-audit.js` — تقرير سابق: جميعها مؤمّنة بعد إغلاق ثغرة notifications).
- **حماية عامة:** `x-api-key` + JWT على كل `/api` (استثناءات موثقة: auth، health، بطاقة QR)، حد معدل 4 طبقات، كاش GET بمفتاح session+URL (TTL 10 ثوانٍ، سقف 2000).

### 4.3 العمال والجدولة (Background work)
`zkteco engine` (TCP pull كل 5 ثوانٍ لكل جهاز) · `oracle-poll-worker` (عملية منفصلة، تشغيل حاليًا) · `whatsapp scheduler/sender` · `shift rollover` · `daily-report` · `budget-alerts` · `attendance-push worker` · `print-worker` · `zatca-worker` · `steel-watchdog` (كل 5 دقائق) · `backup-nightly` (03:00) · BullMQ **اختياري ومعطّل** (`SKIP_BULLMQ=1` — SQL + pollers هي المصدر).

### 4.4 المحاسبة والمخزون (مصدر الحقيقة)
- **Outbox transactional موجود فعلًا:** جدول `event_outbox` + `realtime/publisher.js` (FOR UPDATE SKIP LOCKED) + بث بعد COMMIT (تقرير V6.0 ✓ verify).
- **توجيه الإيرادات عبر trigger** (`trg_fn_pos_route_revenue`) — قاعدة تنشر للإيرادات مستقلة عن التطبيق.
- **Idempotency:** جدول + middleware (X-Idempotency-Key، 24 ساعة، 409 عند تعارض) + `pos_idempotency_keys`.
- **سلسلة فواتير POS:** trigger `trg_fn_pos_chain_invoice_hash` قبل الكتابة + طابور ZATCA.
- التكلفة/COGS عبر `inventory_ledger` + `finance-routes.js` (COGS_TYPES = dispatch/dispatch_return، SHRINKAGE = count_correction).

---

## 5. الواجهة والجوال (تفصيل وكيل المسح)

- **SPA بدون framework** (vanilla ESM + window-bridge BRIDGE-001..029): 22 ملف features، قلب core/ (api, config, state, storage, i18n + i18n-auto, pwa, utils)، POS منفصل (`pos.html`/`pos.js`).
- **37 صفحة** موجهة عبر page-router، 9 أدوار بقوائم مختلفة، صلاحيات (grants/denies) تُدمج من `/permissions/me` مع منع admin من الـ denies.
- **العميل:** JWT بالذاكرة فقط + refresh في localStorage (365 يوم) + ترويسة x-api-key + إعادة محاولة 429 مع Retry-After + refresh صامت عند 401.
- **PWA:** sw.js يمنع تخزين `/api` و`/socket.io` نهائيًا، offline shell، background sync للحضور والطلبات.
- **Realtime:** socket.io + تسلسل أحداث دائم (`karim_rt_seq`) + فجوات تُصلح عبر `/api/rt/events?since=` + ACK.
- **الأمان بعرض الصفحات:** ~453 `innerHTML` مقابل ~1,264 نداء `esc()` — انضباط تخفيف موجود لكن أي سطر واحد منسي = sink.
- **Android:** مشروع Gradle حقيقي (minSdk 24/target 35)، إضافة أصلية MockLocationDetector (مكافحة انتحال GPS)، كاميرا + موقع.
- **Electron:** حزمة سطح مكتب كاملة تُقلع PostgreSQL وتشغل الخادم وتحدّث نفسها من GitHub releases.
- **i18n:** قاموس يدوي + طبقة ترجمة DOM تلقائية (MutationObserver).

---

## 6. الاختبارات

- **68 جناح Jest** (10.3K LOC) تغطي: أمن/RBAC (7)، حضور/HR (10)، POS/مطبخ (3)، مستودع/مشتريات (7)، مالية (4)، realtime (4)، منصة/تشغيل (20+: health, idempotency, metrics, backups, windows-service, oracle-resilience, fullchain-regression...)، تكاملات (7).
- **Harnesses إضافية:** smoke (27 فحصًا)، integration (53 فحصًا)، `crud-e2e.js`، `expanded-pos-scenarios.js`، **`tests/load/stress-test.js`** (أُنشئ 2026-10-03: قياس أساسي قبل/بعد + snapshot — النتائج في `tests/load/results/`).
- **الفجوات:** لا اختبارات DOM/UI، smoke/integration تتطلب خادم حي + PG، بقايا `*.tmp.js` بالشجرة.

---

## 7. الأمن والمصادقة (الوضع الفعلي)

| المجال | الوضع | الدليل |
|---|---|---|
| كلمات المرور | bcrypt cost 12 في worker pool، رفض hash غير-bcrypt، سياسة ≥8+حرف+رقم، خزنة مشفرة | `pw-crypto.js`, `jwt-middleware.js` |
| JWT | Access 24h + **دوران refresh عند كل تحديث** + hash مخزّن + إبطال عند تغيير كلمة المرور/الخروج | `cashier-module/jwt-middleware.js` |
| Secrets | فحص قاتل للقيم البديلة في إنتاج | `security-fix-placeholder-secrets.test.js` |
| RBAC | 10 أدوار + grants/denies (deny-first) + قيود schema-registry لكل كيان | `permissions.js`, `073/074` |
| تدقيق | audit-engine (6 مجالات) + مسارات POS بtrigger تدقيق غير قابل للتعديل + `security-route-audit.js` (225 مسار) | `audit-engine/`, `pos_audit_logs` |
| حدود المعدل | عام 100/د، دخول 20/15د (لكل حساب+IP — أُصلح اليوم ليحترم متغير البيئة)، CRUD 200/د + nginx login 5/د | `rate-limiter.js` (إصلاح 2026-10-03) |
| ترويسات | helmet-equivalent + CSP nonce + hppGuard + HSTS عبر TLS | `middleware/security.js` |
| الصحة | live/ready/startup/verbose probes + metrics + event-loop lag | `middleware/health.js`, `metrics.js` |
| **فجوات** | لا قفل حساب عند تخمين كلمة المرور (فقط rate limit) · refresh 365 يوم افتراضيًا · RT_REQUIRE_AUTH=false في الإنتاج الحالي · CORS دائم السماح لـ ts.net/zrok · CSP متساهل (unsafe-inline/eval) | أدلة الوكيل |
| **مفاتيح مكشوفة** | 🔴 مفتاح CA الخاص + keystore أندرويد + نسخة DB كاملة **متتبعة في git** | `.git/index` |

---

## 8. النشر والتشغيل

- **الوضع الحي:** Windows 10 (i5-9500/8GB)، نافذة `serve.js` مشرف (إحياء ذاتي حتى 50 إعادة)، PG 18 مدمج في `database/data` (الكتلة داخل الشجرة!)، HTTPS بشهادة mkcert LAN (`C:\HorusData\certs`).
- **بدائل نشر كاملة:** Dockerfile+compose (+nginx، redis) · aaPanel/PM2 · Windows service (`KarimERP-Service.exe` + watchdog) · Electron installer · pkg exe · APK عبر Cloudflare Tunnel (`karimeg.online`) · CI على GitHub Actions (audit+lint+type+tests على PG16+smoke+build NSIS).
- **سكربتات:** ~30 مشغّل/مثبّت بالجذر + 66 سكربت `scripts/` (منها ~20 تدقيق live بالبايثون، security-route-audit، quality-gate، finance-reconcile).
- **موثوقية:** إحياء ذاتي للمشرف + مهام مجدولة (خدمة ONSTART + watchdog 5 دقائق + backups مجدولة) + keep-awake.

---

## 9. جدول الوحدات المطلوب (Module | Files | LOC | APIs | DB Tables | Services | Tests | Dependencies | Risks)

| الوحدة | ملفات | LOC≈ | APIs | جداول DB | خدمات | اختبارات | اعتماديات | مخاطر رئيسية |
|---|---|---|---|---|---|---|---|---|
| Core/CRUD/Auth | server.js + jwt/permissions + errors | 12,000 | /api/auth، CRUD×25، /permissions | users, app_state, idempotency_keys | schema-registry, api-cache, rate-limiter | security×7, api-cache, permissions | express, jsonwebtoken, bcryptjs | RT_REQUIRE_AUTH=false، 365d refresh، لا قفل حساب |
| HR/حضور | hr-routes, attendance-engine, portal, shifts, leave | 15,500 | /api/hr/*، portal، leaves | attendance×8, employees, leave×4, punch×6, payroll×5 | engine, classify, reconcile | attendance×10, leave-chain, shifts | zkteco, pgcrypto | TZ conflict Cairo/Riyadh، إجازات runtime-DDL (عولج 091)، تجاهل day_off |
| مالي/محاسبة | finance/accounting-routes, periods, tax, budget | 7,500 | /api/accounting، finance، reports | chart_of_accounts, journal×2, periods×2, budgets | postJournal, reconcile scripts | finance×4 | pg | 🔴 GL شبه فارغ (قيدان)، فترات مغلقة بلا فحص في payroll-runs (تقرير V6.0) |
| مستودع/مخزون | warehouse (185K), transfers, control, stocktaking, ledger | 14,000 | /api/warehouse، inventory-control، stocktaking | inventory×12, shelves, inventoryTx | movement service لكل مسار؟ (Stage 2) | stock-ledger, stocktaking×2, procurement | pg | تعدد مسارات UPDATE مباشرة — يحتاج تدقيق مركزية في Stage 2 |
| POS/كاشير | cashier-module ×14, pos.js | 9,000 | /api/pos، orders، day-close | pos_* ×25، orders/orders_items | complete-sale, day-close, escpos | pos-cache, kot, buffet, pos-scenarios | pg, escpos | سلّة POS تُحمّل كاملة بالذاكرة (تقرير V6.0) |
| مطبخ/توزيع | kitchen-production, dispatches, kitchen.js | 6,500 | kitchen, dispatches workflow | kitchen_* ×9, dispatches | chain approval | dept-head-requisition | pg | سلسلة اعتماد حديثة — حساسة |
| بصمة ZKTeco | zkteco/ ×5 | 4,000 | /api/zkteco | zk_device_users, devices, sync_state | TCP client (pyzk-faithful) | zkteco-protocol, punch-* | net | TZ Cairo في 4 مواضع، io.emit بلا rooms |
| Yarasoft/Oracle | yarasoft/ ×13 + poll worker | 8,000 | /api/yarasoft، oracle-data | ora_* ×52, yarasoft_* ×5, ys_* ×4 | parser, mirror, mapping | yarasoft-parser, oracle-resilient, .check×2 | oracledb (thick) | 🔴 1.3M صف staging بلا سياسة أرشفة موثقة |
| واتساب | whatsapp-engine/ ×20 | 7,500 | /api/whatsapp | wa_* ×25 | Baileys, AI, scheduler | whatsapp×3 | baileys, gemini | جلسة داخل العملية، أرقام مديرين فارغة |
| واجهة SPA | frontend ×44 | 24,178 | عميل REST/WS | — | state, storage, i18n, pwa | لا UI tests | chart.js, xlsx, face-api | 453 innerHTML، CDN خارجي، version drift 4.8.2/4.9.1/4.23.0 |
| موبايل/سطح مكتب | android/, electron/, capacitor | 5,000 | — | — | mock-location plugin, auto-update | — | capacitor, electron | 🔴 keystore+كلمات في build.gradle، updater غير موقّع |
| تشغيل/نشر | scripts ×66 + launchers ×30 + windows-service | 8,884 | — | schema_migrations (فارغ) | backup×3, watchdog, doctor | backup×2, windows-service, aapanel | pg_dump, mkcert | 🔴 rootCA-key متتبع، .env في Docker image، git غير مثبت |
| اختبارات/جودة | tests ×78 | 10,350 | — | — | smoke/integration/e2e/load | 68 جناح | jest | بقايا tmp، تتطلب خادم حي |

---

## 10. سجل مخاطر أولي (Stage 1 — يُعمق في Stage 4)

| # | الخطر | النوع | الخطورة | الدليل |
|---|---|---|---|---|
| R1 | مفتاح CA الخاص (`rootCA-key.pem`) + keystore أندرويد + `full-backup.sql` **متتبعة في git** | أمن | 🔴 Critical | `.git/index` |
| R2 | `Dockerfile` ينسخ `.env` داخل الصورة و`.dockerignore` لا يستثنيه + `docker-deploy/.env` ونسخ `.env.*-backup` متعددة بالشجرة | أمن | 🔴 Critical | Dockerfile, dir |
| R3 | GL فارغ عمليًا (قيدان) — المحاسبة غير مشغّلة أو مسارات النشر معطلة | مالي | 🔴 Critical | COUNT journal_lines=4 |
| R4 | نسخ احتياطي مُختبَر جزئيًا فقط (drills موجودة) — لم يُثبت استرجاع كامل موثق حديثًا | DR | 🟠 High | `database/backups/drill*` |
| R5 | تتبع الترحيلات خارج القاعدة (ملف) + جدول `schema_migrations` فارغ + أرقام مكررة | تشغيل | 🟠 High | `.migrations_applied` (96) |
| R6 | تعارض منطقة زمنية Cairo/Riyadh في `zkteco/routes.js` (4 مواضع) — انزياح يوم حضور | بيانات | 🟠 High | تقرير V6.0 §4 |
| R7 | payroll-runs/CRUD بلا فحص فترة مغلقة — إعادة توليد شهر مغلق تكتب فوقه | مالي | 🟠 High | تقرير V6.0 §5 |
| R8 | 1.3M صف `ora_*` staging تنمو بلا سياسة — قاعدة 527MB وستنمعج | أداء | 🟡 Medium | row counts |
| R9 | RT_REQUIRE_AUTH=false في الإنتاج + بث biometric بلا rooms | أمن | 🟡 Medium | `.env`, تقرير V6.0 §8 |
| R10 | version drift: package 4.8.0 / APK 4.9.1 / SW 4.23.0 / CONFIG 4.8.2 | تشغيل | 🟡 Medium | ملفات الإصدارات |
| R11 | `deleted_employees_20261001.csv` (PII) و`*.tmp*` بالجذر + جدول كلمات مرور موظفين خارج المشروع | أمن/امتثال | 🟡 Medium | dir |
| R12 | git غير مثبت على خادم الإنتاج — لا يمكن قص/مراجعة تغييرات في الموقع | تشغيل | 🟡 Medium | shell |
| R13 | CDN خارجي (fonts/jsdelivr) في تطبيق معلن offline | متانة | 🟢 Low | mobile-shell.js |
| R14 | لا UI/DOM tests | جودة | 🟢 Low | tests/ |

---

## 11. المراجع السابقة (تُعتمد كأدلة مكملة)
`DISCOVERY_REPORT.md` (V6.0 2026-09-30 — تعمق مسارات حضور/رواتب/استحقاقات) · `docs/DB-SCHEMA.md` · `docs/ARCHITECTURE.md` + `ARCHITECTURE_CONTRACT.md` · `docs/SECURITY.md` + `PHASE1-SECURITY-REPORT.md` · `docs/KARIM-ERP-FINAL-REPORT.md` · `docs/HANDOVER-2026-09-30.md` · `docs/PLAN-9-of-10.md` · `worklog.md` (120K) · `docs/erp/` سيستقبل تقارير هذه الخطة.

---

## 12. بطاقة نهاية المرحلة (قالب التوجيه)

**STAGE:** 1 — Complete Inventory
**STATUS:** ✅ مكتملة (قراءة فقط — صفر تغيير على الكود/القاعدة)
**DISCOVERED:** 200 جدول/94 ترحيل/25 كيان CRUD/225 مسار/68 جناح اختبار/4 تكاملات حية/3 آليات نسخ/بنية outbox+idempotency موجودة فعلًا؛ فجوات: GL فارغ، أسرار متتبعة، تعارض TZ، تتبع ترحيلات خارجي
**CHANGED:** لا شيء (تقرير فقط)
**NOT CHANGED:** كل الكود والقاعدة
**DB — Migration:** لا شيء · **Rollback:** غير مطلوب · **Verification:** أعداد objects من information_schema مباشرة
**API:** جرد فقط — 25 كيانًا عامًا + مسارات متخصصة (خريطة §4.2)
**Security:** وضع موثق §7 — الأسرار المتتبعة أعلى خطر
**Tests:** جرد فقط — 68 جناح + harnesses (لا تشغيل)
**Financial Reconciliation:** لم تُنفذ بعد (Stage 3) — إشارة أولية: GL فارغ
**Inventory Reconciliation:** لم تُنفذ بعد (Stage 3)
**Risks:** 14 مُسجلة (3 حرجة) — §10
**Evidence:** psql information_schema، `.git` internals، dir/LOC counts، تقرا وكيلي مسح مستقلين، DISCOVERY_REPORT V6.0
**Decisions:** إسقاط وكيل مسح الخلفية الثالث وتعويضه بتقرير V6.0 + قراءات الجلسة (تجنب ازدواجية بأدلة كافية) — البديل المرفوض: مسح يدوي جديد كامل (تكلفة بلا قيمة مضافة)
**Next Stage:** Stage 2 — Deep Understanding: تتبع مسارات البيع/المخزون/المحاسبة end-to-end، وتحديد مصدر الحقيقة لكل قيمة، وحسم سبب فراغ GL
