# Runbook — «السيرفر بيقفل لوحده» (إحياء ذاتي)

> آخر تحديث: 2026-10-19 · الطلب: «محرك مش يخليه يغلق، وحتي لو أغلق يعيد تشغيله اتوماتيك»

## الخريطة في 30 ثانية
السيرفر خدمة ويندوز اسمها **`KarimERP-Server`** (مغلّفة **WinSW**، ثنائي
`windows-service/KarimERP-Service.exe`). فوقها ثلاث طبقات إشراف:

| الطبقة | ماذا تفعل | كل كم |
|---|---|---|
| WinSW `<onfailure>` | يعيد تشغيل العملية بعد سقوطها (10/30/60 ث) | فور السقوط |
| Windows SCM | يعيد تشغيل الخدمة نفسها لو مات الـwrapper | 5/10/30 ث |
| مهمة `KarimERP-Watchdog-SYSTEM` | فحص صحة `/api/health` وإحياء عند التوقف + نفق + قرص + نسخ | كل 5 دقائق |

## الأعراض
- الموقع يفصل لحظيًا ثم يرجع، أو يرفض الاتصال (502/connection refused).
- `winsw`/الخدمة تظهر RUNNING لكن `/api/health` لا يستجيب.

## التشخيص السريع (بالترتيب)
```powershell
# 1) هل الخدمة تعمل؟ وهل المنفذ يستجيب؟
sc.exe query KarimERP-Server
curl.exe -sk --max-time 6 https://127.0.0.1:5000/api/health

# 2) لماذا سقط آخر مرة؟ (آخر 60 سطرًا تكفي)
Get-Content logs\CRASH.log -Tail 60

# 3) ماذا فعل المشرف؟ (إيقاف/تشغيل)
Get-Content logs\KarimERP-Service.wrapper.log -Tail 15

# 4) سجل التطبيق المباشر
Get-Content logs\app-out.log -Tail 20
```

## الأسباب الشائعة وحلّها
| السبب في `CRASH.log` | المعنى | الحالة |
|---|---|---|
| `EADDRINUSE ... 0.0.0.0:5000` | إعادة تشغيل والمنفذ لسه مشغول | **مُصلَح**: الخادم يعيد المحاولة بتدرّج حتى يتحرّر المنفذ |
| `Connection terminated unexpectedly` / `timeout` | قطع اتصال PostgreSQL عابر | **مُصلَح**: يُسجَّل ويُمتصّ بلا إسقاط الخادم |
| `_pool[prop].bind is not a function` | خلل قديم في Proxy الـpool | تاريخي (قبل 2026-10-12) |
| خطأ برمجي حقيقي (نوع/مرجع) | عطل كود | **مقصود**: يُسقَط لإعادة تشغيل نظيفة |

## الإحياء اليدوي (لو احتاج)
```powershell
sc.exe stop KarimERP-Server
# انتظر حتى يتحرّر المنفذ 5000 فعليًا
sc.exe start KarimERP-Server
```
أو شغّل المراقب فورًا بدل انتظار الدورة:
```powershell
C:\nodejs\node.exe scripts\watchdog.js --fix
```

## الفحص بعد الإصلاح (شرط القبول)
1. `sc.exe query KarimERP-Server` → `STATE: RUNNING`.
2. `curl.exe -sk https://127.0.0.1:5000/api/health` → `"status":"ok"`.
3. `Get-Content logs\KarimERP-Service.wrapper.log -Tail 5` → `Started process <pid>` حديث.
4. `logs/CRASH.log` لا يزيد بعد الإصلاح.

## منع التكرار
- لا تُشغّل نسخة ثانية يدويًا (`npm start`) والخدمة تعمل — ستصطدم بالمنفذ.
- لا تُغيّر `<onfailure>` في `windows-service/KarimERP-Service.xml` (مثبَّت باختبار).
- عند أي تعديل على `backend/` أعد تشغيل الخدمة لتُحمَّل النسخة الجديدة.
