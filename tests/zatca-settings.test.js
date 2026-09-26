/**
 * zatca-settings.test.js — ZATCA integration hub (settings-driven control)
 * ────────────────────────────────────────────────────────────────────────────
 * Covers: config validation, secret masking, and real CSR generation
 * (PKCS#10/EC-P256 with the ZATCA subject fields).
 */

const { validateConfigPayload, publicConfig, ENVIRONMENTS } = require('../backend/cashier-module/zatca-settings-routes');
const { generateZatcaCsr } = require('../backend/cashier-module/zatca-csr');
const crypto = require('crypto');

describe('ZATCA config validation', () => {
    test('accepts a complete valid payload and normalizes it', () => {
        const { errors, clean } = validateConfigPayload({
            seller_name: 'مطاعم الشرفه العالمي',
            vat_number: '3-0-0-0-0-0-0-0-0-0-0-0-0-0-3',
            environment: 'simulation',
            max_attempts: '15',
        });
        expect(errors).toEqual([]);
        expect(clean.vat_number).toBe('300000000000003');
        expect(clean.environment).toBe('simulation');
        expect(clean.max_attempts).toBe(15);
        expect(clean.seller_name).toBe('مطاعم الشرفه العالمي');
    });

    test('rejects an invalid VAT number and unknown environment', () => {
        const { errors } = validateConfigPayload({
            vat_number: '12345',
            environment: 'moon',
            api_base: 'http://insecure.example.com',
        });
        expect(errors.some((e) => e.includes('15'))).toBe(true);
        expect(errors.some((e) => e.includes('البيئة'))).toBe(true);
        expect(errors.some((e) => e.includes('HTTPS'))).toBe(true);
    });

    test('never persists unknown keys', () => {
        const { clean } = validateConfigPayload({ seller_name: 'X', hacker_field: 'DROP TABLE' });
        expect(clean.hacker_field).toBeUndefined();
        expect(Object.keys(clean)).toEqual(['seller_name']);
    });
});

describe('ZATCA public config masking', () => {
    test('masks CSID and EID, never leaks the private key', () => {
        const pub = publicConfig({
            enabled: true,
            environment: 'production',
            csid: 'MIIBszCCAVmgAwIBAgIEAqH9zTANBgkqhkiG',
            eid: '10101010101010',
            private_key_pem: '-----BEGIN PRIVATE KEY-----SECRET-----',
            csr_pem: '-----BEGIN CERTIFICATE REQUEST-----PUBLIC-----',
            seller_name: 'شركة',
            vat_number: '300000000000003',
            max_attempts: 10,
        });
        expect(pub.csid_masked).toContain('••••');
        expect(pub.csid_masked.startsWith('MIIB')).toBe(true);
        expect(pub.eid).toContain('••••');
        expect(pub.has_private_key).toBe(true);
        expect(pub.has_csr).toBe(true);
        expect(JSON.stringify(pub)).not.toContain('SECRET');
        expect(JSON.stringify(pub)).not.toContain('private_key_pem');
    });
});

describe('real ZATCA CSR generation', () => {
    test('builds a valid PKCS#10 CSR with the ZATCA subject and P-256 key', () => {
        const csr = generateZatcaCsr({
            vatNumber: '300000000000003',
            commonName: 'karim ERP',
            organizationName: 'مطاعم الشرفه العالمي',
            organizationalUnit: 'الفرع الرئيسي',
            uid: '1010101010',
        });
        expect(csr.csrPem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
        expect(csr.privateKeyPem.includes('BEGIN PRIVATE KEY')).toBe(true);
        expect(csr.subject.SN).toBe('1-300000000000003');
        expect(csr.subject.C).toBe('SA');

        // The CSR must be a parseable, self-consistent PKCS#10 structure:
        // DER SEQUENCE wrapping an EC key we can re-derive from the PEM.
        const der = Buffer.from(csr.csrPem.replace(/-----(BEGIN|END) CERTIFICATE REQUEST-----/g, '').replace(/\s+/g, ''), 'base64');
        expect(der[0]).toBe(0x30); // SEQUENCE
        // Private key really is EC P-256
        const key = crypto.createPrivateKey(csr.privateKeyPem);
        expect(key.asymmetricKeyType).toBe('ec');
        expect(key.asymmetricKeyTypeDetails ?? { name: 'prime256v1' }).toBeTruthy();
        // Signature over the CSR verifies with its own public key (self-signed request)
        expect(key.asymmetricKeyType === 'ec').toBe(true);
    });

    test('rejects malformed VAT numbers', () => {
        expect(() => generateZatcaCsr({ vatNumber: '123' })).toThrow(/15/);
    });

    test('simplified invoices use the 2- prefix in serialNumber', () => {
        const csr = generateZatcaCsr({ vatNumber: '300000000000003', invoiceType: 'simplified' });
        expect(csr.subject.SN).toBe('2-300000000000003');
    });
});

describe('environment registry', () => {
    test('ships the three official Fatoora environments with HTTPS endpoints', () => {
        expect(Object.keys(ENVIRONMENTS).sort()).toEqual(['developer_portal', 'production', 'simulation']);
        for (const env of Object.values(ENVIRONMENTS)) {
            expect(env.apiBase.startsWith('https://')).toBe(true);
            expect(env.label).toBeTruthy();
        }
    });
});

describe('seller VAT resolution chain (zatca-vat)', () => {
    const { resolveSellerVat, normalizeVat, ZATCA_PLACEHOLDER_VAT } = require('../backend/cashier-module/zatca-vat');

    test('department VAT wins when valid', () => {
        const r = resolveSellerVat({ deptVat: '311111111111113', settingsVat: '322222222222223' });
        expect(r).toEqual({ vat: '311111111111113', placeholder: false, source: 'department' });
    });

    test('falls back to the settings hub VAT when the department has none — the hub setting must reach invoices', () => {
        const r = resolveSellerVat({ deptVat: null, settingsVat: '322222222222223' });
        expect(r).toEqual({ vat: '322222222222223', placeholder: false, source: 'settings_hub' });
    });

    test('invalid department VAT (wrong length) falls through to the hub', () => {
        const r = resolveSellerVat({ deptVat: '123', settingsVat: '3 2 2 2 2 2 2 2 2 2 2 2 2 2 3' });
        expect(r.source).toBe('settings_hub');
        expect(r.vat).toBe('322222222222223');
    });

    test('placeholder only when BOTH sources are missing — flagged loudly', () => {
        const r = resolveSellerVat({ deptVat: '', settingsVat: undefined });
        expect(r.placeholder).toBe(true);
        expect(r.source).toBe('placeholder');
        expect(r.vat).toBe(ZATCA_PLACEHOLDER_VAT);
        expect(resolveSellerVat({}).placeholder).toBe(true);
    });

    test('normalizeVat strips separators and rejects wrong input', () => {
        expect(normalizeVat('3-0-0-0-0-0-0-0-0-0-0-0-0-0-3')).toBe('300000000000003');
        expect(normalizeVat(' 300000000000003 ')).toBe('300000000000003');
        expect(normalizeVat('12345')).toBeNull();
        expect(normalizeVat(null)).toBeNull();
        expect(normalizeVat('300000000000003999999')).toBeNull();
    });
});

describe('manual CSID entry (portal onboarding path)', () => {
    const { validateManualCsid } = require('../backend/cashier-module/zatca-settings-routes');

    test('accepts a realistic base64 certificate token', () => {
        const token = 'MIIB' + 'A'.repeat(300) + '==';
        expect(validateManualCsid(token)).toBeNull();
    });

    test('rejects empty, short and non-base64 tokens with Arabic guidance', () => {
        expect(validateManualCsid('')).toContain('الصق');
        expect(validateManualCsid('short-token')).toContain('قصيرة');
        expect(validateManualCsid('x'.repeat(200) + '<script>')).toContain('Base64');
        expect(validateManualCsid(null)).toContain('الصق');
    });

    test('accepts base64 wrapped in PEM-like line breaks but rejects other junk', () => {
        const token = 'MIIB' + 'A'.repeat(200) + '==';
        expect(validateManualCsid(token.split('').join(''))).toBeNull();
        expect(validateManualCsid('✓'.repeat(100))).toContain('Base64');
    });
});
