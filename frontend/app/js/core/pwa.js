/**
 * core/pwa.js — PWA install + offline bar (extracted verbatim from app.js 11702–11728)
 * Bridge policy: pwaInstall/pwaUpdateOfflineBar are mounted on window by js/main.js.
 * External dependency: `toast()` — resolved from window at call time (defined by app.js).
 */

let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _pwaPrompt = e;
  const b = document.getElementById('pwaInstallBtn');
  if (b) {b.style.display = '';}
});
export async function pwaInstall(){
  if (_pwaPrompt) {
    _pwaPrompt.prompt();
    try { await _pwaPrompt.userChoice; } catch (_) {}
    _pwaPrompt = null;
    const b = document.getElementById('pwaInstallBtn');
    if (b) {b.style.display = 'none';}
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
