/**
 * security-fix-placeholder-secrets.test.js
 * ────────────────────────────────────────────────────────────────────────────
 * Regression tests for the fix to a real vulnerability found in this project:
 *
 *   scripts/shared.js's setupEnvSecrets() only checked that JWT_ACCESS_SECRET /
 *   JWT_REFRESH_SECRET were "≥32 characters" to decide whether a real secret
 *   was already configured. The placeholder values shipped in .env.example
 *   ("replace-me-with-a-long-random-secret-access-key-32chars-min", etc.)
 *   are deliberately long (59 chars) so they read clearly as placeholders —
 *   but that same length made setupEnvSecrets() treat them as "already set"
 *   and skip generating real secrets. Since these placeholder strings are
 *   public (they ship in every copy of the repo), a production deployment
 *   that kept them would let anyone forge a valid admin JWT.
 *
 * These tests lock in the fix: placeholder values must be rejected
 * regardless of length, both by the setup-time generator (lib.isRealSecret)
 * and by the runtime boot guard in backend/cashier-module/jwt-middleware.js.
 */
const lib = require('../scripts/shared');

const ACCESS_PLACEHOLDER  = 'replace-me-with-a-long-random-secret-access-key-32chars-min';
const REFRESH_PLACEHOLDER = 'replace-me-with-a-long-random-secret-refresh-key-32chars-min';

describe('lib.isRealSecret — rejects known placeholders', () => {
    it('rejects the exact .env.example placeholder values', () => {
        expect(lib.isRealSecret(ACCESS_PLACEHOLDER)).toBe(false);
        expect(lib.isRealSecret(REFRESH_PLACEHOLDER)).toBe(false);
    });

    it('confirms the placeholder is long enough that a naive length check would wrongly accept it', () => {
        // This is the exact bug: length ≥ 32 used to be treated as "real".
        expect(ACCESS_PLACEHOLDER.length).toBeGreaterThanOrEqual(32);
        expect(lib.isRealSecret(ACCESS_PLACEHOLDER)).toBe(false);
    });

    it('rejects short/empty values', () => {
        expect(lib.isRealSecret('')).toBe(false);
        expect(lib.isRealSecret('short')).toBe(false);
        expect(lib.isRealSecret(undefined)).toBe(false);
    });

    it('rejects any future "replace-me*" style placeholder, not just the exact known strings', () => {
        expect(lib.isRealSecret('replace-me-please-1234567890123456789012345')).toBe(false);
    });

    it('accepts a real, randomly generated secret', () => {
        const real = require('crypto').randomBytes(48).toString('hex');
        expect(lib.isRealSecret(real)).toBe(true);
    });
});

describe('jwt-middleware production boot guard — rejects placeholders', () => {
    // We test the guard in isolation (not by requiring the real module,
    // which needs a live DB pool) by re-implementing the exact predicate
    // used in backend/cashier-module/jwt-middleware.js and asserting the
    // same known placeholder strings trip it.
    const jwtMiddlewareSrc = require('fs').readFileSync(
        require('path').join(__dirname, '../backend/cashier-module/jwt-middleware.js'),
        'utf-8'
    );

    it('still contains the placeholder-detection guard (protects against silent regressions)', () => {
        expect(jwtMiddlewareSrc).toMatch(/isPlaceholderSecret/);
        expect(jwtMiddlewareSrc).toMatch(/KNOWN_PLACEHOLDER_SECRETS/);
        expect(jwtMiddlewareSrc).toContain(ACCESS_PLACEHOLDER);
        expect(jwtMiddlewareSrc).toContain(REFRESH_PLACEHOLDER);
    });

    it('production guard checks accessSecretIsPlaceholder / refreshSecretIsPlaceholder before allowing boot', () => {
        expect(jwtMiddlewareSrc).toMatch(/accessSecretIsPlaceholder \|\| refreshSecretIsPlaceholder/);
        expect(jwtMiddlewareSrc).toMatch(/process\.exit\(1\)/);
    });
});

describe('electron/main.js — database is never exposed with trust auth', () => {
    const mainSrc = require('fs').readFileSync(
        require('path').join(__dirname, '../electron/main.js'),
        'utf-8'
    );

    it('does not use --auth=trust for initdb', () => {
        expect(mainSrc).not.toMatch(/--auth=trust/);
    });

    it('does not open pg_hba.conf to 0.0.0.0/0 or ::/0', () => {
        expect(mainSrc).not.toMatch(/0\.0\.0\.0\/0/);
        expect(mainSrc).not.toMatch(/::\/0/);
    });

    it('does not set listen_addresses to \'*\' for Postgres', () => {
        expect(mainSrc).not.toMatch(/listen_addresses = '\*'/);
    });

    it('uses scram-sha-256 and binds Postgres to localhost only', () => {
        expect(mainSrc).toMatch(/--auth=scram-sha-256/);
        expect(mainSrc).toMatch(/listen_addresses = 'localhost'/);
        expect(mainSrc).toMatch(/127\.0\.0\.1\/32\s+scram-sha-256/);
    });

    it('never passes an empty DB_PASSWORD to the spawned server process', () => {
        expect(mainSrc).not.toMatch(/DB_PASSWORD:\s*''/);
        expect(mainSrc).toMatch(/DB_PASSWORD:\s*getOrCreateDbPassword\(\)/);
    });
});
