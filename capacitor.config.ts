import type { CapacitorConfig } from '@capacitor/cli';

// عنوان سيرفر المطعم داخل الشبكة — عدّله إذا تغيّر IP السيرفر
const LAN_SERVER = 'https://192.168.1.165:5001';

const config: CapacitorConfig = {
  appId: 'com.karimerp.app',
  appName: 'Karim ERP',
  webDir: 'frontend/app',
  // التطبيق يعمل كواجهة للسيرفر المحلي مباشرة (لا نسخ ملفات)
  server: {
    url: `${LAN_SERVER}/app/index.html`,
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    // يثق بشهادات المستخدم (CA المثبتة على الجهاز) — يلزم تثبيت karim-ca.crt مرة واحدة
    // راجع: android/app/src/main/res/xml/network_security_config.xml
  },
};

export default config;
