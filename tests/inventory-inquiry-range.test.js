'use strict';

const { readRange, riyadhDay } = require('../backend/inventory-inquiry');

describe('inventory inquiry date range', () => {
    it('rejects dates that do not exist in the calendar', () => {
        expect(readRange({ from: '2026-02-31', to: '2026-03-02' })).toMatchObject({
            ok: false,
            code: 'INVALID_RANGE',
        });
        expect(readRange({ from: '2026-13-01', to: '2026-13-02' })).toMatchObject({
            ok: false,
            code: 'INVALID_RANGE',
        });
    });

    it('accepts a real leap day and rejects a non-leap February 29', () => {
        expect(readRange({ from: '2024-02-29', to: '2024-03-01' })).toMatchObject({
            ok: true,
            from: '2024-02-29',
            to: '2024-03-01',
            span: 2,
        });
        expect(readRange({ from: '2025-02-29', to: '2025-03-01' })).toMatchObject({
            ok: false,
            code: 'INVALID_RANGE',
        });
    });

    it('rejects an inverted valid range', () => {
        expect(readRange({ from: '2026-11-12', to: '2026-11-11' })).toMatchObject({
            ok: false,
            code: 'INVALID_RANGE',
        });
    });

    it('preserves default dates and enforces the 93-day API limit', () => {
        expect(readRange({})).toMatchObject({
            ok: true,
            from: riyadhDay(-29),
            to: riyadhDay(0),
            span: 30,
        });
        expect(readRange({ from: '2026-01-01', to: '2026-04-03' })).toMatchObject({
            ok: true,
            span: 93,
        });
        const overLimit = readRange({ from: '2026-01-01', to: '2026-04-04' });
        expect(overLimit).toMatchObject({
            ok: false,
            code: 'RANGE_TOO_WIDE',
        });
        expect(overLimit.message).toContain('94');
    });
});
