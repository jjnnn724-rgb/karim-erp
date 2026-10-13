/**
 * Phase 2.2: Pagination & Sorting Tests
 * ──────────────────────────────────────────────────────────
 * Tests for pagination middleware, query building, and API responses.
 * 
 * Covers:
 * - parsePaginationParams() validation and defaults
 * - buildPaginatedQuery() SQL generation
 * - Security: injection prevention, limit enforcement
 * - Edge cases: negative values, huge pages, invalid sort columns
 */

const {
    parsePaginationParams,
    buildPaginatedQuery,
    DEFAULT_PAGE,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MAX_OFFSET,
} = require('../backend/pagination');

describe('Phase 2.2: Pagination & Sorting System', () => {
    
    // ============================================================
    // 1. DEFAULT VALUES
    // ============================================================
    describe('1. Default Values', () => {
        test('should use default page=1 when no query provided', () => {
            const result = parsePaginationParams({}, ['id']);
            expect(result.page).toBe(DEFAULT_PAGE);
            expect(result.limit).toBe(DEFAULT_LIMIT);
            expect(result.sort).toBe('id');
            expect(result.order).toBe('ASC');
        });

        test('should have correct constants', () => {
            expect(DEFAULT_PAGE).toBe(1);
            expect(DEFAULT_LIMIT).toBe(50);
            expect(MAX_LIMIT).toBe(1000);
            expect(MAX_OFFSET).toBe(50000);
        });
    });

    // ============================================================
    // 2. PAGE PARAMETER PARSING
    // ============================================================
    describe('2. Page Parameter Parsing', () => {
        test('should parse valid page number', () => {
            const result = parsePaginationParams({ page: '5' }, ['id']);
            expect(result.page).toBe(5);
            expect(result.offset).toBe(200); // (5-1) * 50
        });

        test('should default to page 1 for non-numeric input', () => {
            const result = parsePaginationParams({ page: 'abc' }, ['id']);
            expect(result.page).toBe(1);
        });

        test('should default to page 1 for negative numbers', () => {
            const result = parsePaginationParams({ page: '-5' }, ['id']);
            expect(result.page).toBe(1);
        });

        test('should default to page 1 for zero', () => {
            const result = parsePaginationParams({ page: '0' }, ['id']);
            expect(result.page).toBe(1);
        });

        test('should handle floating point by parsing as integer', () => {
            const result = parsePaginationParams({ page: '3.7' }, ['id']);
            expect(result.page).toBe(3);
        });
    });

    // ============================================================
    // 3. LIMIT PARAMETER PARSING & ENFORCEMENT
    // ============================================================
    describe('3. Limit Parameter Parsing & Enforcement', () => {
        test('should parse valid limit', () => {
            const result = parsePaginationParams({ limit: '25' }, ['id']);
            expect(result.limit).toBe(25);
        });

        test('should enforce MAX_LIMIT cap (1000)', () => {
            const result = parsePaginationParams({ limit: '9999' }, ['id']);
            expect(result.limit).toBe(MAX_LIMIT); // Capped at 200
            expect(result.errors).toContain('Limit 9999 exceeds maximum of 1000');
            expect(result.valid).toBe(false);
        });

        test('should allow exactly MAX_LIMIT', () => {
            const result = parsePaginationParams({ limit: '1000' }, ['id']);
            expect(result.limit).toBe(1000);
        });

        test('should default to DEFAULT_LIMIT for non-numeric', () => {
            const result = parsePaginationParams({ limit: 'abc' }, ['id']);
            expect(result.limit).toBe(DEFAULT_LIMIT);
        });

        test('should default to DEFAULT_LIMIT for negative', () => {
            const result = parsePaginationParams({ limit: '-10' }, ['id']);
            expect(result.limit).toBe(DEFAULT_LIMIT);
        });

        test('should calculate offset correctly with custom limit', () => {
            const result = parsePaginationParams({ page: '3', limit: '30' }, ['id']);
            expect(result.offset).toBe(60); // (3-1) * 30
        });
    });

    // ============================================================
    // 4. OFFSET PROTECTION (Deep Pagination Prevention)
    // ============================================================
    describe('4. Offset Protection', () => {
        test('should clamp offset exceeding MAX_OFFSET', () => {
            // Page 1000 with limit 50 = offset 49,950 > 10,000 (but MAX_OFFSET is 50000)
            // Need a page that exceeds 50000: page 1001 with limit 50 = offset 50000 (at boundary)
            // page 1002 with limit 50 = offset 50050 > 50000
            const result = parsePaginationParams({ page: '1002', limit: '50' }, ['id']);
            expect(result.errors).toContain('Page 1002 exceeds maximum offset of 50000');
            expect(result.valid).toBe(false);
        });

        test('should allow offset at exactly MAX_OFFSET boundary', () => {
            // Page 1001 with limit 50 = offset 50,000 (exactly at max)
            const result = parsePaginationParams({ page: '1001', limit: '50' }, ['id']);
            // Should be clamped or allowed depending on implementation
            expect(result.offset).toBeLessThanOrEqual(MAX_OFFSET);
        });
    });

    // ============================================================
    // 5. SORT COLUMN VALIDATION (Security Critical)
    // ============================================================
    describe('5. Sort Column Validation (Security)', () => {
        test('should allow column in whitelist', () => {
            const result = parsePaginationParams({ sort: 'name' }, ['id', 'name', 'email']);
            expect(result.sort).toBe('name');
            expect(result.errors).toHaveLength(0);
            expect(result.valid).toBe(true);
        });

        test('should block column NOT in whitelist', () => {
            const result = parsePaginationParams({ sort: 'password' }, ['id', 'name', 'email']);
            expect(result.sort).toBe('id'); // Fallback to first allowed
            expect(result.errors.some(e => e.includes('Sort column "password" not allowed'))).toBe(true);
            expect(result.valid).toBe(false);
        });

        test('should default sort to id when not specified', () => {
            const result = parsePaginationParams({}, ['id', 'name']);
            expect(result.sort).toBe('id');
        });

        test('should prevent SQL injection in sort column', () => {
            const attackPatterns = [
                'id; DROP TABLE users--',
                'id OR 1=1',
                'name"; DELETE FROM users--',
                '1 UNION SELECT * FROM passwords',
            ];
            
            attackPatterns.forEach(pattern => {
                const result = parsePaginationParams({ sort: pattern }, ['id', 'name']);
                expect(result.sort).not.toContain(';');
                expect(result.sort).not.toContain('DROP');
                expect(result.sort).not.toContain('UNION');
                expect(['id', 'name']).toContain(result.sort);
            });
        });

        test('should reject special characters in sort column', () => {
            const specialChars = ['id<script>', 'name\' OR \'1\'=\'1', 'email--'];
            specialChars.forEach(pattern => {
                const result = parsePaginationParams({ sort: pattern }, ['id', 'name', 'email']);
                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
            });
        });

        test('should allow underscores in column names', () => {
            const result = parsePaginationParams({ sort: 'created_at' }, ['id', 'created_at']);
            expect(result.sort).toBe('created_at');
            expect(result.valid).toBe(true);
        });
    });

    // ============================================================
    // 6. ORDER DIRECTION VALIDATION
    // ============================================================
    describe('6. Order Direction Validation', () => {
        test('should accept ASC (case-insensitive)', () => {
            const ascVariants = ['ASC', 'asc', 'Asc', 'aSc'];
            ascVariants.forEach(variant => {
                const result = parsePaginationParams({ order: variant }, ['id']);
                expect(result.order).toBe('ASC');
            });
        });

        test('should accept DESC (case-insensitive)', () => {
            const descVariants = ['DESC', 'desc', 'Desc', 'dEsC'];
            descVariants.forEach(variant => {
                const result = parsePaginationParams({ order: variant }, ['id']);
                expect(result.order).toBe('DESC');
            });
        });

        test('should default to ASC for invalid order', () => {
            const invalidOrders = ['RANDOM', 'UP', 'DOWN', '', '123', 'ASCDESC'];
            invalidOrders.forEach(order => {
                const result = parsePaginationParams({ order }, ['id']);
                expect(result.order).toBe('ASC');
            });
        });
    });

    // ============================================================
    // 7. BUILD PAGINATED QUERY (SQL Generation)
    // ============================================================
    describe('7. Build Paginated Query (SQL Generation)', () => {
        test('should generate basic paginated query', () => {
            const params = { page: 1, limit: 50, offset: 0, sort: 'id', order: 'ASC' };
            const { dataQuery, countQuery, params: queryParams } = buildPaginatedQuery('users', params);
            
            expect(dataQuery).toContain('SELECT * FROM "users"');
            expect(dataQuery).toContain('ORDER BY "id" ASC');
            expect(dataQuery).toContain('LIMIT $1 OFFSET $2');
            expect(countQuery).toContain('SELECT COUNT(*) AS total FROM "users"');
            expect(queryParams).toEqual([50, 0]);
        });

        test('should generate DESC sorted query', () => {
            const params = { page: 2, limit: 25, offset: 25, sort: 'created_at', order: 'DESC' };
            const { dataQuery } = buildPaginatedQuery('orders', params);
            
            expect(dataQuery).toContain('ORDER BY "created_at" DESC');
            expect(dataQuery).toContain('LIMIT $1 OFFSET $2');
        });

        test('should parameterize limit and offset correctly', () => {
            const params = { page: 5, limit: 100, offset: 400, sort: 'id', order: 'ASC' };
            const { params: queryParams } = buildPaginatedQuery('items', params);
            
            expect(queryParams[0]).toBe(100); // LIMIT
            expect(queryParams[1]).toBe(400); // OFFSET
        });

        test('should use proper table name quoting', () => {
            const { dataQuery, countQuery } = buildPaginatedQuery('inventory_items', {
                page: 1, limit: 10, offset: 0, sort: 'id', order: 'ASC'
            });
            
            expect(dataQuery).toContain('"inventory_items"');
            expect(countQuery).toContain('"inventory_items"');
        });

        // REGRESSION 2026-10-13: كان العدّ يُنفَّذ ببارامترات الصفحة (limit/offset) وهو
        // بلا $ → PostgreSQL يرفض البروتوكول (08P01) فتعود كل القوائم 500 وتبدو البيانات
        // «محذوفة». القاعدة: عدد البارامترات يجب أن يطابق عدد المعاملات في كل استعلام.
        test('count query carries only its own placeholders (PG 08P01 guard)', () => {
            const maxPh = sql => Math.max(0, ...[...String(sql).matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
            const cases = [
                { tbl: 'departments', branchId: null },
                { tbl: 'employees', branchId: null },
                { tbl: 'employees', branchId: 1 },
                { tbl: 'users', branchId: 7 },
            ];
            for (const { tbl, branchId } of cases) {
                const q = buildPaginatedQuery(tbl, { page: 2, limit: 20, offset: 20, sort: 'id', order: 'ASC' }, { branchId });
                expect(q.params).toHaveLength(maxPh(q.dataQuery));
                expect(q.countParams).toHaveLength(maxPh(q.countQuery));
                if (branchId == null) {
                    expect(q.countParams).toEqual([]);
                    expect(q.countQuery).not.toMatch(/\$\d/);
                } else {
                    expect(q.countParams).toEqual([branchId]);
                }
            }
        });

        test('branch filter is first placeholder so PG can infer types (42P18 guard)', () => {
            const q = buildPaginatedQuery('employees', { page: 1, limit: 50, offset: 0, sort: 'id', order: 'ASC' }, { branchId: 1 });
            expect(q.dataQuery).toContain('WHERE "branch_id" = $1');
            expect(q.dataQuery).toContain('LIMIT $2 OFFSET $3');
            expect(q.params).toEqual([1, 50, 0]);
        });

        test('non-branch entities never receive a branch predicate', () => {
            const q = buildPaginatedQuery('departments', { page: 1, limit: 10, offset: 0, sort: 'id', order: 'ASC' }, {});
            expect(q.dataQuery).not.toContain('branch_id');
            expect(q.countQuery).not.toContain('branch_id');
        });
    });

    // ============================================================
    // 8. COMBINED SCENARIOS (Integration-style)
    // ============================================================
    describe('8. Combined Scenarios', () => {
        test('full pagination request with all parameters', () => {
            const query = { page: '3', limit: '20', sort: 'name', order: 'DESC' };
            const allowedColumns = ['id', 'name', 'email', 'created_at'];
            
            const result = parsePaginationParams(query, allowedColumns);
            
            expect(result).toEqual({
                page: 3,
                limit: 20,
                offset: 40,
                sort: 'name',
                order: 'DESC',
                valid: true,
                errors: [],
            });
        });

        test('API consumer example: second page of active employees', () => {
            const query = { page: '2', limit: '25', sort: 'status', order: 'ASC' };
            const allowedColumns = ['id', 'name', 'status', 'department_id'];
            
            const result = parsePaginationParams(query, allowedColumns);
            const sql = buildPaginatedQuery('employees', result);
            
            expect(result.page).toBe(2);
            expect(result.offset).toBe(25);
            expect(sql.dataQuery).toContain('"status" ASC');
            expect(sql.params).toEqual([25, 25]);
        });

        test('malicious request should be sanitized safely', () => {
            const maliciousQuery = {
                page: '-1 OR 1=1',
                limit: '999999',
                sort: 'id; DROP TABLE users--',
                order: 'UNION SELECT',
            };
            
            const result = parsePaginationParams(maliciousQuery, ['id', 'name']);
            
            // All malicious inputs should be neutralized
            expect(result.page).toBe(1);
            expect(result.limit).toBe(1000); // Capped
            expect(['id', 'name']).toContain(result.sort);
            expect(result.order).toBe('ASC');
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test('empty whitelist should only allow id fallback', () => {
            const result = parsePaginationParams({ sort: 'name' }, []);
            expect(result.sort).toBe('id'); // Falls back to id even if not in empty list
            expect(result.valid).toBe(false);
        });
    });

    // ============================================================
    // 9. EDGE CASES
    // ============================================================
    describe('9. Edge Cases', () => {
        test('very large page number within offset limit', () => {
            const result = parsePaginationParams({ page: '200', limit: '50' }, ['id']);
            // Offset = 199 * 50 = 9950, which is < 10000, so it's allowed
            expect(result.page).toBe(200);
            expect(result.offset).toBe(9950);
        });

        test('undefined/null query object', () => {
            const result = parsePaginationParams(undefined, ['id']);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(50);
        });

        test('empty string parameters', () => {
            const result = parsePaginationParams({ page: '', limit: '', sort: '', order: '' }, ['id', 'name']);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(50);
            expect(result.sort).toBe('id'); // Falls back when empty
            expect(result.order).toBe('ASC');
        });

        test('whitespace-only parameters', () => {
            const result = parsePaginationParams({ sort: '   ', order: '   ' }, ['id', 'name']);
            // After trim, empty sort falls back to 'id'
            expect(result.sort).toBe('id');
            expect(result.order).toBe('ASC');
        });
    });
});
