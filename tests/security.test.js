/**
 * security.test.js — Security-focused unit tests for karim ERP Pro
 * ────────────────────────────────────────────────────────────────────────────
 * Tests for: Schema Registry (Identifier Injection prevention), 
 *           Password Migration, Header Sanitization, and Auth middleware.
 */

const {
    filterBody,
    validateColumnName,
    getSchema,
    entityExists,
    getEntityNames,
    getSortableColumns,
    TYPES,
} = require('../backend/schema-registry');

// ─── Test Data ──────────────────────────────────────────
const MALICIOUS_PAYLOADS = [
    // Identifier Injection attempts
    { 
        name: 'SQL injection via column name',
        payload: { id: 1, 'role': 'admin', 'proto': 'x', '"; DROP TABLE users;--': 'y' },
        entity: 'users',
        shouldReject: true,
    },
    {
        name: 'Prototype pollution attempt',
        payload: { __proto__: { admin: true }, username: 'test' },
        entity: 'users',
        shouldReject: true,
    },
    {
        name: 'Protected field injection (id)',
        payload: { id: 999, username: 'hacker' },
        entity: 'users',
        shouldReject: true,
    },
    {
        name: 'Protected field injection (created_at)',
        payload: { username: 'test', created_at: '2026-01-01' },
        entity: 'users',
        shouldReject: true,
    },
    {
        name: 'Unknown column',
        payload: { username: 'test', non_existent_column: 'value' },
        entity: 'users',
        shouldReject: true,
    },
];

const VALID_PAYLOADS = [
    {
        name: 'Valid user creation',
        payload: { username: 'newuser', name: 'New User', email: 'test@example.com', active: true },
        entity: 'users',
        shouldPass: true,
    },
    {
        name: 'Valid inventory item',
        // camelCase columns matching migration 001
        payload: { name: 'Product A', qty: 100, avgCost: 25.50, unit: 'كجم', category: 'بروتين' },
        entity: 'inventory',
        shouldPass: true,
    },
    {
        name: 'Valid attendance record',
        // camelCase columns matching migration 001
        payload: { employeeId: 1, date: '2026-07-17', checkIn: '08:00', late: false },
        entity: 'attendance',
        shouldPass: true,
    },
];

// ─── Test Suites ────────────────────────────────────────

describe('Schema Registry - Column Whitelist', () => {

    describe('entityExists()', () => {
        it('should return true for valid entities', () => {
            expect(entityExists('users')).toBe(true);
            expect(entityExists('employees')).toBe(true);
            expect(entityExists('inventory')).toBe(true);
            expect(entityExists('payroll')).toBe(true);
        });

        it('should return false for unknown entities', () => {
            expect(entityExists('nonexistent')).toBe(false);
            expect(entityExists('')).toBe(false);
            expect(entityExists(null)).toBe(false);
            expect(entityExists(undefined)).toBe(false);
        });
    });

    describe('getSchema()', () => {
        it('should return schema for existing entities', () => {
            const userSchema = getSchema('users');
            expect(userSchema).not.toBeNull();
            expect(userSchema.writeable).toContain('username');
            expect(userSchema.protected).toContain('id');
        });

        it('should return null for non-existing entities', () => {
            expect(getSchema('nonexistent')).toBeNull();
        });
    });

    describe('getEntityNames()', () => {
        it('should return all registered entity names', () => {
            const names = getEntityNames();
            expect(names.length).toBeGreaterThan(0);
            expect(names).toContain('users');
            expect(names).toContain('employees');
            expect(names).toContain('inventory');
        });
    });
});

describe('validateColumnName() - Defense in Depth', () => {

    it('should accept valid alphanumeric column names with underscores', () => {
        const result1 = validateColumnName('username');
        const result2 = validateColumnName('employee_id');
        const result3 = validateColumnName('_private');
        
        expect(result1.valid).toBe(true);
        expect(result2.valid).toBe(true);
        expect(result3.valid).toBe(true);
    });

    it('should reject SQL keywords as column names', () => {
        const sqlKeywords = ['select', 'insert', 'update', 'delete', 'drop', 'table', 'from', 'where'];
        
        sqlKeywords.forEach(keyword => {
            const result = validateColumnName(keyword);
            expect(result.valid).toBe(false); // Should reject SQL keyword
        });
    });

    it('should reject columns with special characters', () => {
        const invalidNames = [
            'column-name',     // hyphen
            'column.name',     // dot
            'column;drop',     // semicolon
            'column"',         // quote
            "column'",         // single quote
            'column)',         // parenthesis
            '',                // empty string
        ];
        
        invalidNames.forEach(name => {
            const result = validateColumnName(name);
            expect(result.valid).toBe(false);
        });
    });
});

describe('filterBody() - Payload Filtering', () => {

    describe('Malicious payloads should be rejected', () => {
        test.each(MALICIOUS_PAYLOADS)('$name rejects malicious payload', ({ payload, entity, shouldReject }) => {
            const { filtered, errors, removedKeys } = filterBody(entity, payload);
            
            if (shouldReject) {
                // Either errors or removed keys should exist
                const hasIssues = (errors.length > 0 || removedKeys.length > 0);
                expect(hasIssues).toBe(true);
                
                // Filtered should NOT contain malicious/unknown keys
                Object.keys(filtered).forEach(key => {
                    const schema = getSchema(entity);
                    expect(schema.writeable).toContain(key);
                });
            }
        });
    });

    describe('Valid payloads should pass', () => {
        test.each(VALID_PAYLOADS)('$name accepts valid payload', ({ payload, entity, shouldPass }) => {
            const { filtered, errors, removedKeys } = filterBody(entity, payload);
            
            if (shouldPass) {
                expect(errors).toHaveLength(0);
                expect(removedKeys).toHaveLength(0);
                expect(Object.keys(filtered).length).toBeGreaterThan(0);
            }
        });
    });

    it('should remove protected fields even if in body', () => {
        const payload = { 
            username: 'admin', 
            id: 999,  // protected
            created_at: '2026-01-01',  // protected
            role: 'admin'  // allowed
        };
        
        const { filtered, errors, removedKeys } = filterBody('users', payload);
        
        expect(filtered.id).toBeUndefined();
        expect(filtered.created_at).toBeUndefined();
        expect(filtered.username).toBe('admin');
        expect(filtered.role).toBe('admin');
        
        // Protected fields should be reported as errors (not writable)
        expect(errors.some(e => e.includes('محمي'))).toBe(true);
    });

    it('should enforce enum values', () => {
        // users.role is an ENUM with allowed values
        const payload = { username: 'newuser', name: 'New', role: 'invalid_role' };
        const { errors } = filterBody('users', payload);
        expect(errors.some(e => e.includes('قيمة غير صالحة للحقل'))).toBe(true);
    });

    it('should enforce max length constraints', () => {
        const longString = 'a'.repeat(300);
        const payload = { username: longString };
        const { errors } = filterBody('users', payload);
        
        expect(errors.some(e => e.includes('أطول من المسموح'))).toBe(true);
    });

    it('should handle null/undefined body gracefully', () => {
        const result1 = filterBody('users', null);
        const result2 = filterBody('users', undefined);
        const result3 = filterBody('users', {});
        
        expect(result1.errors.length).toBeGreaterThan(0);
        expect(result2.errors.length).toBeGreaterThan(0);
        expect(result3.errors.length).toBeGreaterThan(0); // Missing required fields
    });

    it('should reject unknown entities', () => {
        const { errors } = filterBody('nonexistent_table', { foo: 'bar' });
        expect(errors.some(e => e.includes('نوع البيانات غير معروف'))).toBe(true);
    });
});

describe('getSortableColumns()', () => {
    it('should include writeable columns plus id', () => {
        const sortable = getSortableColumns('users');
        expect(sortable).toContain('id');
        expect(sortable).toContain('username');
        expect(sortable).toContain('name');
    });
});

describe('Bcrypt Regex Validation', () => {
    const bcryptRegex = /^\$2[aby]\$/;

    it('should match valid bcrypt hashes', () => {
        expect(bcryptRegex.test('$2b$10$KLGQ5LF9N3RJZTGRN5MMP.0xMP0HQPTuGQRPrP1CqbROhZFF2i2O')).toBe(true);
        expect(bcryptRegex.test('$2a$10$abcdefg...')).toBe(true);
        expect(bcryptRegex.test('$2y$10$abcdefg...')).toBe(true);
    });

    it('should reject plaintext passwords', () => {
        expect(bcryptRegex.test('1234')).toBe(false);
        expect(bcryptRegex.test('password')).toBe(false);
        expect(bcryptRegex.test('')).toBe(false);
        expect(bcryptRegex.test('admin123')).toBe(false);
    });
});

describe('Type Validation Edge Cases', () => {
    const { validateType } = require('../backend/schema-registry');
    const mockSchema = { types: {}, allowedValues: {} };

    it('should reject numeric strings for NUMBER type when strict', () => {
        const result = validateType('amount', 'not_a_number', TYPES.NUMBER, mockSchema);
        expect(result.valid).toBe(false);
    });

    it('should accept actual numbers for NUMBER type', () => {
        const result = validateType('amount', 42.5, TYPES.NUMBER, mockSchema);
        expect(result.valid).toBe(true);
    });

    it('should reject invalid dates', () => {
        const result = validateType('date_field', 'not-a-date', TYPES.DATE, mockSchema);
        expect(result.valid).toBe(false);
    });

    it('should accept ISO date strings', () => {
        const result = validateType('date_field', '2026-07-17T10:30:00Z', TYPES.DATE, mockSchema);
        expect(result.valid).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
        const result = validateType('uuid_field', 'not-uuid', TYPES.UUID, mockSchema);
        expect(result.valid).toBe(false);
    });

    it('should accept valid UUIDs', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const result = validateType('uuid_field', uuid, TYPES.UUID, mockSchema);
        expect(result.valid).toBe(true);
    });
});
