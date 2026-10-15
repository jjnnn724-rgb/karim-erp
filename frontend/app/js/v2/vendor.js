/**
 * V2 — Vendor loader (تحميل عند الطلب، لا تكلفة على من لا يستخدمها)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 *   Two V2 features need browser libraries the legacy page loads for the
 *   whole app: Excel import/export (global XLSX, 892 KB) and QR rendering
 *   (global QRCode, 82 KB). v2.html ships neither — and must not: one of
 *   the owner's goals is speed, and a page that weighs ~1 MB before the
 *   roster paints for users who never touch Excel is exactly the kind of
 *   cost this migration exists to remove.
 *
 * SAME FILES, SAME URLS AS THE LEGACY PAGE — ON PURPOSE
 *   index.html loads them as:
 *     /app/vendor/xlsx.full.min.js?v=4.9.77      (index.html:46)
 *     js/vendor/qrcode.min.js?v=4.9.77           (index.html:257)
 *   These specifiers point at the same physical files with the SAME ?v the
 *   legacy page already uses, so the browser and the Cloudflare tunnel's
 *   four-hour cache serve them as hits — no new cache URL is minted. The
 *   files themselves never change (vendored builds), which is why they keep
 *   the legacy 4.9.77 revision instead of the moving V2 one. This is the
 *   one place in js/v2 where 4.9.77 is correct; the module graph rule
 *   (tests/v2-branches.test.js — every `import` specifier carries the page
 *   revision) still holds, because these are script src tags, not imports.
 *
 * CSP
 *   The origin sends script-src 'self' 'nonce-…'. A tag with a same-origin
 *   src is allowed by 'self' regardless of nonce, which is why dynamic
 *   injection works here. An onerror is always wired: a vendor that fails
 *   to load resolves false ONCE and the calling feature states its failure
 *   in Arabic instead of throwing.
 */

const VENDOR_ASSETS = {
    XLSX: { global: 'XLSX', src: 'vendor/xlsx.full.min.js?v=4.9.77' },
    QRCode: { global: 'QRCode', src: 'js/vendor/qrcode.min.js?v=4.9.77' },
    // قارئ الكاميرا (371 KB) — index.html:47 يحمّله لكل الجلسة؛ هنا يُحمَّل
    // عند أول مسح بطاقة فقط، بنفس الملف ونفس ?v فلا عنوان كاش جديد.
    Html5Qrcode: { global: 'Html5Qrcode', src: 'vendor/html5-qrcode.min.js?v=4.9.77' },
};

/** @type {Map<string, Promise<boolean>>} one in-flight promise per asset */
const pending = new Map();

/**
 * Load a vendor global on first use. Never rejects: a dead asset resolves
 * false, and callers decide how to say so.
 * @param {'XLSX'|'QRCode'|'Html5Qrcode'} name
 * @returns {Promise<boolean>} whether the global is available afterwards
 */
export function ensureVendor(name) {
    const spec = VENDOR_ASSETS[name];
    if (!spec) {return Promise.resolve(false);}
    if (typeof window[spec.global] !== 'undefined') {return Promise.resolve(true);}
    const inflight = pending.get(name);
    if (inflight) {return inflight;}
    const promise = new Promise((resolve) => {
        const tag = document.createElement('script');
        tag.src = spec.src;
        tag.async = true;
        tag.onload = () => {resolve(typeof window[spec.global] !== 'undefined');};
        tag.onerror = () => {pending.delete(name); resolve(false);};
        document.head.appendChild(tag);
    });
    pending.set(name, promise);
    return promise;
}

/** @returns {Promise<boolean>} */
export const ensureXlsx = () => ensureVendor('XLSX');

/** @returns {Promise<boolean>} */
export const ensureQrCode = () => ensureVendor('QRCode');

/** @returns {Promise<boolean>} */
export const ensureHtml5Qrcode = () => ensureVendor('Html5Qrcode');
