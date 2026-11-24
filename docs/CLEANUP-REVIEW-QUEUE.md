# قائمة مراجعة التنظيف — قرار المالك (625 ملفًا / ~10MB)
**2026-11-19 · جرد آلي بالأدلة (قراءة فقط) + مراجعة يدوية · لا شيء هنا حُذف — كلها تنتظر قرارك**

المنهجية: مسح 2,217 ملف نصي (29.2MB) لعدّ المراجع بأشكالها الثلاثة (basename، الجذر بلا امتداد، صيغة المسار) بما فيها CI وpackage.json وdocs وrequires بلا امتداد؛ إغلاق مراجع الأصول من index.html والحزم المدخلة؛ md5 للمكررات. **صفر مراجع = مرشح، وليس حكمًا** — أدوات التشغيل اليدوية قد تُستدعى خارج المستودع.

ما نُفذ بالفعل (آمن، مُودع `4b4526ae`): 471 ملف حزم ميتة (9.6MB) + NUL + pnpm-lock.yaml الجذر + آثار السجلات المحلية. **أُبقي:** دليل تمرين DR الموثق، daily-backup-status.json، كل ما يخدمه الإنتاج.

## المجموعات بانتظار القرار

### 1) نسخة مصدر احتياطية قديمة — 555 ملفًا (~8MB) `backups/v3-src-20261113-023423/`
لقطة مصدر v3 قبل ترحيل ESM (13 نوفمبر). **توصيتي: حذف** — تاريخ git يحفظ كل شيء، واللقطة ازدواجية بلا مرجع.
الأمر عند الموافقة: `git rm -r backups/v3-src-20261113-023423 && git commit`

### 2) سكربتات بلا مرجع — 30 ملفًا `scripts/`
| الفئة | الملفات | توصيتي |
|---|---|---|
| أدوات تشغيل يدوية محتملة | reset-admin-pw.js، check-admin-pw.js، setup-nssm.js، kill-old.js، build-app.js، machine-bundle.js، zk-repair-gaps-task.bat | **أرشفة** إلى scripts/archive/ (لا حذف) |
| تدقيق/ترحيل لمرة واحدة | backfill-transfer-expenses، closing-gap-audit، migrate-concat-handlers، migrate-test-db، generate-delegation-actions (+سلسلتها الميتة migrate-handlers-to-delegation)، import-json-professional، probe_insert، fix-set-local.py، live_*_audit.py ×3، probe_idempotency.py، resilience_test.py، production-source-audit.sh، check-attendance(2)، check-cashier-module، screenshot-design/pos | **أرشفة** أو حذف بموافقتك |
| عينات تسجيل الوجه | face-a.jpg (2.28MB)، face-b.jpg، face-c.jpg، face-test.jpg — **3.3MB** | حذف إن انتهى اختبار تسجيل الوجه |

### 3) لقطات شاشة ومكررات توثيق — ~1.1MB
- جذر: live-login-1366.png، pos-1366.png، v3-live-1366.png (متتبعة، بلا مرجع) → **حذف**
- docs/HORUS-ERP-FINAL-REPORT.md + HORUS-ERP-SUMMARY.md (مكرران قبل إعادة التسمية؛ التوأم KARIM موجود) → **حذف**
- docs/v2-coherence-check.png + docs/esm-migration/final-*.png ×4 (متطابقة بايت-بايت مع أدلة محفوظة) → **حذف المكرر**
- docs/CHANGELOG.md (ميت؛ الجذر CHANGELOG.md حي ومرجعي) → **حذف**
- PROGRESS.md (9KB، بلا مرجع) → قرارك

### 4) مجموعات كاملة
- `docs/archive/` — 26 مستندًا تاريخيًا (204KB): **إبقاء** كتاريخ ما لم تقرر ضغطه
- `.freebuff/` — حالة أداة قابلة للتوليد (151B): حذف إن كنت لا تستخدم freebuff

## آلية الموافقة
قل «وافق على المجموعة 1 و3» (أو أي تركيبة) وأنفذها بإيداع git قابل للاسترجاع، مع إعادة تشغيل البوابات بعد كل حذف. **لن أحذف أيًا منها بلا كلمتك.**

## ملاحظات سالبة (لا تنظيف مطلوب)
لا .DS_Store/Thumbs.db، لا orphan tests (كل require ظاهري مفقود هو نص تأكيد أو spawn بمسار صحيح)، لا pre-restore متبقية، والمجلدات الفارغة updates/ وvar/brotli-cache/ **مرجعية تشغيليًا** (electron updater + brotli static) — تُركت عمدًا.
فجوة توثيقية بلا حذف: CHANGELOG.md وdocs/coa-audit-2026-11-05/COMMIT_PLAN.md يشيران إلى attendance-grace-threshold.test.js وattendance-reconcile-double-use.test.js غير الموجودين — يُصلح التوثيق أو تُستعاد الاختبارات (قرار منفصل).
