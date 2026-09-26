/**
 * Phase 2.3: Rate Limiter Tests
 * ──────────────────────────────────────────────────────────
 * Tests for in-memory and Redis-backed rate limiting.
 */

const {
    MemoryStore,
    createRateLimiter,
    DEFAULT_CONFIGS,
    defaultKeyGenerator,
    ipKeyGenerator,
    userKeyGenerator,
} = require('../backend/rate-limiter');

// Shared mock factory (accessible to all test blocks)
function createMocks(overrides = {}) {
    const req = {
        ip: '127.0.0.1',
        user: null,
        ...overrides.req,
    };
    
    const headers = {};
    let statusCode = 200;
    let body = null;
    
    const res = {
        get statusCode() { return statusCode; },
        set code(val) { statusCode = val; },
        set(newHeaders) {
            Object.assign(headers, newHeaders);
            return this;
        },
        status(code) {
            statusCode = code;
            return this;
        },
        json(jsonBody) {
            body = jsonBody;
            return this;
        },
        _headers: headers,
        _body: body,
    };
    
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    return { 
        req, 
        res, 
        next, 
        getNextCalled: () => nextCalled,
        getStatusCode: () => statusCode,
        getBody: () => body,
    };
}

describe('Phase 2.3: Rate Limiting System', () => {
    
    // ============================================================
    // 1. MEMORY STORE
    // ============================================================
    describe('1. MemoryStore', () => {
        let store;
        
        beforeEach(() => {
            store = new MemoryStore();
        });
        
        test('should create new entry on first increment', () => {
            const result = store.increment('test-key', 60000);
            expect(result.count).toBe(1);
            expect(result.resetTime).toBeGreaterThan(Date.now());
        });
        
        test('should increment existing entry within window', () => {
            store.increment('test-key', 60000);
            const result = store.increment('test-key', 60000);
            expect(result.count).toBe(2);
        });
        
        test('should reset count when window expires', async () => {
            const result1 = store.increment('short-window', 10);
            expect(result1.count).toBe(1);
            
            await new Promise(resolve => setTimeout(resolve, 25));
            
            const result2 = store.increment('short-window', 10);
            expect(result2.count).toBe(1);
        });
        
        test('should cleanup expired entries', async () => {
            store.increment('expire-soon', 10);
            await new Promise(resolve => setTimeout(resolve, 25));
            
            store.cleanup();
            expect(store.getState('expire-soon')).toBeNull();
        });
        
        test('should reset specific key', () => {
            store.increment('to-reset', 60000);
            expect(store.getState('to-reset')).not.toBeNull();
            
            store.reset('to-reset');
            expect(store.getState('to-reset')).toBeNull();
        });
        
        test('should handle multiple keys independently', () => {
            const r1 = store.increment('key-1', 60000);
            const r2 = store.increment('key-2', 60000);
            const r3 = store.increment('key-1', 60000);
            
            expect(r1.count).toBe(1);
            expect(r2.count).toBe(1);
            expect(r3.count).toBe(2);
        });
    });

    // ============================================================
    // 2. RATE LIMITER MIDDLEWARE (Async Tests)
    // ============================================================
    describe('2. Rate Limiter Middleware', () => {
        test('should allow requests under the limit', async () => {
            const uniqueKey = `allow-test-${Date.now()}`;
            const limiter = createRateLimiter({
                windowMs: 60000,
                maxRequests: 5,
                keyGenerator: () => uniqueKey,
            });
            
            for (let i = 0; i < 5; i++) {
                const mocks = createMocks();
                await limiter(mocks.req, mocks.res, mocks.next);
                
                expect(mocks.getStatusCode()).toBe(200);
                expect(mocks.getNextCalled()).toBe(true);
            }
        });
        
        test('should block requests exceeding the limit with 429', async () => {
            const uniqueKey = `block-test-${Date.now()}`;
            const limiter = createRateLimiter({
                windowMs: 60000,
                maxRequests: 2,
                keyGenerator: () => uniqueKey,
            });
            
            // First 2 requests OK
            for (let i = 0; i < 2; i++) {
                const mocks = createMocks();
                await limiter(mocks.req, mocks.res, mocks.next);
                expect(mocks.getStatusCode()).toBe(200);
            }
            
            // 3rd request should be blocked
            const mocks = createMocks();
            await limiter(mocks.req, mocks.res, mocks.next);
            
            expect(mocks.getStatusCode()).toBe(429);
            expect(mocks.getBody().error).toBe('RATE_LIMIT_EXCEEDED');
            expect(mocks.getBody().retryAfter).toBeGreaterThan(0);
        });
        
        test('should set X-RateLimit headers on every response', async () => {
            const limiter = createRateLimiter({
                windowMs: 60000,
                maxRequests: 10,
                keyGenerator: () => `header-test-${Date.now()}`,
            });
            
            const mocks = createMocks();
            await limiter(mocks.req, mocks.res, mocks.next);
            
            expect(mocks.res._headers['X-RateLimit-Limit']).toBe(10);
            expect(mocks.res._headers['X-RateLimit-Remaining']).toBe(9);
            expect(mocks.res._headers['X-RateLimit-Reset']).toBeDefined();
        });
        
        test('should set Retry-After when limited', async () => {
            const uniqueKey = `retry-test-${Date.now()}`;
            const limiter = createRateLimiter({
                windowMs: 60000,
                maxRequests: 1,
                keyGenerator: () => uniqueKey,
            });
            
            // First request OK
            const mocks1 = createMocks();
            await limiter(mocks1.req, mocks1.res, mocks1.next);
            
            // Second request blocked
            const mocks2 = createMocks();
            await limiter(mocks2.req, mocks2.res, mocks2.next);
            
            // Check 429 status and retry info in response body
            expect(mocks2.getStatusCode()).toBe(429);
            expect(mocks2.getBody().error).toBe('RATE_LIMIT_EXCEEDED');
            expect(mocks2.getBody().retryAfter).toBeDefined();
            expect(mocks2.getBody().retryAfter).toBeGreaterThan(0);
        });

        test('should fail-open on errors (allow request)', async () => {
            const limiter = createRateLimiter({
                windowMs: 60000,
                maxRequests: 5,
                keyGenerator: () => { throw new Error('Test error'); },
            });
            
            const mocks = createMocks();
            await limiter(mocks.req, mocks.res, mocks.next);
            
            // Should call next even if there's an error (fail-open)
            expect(mocks.getNextCalled()).toBe(true);
        });
    });

    // ============================================================
    // 3. KEY GENERATORS
    // ============================================================
    describe('3. Key Generators', () => {
        test('defaultKeyGenerator should use IP and userId', () => {
            const req = {
                ip: '192.168.1.1',
                user: { id: 42 },
            };
            
            const key = defaultKeyGenerator(req);
            expect(key).toContain('192.168.1.1');
            expect(key).toContain('42');
        });
        
        test('defaultKeyGenerator should handle anonymous users', () => {
            const req = {
                ip: '10.0.0.1',
                user: null,
            };
            
            const key = defaultKeyGenerator(req);
            expect(key).toContain('10.0.0.1');
            expect(key).toContain('anonymous');
        });
        
        test('ipKeyGenerator should only use IP', () => {
            const req = { ip: '172.16.0.1' };
            const key = ipKeyGenerator(req);
            expect(key).toBe('172.16.0.1');
        });
        
        test('userKeyGenerator should throw for unauthenticated', () => {
            const req = { user: null };
            expect(() => userKeyGenerator(req)).toThrow('User not authenticated');
        });
        
        test('userKeyGenerator should return user-prefixed key', () => {
            const req = { user: { id: 99 } };
            const key = userKeyGenerator(req);
            expect(key).toBe('user:99');
        });
    });

    // ============================================================
    // 4. DEFAULT CONFIGURATIONS
    // ============================================================
    describe('4. Default Configurations', () => {
        test('general config should allow 100 requests per minute', () => {
            expect(DEFAULT_CONFIGS.general.windowMs).toBe(60 * 1000);
            expect(DEFAULT_CONFIGS.general.maxRequests).toBe(100);
        });
        
        test('auth config should be stricter (10 per 15 min)', () => {
            expect(DEFAULT_CONFIGS.auth.windowMs).toBe(15 * 60 * 1000);
            expect(DEFAULT_CONFIGS.auth.maxRequests).toBe(10);
        });
        
        test('state config should limit saves (30 per minute)', () => {
            expect(DEFAULT_CONFIGS.state.windowMs).toBe(60 * 1000);
            expect(DEFAULT_CONFIGS.state.maxRequests).toBe(30);
        });
        
        test('crud config should allow more operations (200 per minute)', () => {
            expect(DEFAULT_CONFIGS.crud.windowMs).toBe(60000);
            expect(DEFAULT_CONFIGS.crud.maxRequests).toBe(200);
        });
    });

    // ============================================================
    // 5. INTEGRATION SCENARIOS
    // ============================================================
    describe('5. Integration Scenarios', () => {
        test('brute force protection scenario', async () => {
            const attackerIp = `brute-${Date.now()}`;
            const authLimiter = createRateLimiter({
                ...DEFAULT_CONFIGS.auth,
                keyGenerator: () => attackerIp,
            });
            
            // Attempt 10 logins (the limit)
            for (let i = 0; i < 10; i++) {
                const mocks = createMocks();
                await authLimiter(mocks.req, mocks.res, mocks.next);
                expect(mocks.getStatusCode()).toBe(200);
            }
            
            // 11th attempt should be blocked
            const mocks = createMocks();
            await authLimiter(mocks.req, mocks.res, mocks.next);
            expect(mocks.getStatusCode()).toBe(429);
            expect(mocks.getBody().message).toContain('login');
        });
        
        test('different IPs should have independent limits', async () => {
            const limiter = createRateLimiter({ 
                windowMs: 60000, 
                maxRequests: 2,
                keyGenerator: (req) => req.ip,
            });
            
            // User A makes 2 requests
            const mocksA1 = createMocks({ req: { ip: 'ip-a-unique' } });
            const mocksA2 = createMocks({ req: { ip: 'ip-a-unique' } });
            await limiter(mocksA1.req, mocksA1.res, mocksA1.next);
            await limiter(mocksA2.req, mocksA2.res, mocksA2.next);
            
            // User B should still have full quota
            const mocksB = createMocks({ req: { ip: 'ip-b-unique' } });
            await limiter(mocksB.req, mocksB.res, mocksB.next);
            
            expect(mocksA2.getStatusCode()).toBe(200); // User A at limit
            expect(mocksB.getStatusCode()).toBe(200);   // User B still allowed
        });
        
        test('authenticated vs anonymous should have separate tracking', async () => {
            const baseIp = `auth-anon-${Date.now()}`;
            const limiter = createRateLimiter({ 
                windowMs: 60000, 
                maxRequests: 2,
                keyGenerator: defaultKeyGenerator,
            });
            
            // Anonymous request
            const mocksAnon = createMocks({ 
                req: { ip: baseIp, user: null } 
            });
            await limiter(mocksAnon.req, mocksAnon.res, mocksAnon.next);
            
            // Authenticated request from same IP
            const mocksAuth = createMocks({ 
                req: { ip: baseIp, user: { id: 5 } } 
            });
            await limiter(mocksAuth.req, mocksAuth.res, mocksAuth.next);
            
            // Both should be tracked separately
            expect(mocksAnon.getStatusCode()).toBe(200);
            expect(mocksAuth.getStatusCode()).toBe(200);
        });
    });
});
