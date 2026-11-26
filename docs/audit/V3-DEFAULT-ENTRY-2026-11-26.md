# v3 كمدخل افتراضي — 2026-11-26

## المشكلة
فتح النظام من الهاتف (أو أي جهاز) كان يفتح V2:
- `/` → `/app/index.html`
- `/app` → `/app/v2.html?live=1`

## الحالة
`rollout.json` عنده `switchAt = 2026-11-10T20:22:00+03:00` (ماضي)، والبنية موجودة ⇒ `v3Primary=true`، `v3Ready=true`، `v3Entry=true`. بس كود التوجيه كان ثابت على V2.

## الإصلاح
- `menu-legacy-routes.js`: جذر `/` يحوّل إلى `/v3/` عند `v3Entry()` وإلا `/app/index.html`.
- `server.js`: `/app` و`/app/` يحوّلان إلى `/v3/` عند `v3Entry()`، والـ fallback القديم محفوظ.

## التحقق
- `GET /` → `302 Location: /v3/`
- `GET /app` → `302 Location: /v3/`
- Jest **274/274 · 3980 اختبار** · الخدمة `Running`.

V2 يظل متاحاً صراحةً على `/app/v2.html?live=1` و`/app/index.html` للطوارئ.
