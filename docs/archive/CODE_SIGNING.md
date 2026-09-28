# التوقيع الرسمي لمثبت مطاعم الشرفة العالمية

لا يحتوي المشروع على شهادة توقيع خاصة بالناشر، لذلك لا يمكن إزالة تحذير SmartScreen بشكل صادق من داخل بيئة البناء. لا ينبغي تجاوز SmartScreen أو تعطيله؛ الحل الصحيح هو توقيع التطبيق والمثبت بشهادة Code Signing مرتبطة باسم الناشر الحقيقي.

## بناء نسخة موقعة

على جهاز البناء أو CI، تُضبط متغيرات البيئة التالية قبل تشغيل electron-builder:

```powershell
$env:CSC_LINK = "C:\certificates\alshorfa-code-signing.p12"
$env:CSC_KEY_PASSWORD = "ضع-كلمة-مرور-الشهادة-هنا"
npm run electron:build:nsis
```

يمكن استخدام شهادة OV من جهة إصدار موثوقة، أو شهادة EV عندما تكون متطلبات الثقة العالية وتقليل تحذيرات SmartScreen أولوية. يجب أن يكون اسم الناشر في الشهادة مطابقًا للكيان القانوني صاحب التطبيق، وأن يتم حفظ الشهادة وكلمة المرور خارج المستودع وعدم إرسالها داخل المشروع المضغوط.

بعد التوقيع، يتم التحقق على Windows بالأوامر التالية:

```powershell
Get-AuthenticodeSignature .\Al-Shorfa-International-Restaurants-Setup-3.1.0.exe
signtool verify /pa /v .\Al-Shorfa-International-Restaurants-Setup-3.1.0.exe
```

المثبت الحالي غير موقّع لأنه بُني دون شهادة ناشر. جميع إعدادات البناء جاهزة لاستقبال `CSC_LINK` و`CSC_KEY_PASSWORD` تلقائيًا عند توفر الشهادة.
