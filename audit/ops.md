# تقرير تدقيق التشغيل والبنية التحتية (Ops Audit) — Karim ERP

- **تاريخ التدقيق:** 2026-10-10 (ساعة محلية ≈ UTC+3)
- **المشروع:** `C:\Users\DELL\Desktop\k\karimabdelhamedeldsouky\karimabdelhamed12\karim-erp`
- **نطاق المرور:** كل ملفات `*.bat/*.cmd/*.ps1/*.vbs` في (جذر المشروع، `scripts\`، `windows-scripts\`، `windows-service\`، `deploy\`، `docker-deploy\`)، و`Dockerfile`، و`docker-compose.yml`، و`nginx.conf`، وسكربتات `package.json`، وCI (`.github\workflows\ci.yml`)، و`C:\cloudflared`، والمهام/الخدمات المسماة `KarimERP-*`.
- **عدد السكربتات المفحوصة:** 85 ملفًا داخل المشروع (53 `.bat`، 26 `.ps1`، 3 `.vbs`، 3 `.cmd`) + 11 `.bat` في `C:\cloudflared` + 3 ملفات `.sh` في `deploy\aapanel`.
- **طبيعة العمل:** قراءة فقط (read-only) — لم يُعدَّل أي شيء في النظام خارج هذا التقرير.

### قيود التدقيق (محدوديات فحوصات)
1. `git` غير موجود على PATH → تعذّر التأكد أن `.env` غير مُتعهَّد (tracked). قوائم `.gitignore` تذكر `.env` و`docker-deploy/.env` و`nul` و`docker-deploy/full-backup.sql`.
2. فحص قواعد Defender (`Get-MpPreference`) و`Get-NetFirewallRule` رُفض بدون صلاحية administrator → حالة الاستثناءات/القواعد الحالية **غير قابلة للتحقق**، والجداول أدناه تعكس النوايا في السكربتات لا التطبيق الحالي.
3. مخرجات `schtasks /v` على هذا الجهاز تُظهر التواريخ بالتقويم الهجري (سنة 48 = 1448هـ ≈ 2026م) → التواريخ الصحيحة أُخذت من `Get-ScheduledTaskInfo` (ميلادي).
4. `node`/`npm` غير مثبّتين على PATH (Machine أو User) رغم وجود `C:\nodejs\node.exe` (v20.19.0 / npm 10.8.2).

---

## ملخص تنفيذي (Top 10)

1. **كلمة مرور قاعدة البيانات `‹كلمة مرور DB — محذوفة من المستند›` مكتوبة بالنص المفتوح داخل 23 ملفًا** (منها `.env`، `docker-compose.yml`، `docker-deploy\docker-compose.yml`، `scripts\backup-full.ps1:20`، `scripts\restore-all.ps1:31`، `scripts\setup.js:117`، 3 نسخ `.env` للاحتياطي، 7 ملفات `docs\esm-migration\audits\*.js`، 7 ملفات `tests\load\*.js`) → تدوير كلمة المرور + استبدال الأسرار بمتغيرات بيئة أو مدير أسرار.
2. **خدمة `KarimERP-Server` تعمل لكن مسارها مثبّت على مسار سطح مكتب مستخدم** (`C:\Users\DELL\Desktop\k\...\windows-service\KarimERP-Service.exe`) → أي إعادة تسمية/نقل للمجلد يكسر التشغيل عند إعادة الإقلاع. (الاسترداد ذاتي يعمل: `sc qfailure` = إعادة تشغيل ×3 كل 60s.)
3. **5 مهام مجدولة فقط، وكلها بحالة `Ready` وLastResult = 0x0** — لكن **7 مهام مفقودة** تُستدعى من السكربتات: `KarimERP-Morning-Automation`، `KarimERP-Watchdog-SYSTEM` (أُنشئت 10/08 ثم اختفت)، `KarimERP-NightlyBackup` (في `scripts\quality-gate.js`)، `KarimERP-Guardian` (في `steel-watchdog.ps1`)، `KarimERP-Server` (في `scripts\restore-all.ps1:113`)، `HorusERP-Server`/`HorusERP-Monitor` (في `setup-permanent-start.bat`)، إضافة إلى مستندات `KarimERP-Zrok/DuckDNS/Offsite/Backup`.
4. **`Karim-ERP-Launcher.bat` معطّل**: `set "SCRIPTS_DIR=%~dp0windows-scripts"` (سطر 135) موجود **بعد** `exit /b 0` الخاص بـ `:preflight` وقبل `:setup`، وأوامر `goto setup/run/stop` تقفز فوقه → `SCRIPTS_DIR` يبقى فارغًا وكل خيارات القائمة تنادي `\setup-windows.bat` غير الموجودة وتسكت (فشل صامت).
5. **Node.js غير مضافة على PATH** (لا Machine ولا User) → كل السكربتات التي تنادي `node`/`npm` تفشل: `RUN-KARIM.bat`، `SETUP-SMART.bat`، `KARIMERP.bat`، فحص `:preflight` في الـ Launcher، كل `windows-scripts\*.bat`، وأي `npm run` من طرف المستخدم. المهام والخدمة نجحت لأنها تستخدم المسار المطلق `C:\nodejs\node.exe`.
6. **18 ملفًا** تحتوي مسارات قديمة إلى `C:\Users\RemoteHome\...\horus-erp` (الجهاز غير موجود): `nginx.conf`، `OPEN-LAN-ACCESS.bat`، `setup-permanent-start.bat`، `scripts\backup-database.bat`، `diag-db.ps1`، `diag-full.ps1`، `diag-log.ps1`، `duckdns-update.bat`، `morning-automation.bat`، `run-load-test.bat`، `run-server.bat`، `zrok-share.bat`، `tests\find-hooks.ps1`، و5 ملفات استطلاع (`survey*.ps1`) → سكربتات ميتة أو خرجات خاطئة.
7. **`nginx.conf` يستخدم upstream على `127.0.0.1:5001`** والتطبيق يعمل فعليًا على `5000`، ولم يُثبَّت nginx على الجهاز (`C:\nginx` غير موجود، والخدمة غير موجودة) → إعداد غير مستخدم، ويجب إصلاح المنفذ قبل أي تفعيل.
8. **مساحة القرص والسجلات:** `logs\app-out.log` بلغ **590MB** (تدوير المجلدات لا يغطيه)، و`docker-deploy\full-backup.sql` بحجم **492MB** محليًا (أُضيف رغم أن `.gitignore` يذكره) → تدوير/ضغط + حذف من المستودع المحلي.
9. **توسعة RDP عدوانية:** `C:\cloudflared\fix-rdp.bat` يفعّل RDP ويضيف قواعد جدار حماية لمجموعة "Remote Desktop" ويقتل عمليات UltraViewer، والمنفذ 3389 مفتوح فعليًا (0.0.0.0:3389) مع سطح هجوم واسع (Node/PostgreSQL/cloudflared) → تقييد RDP بـ VPN/Tailscale + قواعد محددة المصدر.
10. **طيف استثناءات Defender المخطط (بلا تحقق):** `server-harden-admin.bat` يضيف استثناءات لـ `C:\nodejs` و`PostgreSQL\18` و`C:\cloudflared` و`backend` (مجلدات كاملة، لا ملفات محددة) → خلل عتادي فعلي في صحة الفحص، مع صعوبة التحقق من تطبيقها بدون صلاحية admin.

---

## جدول السكربتات

| الموقع | السكربت | الغرض | التشغيل | الحالة |
|---|---|---|---|---|
| **الجذر (25)** | `RUN-KARIM.bat` | تشغيل السيرفر يدويًا (`node scripts\serve.js`) | يدوي | يفشل بدون PATH |
| | `RUN-KARIM-HIDDEN.vbs` | تشغيل مخفي بـ wscript | يدوي | سليم تقنيًا |
| | `Karim-ERP-Launcher.bat` | قائمة تشغيل شاملة (setup/run/backup/…) | يدوي | **معطّل (BUG `SCRIPTS_DIR`)** |
| | `KARIMERP.bat` | حمّول `node scripts\karim-erp.js` + رفع صلاحية | يدوي | يفشل بدون PATH |
| | `SETUP-SMART.bat` | `smart-install.js` | يدوي | يفشل بدون PATH |
| | `FORMAT-AND-RUN.bat` | مسح مجلدات بيانات ثم إعادة تشغيل (يطلب YES) | يدوي admin | خطر دمار محتمل، له حماية نصية |
| | `Restart-Karim.bat` / `Karim-RESTART.bat` | إعادة تشغيل عبر VBS | يدوي | مكرر + لا يلمس الخدمة |
| | `RESTART-KARIM.vbs` | `scripts\restart-server.ps1` (يقضي على node مباشرة) | يدوي | **يتعارض مع الخدمة** (يقضي node الخاص بالخدمة) |
| | `STOP-KARIM.vbs` | إيقاف | يدوي | مكرر |
| | `INSTALL-PERMANENT-OFFLINE.bat` | تثبيت دائم إلى `C:\KarimERP` | يدوي admin | الهدف `C:\KarimERP` غير موجود |
| | `INSTALL-PERMENANT-OFFLINE.bat` | نسخة مكررة بخطأ إملائي → `C:\HorusERP` | يدوي admin | **نُسخة مكررة مهجورة** |
| | `Install-Karim-CA.bat` / `Install-Horus-CA.bat` | تثبيت CA محلي | يدوي admin | مكرر (Horus = إرث) |
| | `OPEN-LAN-ACCESS.bat` | فتح 5000/5432 بالجدار + مسارات قديمة | يدوي admin | مسارات RemoteHome + `echo` بـ `>` |
| | `CLIENT-SETUP.bat` | إعداد عميل رقيق (مسارات `\\192.168.1.x`) | يدوي | يحتوي أسطر `echo … >` خطيرة إن نُفّذت في PowerShell |
| | `setup-https.bat` | nginx + certbot | يدوي admin | مسارات `C:\nginx`/`C:\Certbot` غير موجودة → ميت |
| | `setup-local-https.bat` | ينادي `setup-lan-trust.ps1` | يدوي admin | **كود ميت بعد `exit /b 0`** + `@echo off` مكرر |
| | `setup-lan-trust.ps1` | إنشاء CA محلي (mkcert) + ثقة | يدوي admin | سليم — المُرشَّح للاحتفاظ |
| | `setup-permanent-start.bat` | إنشاء مهام `HorusERP-*` | يدوي admin | مسارات RemoteHome → ميت |
| | `setup-full-offline.ps1` | حزمة عدم اتصال كاملة | يدوي admin | يعتمد إرث Horus |
| | `DOCKER-IMAGE-EXPORT.bat` / `DOCKER-USB-EXPORT.bat` / `DOCKER-USB-IMPORT.bat` | تصدير/استيراد صورة Docker | يدوي | 3 سكربتات بتغليف ps1 — يُدُمَج واحد |
| **`scripts\` (40)** | `backup-nightly-task.bat` | **فعل المهمة** `KarimERP-Backup-0300/1500` | مهمة مجدولة | ✅ يعمل ويسجّل (`nightly-task.log`، 55–56MB نسخ، مرآة D/E) |
| | `reconcile-portal-punches-task.bat` | **فعل المهمة** `KarimERP-Punch-Reconcile` | مهمة كل 30د | ✅ يعمل (`punch-reconcile.log` ok=12) |
| | `morning-automation.bat` | ترحيل/تدوير/تقارير صباحية | متسلسل عند 07:18 و07:48 | ⚠️ شرط `HH=="7"` يُشغِّله **مرتين**، وguard يُرجع `exit=2` ثم يكمل ويعيد 0 |
| | `backup-database.bat` | احتياطي قديم | يدوي | يقرأ `.env` من مسار RemoteHome → لا يعمل |
| | `backup-full.ps1` / `backup-offsite.bat` | نسخ كاملة/خارج الموقع | يدوي | **كلمة مرور صريحة في السطر 20** |
| | `restore-all.ps1` | استعادة كاملة + `schtasks /Run KarimERP-Server` | يدوي admin | كلمة مرور صريحة (31) + مهمة مفقودة + يطبع admin/admin12345 |
| | `diag-db.ps1` / `diag-full.ps1` / `diag-log.ps1` | تشخيص | يدوي | مسارات RemoteHome (جزئيًا) |
| | `watchdog.js` | مراقبة + إصلاح | المهمة `KarimERP-Watchdog-SYSTEM` | ⚠️ المهمة **غير موجودة**، مع أن `watchdog-status.json` حديث (ok:true) |
| | `steel-watchdog.ps1` | مراقب احتياطي (منافذ 5001/Tailscale/zrok) | يدوي | **ميت**: مهام ومنافذ قديمة |
| | `quality-gate.js` | فحص ذكي (بما فيها مهام `KarimERP-NightlyBackup`) | يدوي/CI | يبلغ عن مهمة مفقودة باستمرار |
| | `run-server.bat`، `run-load-test.bat`، `duckdns-update.bat`، `zrok-share*.bat`، `kill-port5000.bat`، `kill-service.bat`، `find-port-5000.bat`، `install-ca.bat`، `migrate-export.bat`، `migrate-import.bat`، `setup-apikey.bat` | أدوات تشغيل/صيانة | يدوي | أغلبها RemoteHome أو يفشل بدون PATH |
| | `docker-image-export.ps1`، `docker-usb-export.ps1`، `install-cloudflare-tunnel.ps1`، `Install-HorusCA.ps1`، `keep-awake.ps1`، `update-production.ps1` | أدوات | يدوي | بعضها إرث |
| | `archive-yarasoft-done.cmd` | أرشفة محتوى قديم | يدوي | `robocopy /MOVE` مكرر مرتين، بدون فحص أخطاء، مسار `D:\` ثابت |
| **`windows-scripts\` (11)** | `run/setup/stop/status/backup/restore/build/test/resetdb.bat`، `horus-master.ps1` | حزمة "قابلة للحمل" للتطوير | يدوي | `horus-master.ps1 run` يستدعي `scripts\start.js` **غير موجود**؛ باقيها تعتمد PATH |
| **`windows-service\` (9)** | `install-service.bat`، `install-all-elevated.bat`، `remove-service.bat`، `status-service.bat`، `karim-start.cmd`، `karim-stop.cmd`، `karim-killport.ps1`، `DailyBackup.bat` | تثبيت/إدارة الخدمة | admin | ✅ `karim-start/stop.cmd` هما **ال入口 الموحّد الصحيح**؛ `install-all-elevated.bat` تقتل كل `node.exe` وتُنشئ مهمة Watchdog المفقودة بصمت (التوجيه إلى NUL) |
| **`docker-deploy\`** | `docker-compose.yml` + `Dockerfile` + `.env` + 3 نسخ `.env` + `full-backup.sql` (492MB) + بث (bat عربية التسمية "إنشاء-الحزمة-على-الجهاز-الهدف") | نشر Docker/نقل حزمة | يدوي | كلمة المرور افتراضية في compose؛ ملفات سرية محليًا؛ الاسم العربي يكسر الكونسول |
| **`deploy\aapanel\`** | `install-aapanel.sh`، `update-aapanel.sh`، `ecosystem.config.cjs`، `nginx-*.conf.template`، `.env.aapanel.example` | نشر Linux (aaPanel) | root يدوي | سليم نسبيًا (يحمي `.env` من الكتابة المزدوجة) |
| **`C:\cloudflared\` (11)** | `run-tunnel.bat` / `fix-tunnel-process.bat` / `keepalive-tunnel.bat` (فعل المهمة `Tunnel-Keepalive`) | النفق | مهمة + يدوي | ✅ النفق يعمل (`tunnel.log` متصل، `karimeg.online`)؛ التوكن يمر عبر سطر الأوامر (ظاهر في قائمة العمليات) |
| | `keepalive-server.bat` (فعل المهمة `Server-Keepalive`) | إبقاء السيرفر حيًا | مهمة كل 5د | ⚠️ بلا أي تسجيل (صامت تمامًا) |
| | `restart-erp-service.bat` | إعادة تشغيل الخدمة مع تسجيل + رفع صلاحية | يدوي | ✅ أفضل سكربت إعادة تشغيل (سجل `restart-history.log`) |
| | `server-harden-admin.bat` | تفعيل Defender exclusions + مهمة Morning | admin | استثناءات واسعة + إنشاء مهمة صامت |
| | `tune-windows.bat` / `takeown-f.bat` / `fix-rdp.bat` / `do-login.bat` / `run-server.bat` | تهيئة/صيانة | admin/يدوي | `fix-rdp.bat` يفتح RDP بشكل عدواني؛ `do-login.bat` يسجّل مخرجات دخول |
| **CI** | `.github\workflows\ci.yml` | Node 20.x + Postgres 16 (mismatch مع compose: postgres:18) | CI | وظيفة `deploy-production` Placeholder فارغة |
| **النشر** | `Dockerfile` (node:20-slim) / `docker-compose.yml` / `nginx.conf` / `package.json` | بناء ونشر | CI/يدوي | لا ينسخ `.env` (جيد)؛ nginx 5001-قديم؛ engines ≥18 |

---

## جدول المهام المجدولة

### المهام الموجودة (كلها `Ready`، LastResult = `0x00000000`)

| اسم المهمة | التكرار | آخر تشغيل | التشغيل القادم | الحساب | الفعل | الصحة |
|---|---|---|---|---|---|---|
| `KarimERP-Backup-0300` | يوميًا 03:00 | 2026-10-10 03:00 | 2026-10-11 03:00 | `DELL` (Interactive only) | `scripts\backup-nightly-task.bat` | ✅ نجح اليوم (58,441,321 بايت، مرآت D/E) |
| `KarimERP-Backup-1500` | يوميًا 15:00 | 2026-10-10 15:00 | 2026-10-11 15:00 | `DELL` (Interactive only) | `scripts\backup-nightly-task.bat` | ✅ نجح اليوم |
| `KarimERP-Punch-Reconcile` | كل 30 دقيقة | 19:18 | 19:48 | `SYSTEM` | `scripts\reconcile-portal-punches-task.bat` | ✅ ok=12/12 |
| `KarimERP-Server-Keepalive` | كل 5 دقائق | 19:37 | 19:42 | `SYSTEM` | `C:\cloudflared\keepalive-server.bat` | ⚠️ يعمل لكن بلا تسجيل |
| `KarimERP-Tunnel-Keepalive` | كل 15 دقيقة | 19:09 | 19:39 | `SYSTEM` | `C:\cloudflared\keepalive-tunnel.bat` | ✅ النفق موصول |

### ملاحظة حرجة على المهام
مهام النسخ الاحتياطي تعمل **برصيد `DELL` ووضع Interactive only** → لن تعمل إذا لم يكن المستخدم مسجّل الدخول (فشل صامت للاحتياطي الليلي). يجب تحويلها إلى `/RU SYSTEM` أو حساب خدمة مخصص.

### الخدمات
| الاسم | الحالة | بدء التشغيل | مسار التنفيذ | الاسترداد |
|---|---|---|---|---|
| `KarimERP-Server` | Running | AUTO_START | `...\Desktop\...\windows-service\KarimERP-Service.exe` (LocalSystem) | SCM: إعادة تشغيل ×3 @60s، reset 24h ✅ |
| (WinSW XML) | — | — | `C:\nodejs\node.exe` + `%BASE%\..\backend\server.js --service` | restart 10s → restart 60s → none |
| `KarimERP-PrintWorker` | **غير موجودة** | — | تُستدعى من سكربتات متعددة بصمت | — |
| خدمة Cloudflared | **غير موجودة** (أُزيلت عمدًا بواسطة `fix-tunnel-process.bat`) | — | تُدار بالمهمة `Tunnel-Keepalive` | — |
| `postgresql-x64-18` | Running | AUTO | `C:\Program Files\PostgreSQL\18` | — |

### مهام مفقودة (مُستدعاة في الكود لكنها غير مُعرَّفة)
`KarimERP-Morning-Automation`، `KarimERP-Watchdog-SYSTEM` (أُنشئت 10/08 وحُذفت)، `KarimERP-NightlyBackup`، `KarimERP-Guardian`، `KarimERP-Server` (في `restore-all.ps1:113`)، `KarimERP-Zrok`، `KarimERP-DuckDNS`، `KarimERP-Offsite`، `KarimERP-Backup`، `HorusERP-Server`، `HorusERP-Monitor`.

### المفاتيح السليمة المؤكدة
- الاحتفاظ/التشغيل/الاسترداد: `sc qfailure` = RESTART ×3، مدة 60000ms، reset 86400s.
- النفق: `C:\cloudflared\tunnel.log` اتصالات نشطة (`karimeg.online`).
- صحة المراقب: `watchdog-status.json` → `postgres: listening`, `erp: healthy`, `tunnel: reachable`, `disk_free_mb: 395703`, `ok: true`.

---

## قائمة المشاكل (مرتّبة بالخطورة)

| # | الخطورة | المشكلة | الدليل | الإجراء المقترح |
|---|---|---|---|---|
| 1 | **حرج** | كلمة مرور قاعدة بيانات صريحة في 23 ملفًا | grep `‹كلمة مرور DB — محذوفة من المستند›` في `.env`، `docker-compose.yml:docker-deploy/docker-compose.yml`، `scripts\backup-full.ps1:20`، `scripts\restore-all.ps1:31`، `scripts\setup.js:117`، 3 `.env` احتياطية، 7 `docs\esm-migration\audits\*.js`، 7 `tests\load\*.js` | تدوير السر فورًا، نقله إلى متغيّر بيئة أو مدير أسرار، تنظيف الملفات والسجلات القديمة |
| 2 | **حرج** | أسرار أخرى مكشوفة: `KARIM_FIXED_ADMIN_PASSWORD`، `JWT_SECRET`، كلمة مرور Oracle في `.env`؛ توكن النفق في `C:\cloudflared\tunnel-token.txt` ويمر عبر سطر الأوامر (`--token %CF_TOKEN%`) | قراءة `.env` و`run-tunnel.bat`/`keepalive-tunnel.bat`/`fix-tunnel-process.bat` | تدوير + استبدال بـ environment injection؛ منع إظهار التوكن في سطر الأوامر (استخدام `--token-file`/متغيّر مخفي) |
| 3 | **حرج** | الخدمة مربوطة بمسار سطح مكتب مستخدم | `sc qc KarimERP-Server` → `Desktop\k\...\Karim-ERP-Service.exe` | نقل المشروع إلى `C:\KarimERP` (مثبّت) وإعادة تثبيت الخدمة |
| 4 | **عالٍ** | المهام `KarimERP-Backup-*` بحساب تفاعلي فقط → خطر فشل صامت | `schtasks /query /v` → Interactive only + user DELL | إعادة إنشائها بـ `/RU SYSTEM` مع إبقاء التسجيل |
| 5 | **عالٍ** | 7+ مهام مفقودة تُستدعى من السكربتات (رقم 3 أعلاه) | `quality-gate.js`، `restore-all.ps1:113`، `install-all-elevated.bat:65`، `steel-watchdog.ps1`، `setup-permanent-start.bat` | حذف المراجع الميتة أو إعادة إنشاء المهام المطلوبة (خاصة Watchdog) |
| 6 | **عالٍ** | Node/npm غير على PATH | `where node` يفشل؛ Machine/User PATH بلا `C:\nodejs` | إضافة `C:\nodejs` إلى PATH المmachine |
| 7 | **عالٍ** | `Karim-ERP-Launcher.bat` معطّل (سطر 135 بعد `exit /b 0`) | القراءة المرقّمة للملف | نقل `set "SCRIPTS_DIR=..."` وفحص `run-windows.bat` قبل `:menu` |
| 8 | **متوسط** | RDP مفتوح (3389) + قواعد "Remote Desktop" العريضة عبر `fix-rdp.bat` | المنفذ يستمع على 0.0.0.0 | تقييد RDP بـ Tailscale/VPN أو IP ثابت + تعطيل أيقونة Remote Desktop للمستخدمين |
| 9 | **متوسط** | استثناءات Defender مجلدات كاملة مخططة (`server-harden-admin.bat`) | السطر المضيف للاستثناءات | استبدالها بمسارات ضيقة + تحقق admin من الإعداد الحالي |
| 10 | **متوسط** | `logs\app-out.log` 590MB بلا تدوير | `Get-ChildItem logs` | توسيع `rotate-logs.js` ليشمل app-out.log + ضغط |
| 11 | **متوسط** | `docker-deploy\full-backup.sql` 492MB محليًا (مخزّنة رغم gitignore) | الحجم المُقاس | حذف نسخة المستودع المحلي والاحتفاظ بها في D/E فقط |
| 12 | **متوسط** | 18 ملفًا بمسارات `C:\Users\RemoteHome\...\horus-erp` | grep المسار | تحديث المسارات أو أرشفة الملفات الميتة |
| 13 | **متوسط** | `nginx.conf` يستخدم 5001 والتطبيق على 5000 + مسار RemoteHome | قراءة الملف | تصحيح upstream أو أرشفة الملف |
| 14 | **متوسط** | `morning-automation.bat` ينفّذ مرتين عند الساعة 7 (07:18 و07:48) ويشتري `exit=2` | الشرط `HH=="7"` | تغيير الشرط إلى نافذة دقيقة واحدة + إرجاع الكود الحقيقي من الـ guard |
| 15 | **متوسط** | `install-all-elevated.bat` تُنهي كل عملية `node.exe` وتصمت عن أخطاء `schtasks` (توجيه إلى NUL) | السطور 65+ | استبدال `taskkill /IM node.exe` بقتل PID محددة + إظهار أخطاء التسجيل |
| 16 | **منخفض** | `RESTART-KARIM.vbs` / `restart-server.ps1` تقتل node مباشرة (تتعارض مع الخدمة) | القراءة | إلغاء السلسلة والاعتماد على `restart-erp-service.bat` |
| 17 | **منخفض** | أسطر `echo … >` خطيرة داخل `.bat` (تُنشئ ملفات إذا نُفّذت في PowerShell) | `CLIENT-SETUP.bat:32-35`، `OPEN-LAN-ACCESS.bat:38-43`، `setup-https.bat:20` | انتقال إلى `>>` داخل كتل cmd فقط أو نقلها لـ `scripts\*.ps1` |
| 18 | **منخفض** | تشفير عربي داخل `.bat` يكسر الكونسول (mojibake) — يُعترف به في `karim-start.cmd` | مقارنة الملفات | توحيد الكودبة: إما كله ASCII أو chcp معلن |
| 19 | **منخفض** | `&&`/`||` داخل PS1: المطابقات الوحيدة في `diag-db.ps1`/`diag-full.ps1` عبارة SQL داخل نص استعلام | grep | لا حاجة — تأكيد أنه لا يُستخدم operator غير متاح في PowerShell 5.1 |
| 20 | **منخفض** | `horus-master.ps1 run` يستدعي `scripts\start.js` غير موجود | التحقق من الوجود | حذف الوظيفة أو استبدالها |
| 21 | **منخفض** | CI يستخدم Postgres 16 بينما compose يستخدم 18 | قراءة `ci.yml` و`docker-compose.yml` | مواءمة الإصدارات |
| 22 | **منخفض** | وظيفة `deploy-production` في CI فارغة (Placeholder) | قراءة `ci.yml` | إما تنفيذها أو حذفها |

---

## مرشحات التنظيف

### مجموعات التكرار (الأسرع إلى الأمام)
| المجموعة | الملفات | القرار المقترح |
|---|---|---|
| **تشغيل اليدوي** (9 ملفات) | `RUN-KARIM.bat`، `RUN-KARIM-HIDDEN.vbs`، `Karim-ERP-Launcher.bat`، `KARIMERP.bat`، `SETUP-SMART.bat`، `FORMAT-AND-RUN.bat`، `windows-scripts\run-windows.bat`، `windows-service\karim-start.cmd`، `C:\cloudflared\restart-erp-service.bat` | **الاحتفاظ** بـ `karim-start.cmd` + `restart-erp-service.bat` كنقطتي دخول وحيدتين (مع تسجيل)، وأرشفة الباقي |
| **إعادة التشغيل** (5) | `Restart-Karim.bat`، `Karim-RESTART.bat`، `RESTART-KARIM.vbs`، `scripts\restart-server.ps1`، `restart-erp-service.bat` | الاحتفاظ بـ `restart-erp-service.bat` فقط |
| **النسخ الاحتياطي** (6) | `scripts\backup-database.bat` (ميت)، `backup-nightly-task.bat` ✅، `windows-service\DailyBackup.bat`، `scripts\backup-full.ps1`، `backup-offsite.bat`، `windows-scripts\backup-windows.bat` | الاحتفاظ بـ `backup-nightly-task.bat` (المهام) + `backup-offsite.bat` |
| **تثبيت CA** (4) | `Install-Karim-CA.bat` ✅، `Install-Horus-CA.bat`، `scripts\install-ca.bat`، `scripts\Install-HorusCA.ps1` | الاحتفاظ بـ `Install-Karim-CA.bat` |
| **إعداد HTTPS/الشبكة** (4) | `setup-lan-trust.ps1` ✅، `setup-https.bat` (nginx غير موجود)، `setup-local-https.bat` (كود ميت)، `setup-full-offline.ps1` | الاحتفاظ بـ `setup-lan-trust.ps1` |
| **حزمة عدم الاتصال** (2) | `INSTALL-PERMANENT-OFFLINE.bat` (C:\KarimERP) vs `INSTALL-PERMENANT-OFFLINE.bat` (C:\HorusERP، خطأ إملائي) | حذف النسخة المكررة `PERMENANT` |
| **تصدير Docker** (4) | `DOCKER-IMAGE-EXPORT.bat`، `DOCKER-USB-EXPORT.bat`، `docker-image-export.ps1`، `docker-usb-export.ps1` | دمج في أمر واحد `docker-usb-export.ps1` |
| **المراقبة** (3) | `scripts\watchdog.js` (المهمة مفقودة) + `scripts\steel-watchdog.ps1` (ميت) + `keepalive-*.bat` | إسقاط `steel-watchdog.ps1`؛ إعادة إنشاء مهمة Watchdog أو إسقاط `watchdog.js` |
| **حُزم كاملة مكررة** | `windows-scripts\` (حزمة محمولة للتطوير) vs `windows-service\` (حزمة التشغيل) vs سكربتات الجذر | الاحتفاظ بحزمتين: `windows-service` للتشغيل + `windows-scripts` للتطوير فقط |
| **تقارير/وثائق مكررة** | `FINAL_REPORT.md`، `HANDOVER_REPORT.md`، `IMPLEMENTATION_REPORT.md`، `QA_REPORT.md`، `DISCOVERY_REPORT.md`، `DISCOVERY_ARTIFACT.md` + 18 ملف `.md` في الجذر + `docs\HORUS-ERP-FINAL-REPORT.md` = `docs\KARIM-ERP-FINAL-REPORT.md` (14372 بايت متطابقان) و`HORUS/KARIM-SUMMARY.md` (7008 متطابقان) | نقل الجذر إلى `docs\archive\`، إسقاط نسخة Horus المطابقة |
| **أدوات الاستطلاع** | `tests\survey*.ps1` (5)، `tests\find-hooks.ps1`، `tools\legacy\find_*.ps1`، `tools\employee-card\out\` (200+ SVG/HTML) | نقل إلى `tools/legacy/archive` أو حذف |
| **قاعدة بيانات/سجلات** | `logs\app-out.log` (590MB)، `logs\_check_lint*.txt`، `database\backups\*.sql.env` (3 ملفات فيها كلمة المرور)، `docker-deploy\full-backup.sql` (492MB)، `worklog.md` (180KB)، `CHANGELOG.md` (91KB) | تدوير/ضغط/حذف (مع نسخة خارجية D/E) |

### قمامة شل مُثبتة (artifacts)
| الملف | الحجم | الخلاصة |
|---|---|---|
| `query`، `start`، `stop` | 17 بايت لكل منها | المحتوى حرفيًا `KarimERP-Server\r\n` → أثر لتنفيذ `sc query KarimERP-Server` أو `>` كتب المخرجات إلى ملف بسبب اقتباس مكسور في cmd |
| `NUL` | 0 بايت | `.gitignore` يذكر `nul` (بالحروف الصغيرة) لكن النظام أنشأ `NUL` — أثر لتنفيذ أوامر shell داخل PowerShell بدل cmd |
| `{console.log(b.slice(0` | 0 بايت | مقتطف JS مكسور حُفظ كاسم ملف (اقتباس غير مغلق) |
| `'2026-10-05'` | 205 بايت | **اسم الملف يحوي علامتي اقتباس حرفيتين** (U+0027) → `Get-Content` عادي يفشل لأن المسار لا существует؛ المحتوى: رسوم `dotenvx` + `ERR column "deptname" does not exist` → ملصق كونسول بالخطأ |

### تنبيهات استعمال shell (PowerShell-hostile)
- **لا يوجد** أي `&&` أو `||` كمعامل PowerShell داخل `.bat/.ps1` (المطابقات الوحيدة عبارة SQL داخل `diag-*.ps1`) — ✅.
- الملفات التي تحتوي `>` داخل `echo` داخل `.bat` **تُنشئ ملفات** إن نُفّذت يدويًا داخل PowerShell: `CLIENT-SETUP.bat:32-35`، `OPEN-LAN-ACCESS.bat:38-43`، `setup-https.bat:20` (`->`)، `scripts\duckdns-update.bat:22`، `android\gradlew.bat` (`1>&2`).
- كل أوامر الإنشاء في هذه التقرير نُفّذت كأوامر shell منفصلة (PowerShell 5.1)، ولم يُجرَ أي تعديل على المشروع أو النظام.

---

## الخلاصة الآلية

- **النظام حاليًا يعمل ومتصل:** الخدمة `KarimERP-Server` Running، PostgreSQL 18 يعمل، النفق `karimeg.online` موصول، وآخر نسخة احتياطية ناجحة اليوم 58.4MB مع مرآت D/E، والمراقب يبلغ `ok: true` (قرص حر 395GB).
- **ما يهدد الاستمرارية أكثر من الأعطال:** الاعتماد على مسار سطح مكتب في الخدمة، مهام احتياطي بحساب تفاعلي، وNode غير على PATH — ثلاثة عوامل تُفشل النظام عند إعادة إقلاع/نقل/تسجيل خروج.
- **الأولوية القصوى:** تدوير 23 سرًا مكشوفًا + تثبيت الخدمة في مسار دائم + تحويل مهام النسخ الاحتياطي إلى SYSTEM.
