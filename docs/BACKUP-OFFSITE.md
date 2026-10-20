# الأرشفة خارج الموقع — دليل التشغيل

> لماذا: النسخة على القرص نفسه ليست نسخة. فشل قرص أو جهاز أو سرقة كانت
> يُفقد كل البيانات. الآن: نسخة مشفّرة على قرصين ثانويين + (اختياري) سحابة عبر rclone.

---

## 1) كيف تعمل المسار

```
database/scripts/backup.js
   └─ pg_dump → نسخة نصية محلية (database/backups/)
        └─ scripts/backup-mirror.js
             ├─ encryptBackupFile()  → تشفير GPG (‎.gpg + ‎.sha256)
             └─ mirrorFile()        → نسخ إلى D:/KarimBackups و E:/KarimBackups
                  · يرفض أي ملف ليس ‎.gpg (plaintext-mirror-refused)
                  · يتحقق من SHA-256 قبل النسخ
```

مسار النسخ الأسبوعي (`scripts/backup-offsite.bat`) ينسخ **النسخة المشفّرة فقط**
+ بصمتها، ويرفض النسخ النصي صراحةً، ثم يزامن عبر `rclone` إن كان هناك remote
اسمه `karim`.

## 2) الإعداد المطلوب (مرة واحدة)

| المتغير | القيمة | ملاحظة |
|---|---|---|
| `KARIM_BACKUP_GPG_RECIPIENT` | بصمة المفتاح العام (40/64 hex) | **مفتاح عام فقط** — لا تُضع المفتاح الخاص هنا |
| `KARIM_GPG_PATH` | مسار `gpg.exe` | اختياري إن لم يكن في PATH |
| `KARIM_MIRROR_D` / `KARIM_MIRROR_E` | مجلدات المرآة | الافتراضي `D:/KarimBackups` و `E:/KarimBackups` |

بلا `KARIM_BACKUP_GPG_RECIPIENT` **لا تُنشأ أي نسخة خارجية** (السكربت يرفض
النص الصريح عمدًا — نسخة نصية على قرص ثانٍ أخطر من بلا نسخة).

## 3) إدارة المفاتيح

- **المفتاح الخاص**: يُحفظ خارج هذا الجهاز (USB آمن أو خزنة). المفتاح العام فقط
  على هذا الجهاز (في keyring GPG) — والتشفير لا يحتاج إلا العام.
- **فقد المفتاح الخاص = فقدان كل النسخ المشفّرة**. لذلك: خُذ نسختين من المفتاح
  الخاص، واحدة USB وأخرى في مكان آمن آخر.
- تدوير المفتاح: ولّد مفتاحًا جديدًا، أضف بصمته إلى `KARIM_BACKUP_GPG_RECIPIENT`،
  ثم احذف المفتاح القديم بعد التأكد من نجاح النسخ الجديدة.

## 4) التحقق الدوري (شهريًا)

```powershell
# 1) هل تُنشأ نسخة مشفّرة؟
node database/scripts/backup.js
# 2) هل المرآة تحتوي .gpg فقط؟
Get-ChildItem D:\KarimBackups -Recurse -File | Where-Object { $_.Extension -ne '.gpg' -and $_.Extension -ne '.sha256' }
# 3) هل تفكّ النسخة المشفّرة إلى نسخة مطابقة؟ (دورة كاملة)
gpg --output $env:TEMP\rt.sql --decrypt <latest.sql.gpg>
(Get-FileHash $env:TEMP\rt.sql).Hash -eq (Get-FileHash <original.sql>).Hash
```

## 5) الاسترجاع

```powershell
# فك التشفير (يحتاج المفتاح الخاص)
gpg --output C:\restore\karim_erp.sql --decrypt D:\KarimBackups\full\<file>.sql.gpg
# استعادة
psql -h 127.0.0.1 -U postgres -d karim_erp_restored -v ON_ERROR_STOP=1 -f C:\restore\karim_erp.sql
```

## 6) حالة هذه البيئة (2026-10-21)

- GPG 2.5.24 مثبّت.
- مفتاح الأرشفة: RSA-4096 بصلاحية تشفير فقط؛ **المفتاح الخاص مستخرج ومحمي
  (Administrators + SYSTEM فقط) خارج المستودع**.
- النسخ النصية القديمة على D:/E: (من قبل ضبط GPG) شُفِّرت في مكانها مع
  التحقق من دورة فك-تشفير لكل ملف.
