/**
 * untyped-modules.d.ts — وحدات npm بلا حزم أنواع مثبّة
 * ────────────────────────────────────────────────────────────────────────────
 * المشروع لا يثبّت @types/express ونحوه، فـtsc يرفع TS7016 («لا يوجد إعلان»)
 * في كل ملف يستوردها. الإعلان المُحيطي القصير هنا يُعاملها كـany صراحةً:
 *   · نفس الاستدلال الذي كانت تصل إليهimplicitly — لا تغيير في أي فحص آخر.
 *   · لا تعليق @ts-ignore/on في ملفات الكود، ولا تغيير في package.json.
 *   · ملفات .js وحدها لا تحمل إعلانات — هنا مكانتها الصحيحة.
 */
declare module 'express';
declare module 'pngjs';
declare module 'qrcode';
declare module 'bcryptjs';
declare module 'jsonwebtoken';
