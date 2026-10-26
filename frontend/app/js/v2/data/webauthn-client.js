/**
 * V2 — WebAuthn browser client (مفاتيح المرور)
 * ═══════════════════════════════════════════════════════════════════════
 * The server speaks base64url JSON (@simplewebauthn/server), the browser
 * speaks ArrayBuffer. This module is the only translation layer between the
 * two — no network calls, no DOM, no storage.
 *
 * CONTRACT (copied from webauthn-routes.js):
 *   options.challenge / options.user.id / *.credential ids arrive as
 *   base64url strings and must become ArrayBuffer before
 *   navigator.credentials.create()/get().
 *   Registration/assertion responses go back as base64url JSON — the exact
 *   shapes RegistrationResponseJSON / AuthenticationResponseJSON expect.
 *
 * USER-VERIFICATION IS REQUIRED BY THE SERVER (`userVerification:
 * 'required'`). The browser UI for that is biometric/PIN — never invented
 * here: if the device has no platform authenticator the call fails and the
 * caller must offer the TOTP route instead of guessing.
 */

function b64urlToBytes(value) {
    const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const binary = atob(s + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {bytes[i] = binary.charCodeAt(i);}
    return bytes;
}

function bytesToB64url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {binary += String.fromCharCode(bytes[i]);}
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** البصمة تتطلب HTTPS (أو localhost) — وليس مجرد متصفح حديث. */
function secureContextOk(win) {
    return !win || win.isSecureContext !== false;
}

export function isWebAuthnSupported(win = globalThis) {
    const nav = win && win.navigator;
    return Boolean(
        win && win.PublicKeyCredential && nav && nav.credentials
        && typeof nav.credentials.create === 'function'
        && typeof nav.credentials.get === 'function'
        && secureContextOk(win)
    );
}

/** لماذا لا يمكن استخدام مفتاح المرور هنا؟ null = متاح. */
export function passkeyUnavailableReason(win = globalThis) {
    if (!secureContextOk(win)) {
        return 'الدخول بالبصمة يتطلب فتح النظام عبر HTTPS من عنوانه الرسمي.';
    }
    if (!isWebAuthnSupported(win)) {
        return 'هذا المتصفح لا يدعم مفاتيح المرور — استخدم Chrome أو Edge أو Safari حديثًا.';
    }
    return null;
}

export async function platformAuthenticatorAvailable(win = globalThis) {
    try {
        const P = win && win.PublicKeyCredential;
        if (!P || typeof P.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {return false;}
        return (await P.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
    } catch {return false;}
}

export function toCreationOptions(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const user = source.user && typeof source.user === 'object' ? source.user : {};
    const publicKey = {
        rp: source.rp,
        user: {
            id: b64urlToBytes(user.id),
            name: String(user.name || ''),
            displayName: String(user.displayName || user.name || ''),
        },
        challenge: b64urlToBytes(source.challenge),
        pubKeyCredParams: Array.isArray(source.pubKeyCredParams) ? source.pubKeyCredParams : [],
        timeout: Number(source.timeout) || 60000,
        attestation: source.attestation || 'none',
    };
    if (source.authenticatorSelection && typeof source.authenticatorSelection === 'object') {
        publicKey.authenticatorSelection = source.authenticatorSelection;
    }
    if (Array.isArray(source.hints) && source.hints.length) {publicKey.hints = source.hints;}
    if (source.extensions && typeof source.extensions === 'object') {publicKey.extensions = source.extensions;}
    const exclude = Array.isArray(source.excludeCredentials) ? source.excludeCredentials : [];
    if (exclude.length) {
        publicKey.excludeCredentials = exclude.map((entry) => ({
            type: entry.type || 'public-key',
            id: b64urlToBytes(entry.id),
            transports: Array.isArray(entry.transports) ? entry.transports : undefined,
        }));
    }
    return publicKey;
}

export function toRequestOptions(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const publicKey = {
        challenge: b64urlToBytes(source.challenge),
        timeout: Number(source.timeout) || 60000,
        userVerification: source.userVerification || 'required',
    };
    if (source.rpId) {publicKey.rpId = String(source.rpId);}
    if (source.extensions && typeof source.extensions === 'object') {publicKey.extensions = source.extensions;}
    const allow = Array.isArray(source.allowCredentials) ? source.allowCredentials : [];
    if (allow.length) {
        publicKey.allowCredentials = allow.map((entry) => ({
            type: entry.type || 'public-key',
            id: b64urlToBytes(entry.id),
            transports: Array.isArray(entry.transports) ? entry.transports : undefined,
        }));
    }
    return publicKey;
}

export function serializeRegistration(credential) {
    const response = credential.response;
    const out = {
        id: credential.id,
        rawId: bytesToB64url(credential.rawId),
        type: credential.type || 'public-key',
        response: {
            clientDataJSON: bytesToB64url(response.clientDataJSON),
            attestationObject: bytesToB64url(response.attestationObject),
        },
        clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
            ? credential.getClientExtensionResults() : {},
    };
    if (typeof response.getTransports === 'function') {
        const transports = response.getTransports();
        if (Array.isArray(transports) && transports.length) {out.response.transports = transports;}
    }
    if (credential.authenticatorAttachment) {out.authenticatorAttachment = credential.authenticatorAttachment;}
    return out;
}

export function serializeAssertion(credential) {
    const response = credential.response;
    return {
        id: credential.id,
        rawId: bytesToB64url(credential.rawId),
        type: credential.type || 'public-key',
        response: {
            clientDataJSON: bytesToB64url(response.clientDataJSON),
            authenticatorData: bytesToB64url(response.authenticatorData),
            signature: bytesToB64url(response.signature),
            userHandle: response.userHandle ? bytesToB64url(response.userHandle) : null,
        },
        clientExtensionResults: typeof credential.getClientExtensionResults === 'function'
            ? credential.getClientExtensionResults() : {},
        authenticatorAttachment: credential.authenticatorAttachment || undefined,
    };
}

/** DOMException → sentence the user can act on. Pure and exported for tests. */
export function describeWebAuthnError(err) {
    const name = err && err.name ? String(err.name) : '';
    if (name === 'InvalidStateError') {return 'هذا الجهاز مسجّل بالفعل لهذا الحساب — سجّل جهازًا آخر.';}
    if (name === 'NotAllowedError') {return 'أُلغي التحقق أو انتهت مهلته — أعد المحاولة وامنح الإذن عند طلب المتصفح.';}
    if (name === 'SecurityError') {return 'فتح النظام عبر HTTPS من عنوانه الرسمي مطلوب لاستخدام البصمة.';}
    if (name === 'NotSupportedError') {return 'هذا المتصفح أو الجهاز لا يدعم الدخول بالبصمة / Face ID.';}
    if (name === 'AbortError') {return 'أُلغيت العملية — أعد المحاولة.';}
    if (name === 'ConstraintError') {return 'الجهاز لا يستوفي شرط التحقق — استخدم قارئ البصمة أو رمز الجهاز.';}
    return (err && err.message) || 'تعذّر إكمال التحقق بالجهاز — حاول مجددًا.';
}

export { b64urlToBytes, bytesToB64url };
