# خريطة مساحة العمل — Karim ERP

> الغرض: توضيح إيه كل مجلد عشان نمنع التلخيص اللي حصل. لا تحذف أي مجلد قبل الرجوع للتقرير `SYSTEM-AUDIT-2026-11-25.md`.

## الحالة بعد التنظيم النهائي (2026-11-26)
- **النظام = مجلد واحد: `C:\Users\DELL\Desktop\k\KARIM-ERP\`** (كان `karim-erp-ci-release-fix`). كل التقارير جوه `docs/audit/`.
- كل حاجة تانية اتنقلت لـ `C:\Users\DELL\Desktop\KARIM-ERP-ARCHIVE-2026-11-26\` (بره مساحة العمل).
- ✅ كل الخدمات اتوقفت واتعطل الإقلاع التلقائي (KarimERP-Server / KarimERP-Control / KarimControlTunnel)، وكل المجلدات اتنقلت للأرشيف. التفاصيل: `C:\Users\DELL\Desktop\KARIM-ERP-ARCHIVE-2026-11-26\SERVICES-NOTICE.md`.
- فاضل في الجذر مجلدان **فاضيان تماماً** (`karim-erp-phase5-8`, `karimabdelhamedeldsouky`) لأن فيه مقابض مفتوحة مش قابلة للحذف، plus `.mimosa`/`.zcode` (حالة أدوات) و3 ملفات 0 بايت بأسما غريبة. كلها مش مؤثرة على النظام.
- `_archive-2026-11-26/folders` (17 مجلد) + `files` (39 ملف): كل المجلدات/الملفات المبعثرة القديمة اتنقلت هنا — قابلة للرجوع.
- `_quarantine-2026-11-25/`: 28 ملف مؤقت + `.git` الفاضي القديم + 15 سكربت مساعد + `secret-backups-before-rotation/` (نسخ أصلية قبل تدوير الأسرار).
- `SECRET-ROTATION-2026-11-26.md`: سجل التدوير (أسماء ملفات/مفاتيح فقط، بلا أي قيمة).
- `karimabdelhamedeldsouky/.../karim-erp`: **نسخة الإنتاج الحية** — اتنقلتش عمداً عشان ما نكسرش النشر الحالي.
- `backups/`: مقدّس، ما اتنقلش.
- `karim-erp-phase5-8/` و`karim-saas-staging-run/`: لسه في الجذر لأن ملفاتهما مفتوحة من عمليات شغالة — محتاجين إغلاق تلك العمليات ثم نقلهم للأرشيف. تعديلات `phase5-8` محفوظة في الفرع `legacy/phase5-8-merge` جوه repo الحقيقي.
- 3 ملفات بأسما غريبة (` ' `، ` ' + esc(...) `، `NUL`) — 0/1288 بايت، Windows ما سمحش بنقلهم.

## المصدر الحقيقي (source of truth)
| المجلد | الحالة |
|---|---|
| `karim-erp-ci-release-fix/` | **الـ repo الوحيد له Git history + remote (GitHub)**. 1598 ملف متتبع، 15 فرع، v4.9.2. فيه backend/frontend/database/electron/docker. الفرع الحالي `fix/main-ci-release-20261125` = 1 commit أمام `origin/main`. **اتضاف له `v3/` (النسخة المعتمدة) كملفات غير متتبعة لحد ما ت.commitها.** |

## نسخ/مراحل frontend (v3) — كلها خارج Git
| المجلد | عدد المسارات | ملاحظة |
|---|---|---|
| **`KARIM-ERP-PORTABLE/APP/v3`** | 81 | ✅ **المعتمد (source of truth)** — اننسخ داخل `karim-erp-ci-release-fix/v3`. مطابق لنسخة الإنتاج الحية تقريباً (15 ملف فرق)، ونظيف من `.mimosa`. |
| `KARIM-ERP-TRIAL/APP/v3` | 81 | نسخة تجريبية مطابقة للمعتمد — احتفظ بها كمرجع |
| `karimabdelhamedeldsouky/.../karim-erp/v3` | 81 | نسخة الإنتاج الحية (DB `karim_erp`)، فيها `.mimosa/hook-state` داخل `src` — احتفظ بها ولا تحذف |
| `karim-erp-phase5-8/v3` | 70 | أحدث تعديلاً (11/25) بس **ناقصة 105 ملف**. التعديلات المعلّقة موثّقة في `karim-erp-ci-release-fix/v3/MERGE-PENDING.md` (286 ملف أحدث + 10 ملفات فقط هنا) — **لا تُدمج آلياً** |
| `karim-saas-staging-run/v3` | 70 | staging قديم |

## أرشيفات ونسخ احتياطية (لا تلمس)
| المجلد/الملف | الحالة |
|---|---|
| `KARIM-ERP-PORTABLE.zip` / `.tar.gz` | ❌ **اتحذفت** 2026-11-25 بأمر صريح منك — التفاصيل في `DELETION-LOG-2026-11-25.md`. المجلد المستخرج `KARIM-ERP-PORTABLE/APP/` سليم |
| `KARIM-ERP-TRIAL.tar.gz` | ❌ **اتحذف** 2026-11-25 — المجلد المستخرج `KARIM-ERP-TRIAL/APP/` سليم |
| `backups/` | 107 ألف ملف، نسخ `v3-live-*` قبل كل تغيير — **مقدّس** |
| `quarantine-2026-11-19/`, `_quarantine_%BK%_2026-10-24/` | عزل قديم، احتفظ به |
| `_quarantine-2026-11-25/` | عزل هذه الجولة — قابل للرجوع، اقرأ README داخله |

## مجلدات أدوات/تجارب (مؤقتة لكن قد تكون مفيدة)
`.archify/`, `.cloud-attachments/`, `.freebuff/`, `.mimosa/`, `.mobile-probe/`, `.perf-harness/`, `.plex-tmp/`, `.print-harness/`, `.recon-probe/`, `.v3-review-shots/`, `.zcode/`, `heroui-proto/`, `menu-pdf/`, `menu-print/`, `menu-screen-v2/`, `menu-system/`, `open-ds-lab/`, `pin-reset-2026-10-31/`, `render/`, `tools/`, `_verify-shots/`, `tmp-cam-scan/`

## ملفات الجذر
- الـ `.git` الفاضي (0 commit) اتنقل لـ `_quarantine-2026-11-25/root-git-backup/.git` — الجذر لم يعد repo. المعتمد هو `karim-erp-ci-release-fix`.
- `SYSTEM-AUDIT-2026-11-25.md` — التقرير الشامل والتقييم الأولي (5.0/10).
- `FINAL-STATE-2026-11-26.md` — الحالة النهائية والتقييم المحدّث (7.0/10) والقرارات المتبقية.
- `DELETION-LOG-2026-11-25.md` — سجل الأرشيفات المحذوفة.
- `WORKSPACE-MAP.md` — هذه الخريطة.
- `.gitignore` — يمنع إضافة الأرشيفات/اللوجات/الملفات المؤقتة بالغلط.
- `PHASE0-ACCOUNTING-AUDIT-2026-11-06.md`, `A5_REPORT.md` — تقارير تدقيق محاسبي قديمة (وثائق، لا كود).

## قاعدة ذهبية
1. أي تعديل كود = داخل `karim-erp-ci-release-fix` بعد ما نتأكد من النسخة المعتمدة.
2. أي تغيير قاعدة بيانات = نسخة احتياطية أولاً + موافقة صريحة.
3. أي حذف/نقل لأرشيف أو backup = موافقة صريحة منك.
