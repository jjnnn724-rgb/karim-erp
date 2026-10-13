# تقرير تدقيق طبقة قاعدة البيانات — Karim ERP

**تاريخ التدقيق:** 2026-10-10 | **القاعدة:** karim_erp (PostgreSQL 18, localhost) | **المنهجية:** قراءة فقط (pg_stat_user_tables، information_schema، pg_indexes، pg_constraint، pg_trigger + عينات استعلامات) + مراجعة ملفات database/ و backend/*-routes.js.

---

## ملخص تنفيذي (أعلى 10 نتائج)

1. **[مرتفع] جداول Oracle المرآة بلا فهرس نهائي:** 53 جدول `ora_*` تحتوي **1,384,198 صف (~89% من كل البيانات، ~450MB)** ولا تحوي أي فهرس ولا Primary Key (تحقق: `pg_indexes` فارغة لها، `pg_constraint` بلا PK). أكبرها `ora_cc_bill_enter3` (443,600 صف)، `ora_e_invline` (441,625)، `ora_cc_bills3` (286,398) — كل عملياتها seq scan. حتى لو كانت استيراد YaraSoft التاريخي، أي مراجعة/بحث مستقبلي سيقرأ الـ1.4M صف بالكامل.
2. **[مرتفع] 63 جدولًا فارغًا = ميزات غير مكتملة أو مهجورة:** `pos_orders`، `orders`، `order_items`، `payroll`، `payroll_runs`، `payroll_adjustments`، `salary_advances`، `employee_contracts`، `employee_evaluations`، `budgets`، `bank_statements`، `fixed_assets`، `inventory_transfers` (+items/events)، `kitchenReturns`، `kitchen_audits`، `weightReadings`، `event_outbox`، `attendance_push_queue` — كلها 0 صف بالعدّ الفعلي. المبيعات الفعلية تمر عبر `revenues` (29,015) و `ys_mirror_orders` (12,492) بينما جداول POS_relationales ميتة، ونظام payroll غير مستخدم إطلاقًا رغم وجود رواتب حقيقية للموظفين في `employees.salary`.
3. **[مرتفع] قسمان متضاربان للم部門ات:** `departments` (21 كود، FK لـ dispatches.deptCode) و `hrDepartments` (24 كود، FK لـ employees.department) — **9 أكواد موجودة في hrDepartments وغير موجودة في departments** (KITCHEN, SERVICE, WAREHOUSE, ADMIN, PURCHASING, MAINTENANCE, JUICE, STUZBEK, UZBEK)، ومعرّفات hrDepartments مختلطة بين صغيرة (201-204) وعملاقة صناعية (1790885224406, 1791000000000001…). النتيجة: مستخدم واحد على الأقل بـ `dept_code='WAREHOUSE'` لا يطابق جدول departments، والربط بين قسم الموظف وقسم الإذن غير مضمون.
4. **[مرتفع] النسخ الاحتياطية مزدحمة بملفات عملاقة وفاشلة:** `database/backups/` يحوي 8 ملفات SQL plain بحجم ~500MB لكل منها (نسخ 10-05 و10-08 و3 نسخ pre-restore بتاريخ 10-07) + `recovery-data-20260921.sql` (486MB) + **`karim_erp-nightly-20261006.dump` بحجم 0 بايت (نسخة فاشلة لم تُحذف)** + ملفات `*.sql.env` تحمل `DB_PASSWORD` بجانب النسخ + `docker-deploy/full-backup.sql` بحجم 492MB داخل المستودع نفسه. النسخ الليلية الحديثة (10-10, 58MB, watchdog ok) سليمة، لكن الفوضى تهدد الاستعادة السريعة.
5. **[متوسط] جداول backup مؤقتة عالقة داخل القاعدة:** `employees_backup_pre_dedup_20261001` (264 صف)، `employees_backup_pass2_20261001` (181)، `employees_backup_pre_dept_20261001` (138)، `employees_backup_pre_shift_20261001` (137)، `veg_requests_backup_20261010` (4)، `ora_acc_mov_old` (39)، `ora_back1` (11) — كتل تفريغ (heap) بلا فهارس، كتبت كنسخ أمان أثناء تنظيفات أكتوبر ولم تُحذف.
6. **[متوسط] تدقيق الم变动 (audit triggers) مقتصر على users + POS:** يوجد 16 trigger فقط؛ التدقيق يغطي `users` (trg_users_audit → log_users_changes) وسلسلة POS (pos_orders/pos_order_items/pos_products/pos_invoice_payments/pos_shift_sessions) وضمانات `journal_entries`. **الجداول الحرجة بلا أي trigger تدقيق:** `employees`، `attendance`، `attendance_logs` (52k صبعة)، `inventory`، `inventory_ledger`، `dispatches`، `journal_lines`، `expenses`، `revenues`، `suppliers`، `settings`. أي تعديل يدوي على المخزون أو الحضور أو الأستاذ لن يترك أثرًا.
7. **[متوسط] تتبّع الهجرات مزدوج وله سجل معلّق:** التتبع عبر `schema_migrations` (103 صف) + ملف `database/data/.migrations_applied` (backfill منذ إصلاح R5 بتاريخ 2026-10-03). كل الملفات 001–097 مطبّقة عدا `006_demo_seed.sql` ( intentionally demo ). لكن يوجد سجل ميت: **`085_shift_schedules.sql` مسجّل في schema_migrations بينما الملف غير موجود على القرص** (استُبدل بـ 086_drop_shift_schedules الذي يحذف الجدول). كما توجد تصادمات ترقيم: 051 مرتين، 086 مرتين، 087 مرتين، 089 مرتين، و060/061 كلاهما catch_weight — ترقيم يهدد ترتيب التطبيق.
8. **[متوسط] فهارس متطابقة/مكررة تهدر الكتابة:** `dispatches`: `idx_dispatches_dept_code` و `idx_dispatches_deptcode` معرّفان متطابقان تمامًا على ("deptCode")؛ `attendance`: `uq_attendance_employee_date` (فريد) تغطّي نفس عمودي `idx_attendance_employee_date`؛ `inventory`: `idx_inventory_quantity` (qty) مكررة داخل `idx_inventory_stock` (qty,minQty). كل كتابة على هذه الجداول تدفع تكلفة فهرس إضافية بلا فائدة.
9. **[منخفض] صفحات حرجة بلا فهارس جماعية (hot tiny tables):** `chart_of_accounts` (28 صف = **244,593 seq scan**)، `accounting_periods` (12 صف = 234,066)، `attendance_devices` (1 صف = 122,019)، `devices_sync_state` (1 = 16,381)، `zatca_settings` (1 = 22,423)، `departments` (21 = 16,787 بلا idx_scan)، `employees` (136 = 22,524)، `users` (173 = 10,807). الاستعلامات تمسح الجداول كاملة في كل نداء — صغير الحجم حاليًا لكنه عادة تصميم تستهلك CPU مع كل نداء حضور/دفتر.
10. **[منخفض] نفايات مستودع في الجذر:** ملف **`NUL`** (اسم محجوز في Windows — خطر على أدوات النسخ/الحذف)، ملف **`{console.log(b.slice(0`** (0 بايت، كود متسرب من console)، `2026-10-05` (205 بايت)، `query`/`start`/`stop` (17 بايت، محتوى "KarimERP-Server")، إضافة إلى `docker-deploy/full-backup.sql` (492MB) ومجلد جذر `backups/` فارغ تمامًا (إنشاء مهجور 10-04).

---

## جدول الجداول (حسب النطاق)

**الإجمالي: 206 جدولًا | ~1,549,235 صف (تقدير n_live_tup بعد analyze 2026-10-07/10) | 458 فهرسًا | 126 جدولًا بلا FK | 63 جدولًا فارغًا.** العدّ الفعلي مُتحقَّق منه للمجاميع الحرجة أدناه.

### المرآة YaraSoft/Oracle (53 جدول `ora_*` + ys/yara) — 1,396,748 صف

| الجدول | الصفوف | ملاحظة |
|---|---|---|
| ora_cc_bill_enter3 | 443,600 | فواتير مركز تكلفة — بلا فهرس/PK |
| ora_e_invline | 441,625 | بنود فواتير — بلا فهرس/PK |
| ora_cc_bills3 | 286,398 | بلا فهرس/PK |
| ora_e_invoices | 80,000 | بلا فهرس/PK |
| ora_acc_mov | 75,000 | بلا فهرس/PK |
| ora_bill_enter6 | 36,275 | بلا فهرس/PK |
| ora_bill_enter4 | 8,839 | |
| ys_mirror_orders | 12,492 | مفهرسة (doc_no PK، doc_date، cashier_no) — نشطة |
| invoice_import_log | 29,027 | مفهرسة جيدًا (status/ext/hash) — نشطة |
| yarasoft_revenue_map | 23 | |
| 42 جدولًا آخر ora_* + ys_* | ≤3,948 لكل منها | أرصدة، حسابات، عملاء، دفعات… إلخ |

### الحضور والموارد البشرية — 61,124 صف

| الجدول | الصفوف | ملاحظة |
|---|---|---|
| attendance_logs | 52,076 | سجل بصمات الأجهزة — مفهرس (time/employee/dedup) |
| attendance | 3,123 | يومي — uq(employeeId,date) مكرر مع idx مساوٍ |
| attendance_decisions | 929 | |
| employee_shift_history | 390 | |
| zk_device_users | 156 | |
| punch_attempts / punch_settings / punch_devices / face_templates v1+v2 | 88/19/13/8/9 | |
| device_sync_state | 1 | 16,381 seq scan |
| employees | 136 | 12 عمودًا؛ department نصي FK→hrDepartments(code) |
| users | 173 | 10 أدوار كلها ضمن القائمة المعتمدة (schema-registry.js) |
| hrDepartments | 24 | كودات مختلطة الحالة + معرفات صناعية |
| departments | 21 | كودات POS/الأقسام — 9 كودات غير مغطاة في hrDepartments反过来 |
| attendance_devices | 1 | 122,019 seq scan لجدول بصف واحد |
| attendance_push_queue | 0 | ميزة معلّقة |
| employee_contracts / employee_evaluations / payroll / payroll_runs / payroll_adjustments / salary_advances / advance_applications | 0 | **كامل نظام payroll وعقود فارغ** |
| 4 جداول employees_backup_* | 720 إجماليًا | نسخ أمان أكتوبر عالقة |
| leaveRequests / leaveTypes / roster_approvals / leave_approval_* | 1/4/25/1+1 | سير إجازات 3-مراحل جديد (1 إجازة فقط) |

### المخزون والتوزيع — 4,164 صف

| الجدول | الصفوف | ملاحظة |
|---|---|---|
| inventory_ledger | 1,647 | مفهرس جيدًا (idempotency، item+location، reference) |
| inventoryTx | 1,528 | قديم — يُطبع 5,280 seq scan مقابل 2,425 idx |
| inventory_location_balances | 760 | مجموع on_hand = 4,593.57 = مجموع inventory.qty تمامًا ✓ |
| inventory | 342 | qty≥0 ✓، shelfId NULL دائمًا (shelves فارغ) |
| inventory_audit_items | 293 | |
| dispatches | 73 | كل deptCode صالح في departments ✓ — 58 approved |
| dispatch_workflow_events | 168 | |
| inventory_transfers (+items/events) / kitchenReturns / weightReadings | 0 | ميزات مستقبلية فارغة |

### المحاسبة والمالية — 54,536 صف

| الجدول | الصفوف | ملاحظة |
|---|---|---|
| revenues | 29,015 | مفهرسة (date، deptId، pos_order_id) — مصدر إيرادات فعلي |
| journal_lines | 16,069 | مفهرسة (entry/account/cc) — **بلا trigger تدقيق** |
| journal_entries | 8,011 | triggers ضمان ترحيل + مطابقة رصيد |
| expenses | 701 | |
| chart_of_accounts | 28 | 244,593 seq scan |
| accounting_periods | 12 | 234,066 seq scan |
| budgets / bank_statements / fixed_assets | 0 | ميزات فارغة |
| fiscal_years / cost_centers / tax_config / zatca_settings | 1 لكل | |

### المشتريات والمستودعات — 159 صف: suppliers (18)، purchaseInvoices (71)، supplier_payments (66)، purchase_requests (3)، purchase_request_events (4)، supplier_tax_audit (1).

### POS — 400 صف تقريبًا: pos_refresh_tokens (197)، pos_audit_logs (158)، pos_products (10)، pos_password_reset_codes (8)، pos_shift_sessions (3)، pos_day_closes (1)… **جداول البيع pos_orders/pos_order_items/pos_held_orders/pos_stock_movements فارغة (0)** — الواجهة البارزة للنظام لا تنتج بيانات إطلاقًا.

### واتساب وتنبيهات — 5,579 صف: wa_events (4,921)، wa_outbox (147)، wa_inbox (136)، wa_processed (136)، wa_rules (19)، wa_settings (11)، notifications (691)، client_event_ack (129)، internal_chat (3)… حمل wa_outbox صغير (45k seq/135k idx).

### النظام — schema_migrations (103)، settings (1)، app_state (1)، alert_state (3)، admin_delete_audit (13)، permission_audit (14)، user_change_log (1)، menu_board_settings/menu_weekly (1+1)، veg_requests (1)…

---

## قائمة المشاكل (بالتفصيل)

| # | الخطورة | المشكلة | الدليل | الإصلاح المقترح |
|---|---|---|---|---|
| 1 | 🔴 مرتفع | 53 جدول `ora_*` (1.38M صف، ~450MB) بلا PK أو أي فهرس | `pg_indexes` لا يحوي أي `ora_*` عدا ora_table_meta؛ `pg_constraint` بلا PK لـora_e_invline؛ seq_scan=18-20 لكل منها وidx_scan=NULL | أضف PK افتراضي أو فهارس على أعمدة البحث (doc_no, doc_date, party_code)؛ أو انقل البيانات إلى أرشيف مقفل/UNLOGGED واحذفها من القاعدة النشطة |
| 2 | 🔴 مرتفع | 63 جدولًا فارغًا يشمل منظومة payroll وcontracts وbudgets وPOS_relationales كاملة | عدّ فعلي = 0 لـ pos_orders, orders, payroll, payroll_runs, employee_contracts, budgets, fixed_assets, inventory_transfers, kitchenReturns… | قرّر: إما تفعيل الميزات وربطها بالواجهة، أو حذف/أرشفة الجداول وتوثيق القرار في DEVELOPMENT-ROADMAP |
| 3 | 🔴 مرتفع | departments و hrDepartments غير متزامنين (9 كودات فارقة + معرفات صناعية 17910000000000xx) | `SELECT h.code FROM hrDepartments h WHERE NOT EXISTS (departments d…)` = 9 أكواد؛ users ب dept_code='WAREHOUSE' خارج departments | اجعل `departments` مصدرًا واحدًا، اجعل hrDepartments عرضًا/مرآة، أو أضف trigger/mview للمزامنة؛ صحّح كود WAREHOUSE→storeroom |
| 4 | 🔴 مرتفع | نسخ احتياطية مزدحمة: 8 ملفات ~500MB + recovery 486MB + dump فاشل 0 بايت + .sql.env بكلمات مرور + 492MB مكرّرة داخل docker-deploy/ | `karim_erp-nightly-20261006.dump` = 0 بايت؛ `horus-horus_erp-2026-09-17….sql.env` يحوي DB_PASSWORD؛ `docker-deploy/full-backup.sql` = 492MB | احذف الملفات الفاشلة والقمامة، انقل النسخ الكبيرة خارج المستودع (أو git-annex/تشف remote)، ارفع أمان المجلد لأن .sql.env مكشوف، اجعل политика الاحتفاظ 7 أيام تُطبّق على .sql أيضًا لا .dump فقط |
| 5 | 🟠 متوسط | 7 جداول backup داخل القاعدة (720+ صف) | employees_backup_* ×4 (2026-10-01)، veg_requests_backup_20261010، ora_acc_mov_old، ora_back1 | بعد التأكد من سلامة التنظيف: `DROP TABLE` مع تسجيلها في migration صغير |
| 6 | 🟠 متوسط | صفر تدقيق على الجداول المالية/التشغيلية الحرجة | `pg_trigger`: 16 trigger فقط؛ users وPOS وحدها مغطاة؛ attendance_logs/inventory_ledger/journal_lines/dispatches/expenses بلا أي trigger | أنشئ trigger تدقيق قياسي (BEFORE UPDATE/DELETE) لـ journal_lines, inventory_ledger, dispatches, employees, attendance — أو عرّض تدفقات الكتابة عبر دالـة واحدة تسجّل actor |
| 7 | 🟠 متوسط | سجل معلّق في schema_migrations + تصادم ترقيم الهجرات | `085_shift_schedules.sql` مسجّل والمفقود؛ أرقام مكررة: 051×2, 086×2, 087×2, 089×2, catch_weight بـ060 و061 | احذف سجل 085 الميت (أو وثّقه كـ dropped)، اعتمد ترقيمًا تسلسليًا فريدًا (yyyyMMdd-NN) مستقبلًا، وأضف تحققًا في run-migration.js يرفض التصادم |
| 8 | 🟠 متوسط | فهارس متطابقة/مكررة | idx_dispatches_dept_code ≡ idx_dispatches_deptcode؛ idx_attendance_employee_date مغطى بـ uq_attendance_employee_date؛ idx_inventory_quantity مغطاة بـ idx_inventory_stock | `DROP INDEX` للنسخ الأضيق/الأقدم ضمن migration |
| 9 | 🟡 منخفض | صفحات حرجة تُمسح بالكامل في كل نداء (seq_scan تراكمي منذ إنشاء القاعدة — stats_reset=NULL) | chart_of_accounts 244,593 و accounting_periods 234,066 و attendance_devices 122,019 و departments 16,787 (idx_scan=0!) و users 10,807 و employees 22,524 seq scan | أضف فهارس COALESCE/Partial أو ا-cache هذه الصفحات الصغيرة في الذاكرة (لا داعي لـSELECT كامل في كل حضور) |
| 10 | 🟡 منخفض | نفايات المستودع وأخطاء Windows | `NUL` (محجوز)، `{console.log(b.slice(0`، `2026-10-05`، `query`، `start`، `stop` (محتوى KarimERP-Server)، مجلد `backups/` جذري فارغ، `logs/_demo-products.sql` | احذفها من git ومن القرص (احذر: حذف NUL يحتاج `fsutil file delete` أو cmd del) |
| 11 | 🟡 منخفض | users↔employees غير مكتمل الربط | 39 مستخدمًا بلا موظف مقابل (173 مستخدم مقابل 136 موظف)؛ 2 موظف بلا userId؛ صفر انتهاك FK (سليم) | راجع حسابات kitchen/dept_head بدون ملف موظف؛ اربط أو أرشف الحسابات اليتيمة؛ أضف تطبيقًا يمنع إنشاء مستخدم موظف بلا سجل موظف |
| 12 | 🟡 منخفض | أعمدة attendance بصيغة نصية HH:MM رغم وجود أعمدة timestamp | 1,242 صفا checkOut نصيًا "أصغر من" checkIn (وردية ليلية: 15:40→03:52) — صفر تنسيقات خاطئة، 59 صفا مفتوحًا بلا خروج؛ workMinutes محسوب حاليًا | وحّد المصدر على checkInAt/checkOutAt (timestamps) واجعل HH:MM عرضًا فقط؛ فكّر بـCHECK للوردية الليلية |
| 13 | 🟡 منخفض | تتبّع الهجرات على ملفين (schema_migrations + .migrations_applied) مع backfill بالاستعلامات المُركّبة نصيًا | run-migration.js:16-38 (إدراج ON CONFLICT من ملف JSON) | أبقِ الجدول مصدرًا وحيدًا، اجعل الملف للتوافق المؤقت واحذفه بعد انتقال كل الأجهزة |

**إيجابيات مُتحقَّق منها:** صفر انتهاك FK (كل الـ FK مُتحقَّق منها convalidated=true)؛ users↔employees وattendance↔employees وdispatches↔departments نظيفة orphan-wise؛ مخزون `inventory.qty` مطابق تمامًا لمجموع `inventory_location_balances.on_hand` (4,593.57)؛ صفر كميات سالبة أو avgCost سالب؛ صفر أرقام موظفين مكررة؛ كل كلمات المرور bcrypt/argon2؛ كل الأدوار المستخدمة ضمن القائمة المعتمدة؛ الفهارس الأساسية للجداول الكبيرة النشطة (attendance_logs, invoice_import_log, revenues, journal_lines, ys_mirror_orders, inventory_ledger) ممتازة؛ النسخ الليلية تعمل يوميًا مع watchdog ومراقبة.

---

## إحصاءات

| المؤشر | القيمة |
|---|---|
| عدد الجداول (public) | 206 |
| إجمالي الصفوف (تقدير n_live_tup) | ~1,549,235 |
| — منهم جداول ora_* (مرآة) | 1,384,198 (89.3%) |
| جداول فارغة (0 صف) | 63 (30.6%) |
| عدد الفهارس | 458 |
| جداول بها PK/فهرس وحيد فقط | 27 |
| جداول بها FK | 80 (بلا FK: 126) |
| FKs غير مُتحقَّق منها (NOT VALID) | 0 |
| انتهاكات FK مكتشفة (عينات حرجة) | 0 |
| عدد الـ Triggers | 16 (تدقيق: users + 5 جداول POS + ضمانات journal_entries) |
| عدد الهجرات المطبقة | 103 (schema_migrations = .migrations_applied) |
| ملفات .sql في database/migrations | 104 (001–097 مع 051/086/087/089 مكررة + 062a/067a) |
| حجم أكبر 3 جداول | ora_cc_bills3 138MB، ora_cc_bill_enter3 137MB، ora_e_invoices 89MB |
| حجم النسخة الليلية الحديثة | 58MB (2026-10-10, ok) |
| إجمالي تقريبي لملفات النسخ في database/backups | >3.5 GB (8 ملفات ~500MB + recovery 486MB + dumps) |
| آخر تحديث لمخطط ملف (migrations) | 097_menu_weekly.sql — 2026-10-09 |
| وجود db/schema.sql | غير موجود — القاعدة تُبنى من migrations فقط (لا يوجد schema موحّد للتدقيق/المقارنة) |
| قيم شاذة: أوقات حضور خارج 00:00–23:59 | 0 |
| قيم شاذة: كميات مخزون سالبة | 0 |
| قيم شاذة: أرقام موظفين مكررة | 0 |
| دور مستخدم خارج القائمة المعتمدة | 0 (10 أدوار فريدة، كلها ضمن schema-registry.js) |
| روابط users↔employees يتيمة | 39 مستخدم بلا موظف + 2 موظف بلا مستخدم |

*ملاحظة منهجية: أرقام الصفوف من `pg_stat_user_tables.n_live_tup` (آخر analyze: 2026-10-07/10-10) عدا الجداول التي تحققت منها بالعدّ الفعلي (users=173, employees=136, attendance=3123, inventory=342, dispatches=73, pos_orders=0, payroll=0, orders=0, journal_entries/lines…). إجراءات التدقيق كانت SELECT فقط ولم تُ modific أي بيانات.*
