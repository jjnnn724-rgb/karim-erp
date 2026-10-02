/**
 * core/pwa.js — PWA install + offline bar (extracted verbatim from app.js 11702–11728)
 * Bridge policy: pwaInstall/pwaUpdateOfflineBar are mounted on window by js/main.js.
 * External dependency: `toast()` — resolved from window at call time (defined by app.js).
 */

let _pwaPrompt = null;

/**
 * زر تثبيت داخل الشريط الجانبي — لأن زر شاشة الدخول لا يراه المستخدم صاحب
 * الجلسة المحفوظة. يظهر فقط عندما يمنح المتصفح beforeinstallprompt (سياق
 * آمن موثوق + معايير PWA مستوفاة).
 */
function showSidebarInstall() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer || document.getElementById('pwaSidebarBtn')) {return;}
  const btn = document.createElement('button');
  btn.className = 'sb-toggle';
  btn.id = 'pwaSidebarBtn';
  btn.innerHTML = '<i class="ji" data-i="arrow-down"></i> ثبّت التطبيق';
  btn.addEventListener('click', () => { window.pwaInstall?.(); });
  footer.insertBefore(btn, footer.firstChild);
}

function hideSidebarInstall() {
  const b = document.getElementById('pwaSidebarBtn');
  if (b) {b.remove();}
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaPrompt = e;
  const b = document.getElementById('pwaInstallBtn');
  if (b) {b.style.display = '';}
  showSidebarInstall();
});
// بعد التثبيت الفعلي — تنظيف كلا زري الدعوة
window.addEventListener('appinstalled', () => {
  _pwaPrompt = null;
  hideSidebarInstall();
  const b = document.getElementById('pwaInstallBtn');
  if (b) {b.style.display = 'none';}
});
export async function pwaInstall(){
  if (_pwaPrompt) {
    _pwaPrompt.prompt();
    try { await _pwaPrompt.userChoice; } catch (_) {}
    _pwaPrompt = null;
    const b = document.getElementById('pwaInstallBtn');
    if (b) {b.style.display = 'none';}
    hideSidebarInstall();
  } else {
    toast('من متصفح الجوال: مشاركة ← إضافة إلى الشاشة الرئيسية', 'info');
  }
}
export function pwaUpdateOfflineBar(){
  const b = document.getElementById('offlineBar');
  if (b) {b.style.display = navigator.onLine ? 'none' : '';}
}
window.addEventListener('online', () => { pwaUpdateOfflineBar(); toast('عاد الاتصال بالشبكة', 'success'); });
window.addEventListener('offline', () => { pwaUpdateOfflineBar(); toast('انقطع الاتصال — وضع عدم الاتصال', 'error'); });
