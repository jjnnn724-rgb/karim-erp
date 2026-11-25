import { describe, expect, test } from 'vitest';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT, paginationQuerySchema } from './pagination.js';

describe('paginationQuerySchema', () => {
    test('الافتراضي 50 كما في /journal', () => {
        expect(paginationQuerySchema.parse({})).toEqual({ limit: PAGINATION_DEFAULT_LIMIT });
        expect(PAGINATION_DEFAULT_LIMIT).toBe(50);
    });

    test('يقبل النص ويحوّله (req.query نصوص)', () => {
        expect(paginationQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
        expect(paginationQuerySchema.parse({ limit: '200' })).toEqual({ limit: 200 });
    });

    test('الحد الأقصى 200 كما يقصّه القديم', () => {
        expect(PAGINATION_MAX_LIMIT).toBe(200);
        expect(() => paginationQuerySchema.parse({ limit: '201' })).toThrow();
    });

    test('يرفض الصفر والكسر وما ليس رقمًا', () => {
        expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow();
        expect(() => paginationQuerySchema.parse({ limit: '1.5' })).toThrow();
        expect(() => paginationQuerySchema.parse({ limit: 'abc' })).toThrow();
    });
});
