import { describe, expect, it } from 'vitest';
import { PRESETS, presetRange } from './reporting';

describe('quarterly reporting preset', () => {
    it('defaults to the most recently completed calendar quarter', () => {
        expect(presetRange('quarter', new Date(2026, 10, 12))).toEqual({
            from: '2026-07-01',
            to: '2026-09-30',
            label: 'آخر ربع مكتمل',
        });
    });

    it('handles year boundaries and leap years', () => {
        expect(presetRange('quarter', new Date(2026, 0, 3))).toEqual({
            from: '2025-10-01',
            to: '2025-12-31',
            label: 'آخر ربع مكتمل',
        });
        expect(presetRange('quarter', new Date(2024, 3, 1))).toEqual({
            from: '2024-01-01',
            to: '2024-03-31',
            label: 'آخر ربع مكتمل',
        });
    });

    it('exposes the quarterly preset to report controls', () => {
        expect(PRESETS).toContainEqual({ key: 'quarter', label: 'آخر ربع مكتمل' });
    });
});
