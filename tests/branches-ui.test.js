// ────────────────────────────────────────────────────────────────────────────
// branches-ui.test.js — ربط واجهة الفروع + طبقة KarimI18n (مهمة 15، 2026-10-13)
// الخلفية (/api/branches + /api/i18n/config) مختبرة الطرف — هذا الملف يقفل
// «أسلاك التوصيل» العشرة: تحميل karim-i18n في index.html، جسر main.js، حالة
// page-router، قوائم config/app/i18n/navigation، كاش sw — وسلوك brRowsHtml.
// أي تعديل يسقط حارسًا من التثبيت يُسقِط هذه الاختبارات فورًا.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const APP = p => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', p), 'utf8');
const INDEX = APP('index.html');
const MAIN = APP('js/main.js');
const ROUTER = APP('js/features/page-router.js');
const CONFIG = APP('js/core/config.js');
const APPJS = APP('js/app.js');
const I18N = APP('js/core/i18n.js');
const NAV = APP('js/features/auth-navigation.js');
const SW = APP('sw.js');
const BR_RAW = APP('js/features/branches.js');
const BR_SRC = BR_RAW.replace(/export\s*\{[^}]*\};?/, '');

function build(STATE, box) {
  const doc = { getElementById: () => box || null, querySelectorAll: () => [], dispatchEvent: () => {} };
  const factory = new Function(
    'STATE',
    'window',
    'document',
    'esc',
    'toast',
    'apiFetch',
    'confirm',
    'closeModal',
    'showModal',
    BR_SRC + '\nreturn { brRowsHtml, renderBranchesPage, brLoad, brAddModal };'
  );
  return factory(
    STATE,
    { STATE },
    doc,
    s =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    () => {},
    async () => {
      throw new Error('NO-NET — الفروع لا تُجلب لغير الأدمن');
    },
    () => true,
    () => {},
    () => {}
  );
}

describe('أسلاك التثبيت: karim-i18n + صفحة الفروع', () => {
  // العقد الحقيقي هو «إصدار كاش واحد لكل الأصول» لا رقم بعينه — كان الاختبار
  // يتقصف عند كل رفعة ?v (Cloudflare يخدم الأصول 4 ساعات بلا رفعة = واجهة قديمة).
  const VER = (INDEX.match(/js\/main\.js\?v=([\d.]+)/) || [])[1];
  test('index.html يحمّل karim-i18n.js قبل main.js بنفس إصدار الكاش', () => {
    expect(VER).toMatch(/^\d+\.\d+\.\d+$/);
    expect(INDEX).toContain(`<script src="js/karim-i18n.js?v=${VER}" defer></script>`);
    expect(INDEX.indexOf('karim-i18n.js')).toBeLessThan(INDEX.indexOf('js/main.js?v='));
  });

  test('main.js يجسر features/branches.js عبر safeBridge', () => {
    expect(MAIN).toContain(`safeBridge('./features/branches.js?v=${VER}', 'BRIDGE-BR')`);
  });

  test('page-router: حالة branches ترسم الصفحة اللاتزامنية بلا ترك شفافية', () => {
    const block = ROUTER.slice(ROUTER.indexOf("case 'branches'"));
    expect(block).toContain('await renderBranchesPage()');
    expect(block).toContain("content.style.opacity='1'");
  });

  test('صلاحيات: branches في قائمة أدمن فقط (ليس manager/hr/owner)', () => {
    const adminLine = CONFIG.split(/\r?\n/).find(l => l.startsWith('admin:'));
    expect(adminLine).toContain("'branches'");
    for (const role of ['manager', 'warehouse', 'hr', 'owner', 'accountant', 'cashier']) {
      const line = CONFIG.split(/\r?\n/).find(l => l.startsWith(role + ':'));
      expect(line).not.toContain("'branches'");
    }
    expect(APPJS).toMatch(/branches: '<i class=ji data-i=building><\/i>',/);
  });

  test('i18n: pg.branches بالعربية والإنجليزية + MENU_STRINGS للفروع', () => {
    expect(I18N).toContain("'pg.branches': 'إدارة الفروع'");
    expect(I18N).toContain("'pg.branches': 'Branches'");
    expect(I18N).toMatch(/branches: \{ icon: 'building', ar: 'الفروع', en: 'Branches' \}/);
  });

  test('navigation: الفروع في مجموعة النظام + عنوان go() + مزامنة toggleLang مع KarimI18n', () => {
    const sysLine = NAV.split(/\r?\n/).find(l => l.includes("id:'sys'"));
    expect(sysLine).toContain("'branches'");
    expect(NAV).toContain("branches:t('pg.branches')");
    const toggle = NAV.slice(NAV.indexOf('function toggleLang'), NAV.indexOf('function toggleTheme'));
    expect(toggle).toContain('window.KarimI18n');
    expect(toggle).toContain('KarimI18n.setLang(STATE.lang)');
  });

  test('service worker: مسح مسبق للكارين-آي١٨ن والفروع + رفعة إصدار الكاش', () => {
    expect(SW).toContain(`'/app/js/karim-i18n.js?v=${VER}'`);
    expect(SW).toContain(`'/app/js/features/branches.js?v=${VER}'`);
    expect(SW).toMatch(/CACHE_VERSION='4\.25\.5[2-9]'/);
  });

  test('branches.js يستدعي عقد الخلفية الأربعة (GET/POST/PATCH/DELETE)', () => {
    // regexes متسامحة مع المسافات — الملفات منسّقة بـ prettier وقد يُعاد تنسيقها
    expect(BR_RAW).toMatch(/apiFetch\(\s*'\/branches'\s*\+/); // GET قائمة
    expect(BR_RAW).toMatch(/apiFetch\(\s*'\/branches'\s*,\s*\{\s*method:\s*'POST'/);
    expect(BR_RAW).toMatch(/\{\s*method:\s*'PATCH'/);
    expect(BR_RAW).toMatch(/\{\s*method:\s*'DELETE'\s*\}/);
    // الكود لا يُعدَّل بعد الإنشاء (معرّف خارجي للسجلات عبر branch_id)
    expect(BR_RAW).toMatch(/delete\s+f\.code\s*;?/);
  });
});

describe('سلوك brRowsHtml + بوابة الأدمن', () => {
  const ADMIN = { currentUser: { role: 'admin' } };

  test('غير الأدمن يرى رسالة منع ولا تُلمس الشبكة', async () => {
    const box = { innerHTML: '' };
    const m = build({ currentUser: { role: 'hr' } }, box);
    await m.renderBranchesPage();
    expect(box.innerHTML).toContain('للمدير فقط');
  });

  test('قائمة فروع: شارات الحالة، حماية MAIN من الإيقاف، هروب HTML من الأسماء', () => {
    const m = build(ADMIN);
    const html = m.brRowsHtml(
      [
        { id: 1, code: 'MAIN', name_ar: 'الرئيسي', currency: 'sar', timezone: 'Asia/Riyadh', is_active: true },
        { id: 2, code: 'BR-2', name_ar: '<img src=x onerror=alert(1)>', name_en: 'Second', is_active: false },
        { id: 3, code: 'BR-3', name_ar: 'فرع نشط', is_active: true },
      ],
      true
    );
    expect(html).toContain('نشط');
    expect(html).toContain('معطّل');
    expect(html).toContain('رئيسي');
    expect(html).toContain('SAR'); // عملة مطبّعة لكبريًا
    // MAIN محمي: زر الإيقاف الوحيد لـ BR-3 النشط — لا يظهر لغير الأدمن ولا لـ MAIN
    expect((html.match(/إيقاف<\/button>/g) || []).length).toBe(1);
    expect(html).toContain('إعادة تفعيل');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  test('لا فروع → حالة فارغة تدعو للإضافة', () => {
    const m = build(ADMIN);
    expect(m.brRowsHtml([], true)).toContain('أضف أول فرع');
  });
});
