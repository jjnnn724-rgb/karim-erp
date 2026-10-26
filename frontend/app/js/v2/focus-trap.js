/**
 * focus-trap.js — حبس التركيز داخل لوحةٍ تعلن `aria-modal`.
 *
 * WHY: `aria-modal="true"` وعدٌ لقارئ الشاشة بأن ما خلف اللوحة خارج اللعب،
 * لكن Tab يمرّ إلى الصفحة الخلفية ما لم يحرسه أحد: يُقرأ ما لا يُرى ويُنقر
 * ما لا يُقصد. الحلقة هنا تحرس الطرفين — الأخير يعود إلى الأول، والأول
 * يذهب إلى الأخير بالخلف — وتعيد التركيز إلى أول عنصر إن كان قد فرّ خارج
 * اللوحة أصلًا.
 *
 * التركيز الابتدائي قرار المستدعي (عنوان اللوحة عادة)؛ هذه الدالة لا تلمس
 * التركيز عند التركيب، وتُفكّ بالدالة المُعادة عند الإغلاق.
 *
 * العناصر غير المرئية لا تُحسب: لوحة مغلقة (`hidden`) أو زر معطّل لا يجوز
 * أن يكون طرف الحلقة.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {HTMLElement} root اللوحة المعلنة aria-modal
 * @returns {() => void} فكّ الحبس
 */
export function trapFocus(root) {
    function items() {
        return [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    }
    function onKey(e) {
        if (e.key !== 'Tab') {return;}
        const list = items();
        if (!list.length) {e.preventDefault(); return;}
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (!root.contains(active)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
            return;
        }
        if (e.shiftKey && active === first) {e.preventDefault(); last.focus();}
        else if (!e.shiftKey && active === last) {e.preventDefault(); first.focus();}
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
}
