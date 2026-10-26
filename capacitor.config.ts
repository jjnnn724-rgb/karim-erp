import type { CapacitorConfig } from '@capacitor/cli';

// الدومين العام عبر نفق Cloudflare (karimeg.online → السيرفر المحلي :5000)
// شهادة موثوقة من Cloudflare — يعمل من أي شبكة داخل أو خارج المطعم.
// ملاحظة تشغيلية: بصمة الجوال عبر التونل تتطلب تفعيل الجيوفانس من
// شاشة إعدادات البصمة (قرار إداري) حسب طبقات التحقق في SPEC v1.
const PUBLIC_SERVER = 'https://karimeg.online';

const config: CapacitorConfig = {
  appId: 'com.karimerp.app',
  appName: 'Karim ERP',
  webDir: 'frontend/app',
  // التطبيق واجهة للسيرفر مباشرة (لا نسخ ملفات) — التحديثات فورية بلا إعادة نشر APK
  server: {
    url: `${PUBLIC_SERVER}/app/index.html`,
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    // أندرويد 15+ يفرض edge-to-edge: بدونه الشريط العلوي يمر تحت النوتش.
    // 'force' يضيف هوامش تلقائية فوق/تحت داخل الـ WebView نفسها.
    adjustMarginsForEdgeToEdge: 'force',
    // network_security_config يثق بشهادات النظام + المستخدم كطبقة احتياطية
    // للوصول الداخلي المباشر عبر IP الشبكة (شهادة CA الموقعة ذاتيًا)
  },
};

export default config;
