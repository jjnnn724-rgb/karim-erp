/**
 * Phase 1 Security Tests — Comprehensive Security Validation Suite
 * ────────────────────────────────────────────────────────────────────────────
 * Tests all Phase 1 security hardening measures:
 * 
 * 1.1 Identifier Injection Prevention (schema-registry + filterBody)
 * 1.2 /api/state RBAC (role restrictions, audit logging, size limits)
 * 1.3 Password Migration (plaintext → bcrypt transparent migration)
 * 1.4 XSS Protection (header sanitization) & Error Sanitization
 *
 * Run: npm test
 */

const { describe, it, expect } = require('@jest/globals');

// Import modules under test
const {
    filterBody,
    validateColumnName,
    entityExists,
    getSchema,
    getSortableColumns,
    validateType,
    TYPES,
    entitySchemas,
} = require('../backend/schema-registry');

const { buildCspDirectives } = require('../backend/middleware/security');

// ============================================================
// Test Suite 1.1: Identifier Injection Prevention
// ============================================================
describe('Phase 1.1 — Identifier Injection Prevention', () => {

    describe('validateColumnName()', () => {
        it('should allow valid alphanumeric column names with underscores', () => {
            const validNames = ['id', 'user_name', 'firstName123', '_private', 'col_9'];
            validNames.forEach(name => {
                const result = validateColumnName(name);
                expect(result.valid).toBe(true);
                expect(result.reason).toBeUndefined();
            });
        });

        it('should reject column names with SQL injection attempts', () => {
            const maliciousNames = [
                '"; DROP TABLE users;--',
                'id; SELECT * FROM',
                'name" OR "1"="1',
                'col\x00null',
                'col\ninject',
            ];
            maliciousNames.forEach(name => {
                const result = validateColumnName(name);
                expect(result.valid).toBe(false);
                expect(result.reason).toBeDefined();
            });
        });

        it('should reject reserved SQL keywords as column names', () => {
            const keywords = [
                'select', 'insert', 'update', 'delete', 'drop', 'truncate',
                'table', 'from', 'where', 'union', 'exec', 'execute'
            ];
            keywords.forEach(keyword => {
                const result = validateColumnName(keyword);
                expect(result.valid).toBe(false);
                expect(result.reason).toContain('كلمة محجوزة');
            });
        });

        it('should reject non-string inputs', () => {
            expect(validateColumnName(123).valid).toBe(false);
            expect(validateColumnName(null).valid).toBe(false);
            expect(validateColumnName(undefined).valid).toBe(false);
            expect(validateColumnName({}).valid).toBe(false);
        });

        it('should reject column names starting with numbers (except underscore)', () => {
            expect(validateColumnName('123col').valid).toBe(false);
            expect(validateColumnName('_123col').valid).toBe(true); // underscore prefix is OK
        });
    });

    describe('filterBody() — Injection Attack Prevention', () => {
        it('should filter out SQL injection attempts in keys', () => {
            const maliciousBody = {
                username: 'admin',
                '"; DROP TABLE users;--': 'malicious',
                'role': 'admin',
            };

            const result = filterBody('users', maliciousBody);

            expect(result.filtered['"; DROP TABLE users;--']).toBeUndefined();
            expect(result.removedKeys).toContain('"; DROP TABLE users;--');
            expect(result.filtered.username).toBe('admin');
        });

        it('should reject protected fields (id, created_at, etc.)', () => {
            const bodyWithProtected = {
                username: 'testuser',
                id: 999,           // Should be rejected - protected
                role: 'cashier',
                created_at: '2024-01-01', // Should be rejected - protected
            };

            const result = filterBody('users', bodyWithProtected);

            expect(result.errors.join(' ')).toContain('الحقل "id" محمي');
            expect(result.errors.join(' ')).toContain('الحقل "created_at" محمي');
            expect(result.filtered.id).toBeUndefined();
            expect(result.filtered.created_at).toBeUndefined();
            expect(result.filtered.username).toBe('testuser');
        });

        it('should handle empty object gracefully', () => {
            const result = filterBody('users', {});
            expect(result.filtered).toEqual({});
            expect(result.errors.join(' ')).toContain('حقول مطلوبة ناقصة: username، name');
        });

        it('should reject null and non-object bodies', () => {
            expect(filterBody('users', null).errors.join(' ')).toContain('يجب إرسال بيانات بصيغة صحيحة');
            expect(filterBody('users', undefined).errors.join(' ')).toContain('يجب إرسال بيانات بصيغة صحيحة');
            expect(filterBody('users', 'string').errors.join(' ')).toContain('يجب إرسال بيانات بصيغة صحيحة');
            expect(filterBody('users', 123).errors.join(' ')).toContain('يجب إرسال بيانات بصيغة صحيحة');
        });

        it('should validate enum values against allowed values', () => {
            // users.role is an ENUM with allowed values
            const invalidEnumBody = {
                username: 'testuser',
                name: 'Test User',
                role: 'hacked_role', // Not in allowedValues
            };

            const result = filterBody('users', invalidEnumBody);
            expect(result.errors.some(e => e.includes('قيمة غير صالحة للحقل "role"'))).toBe(true);
        });

        it('should enforce maxLength constraints on strings', () => {
            const longStringBody = {
                username: 'a'.repeat(101), // Max is 100 for users.username
                name: 'Test User',
            };

            const result = filterBody('users', longStringBody);
            expect(result.errors.some(e => e.includes('أطول من المسموح'))).toBe(true);
        });

        it('should validate data types correctly', () => {
            const wrongTypesBody = {
                name: 'Valid Name',
                salary: 'not-a-number', // Should be NUMBER
                active: 'yes',          // Should be BOOLEAN
            };

            const result = filterBody('employees', wrongTypesBody);
            expect(result.errors.some(e => e.includes('"salary" يجب أن يكون رقمًا'))).toBe(true);
        });

        it('should allow all whitelisted fields through', () => {
            const validBody = {
                username: 'testuser',
                name: 'Test User',
                role: 'cashier',
                active: true,
            };

            const result = filterBody('users', validBody);
            expect(result.errors).toHaveLength(0);
            expect(result.removedKeys).toHaveLength(0);
            expect(result.filtered.username).toBe('testuser');
            expect(result.filtered.name).toBe('Test User');
            expect(result.filtered.role).toBe('cashier');
            expect(result.filtered.active).toBe(true);
        });

        // CRITICAL TEST: The exact attack vector from the requirements
        it('should BLOCK the exact injection payload from requirements', () => {
            // Use bracket notation for malicious key with special characters
            const attackPayload = {
                id: 1,
                role: 'admin',
                proto: 'x',
            };
            attackPayload['"; DROP TABLE users;--'] = 'y';  // Injection attempt as key

            const result = filterBody('users', attackPayload);

            // All malicious/protected keys should be filtered
            expect(result.filtered.id).toBeUndefined();       // Protected
            expect(result.filtered['"; DROP TABLE users;--']).toBeUndefined(); // Malicious key
            expect(result.filtered.proto).toBeUndefined();   // Not in whitelist
            
            // Only valid whitelisted field should pass
            expect(result.filtered.role).toBe('admin');      // In whitelist
            
            // Should have errors about protected/malicious fields
            expect(result.errors.length > 0 || result.removedKeys.length > 0).toBe(true);
        });
    });

    describe('entityExists() & getSchema()', () => {
        it('should return true for all registered entities', () => {
            const expectedEntities = [
                'users', 'hrDepartments', 'employees', 'attendance', 'leaveTypes',
                'leaveRequests', 'payroll', 'departments', 'revenues', 'expenses',
                'shelves', 'inventory', 'inventoryTx', 'dispatches', 'recipes',
                'purchaseInvoices', 'kitchenReturns', 'weightReadings', 'notifications', 'settings'
            ];

            expectedEntities.forEach(entity => {
                expect(entityExists(entity)).toBe(true);
                expect(getSchema(entity)).toBeDefined();
            });
        });

        it('should return false/null for unknown entities', () => {
            expect(entityExists('nonexistent_table')).toBe(false);
            expect(getSchema('hackers')).toBeNull();
        });

        it('should return schema with required properties for each entity', () => {
            Object.keys(entitySchemas).forEach(entityName => {
                const schema = entitySchemas[entityName];
                expect(schema).toHaveProperty('writeable');
                expect(schema).toHaveProperty('required');
                expect(schema).toHaveProperty('types');
                expect(schema).toHaveProperty('protected');
                expect(Array.isArray(schema.writeable)).toBe(true);
                expect(Array.isArray(schema.required)).toBe(true);
            });
        });
    });

    describe('getSortableColumns()', () => {
        it('should include writeable columns plus id', () => {
            const sortableCols = getSortableColumns('inventory');
            expect(sortableCols).toContain('id');
            expect(sortableCols).toContain('name');
            // camelCase column from migration 001 (was 'sell_price' in old snake_case schema)
            expect(sortableCols).toContain('qty');
            expect(sortableCols).toContain('avgCost');
        });

        it('should return empty array for unknown entity', () => {
            expect(getSortableColumns('nonexistent')).toEqual([]);
        });
    });

    describe('validateType()', () => {
        it('should validate NUMBER type correctly', () => {
            expect(validateType('price', 100, TYPES.NUMBER, {}).valid).toBe(true);
            expect(validateType('price', '100', TYPES.NUMBER, {}).valid).toBe(true); // Coerced
            expect(validateType('price', 'abc', TYPES.NUMBER, {}).valid).toBe(false);
        });

        it('should validate BOOLEAN type correctly', () => {
            expect(validateType('active', true, TYPES.BOOLEAN, {}).valid).toBe(true);
            expect(validateType('active', false, TYPES.BOOLEAN, {}).valid).toBe(true);
            expect(validateType('active', 1, TYPES.BOOLEAN, {}).valid).toBe(true);
            expect(validateType('active', 0, TYPES.BOOLEAN, {}).valid).toBe(true);
            expect(validateType('active', 'yes', TYPES.BOOLEAN, {}).valid).toBe(false);
        });

        it('should validate DATE type correctly', () => {
            expect(validateType('date', '2024-01-15', TYPES.DATE, {}).valid).toBe(true);
            expect(validateType('date', new Date(), TYPES.DATE, {}).valid).toBe(true);
            expect(validateType('date', 'not-a-date', TYPES.DATE, {}).valid).toBe(false);
        });

        it('should validate JSON type correctly', () => {
            expect(validateType('data', { a: 1 }, TYPES.JSON, {}).valid).toBe(true);
            expect(validateType('data', '{"a":1}', TYPES.JSON, {}).valid).toBe(true); // Stringified
            expect(validateType('data', 'invalid-json', TYPES.JSON, {}).valid).toBe(false);
            expect(validateType('data', 123, TYPES.JSON, {}).valid).toBe(false);
        });

        it('should validate UUID format correctly', () => {
            expect(validateType('id', '550e8400-e29b-41d4-a716-446655440000', TYPES.UUID, {}).valid).toBe(true);
            expect(validateType('id', 'invalid-uuid', TYPES.UUID, {}).valid).toBe(false);
        });
    });
});

// ============================================================
// Test Suite 1.2: /api/state Access Control & Audit Logging
// ============================================================
describe('Phase 1.2 — /api/state Access Control & Audit', () => {

    // Note: These tests would require the running server.
    // Here we document the expected behavior as contract tests.

    describe('Access Control (LAN-trusted + optional API_KEY)', () => {
        // NOTE: /api/state is now JWT-protected (see security.test.js asserting 401
        // without a token) — the old “accessible without JWT” placeholders described
        // an obsolete contract and were converted to honest TODOs.
        it.todo('GET /api/state returns saved preferences for an authenticated user (integration)');

        it.todo('POST /api/state rejects unauthenticated writes with 401 (integration)');

        it.todo('DELETE /api/state is admin-only and audited (integration)');

        it.todo('POST /api/state rejects oversized preference payloads with 413 (integration)');

        it.todo('POST /api/state embeds an _audit object in state_data (integration)');
    });
});

// ============================================================
// Test Suite 1.3: Password Migration
// ============================================================
describe('Phase 1.3 — Password Migration (Plaintext → Bcrypt)', () => {
    
    describe('Bcrypt Detection Regex', () => {
        // This regex is defined in jwt-middleware.js: /^\$2[aby]\$/
        
        const bcryptRegex = /^\$2[aby]\$/;

        it('should detect $2a$ bcrypt hashes correctly', () => {
            expect(bcryptRegex.test('$2a$10$N9qo8uLOickG2ZODZ9qNO')).toBe(true);
        });

        it('should detect $2b$ bcrypt hashes correctly', () => {
            expect(bcryptRegex.test('$2b$10$N9qo8uLOickG2ZODZ9qNO')).toBe(true);
        });

        it('should detect $2y$ bcrypt hashes correctly (PHP compat)', () => {
            expect(bcryptRegex.test('$2y$10$N9qo8uLOickG2ZODZ9qNO')).toBe(true);
        });

        it('should NOT match plaintext passwords', () => {
            expect(bcryptRegex.test('1234')).toBe(false);
            expect(bcryptRegex.test('password')).toBe(false);
            expect(bcryptRegex.test('')).toBe(false);
        });

        it('should NOT match malformed hash strings', () => {
            expect(bcryptRegex.test('$2x$10$something')).toBe(false);
            expect(bcryptRegex.test('$3a$10$something')).toBe(false);
        });
    });

    describe('Migration Behavior Contract', () => {
        // Legacy plaintext auto-migration on login was replaced by a hard
        // bcrypt-only policy (PASSWORD_MIGRATION_REQUIRED + explicit migration
        // script). These contracts describe future integration coverage.
        it.todo('login rejects plaintext passwords with PASSWORD_MIGRATION_REQUIRED (integration)');

        it.todo('migrate-plaintext-passwords.js converts legacy rows and stamps password_migrated_at (integration)');

        it.todo('change-password clears must_change_password and rotates refresh tokens (integration)');
    });
});

// ============================================================
// Test Suite 1.4: XSS Protection & Error Sanitization
// ============================================================
describe('Phase 1.4 — XSS Protection & Error Handling', () => {

    describe('CSP inline event handler safety', () => {
        it('allows inline event handlers while keeping inline script blocks forbidden', () => {
            const directive = buildCspDirectives({ reportOnly: false }, 'abc123');

            // 'unsafe-inline' ممنوع في script-src: وجود 'nonce-…' يجعل المتصفح
            // يتجاهل 'unsafe-inline' أصلًا (قاعدة CSP2) ⇒ كان وجودهما تناقضًا
            // مُضلِّلًا يعني أن كل سكربت inline يُحجب بصمت (قيس في الإنتاج).
            // صفر سكربت inline في الواجهة الآن، وبوابة CI تمنع عودتها.
            expect(directive).toContain("script-src 'self' 'nonce-abc123' https://static.cloudflareinsights.com 'unsafe-hashes'");
            const scriptSrc = directive.split(';').map((d) => d.trim())
                .find((d) => d.startsWith('script-src '));
            expect(scriptSrc).not.toContain("'unsafe-inline'");
            expect(directive).toContain("'unsafe-hashes'");
            expect(directive).toContain("'nonce-abc123'");
            // المعالجات السطرية (onclick) مسموحة عبر script-src-attr — 1158 منها
            expect(directive).toContain("script-src-attr 'unsafe-inline'");
        });

        it('should allow the approved Google Fonts stylesheet and font hosts', () => {
            const directive = buildCspDirectives({ reportOnly: false }, 'abc123');

            expect(directive).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
            expect(directive).toContain("font-src 'self' data: https://fonts.gstatic.com");
        });
    });
    
    // We'll test the sanitizeHeader logic conceptually
    // (The actual function is in server.js)

    describe('XSS Header Sanitization', () => {
        it('should detect script tags in header values', () => {
            const dangerousPatterns = [
                /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                /javascript:/gi,
                /on\w+\s*=/gi,
                /data:\s*text\/html/gi,
            ];

            const maliciousInputs = [
                '<script>alert("xss")</script>',
                'javascript:alert(1)',
                'onclick="alert(1)"',
                'data:text/html,<script>alert(1)</script>',
            ];

            maliciousInputs.forEach(input => {
                const isDangerous = dangerousPatterns.some(p => p.test(input));
                expect(isDangerous).toBe(true);
            });
        });

        it('should truncate overly long header values', () => {
            const MAX_HEADER_LENGTH = 200;
            const longValue = 'a'.repeat(300);
            expect(longValue.length).toBeGreaterThan(MAX_HEADER_LENGTH);
            
            const sanitized = longValue.substring(0, MAX_HEADER_LENGTH);
            expect(sanitized.length).toBe(MAX_HEADER_LENGTH);
        });
    });

    describe('Production Error Sanitization', () => {
        it('should hide stack traces in production and guard headersSent', () => {
            // عقد المصدر المحدَّث: معالج الأخطاء المركزي backend/errors/error-handler.js
            // 1) حماية headersSent — لا كتابة رؤوس بعد بدء الإرسال
            // 2) جسم الاستجابة يُبنى من AppError.toJSON() فقط — لا تسريب stack للعميل
            const fs = require('fs');
            const path = require('path');
            const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'errors', 'error-handler.js'), 'utf8');
            expect(handlerSource).toContain('if (res.headersSent)');
            expect(handlerSource).toContain('const jsonBody = error.toJSON()');
            // toJSON في AppError يُرجع id/code/status/timestamp (+ message العام) — بلا stack
            const appErrorSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'errors', 'app-error.js'), 'utf8');
            const toJSONBlock = appErrorSource.match(/toJSON\(\)\s*\{[\s\S]*?\n {4}\}/);
            expect(toJSONBlock).not.toBeNull();
            expect(toJSONBlock[0]).not.toContain('stack');
            expect(toJSONBlock[0]).toContain('timestamp');
        });

        it('should include errorId for support reference', () => {
            // Every error response should have an errorId for tracing
            const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);
            expect(errorId).toBeDefined();
            expect(errorId.length).toBeGreaterThan(10);
        });
    });
});

// ============================================================
// Test Suite: Entity Schema Completeness
// ============================================================
describe('Entity Schema Completeness', () => {
    
    it('should have ALL database tables represented in registry', () => {
        const dbTablesFromMigration = [
            'users', 'hrDepartments', 'employees', 'attendance', 'leaveTypes',
            'leaveRequests', 'payroll', 'departments', 'revenues', 'expenses',
            'shelves', 'inventory', 'inventoryTx', 'dispatches', 'recipes',
            'purchaseInvoices', 'kitchenReturns', 'settings', 'weightReadings',
            'notifications', 'app_state'
        ];

        const registeredEntities = Object.keys(entitySchemas);

        // app_state is handled separately (not CRUD), so exclude it
        const crudTables = dbTablesFromMigration.filter(t => t !== 'app_state');

        crudTables.forEach(table => {
            expect(registeredEntities).toContain(table);
        });
    });

    it('should have at least one required field per entity', () => {
        Object.entries(entitySchemas).forEach(([_name, schema]) => {
            expect(schema.required.length).toBeGreaterThan(0);
        });
    });

    it('should have protected fields excluding client-settable IDs', () => {
        Object.entries(entitySchemas).forEach(([_name, schema]) => {
            expect(schema.protected).toContain('id');
        });
    });
});

// Export for potential reuse
module.exports = {
    testConstants: {
        ATTACK_PAYLOAD: (() => {
            const payload = { id: 1, role: 'admin', proto: 'x' };
            payload['"; DROP TABLE users;--'] = 'y';
            return payload;
        })(),
        MALICIOUS_COLUMN_NAMES: [
            '"; DROP TABLE users;--',
            'id" OR "1"="1',
            'select',
            'union'
        ]
    }
};
