'use strict';

/**
 * webauthn-soft-authenticator.js — مصادق برمجي للاختبارات فقط.
 * ────────────────────────────────────────────────────────────────────────────
 * يوقّع بنفس الصيغة التي يرسلها المتصفح (clientDataJSON + authData + توقيع
 * ECDSA P-256)، فيمرّ التدفق عبر verifyRegistrationResponse /
 * verifyAuthenticationResponse الحقيقية — لا محاكاة لقرار الخادم.
 *
 * ليس بديلًا عن اختبار متصفح حقيقي: هو يثبت التوقيع والخادم، لا واجهة
 * الجهاز. اختبار المتصفح يبقى الحدّ الأخير قبل الشحن.
 */

const { generateKeyPairSync, createSign, createHash, randomBytes } = require('node:crypto');

function head(major, n) {
    if (n < 24) {return Buffer.from([(major << 5) | n]);}
    if (n < 0x100) {return Buffer.from([(major << 5) | 24, n]);}
    if (n < 0x10000) {
        const b = Buffer.alloc(3);
        b[0] = (major << 5) | 25;
        b.writeUInt16BE(n, 1);
        return b;
    }
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
}

/** CBOR مبدئي يدعم ما يحتاجه WebAuthn فقط: ints, text, bytes, arrays, maps. */
function cbor(value) {
    if (typeof value === 'number') {
        return value >= 0 ? head(0, value) : head(1, -1 - value);
    }
    if (typeof value === 'string') {
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([head(3, bytes.length), bytes]);
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const bytes = Buffer.from(value);
        return Buffer.concat([head(2, bytes.length), bytes]);
    }
    if (Array.isArray(value)) {
        return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
    }
    if (value instanceof Map) {
        const parts = [head(5, value.size)];
        for (const [k, v] of value) {parts.push(cbor(k), cbor(v));}
        return Buffer.concat(parts);
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        const parts = [head(5, entries.length)];
        for (const [k, v] of entries) {parts.push(cbor(k), cbor(v));}
        return Buffer.concat(parts);
    }
    throw new Error(`CBOR: unsupported value (${typeof value})`);
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

/**
 * @param {{rpId: string}} opts
 */
function createSoftAuthenticator({ rpId }) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credentialId = randomBytes(16);
    let counter = 0;

    function clientData(type, challenge, origin) {
        return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
    }

    function authDataFor(flags, signCount, extra = Buffer.alloc(0)) {
        const rpIdHash = createHash('sha256').update(rpId).digest();
        const counterBuf = Buffer.alloc(4);
        counterBuf.writeUInt32BE(signCount, 0);
        return Buffer.concat([rpIdHash, Buffer.from([flags]), counterBuf, extra]);
    }

    return {
        credentialIdB64: b64url(credentialId),

        registration({ challenge, origin }) {
            const cdj = clientData('webauthn.create', challenge, origin);
            const cose = new Map([
                [1, 2],                                  // kty: EC2
                [3, -7],                                 // alg: ES256
                [-1, 1],                                 // crv: P-256
                [-2, Buffer.from(jwk.x, 'base64url')],
                [-3, Buffer.from(jwk.y, 'base64url')],
            ]);
            const length = Buffer.alloc(2);
            length.writeUInt16BE(credentialId.length, 0);
            const attested = Buffer.concat([
                Buffer.alloc(16),                        // aaguid
                length,
                credentialId,
                cbor(cose),
            ]);
            const authData = authDataFor(0x45, 0, attested); // UP + UV + AT
            const attestationObject = cbor({ fmt: 'none', attStmt: new Map(), authData });
            return {
                id: b64url(credentialId),
                rawId: b64url(credentialId),
                type: 'public-key',
                response: {
                    clientDataJSON: b64url(cdj),
                    attestationObject: b64url(attestationObject),
                    transports: ['internal'],
                },
                clientExtensionResults: {},
                authenticatorAttachment: 'platform',
            };
        },

        assertion({ challenge, origin }) {
            counter += 1;
            const cdj = clientData('webauthn.get', challenge, origin);
            const authData = authDataFor(0x05, counter); // UP + UV
            const signature = createSign('SHA256')
                .update(authData)
                .update(createHash('sha256').update(cdj).digest())
                .sign(privateKey);
            return {
                id: b64url(credentialId),
                rawId: b64url(credentialId),
                type: 'public-key',
                response: {
                    clientDataJSON: b64url(cdj),
                    authenticatorData: b64url(authData),
                    signature: b64url(signature),
                },
                clientExtensionResults: {},
                authenticatorAttachment: 'platform',
            };
        },

        get counter() {return counter;},
    };
}

module.exports = { createSoftAuthenticator, cbor };
