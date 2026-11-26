# تقليل تحذيرات Biome — 2026-11-26

## النتيجة
- قبل: **284 warning**.
- بعد: **227 warning** (−57، حوالي 20%).
- `pnpm gate` = **0**: typecheck نظيف، 1516 اختبار، build نجح، lint 0 errors.

## كيف اتعمل
شغّلنا `biome check --write --unsafe` مع تعطيل مؤقت للقواعد اللي إصلاحها مم يغيّر سلوك (hooks deps، a11y، non-null assertions، CSS specificity…). القواعد اللي اتصلّحت فعلياً:
- `noUselessFragments` ( fragments زائدة )
- `useOptionalChain`
- `useTemplate`
- `useLiteralKeys`
- `useMathMinMax` (حيث كان آمنًا)

القواعد اللي اتصلّحت اتنفّذت على **53 ملف**، واتصلح عقد اختبار `DeptHeadDispatchPanel` اللي كان بيفقد `role` بعد الإصلاح الآلي.

## المتبقي (227)
أكبر المجموعات:
- `noImportantStyles` 88 و`noDescendingSpecificity` 38 — CSS يخص إصدارات قديمة، إزالته تغيّر الشكل.
- `noNonNullAssertion` 28 — محتاج narrowing صريح.
- `useSemanticElements` 23 و`noLabelWithoutControl` 14 — تحسينات a11y هيكلية.
- `useExhaustiveDependencies` 13 — إضافة تبعيات قد تسبب loops.

دي مش عوائق إنتاج (0 errors)، وموثّقة في `LINT-POLICY.md`.
