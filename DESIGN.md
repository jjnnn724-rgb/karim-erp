---
version: alpha
name: Karim-ERP-V2
description: >
  الهوية البصرية الرسمية لواجهة Karim ERP V2 («ليل الزمرد»): ورقٌ عاجي دافئ
  وبطاقات أوفى بياضًا، وزمردٌ هو لون الفعل في الوضعين، وعمودٌ زمردي ليليّ
  يحمل لوحةً نحاسية للوجهة الحالية. النحاس مجوهراتٌ (تركيز، شعار، حدّ)،
  والنحاسي صوتُ البيانات. كل قيمة هنا مشتقة من css/v2/erp-identity.css
  وerp-tokens.css — الملفان الوحيدان المسموح لهما بحمل قيم لونية خام؛ بقية
  ملفات css/v2 تقرأ الرموز فقط وتُفحص ببوابة design-color-audit.
colors:
  primary: "#0F5B46"
  on-primary: "#FFF9EE"
  primary-hover: "#0B4A39"
  primary-active: "#083A2C"
  brand-text: "#0E5C45"
  canvas: "#F6F1E6"
  surface: "#FFFCF5"
  surface-raised: "#FFFFFF"
  surface-sunken: "#EDE6D7"
  surface-hover: "#F3EDE1"
  ink: "#1A2B24"
  ink-secondary: "#33473E"
  muted: "#57685F"
  faint: "#5F7067"
  hairline: "#E2D9C7"
  hairline-strong: "#CBBFA8"
  brass: "#A57A2C"
  brass-text: "#7A5A12"
  brass-bright: "#E6C478"
  copper: "#A85E2E"
  success: "#0F7A46"
  success-text: "#0A5C35"
  warning: "#A86411"
  warning-text: "#824C08"
  danger: "#B03428"
  danger-text: "#8E241A"
  info: "#2E5CC8"
  info-text: "#2348A3"
  neutral: "#5A6A60"
  neutral-text: "#45544B"
  sidebar: "#0C2A23"
  sidebar-ink: "#F7F2E4"
  sidebar-accent: "#E6C478"
  sidebar-plaque: "#FBF6E9"
  sidebar-plaque-ink: "#201A12"
  dark-canvas: "#06110D"
  dark-surface: "#0C1E18"
  dark-raised: "#122A21"
  dark-primary: "#3FBF93"
  dark-on-primary: "#04170F"
  dark-brand-text: "#7FE0BC"
  dark-brass: "#E3C27E"
  dark-brass-text: "#E9CD93"
  dark-ink: "#F3EFE0"
  dark-muted: "#A7B5A4"
typography:
  display-lg:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  heading-lg:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  heading-md:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  heading-sm:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  body-md:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0px
  body-sm:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0px
  caption:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0px
  label-md:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: 0px
  button-md:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0px
  numeric:
    fontFamily: "IBM Plex Sans Arabic, Tajawal, Cairo, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 6px
  md: 10px
  lg: 14px
  xl: 18px
  xxl: 22px
  full: 999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  section: 40px
  page: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: 38px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    height: 38px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: 38px
  button-sm:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: 30px
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: 38px
  text-input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 38px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "16px"
  kpi-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  table-header:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label-md}"
    height: 38px
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    height: 34px
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    height: 34px
  nav-item:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.sidebar-ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: 38px
  nav-item-active:
    backgroundColor: "{colors.sidebar-plaque}"
    textColor: "{colors.sidebar-plaque-ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 38px
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
  state-empty:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  state-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger-text}"
    typography: "{typography.body-md}"
  skeleton:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.sm}"
    height: 11px
---

# Karim ERP V2 — عقد التصميم

## Overview

**الفكرة:** لوحةُ المطعم ورقةٌ دافئة وذهب؛ والنظام يجب أن يكون «الدفتر» الذي
خلفها — لا منتجاً ثانياً لا علاقة له بها. لذلك:

- **ورق عاجي** (`{colors.canvas}`) لا رمادي بارد، و**بطاقات أوفى بياضاً**
  (`{colors.surface}`) تقفز على الورق (فرق القيمة هو ما يجعل الواجهة تُقرأ
  «محترفة» لا «كريمية»).
- **زمرد** (`{colors.primary}`) لونُ الفعل الوحيد في الوضعين: حجرٌ مضاء
  بتدرّج، لا مستطيل مصبوغ. ونصُّه النصي `{colors.brand-text}` أغمق للمقروئية.
- **نحاس** (`{colors.brass}`) مجوهراتٌ لا طلاء: حلقة التركيز، إطار الشعار،
  ولمسات KPI. والنحاسي `{colors.copper}` صوتُ البيانات.
- **عمود جانبي زمردي ليليّ** (`{colors.sidebar}`) في الوضعين — أكبر قرار هوية:
  التطبيق دفترٌ مجلّد (كعب داكن، صفحات ورق) لا قالب إدارة أبيض آخر.
  والوجهةُ الحالية **لوحةٌ نحاسية عاجية** (`{colors.sidebar-plaque}`) بحبر
  إسبريسو — الموضع الوحيد الذي يكتب فيه الواجهة بالمعدن.

**النطاق:** كل ما هنا يخص `.erp-v2` فقط. الواجهة القديمة تحتفظ بلوحتها؛ لا
تُستورد رموز V2 هناك ولا العكس.

**مصادر الحقيقة (بالترتيب):**

1. `frontend/app/css/v2/erp-identity.css` — البدائيات + الدلالات + الوضع الداكن
   + رموز الطباعة على `:root`. يحمّل **أخيراً** (v2.html:109) فهو الطبقة العليا.
2. `frontend/app/css/v2/erp-tokens.css` — المقياس الطباعي والمسافات وأحجام
   عناصر التحكم، وقائمة مضيفي الرموز للطبقات المركّبة على `body`.
3. `frontend/app/css/v2/erp-themes.css` — الوضع الداكن، تباين A11y، الطباعة.
4. هذه الوثيقة — العقد الذي يمنع الانجراف.

> **لا تعدّل `css/design-tokens.css` لتطابق V2.** تلك لوحة الإرث القديمة
> (البرونز)، وتعديلها يغيّر النظام الحيّ. هوية V2 في `erp-identity.css` وحدها.

## Colors

**الكانفس والسطح**

| الدور | الفاتح | الداكن |
|---|---|---|
| كانفس | `{colors.canvas}` | `{colors.dark-canvas}` |
| بطاقة/سطح | `{colors.surface}` | `{colors.dark-surface}` |
| مرفوع | `{colors.surface-raised}` | `{colors.dark-raised}` |
| غائر (رؤوس جدول) | `{colors.surface-sunken}` | — |
| خط شعرة | `{colors.hairline}` | — |

**النص** — أربع درجات لا أكثر:
`{colors.ink}` للقيم، `{colors.ink-secondary}` للعناوين الفرعية،
`{colors.muted}` للتسميات، `{colors.faint}` للهامش. المقاساتُ المقيسة على
البطاقة: 14.48 / 9.71 / 5.77 / 5.12، والدرجة الخافتة على الكانفس 4.66:1 —
أدنى تباين في الواجهة. لا رمادي خامس.

**الفعل والزينة**

- `{colors.primary}` / `{colors.primary-hover}` / `{colors.primary-active}`:
  أزرار أساسية وروابط. الزر تدرّجُ حجرٍ مضاء وحبره `{colors.on-primary}`.
- `{colors.brand-text}`: نصٌّ زمردي على سطح فاتح (7.78:1).
- `{colors.brass}`: حلقة تركيز وإطار شعار (≥3:1 = 3.78) — **لا** خلفيات أزرار.
- `{colors.brass-text}`: نحاسٌ صالحٌ للنص الصغير (6.21:1) — لمسات KPI.
- `{colors.brass-bright}`: نحاسٌ على العمود الداكن.
- `{colors.copper}`: سلاسل بيانات ورسوم.

**الحالات** — كلٌّ منها لون + `-text` أغمق + `-soft` (تلوين 14–16%):
`{colors.success}`, `{colors.warning}`, `{colors.danger}`, `{colors.info}`,
`{colors.neutral}`. الشارة تحمل **نصاً** دائماً؛ اللون وحده ليس دلالة
(WCAG 1.4.1).

**سلّم الرسوم:** زمرد `#14735B` ← نحاسي `#A85E2E` ← `#3F5187` ← `#7A4B63`
← `#66702B` ← `#5A6570`. كل درجة ≥3:1 على السطح والكانفس في الوضعين.

**الوضع الداكن** يبدّل **البدائيات فقط**؛ الدلالات ترث تلقائياً. هذا هو سبب
وجود طبقتين: إضافة لون داكن جديد = سطر بدائي واحد، لا بحث عن كل مستهلكيه.
الليل `{colors.dark-canvas}` بحبر `{colors.dark-ink}`، والفعل فيه يشمٌ مضيء
(`{colors.dark-primary}`) بحبر ليليّ `{colors.dark-on-primary}` — العقد نفسه
في الوضعين، والزمرد هو لون الفعل دائمًا.

**الطباعة:** `:root` يحمل `--erp-print-ink/-ink-strong/-paper/-head/-head-soft/
-grid` لأن قواعد `@media print` تلمس `html`/`body` خارج `.erp-v2`.

## Typography

عائلة واحدة — **IBM Plex Sans Arabic** مستضافة ذاتياً (400/500/600/700 ×
عربي/لاتيني) من `app/fonts/v2/`. لا وجه عرض ثانٍ ولا وجه أرقام منفصل: تبديل
الشخصية بين تسمية والرقم بجانبها يجعل الواجهة تبدو مركّبة.

| المستوى | الحجم | الوزن | الاستخدام |
|---|---|---|---|
| `{typography.display-lg}` | 26px | 600 | عنوان الشاشة (h1) |
| `{typography.heading-lg}` | 20px | 600 | قسم رئيسي (h2) |
| `{typography.heading-md}` | 16px | 600 | بطاقة (h3) |
| `{typography.heading-sm}` | 14px | 600 | عنوان فرعي (h4) |
| `{typography.body-md}` | 13px | 400 | النص الافتراضي — كثافة ERP |
| `{typography.body-sm}` | 12px | 400 | شارات وتلميحات |
| `{typography.caption}` | 11px | 400 | هامش/تسمية صغيرة |
| `{typography.label-md}` | 12px | 500 | رؤوس أعمدة وتسميات حقول |
| `{typography.button-md}` | 13px | 600 | أزرار |
| `{typography.numeric}` | 13px | 500 | أرقام بجدولة `tabular-nums` |

**الأرقام:** كل جدول ورقم مالي يستخدم `font-variant-numeric: tabular-nums`
حتى لا ترتجف الأعمدة عند تغيّر قيمة. لا تخطيط نسبي للأرقام في الجداول.

**العربية:** `font-synthesis-weight: none` و`text-rendering: optimizeLegibility`
مقصودان: لا وزن مُصنَّع ولا تشكيل مُفكَّك. لا تستخدم `letter-spacing` سالباً
مع العربية.

## Layout

- **المسافات:** مقياس 4px (`{spacing.xxs}`…`{spacing.page}`). المسافة بين
  البطاقات 16px، وبين الأقسام 24–32px.
- **الهيكل:** عمود جانبي ثابت 264px (يُطوى إلى 68px `is-compact`) + محتوى
  يتدفّق. تحت 1024px يصبح العمود درجاً منزلقاً فوق المحتوى؛ وتحت 900px
  يتحوّل الهيكل إلى شريط سفلي بخمسة عناصر كحد أقصى (`mobile-shell.js`).
- **الشبكات:** KPI بشبكة تلقائية `repeat(auto-fit, minmax(172px, 1fr))`؛
  لا عرض ثابت لبطاقة في الجوّال.
- **المناطق الرقمية RTL:** استخدم الخصائص المنطقية دائماً
  (`margin-inline`, `padding-block`, `inset-inline-start`). لا `left/right`.
- **التمرير:** الجدول هو منطقة التمرير الأفقية الوحيدة داخل بطاقته؛ الصفحة
  نفسها لا تمرر أفقياً على 360px.

## Elevation & Depth

ظلال دافئة منخفضة (لا ظل أسود بارد)، وحدّ شعرة داخلي يعطي «ورقاً» لا «زجاجاً»:

- `{components.card}`: `0 1px 2px rgba(46, 38, 24, .06)` + حد `1px`.
- قائمة/نافذة عائمة: `0 6px 18px rgba(46, 38, 24, .08)`.
- درج/نافذة: `0 18px 44px rgba(46, 38, 24, .14)`.
- لوحة أوامر: `0 30px 72px rgba(46, 38, 24, .20)`.

الارتفاع ينقل **بنية** (ما يعلو فوق ماذا)، لا زينة. لا ظل على صف جدول.

## Shapes

- نصف القطر: `{rounded.sm}` 6 / `{rounded.md}` 10 / `{rounded.lg}` 14 /
  `{rounded.xl}` 18 / `{rounded.xxl}` 22 / `{rounded.full}` للحبّات والشارات.
- الأزرار والحقول `{rounded.md}`؛ البطاقات `{rounded.lg}`؛ النوافذ
  `{rounded.xl}`.
- لا زوايا مختلطة داخل المكوّن نفسه (زر بـ12 وحقل بـ8 في نفس الصف = انجراف).

## Components

**button-primary** — `{components.button-primary}`؛ hover
`{components.button-primary-hover}`، active أغمق بدرجة، disabled بشفافية
‎0.5 مع `cursor: not-allowed` و`aria-disabled`. الحد الأدنى 38px. التعبئة
تدرّجٌ رأسي من `{colors.primary-hover}` إلى `{colors.primary-active}` وحدُّ
ضوء نحاسي رفيع في الأعلى — «حجرٌ مضاء» لا مستطيل مسطّح.

**text-input** — `{components.text-input}`، حدّ `1px`
`{colors.hairline-strong}`. Focus: `outline: 2px solid {colors.brass}` بـ
`outline-offset: 2px` (المتغيّر `--erp-focus-ring`). لا تحذف الحلقة أبداً
(`:focus-visible`).

**card** — `{components.card}` + ظل `sm` + حد شعرة. الرأس والجسم بفاصل واحد
فقط؛ لا فواصل متداخلة.

**kpi-tile** — `{components.kpi-tile}`؛ أيقونة KPI في مربّع نحاسي
`rgba(169,118,27,.12)` والنص `{colors.brass-text}`. الرقم هو أكبر عنصر في
البطاقة، والتسمية فوقه بخط صغير، والمقارنة شارة أسفلها.

**table** — رأس `{components.table-header}` لاصق بخط
`{typography.label-md}`؛ صف `{components.table-row}` (34px) وhover
`{components.table-row-hover}`. حدود أفقية فقط. التمرير داخل
`.erp-table__scroll` مع `tabindex="0"` واسم مفهوم.

**حالات الجدول الأربع** (عقد إلزامي — لا منطقة فارغة أبداً):

1. `loading` → هيكل عظمي `{components.skeleton}` بصفوف بنفس ارتفاع الصفوف
   الحقيقية **مع إبقاء الرؤوس الحقيقية**، `aria-busy="true"`, ورسالة
   `role="status"` مخفية بصرياً. الهدف: CLS = 0.
2. `error` → `{components.state-error}` + أيقونة `alert-triangle` + زر
   «إعادة المحاولة» + `role="alert"`.
3. `empty` → `{components.state-empty}` + أيقونة `inbox` + عنوان + تلميح
   (ماذا يفعل المستخدم الآن؟).
4. `data` → الصفوف الحقيقية.

**badge** — `{components.badge-success}` / `{components.badge-danger}`؛
حشو `3px 9px`، نص 12px، حدّ بلون النبرة 34% (إشارة ثانية بلا اعتماد على
اللون). قيمة غير معروفة = حدّ متقطّع `data-unknown="true"`.

**nav-item** — `{components.nav-item}` على العمود الزمردي؛ النشط
`{components.nav-item-active}`: **لوحة نحاسية عاجية** بحبر إسبريسو، وشريط
نحاسي رفيع على الحافة (`::before`)، وأيقونة نحاسية داكنة، و
`aria-current="page"`. النشط لا يعتمد على اللون وحده.

**fab** — الزر العائم 52px على الحافة **المقابلة** للعمود الجانبي
(`inset-inline-end: 20px`)، ويُخفى داخل هيكل الجوال (≤900px) حيث الشريط
السفلي يقوم مقامه. لا تضعه على `inset-inline-start` — في RTL يسقط فوق
العمود ويغطّي اسم الدور.

**state-*** — كل حالة فارغة/خطأ تستخدم الأسطوانة المشتركة `.erp-state`
(أيقونة SVG + عنوان + وصف). **ممنوع الإيموجي كأيقونة**؛ سجل `js/icons.js`
هو المصدر، والاسم غير المسجّل يرسم «؟» ويطبع تحذيراً في الـconsole
(يحرسه `tests/v2-icons-registry.test.js`).

## Do's and Don'ts

**افعل**

- اقرأ اللون من `var(--erp-*)` دائماً، حتى في سطر واحد.
- استخدم `{colors.brass}` للتركيز و`{colors.primary}` للفعل — لا تخلطهما.
- أبقِ الرؤوس الحقيقية ظاهرة أثناء التحميل (هيكل عظمي محاذٍ).
- استخدم خصائص CSS المنطقية للـRTL.
- اختبر كل شاشة على 360px، وفي الوضعين، وبتكبير 200%.

**لا تفعل**

- لا تكتب hex/rgb/hsl أو اسم لون في `css/v2/*.css` — بوابة
  `npm run test:color:gate` تُسقط البناء. الاستثناءات الموثّقة فقط
  (`erp-tokens.css`, `erp-themes.css`, `erp-identity.css`, `erp-board.css`؛
  وwhite-label داخل `design-color-audit:allow-begin…end` بسببه المطبوع).
- لا تستخدم الإيموجي كأيقونة، ولا أيقونة بلا `aria-label` إن كانت الزر وحده.
- لا تحرّك محتوى الجداول والأرقام عند تغيير الفلتر — المضيف يعيد رسم
  `innerHTML`، فأي أنيميشن على الأبناء سيُعاد مع كل ضغطة. الحركة المسموحة:
  دخول حاويات الشاشة (`erp-motion.css`) والتدرّج 35/70/105/140ms، وانتقالات
  hover/focus فقط.
- لا تضع ظلاً على صف جدول أو نص.
- لا تُعدّل `css/design-tokens.css` (لوحة الإرث) لتطابق V2.
- لا تربط `erp-identity.css` في الواجهة القديمة.

## Responsive Behavior

- **>1024px:** عمود جانبي ثابت (264px، أو 68px مضغوط) + شبكة KPI تلقائية.
- **641–1024px:** العمود يصبح درجاً منزلقاً مع حاجب؛ وعند ≤900px يظهر
  الشريط السفلي (5 عناصر) والزر العائم ويسقط شريط الأدوات.
- **≤640px:** رأس بلا مسار تنقّل، تبويب الشريط السفلي، أهداف لمس ≥44px،
  وحقول 16px لمنع تكبير iOS التلقائي. الجداول تمرر أفقياً داخل بطاقتها فقط.
- **≤340px:** تتحول مجموعات الاختصار إلى عمود واحد بدل عمودين مقصوصين.
- **الطباعة:** شريط التنقّل والأزرار وأدوات الجدول تختفي
  (`erp-no-print`)، وتُستخدم رموز ورق الطباعة على `:root` (حبر أسود، رؤوس
  رمادية فاتحة، شبكة مرئية).

## Motion

- المدد: 80ms (فوري) · 120ms (سريع) · 180ms (أساسي) · 260ms (بطيء).
- المنحنيات: `cubic-bezier(.2,0,0,1)` قياسي، `cubic-bezier(0,0,.2,1)` خروج.
- الهيكل العظمي يلمع كل 1.4s، ويتوقف تماماً تحت
  `prefers-reduced-motion: reduce`.
- أنيميشن الدخول لحاويات الشاشة فقط (مرة لكل تنقّل)، لا لأبناء البيانات.

## Known Gaps

- **الواجهة القديمة (V1) خارج هذا العقد** — لوحة برونزية مستقلة. أي توحيد
  لاحق يحتاج قراراً منفصلاً (additive فقط).
- **العلامة البيضاء** (`data-brand="corporate"` على `.erp-v2`) تعيد تلوين
  الأزرق/الذهبي عمداً — ليست انجرافاً، ومسموحة صراحة في بوابة الألوان.
- **بانر المعاينة** CSS نائم بلا ترميز في `v2.html` (يُثبّت غيابه
  `tests/v2-mode-banner.test.js`)؛ لا تُحييه دون قرار.
- **الكثافة:** 13px أساسٌ مقصود لشاشات ERP الكثيفة، لا خطأ. أي رفعه إلى 16px
  يحتاج مراجعة كامل الشبكات.
- **DESIGN.md نفسه غير مفحوص آلياً بعد** — لم تُوصَّل بوابة
  `design-md-review` بـCI (خطوة تالية مقترحة، ليست قائمة).
