/**
 * V2 — وصولية النماذج: أخطاء الحقول وتسمياتها
 * ═══════════════════════════════════════════════════════════════════════
 * صندوق `role="alert"` يُعلن الرسالة لكنه لا يقول أيّ حقلٍ سببها، ومستخدم
 * الكيبورد يبقى على زر الحفظ يبحث عن الخطأ بين عشرة حقول. هنا تُعلَّم
 * الحقول الخاطئة `aria-invalid` وتُربط بالصندوق عبر `aria-describedby`،
 * وينتقل التركيز إلى أول حقلٍ خاطئ. رسالة الخادم العامة (بلا حقل) تُعلن
 * فقط ولا تسحب التركيز.
 *
 * وبعض القوالب تضع عنوان الحقل في `<label>` شقيق بلا `for`، فيسمع قارئ
 * الشاشة «حقل نص» بلا اسم؛ `bindAdjacentLabels` يربط ما لم يُربط.
 */

let autoLabelSeq = 0;

/** يربط `<label>` الشقيق التالي لحقله، ولا يمسّ الملتفّ حول حقلٍ أو المسمّى سابقًا. */
export function bindAdjacentLabels(root) {
    root.querySelectorAll('label:not([for])').forEach((label) => {
        if (label.querySelector('input, select, textarea')) {return;}
        const control = label.nextElementSibling;
        if (!control || !['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) {return;}
        if (control.hasAttribute('aria-label') || control.hasAttribute('aria-labelledby')) {return;}
        if (!control.id) {control.id = `v2auto-${++autoLabelSeq}`;}
        label.htmlFor = control.id;
    });
}

function describedBy(input) {
    return String(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
}

export function paintFormErrors(form, box, errors = []) {
    if (!box) {return;}
    if (!box.id) {box.id = 'v2-form-error';}
    box.textContent = errors.map((e) => e.message).join(' · ');
    if (!form) {return;}
    const bad = new Set(errors.map((e) => e.field).filter(Boolean));
    let firstBad = null;
    [...form.querySelectorAll('input, select, textarea')].forEach((input) => {
        if (!input.name) {return;}
        const ids = describedBy(input);
        if (bad.has(input.name)) {
            input.setAttribute('aria-invalid', 'true');
            if (!ids.includes(box.id)) {input.setAttribute('aria-describedby', [...ids, box.id].join(' '));}
            if (!firstBad) {firstBad = input;}
            return;
        }
        input.removeAttribute('aria-invalid');
        const kept = ids.filter((id) => id !== box.id);
        if (kept.length) {input.setAttribute('aria-describedby', kept.join(' '));}
        else {input.removeAttribute('aria-describedby');}
    });
    if (firstBad) {
        try {firstBad.focus({preventScroll: true});} catch (_) { /* detached */ }
        try {firstBad.scrollIntoView({block: 'nearest'});} catch (_) { /* detached */ }
    }
}
