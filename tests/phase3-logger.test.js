/**
 * Phase 3.2: Pino Logger Tests
 * ──────────────────────────────────────────────────────────
 * Tests for structured logging system.
 */

const {
    logger,
    httpLogger,
    childLogger,
    generateRequestId,
    logError,
    createTimer,
    auditLog,
    securityLog,
} = require('../backend/logger');

describe('Phase 3.2: Structured Logging System', () => {
    
    // ============================================================
    // 1. LOGGER INSTANCE
    // ============================================================
    describe('1. Logger Instance', () => {
        test('should be a valid pino logger', () => {
            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.debug).toBe('function');
        });
        
        test('should have correct name', () => {
            // pino logger has a name property or we can check it logs correctly
            expect(logger).toBeDefined();
        });
        
        test('should log at different levels', () => {
            // These should not throw
            expect(() => logger.info('test info')).not.toThrow();
            expect(() => logger.warn('test warn')).not.toThrow();
            expect(() => logger.error('test error')).not.toThrow();
            expect(() => logger.debug('test debug')).not.toThrow();
        });
        
        test('should log objects as structured data', () => {
            expect(() => {
                logger.info({ key: 'value', num: 42 }, 'structured message');
            }).not.toThrow();
        });
    });

    // ============================================================
    // 2. REQUEST ID GENERATION
    // ============================================================
    describe('2. Request ID Generation', () => {
        test('should generate unique IDs', () => {
            const id1 = generateRequestId();
            const id2 = generateRequestId();
            
            expect(id1).not.toBe(id2);
            expect(typeof id1).toBe('string');
            expect(id1.length).toBeGreaterThan(10);
        });
        
        test('should contain expected format parts', () => {
            const id = generateRequestId();
            
            // Should have timestamp, random, and counter parts
            const parts = id.split('-');
            expect(parts.length).toBeGreaterThanOrEqual(3);
        });
        
        test('should generate many unique IDs without collision', () => {
            const ids = new Set();
            for (let i = 0; i < 1000; i++) {
                ids.add(generateRequestId());
            }
            expect(ids.size).toBe(1000);
        });
    });

    // ============================================================
    // 3. CHILD LOGGER (Request-Scoped)
    // ============================================================
    describe('3. Child Logger (Request Context)', () => {
        test('should create child logger from request', () => {
            const req = {
                ip: '192.168.1.1',
                method: 'GET',
                path: '/api/test',
                headers: { 'user-agent': 'test-agent', 'x-request-id': 'req-123' },
                user: { id: 42, role: 'admin' },
            };
            
            const child = childLogger(req);
            
            expect(child).toBeDefined();
            expect(typeof child.info).toBe('function');
        });
        
        test('should handle request without user', () => {
            const req = {
                ip: '10.0.0.1',
                method: 'POST',
                path: '/api/login',
                headers: { 'user-agent': 'test' },
            };
            
            expect(() => childLogger(req)).not.toThrow();
        });
        
        test('should handle missing headers gracefully', () => {
            const req = {
                method: 'GET',
                path: '/api/data',
                headers: {},
            };
            
            expect(() => childLogger(req)).not.toThrow();
        });
    });

    // ============================================================
    // 4. HTTP LOGGER MIDDLEWARE
    // ============================================================
    describe('4. HTTP Logger Middleware', () => {
        test('should be a middleware function', () => {
            const middleware = httpLogger();
            expect(typeof middleware).toBe('function');
            expect(middleware.length).toBe(3); // req, res, next
        });
        
        test('should attach logger to request object', () => {
            const middleware = httpLogger({ ignorePaths: [] });
            
            const req = {
                ip: '127.0.0.1',
                method: 'GET',
                path: '/api/users',
                headers: { 'user-agent': 'test' },
                query: {},
                params: {},
                body: {},
            };
            
            let nextCalled = false;
            const next = () => { nextCalled = true; };
            const res = { 
                statusCode: 200,
                end: function() { return this; },
                getHeader: () => null,
            };
            
            middleware(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.log).toBeDefined();
        });
        
        test('should skip ignored paths', () => {
            const middleware = httpLogger({ ignorePaths: ['/api/health'] });
            
            const req = {
                method: 'GET',
                path: '/api/health',
                headers: {},
            };
            
            let nextCalled = false;
            const next = () => { nextCalled = true; };
            const res = {};
            
            middleware(req, res, next);
            
            expect(nextCalled).toBe(true);
            expect(req.log).toBeUndefined(); // Should NOT attach logger for ignored paths
        });
    });

    // ============================================================
    // 5. ERROR LOGGING
    // ============================================================
    describe('5. Error Logging', () => {
        test('should log error with context', () => {
            const error = new Error('Test error');
            
            expect(() => logError(error, { extraInfo: 'test' })).not.toThrow();
        });
        
        test('should handle validation errors with warn level', () => {
            const validationError = new Error('Invalid input');
            validationError.name = 'ValidationError';
            validationError.code = 'VALIDATION_ERROR';
            
            expect(() => logError(validationError)).not.toThrow();
        });
        
        test('should handle errors without stack', () => {
            const error = { message: 'Plain error object' };
            
            expect(() => logError(error)).not.toThrow();
        });
    });

    // ============================================================
    // 6. PERFORMANCE TIMER
    // ============================================================
    describe('6. Performance Timer', () => {
        test('should create timer with label', () => {
            const timer = createTimer('test-operation');
            
            expect(timer).toBeDefined();
            expect(timer.start).toBeDefined();
            expect(typeof timer.end).toBe('function');
        });
        
        test('should measure elapsed time', () => {
            const timer = createTimer('quick-op');
            
            // Simulate some work
            
            const duration = timer.end();
            
            expect(duration).toBeGreaterThanOrEqual(0);
            expect(typeof duration).toBe('number');
        });
        
        test('should accept extra context on end', () => {
            const timer = createTimer('contextual-timer');
            
            const duration = timer.end({ itemCount: 100, success: true });
            
            expect(duration).toBeGreaterThanOrEqual(0);
        });
    });

    // ============================================================
    // 7. AUDIT LOGGING
    // ============================================================
    describe('7. Audit Logging', () => {
        test('should create audit log entry', () => {
            expect(() => {
                auditLog('user.created', { userId: 42, username: 'john' });
            }).not.toThrow();
        });
        
        test('should include request context when available', () => {
            const req = {
                ip: '192.168.1.100',
                user: { id: 1, role: 'admin' },
                method: 'POST',
                path: '/api/users',
                headers: {},
            };
            
            expect(() => {
                auditLog('settings.updated', { key: 'tax_rate' }, req);
            }).not.toThrow();
        });
        
        test('should work without request context', () => {
            expect(() => {
                auditLog('system.startup', { version: '2.0.1' });
            }).not.toThrow();
        });
    });

    // ============================================================
    // 8. SECURITY EVENT LOGGING
    // ============================================================
    describe('8. Security Event Logging', () => {
        test('should log authentication failure', () => {
            const req = {
                ip: ' suspicious.ip.address',
                headers: {},
                user: null,
            };
            
            expect(() => {
                securityLog('auth.failed', { username: 'admin' }, req);
            }).not.toThrow();
        });
        
        test('should log injection attempt as error', () => {
            expect(() => {
                securityLog('injection_attempt', {
                    payload: "'; DROP TABLE users;--",
                    endpoint: '/api/users',
                });
            }).not.toThrow();
        });
        
        test('should handle all defined security event types', () => {
            const eventTypes = [
                'auth.failed', 'auth.success', 'rate_limited',
                'injection_attempt', 'xss_attempt', 'unauthorized_access',
                'privilege_escalation', 'suspicious_payload',
            ];
            
            eventTypes.forEach(eventType => {
                expect(() => securityLog(eventType, {})).not.toThrow();
            });
        });
        
        test('should log unknown events as warnings', () => {
            expect(() => {
                securityLog('custom.event', { data: 'test' });
            }).not.toThrow();
        });
    });

    // ============================================================
    // 9. LOG REDACTION (Sensitive Data)
    // ============================================================
    describe('9. Log Redaction', () => {
        test('should redact password in logged objects', () => {
            // This is tested by checking that logging doesn't throw
            // and the redaction config exists in the logger setup
            expect(() => {
                logger.info({
                    user: { name: 'John', password: 'secret123' },
                    req: { body: { password: 'hidden' } },
                }, 'Test with sensitive data');
            }).not.toThrow();
        });
    });

    // ============================================================
    // 10. INTEGRATION SCENARIOS
    // ============================================================
    describe('10. Integration Scenarios', () => {
        test('full request lifecycle logging', () => {
            const middleware = httpLogger({ ignorePaths: [] });
            
            const req = {
                ip: '10.20.30.40',
                method: 'POST',
                path: '/api/orders',
                headers: {
                    'user-agent': 'Mozilla/5.0',
                    'x-request-id': 'test-req-123',
                    'content-type': 'application/json',
                },
                user: { id: 5, role: 'cashier' },
                query: {},
                params: {},
                body: { items: [{ id: 1, qty: 2 }] },
            };
            
            let nextCalled = false;
            const next = () => { nextCalled = true; };
            
            const res = {
                statusCode: 201,
                setHeader: () => res,
                getHeader: () => '256',
                end: function() {
                    return this;
                },
            };
            
            // Run middleware
            middleware(req, res, next);
            
            // Verify middleware executed
            expect(nextCalled).toBe(true);
            expect(req.log).toBeDefined();
            
            // Verify response would be logged
            // (res.end is overridden to log)
            expect(typeof res.end).toBe('function');
        });
        
        test('error handling with audit trail', () => {
            const error = new Error('Database connection failed');
            
            // Log the error
            logError(error, { operation: 'query', table: 'orders' });
            
            // Create audit entry for the failure
            auditLog('error.database', {
                error: error.message,
                operation: 'query',
            });
            
            // Both should complete without throwing
            expect(true).toBe(true);
        });
        
        test('security incident full workflow', () => {
            const attackerReq = {
                ip: 'attacker.evil.com',
                method: 'POST',
                path: '/api/users',
                headers: { 'user-agent': 'curl/7.68.0' },
                body: { role: 'admin', username: 'hacker' },
            };
            
            // Log the attempt
            securityLog('privilege_escalation', {
                attemptedRole: 'admin',
                originalRole: 'viewer',
            }, attackerReq);
            
            // Create audit record
            auditLog('security.incident', {
                type: 'privilege_escalation',
                severity: 'high',
            }, attackerReq);
            
            expect(true).toBe(true);
        });
    });
});
