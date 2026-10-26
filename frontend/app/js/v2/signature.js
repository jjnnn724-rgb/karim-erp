/**
 * V2 — لوحة التوقيع الإلكتروني (وحدة مشتركة لدورات القرار)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * منسوخة سلوكًا من النظام الأساسي (features/kitchen.js:976-1057) حرفًا
 * بحرف، بلا اختراع:
 *   • الحقل مقفل على اسم صاحب الحساب (readonly) ولا يقبل أي اسم آخر —
 *     والخادم يعيد الفحص نفسه (warehouse-routes.js:365-390: signerName
 *     يجب أن يطابق req.user.name/username وإلا 403 SIGNER_MISMATCH).
 *   • الرسم على canvas: الاسم بخط Aref Ruqaa (احتياطي Cairo)، خط ذهبي
 *     مرسوم بمنحنى Bezier، وتاريخ اليوم أسفله — نفس المقاسات والألوان
 *     (kitchen.js:996-1021). ألوان الكانفس حرفية لأن الكانفس لا يرث CSS.
 *   • قيمة الإرسال: canvas.toDataURL('image/png') — نفس ما يقرأه
 *     requireSignature من signatureData.
 *
 * CSP: لا معالج سطري واحد — الحقل readonly ولا يحتاج أحداثًا؛ وكل
 * الاستماع عبر تفويض الشاشة المستدعية.
 *
 * الاستخدام: signaturePadMarkup(...) تُلصق في HTML اللوحة، ثم بعد
 * إدراجها في DOM تُنادى initSignaturePad(root, id, accountName)، وعند
 * الإرسال readSignaturePad(root, id, accountName)، وعند إغلاق اللوحة
 * disposeSignaturePads(ids) حتى لا يبقى مرجع كانفس في الذاكرة.
 */

const PADS = new Map();
const SIGNATURE_DATE_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' });

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** نفس تطبيع الخادم: تقليم + دمج المسافات (warehouse-routes.js:7-9). */
export function normalizeSignerName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

/** اسم صاحب الحساب: name ثم username — نفس ترتيب الخادم (:11-13). */
export function accountSignatureName(user) {
    return normalizeSignerName(user && user.name) || normalizeSignerName(user && user.username) || '';
}

/** مطابقة غير حساسة لحالة الأحرف — مرآة signerMatchesAccount (:13-18). */
export function signerMatchesAccount(typed, accountName) {
    const t = normalizeSignerName(typed).toLowerCase();
    const a = normalizeSignerName(accountName).toLowerCase();
    return !!t && !!a && t === a;
}

/**
 * @param {string} id معرّف فريد للوحة داخل الصفحة (كانفس + حقل مقفل)
 * @param {string} title عنوان اللوحة كما يراه الموقّع
 * @param {string} accountName اسم صاحب الحساب (يُقفل عليه الحقل)
 */
export function signaturePadMarkup(id, title, accountName) {
    const locked = normalizeSignerName(accountName);
    return `<div class="erp-signature">
      <label class="erp-label" for="${esc(id)}-input">${esc(title)}</label>
      <input type="text" class="erp-input" id="${esc(id)}-input" autocomplete="off" spellcheck="false"
        maxlength="60" value="${esc(locked)}" readonly tabindex="-1" aria-readonly="true"
        aria-label="${esc(title)} — توقيع ${esc(locked)}">
      <canvas id="${esc(id)}" width="900" height="220" aria-label="${esc(title)}" role="img"></canvas>
      <small class="erp-text-sm erp-text-muted">التوقيع مقفل باسم حسابك (<strong>${esc(locked || '—')}</strong>)
        — لا يمكن توقيع أي اسم آخر. التوقيع موثّق بتاريخ اليوم.</small>
    </div>`;
}

function signatureFont(size) {return `700 ${size}px 'Aref Ruqaa','Cairo',cursive`;}

function paintTypedSignature(id) {
    const state = PADS.get(id);
    if (!state || !state.ctx) {return;}
    const { canvas, ctx, input } = state;
    const name = (input ? input.value : '').trim();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.hasInk = name.length >= 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    if (!state.hasInk) {
        ctx.fillStyle = '#9aa1ad';
        ctx.font = "26px 'Cairo',sans-serif";
        ctx.fillText('التوقيع يظهر هنا بعد كتابة الاسم', canvas.width / 2, canvas.height / 2 - 8);
        return;
    }
    let size = 68;
    ctx.font = signatureFont(size);
    while (ctx.measureText(name).width > canvas.width - 130 && size > 30) {size -= 4; ctx.font = signatureFont(size);}
    const nameW = Math.min(ctx.measureText(name).width, canvas.width - 110);
    ctx.fillStyle = '#1f2430';
    ctx.fillText(name, canvas.width / 2, 88);
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const uy = 148;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - nameW / 2, uy);
    ctx.bezierCurveTo(canvas.width / 2 - nameW / 6, uy - 12, canvas.width / 2 + nameW / 6, uy + 12, canvas.width / 2 + nameW / 2, uy - 6);
    ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.font = "20px 'Cairo',sans-serif";
    ctx.fillText(`توقيع إلكتروني • ${SIGNATURE_DATE_FMT.format(new Date())}`, canvas.width / 2, 188);
}

/**
 * @param {ParentNode} root نطاق اللوحة (نفس جذر الشاشة)
 * @param {string} id
 * @param {string} accountName اسم صاحب الحساب — يُعاد قفل الحقل عليه دائمًا
 */
export function initSignaturePad(root, id, accountName) {
    const scope = root || document;
    const canvas = scope.querySelector(`#${CSS.escape ? CSS.escape(id) : id}`);
    if (!canvas) {return null;}
    const input = scope.querySelector(`#${CSS.escape ? CSS.escape(id) : id}-input`);
    const locked = normalizeSignerName(accountName);
    PADS.set(id, { canvas, ctx: canvas.getContext('2d'), input, hasInk: false });
    // قفل الحقل على اسم الحساب — أي محاولة لتغييره تُعاد للاسم فورًا (kitchen.js:1027)
    if (input) {
        input.value = locked;
        input.setAttribute('readonly', '');
        input.addEventListener('input', () => {
            if (input.value !== locked) {input.value = locked;}
            paintTypedSignature(id);
        });
    }
    paintTypedSignature(id);
    if (document.fonts && document.fonts.load) {
        document.fonts.load("700 68px 'Aref Ruqaa'")
            .then(() => document.fonts.ready)
            .then(() => paintTypedSignature(id))
            .catch(() => {});
    }
    return id;
}

/**
 * @returns {{dataUrl:string}|{error:'SIGNER_MISMATCH'|'SIGNER_NAME_MISSING'|'NO_INK'|'NO_PAD', locked:string}}
 */
export function readSignaturePad(root, id, accountName) {
    const state = PADS.get(id);
    const locked = normalizeSignerName(accountName);
    const typed = normalizeSignerName(
        state && state.input ? state.input.value
            : (root && root.querySelector(`#${id}-input`) ? root.querySelector(`#${id}-input`).value : '')
    );
    if (!typed || !locked) {return { error: 'SIGNER_NAME_MISSING', locked };}
    if (!signerMatchesAccount(typed, locked)) {
        if (state && state.input) {state.input.value = locked;}
        paintTypedSignature(id);
        return { error: 'SIGNER_MISMATCH', locked };
    }
    if (state && state.input && state.input.value !== locked) {state.input.value = locked;}
    if (!state || !state.hasInk) {
        paintTypedSignature(id);
        if (!state || !state.hasInk) {return { error: 'NO_INK', locked };}
    }
    paintTypedSignature(id);
    return { dataUrl: state.canvas.toDataURL('image/png') };
}

/** يُنادى عند إغلاق اللوحة/الشاشة: يحرر مراجع الكانفس. */
export function disposeSignaturePads(ids) {
    for (const id of Array.isArray(ids) ? ids : [ids]) {PADS.delete(id);}
}
