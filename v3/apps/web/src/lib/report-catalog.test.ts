import { describe, expect, it } from 'vitest';
import { availableReportDestinations, REPORT_DESTINATIONS } from './report-catalog';

describe('مركز تقارير V3', () => {
    it('يعرض فقط التقارير المسموح بها والمفعّلة', () => {
        expect(
            availableReportDestinations(
                ['attendance', 'employees', 'payroll', 'reports'],
                new Set(['attendance', 'employees', 'reports']),
            ).map((report) => report.key),
        ).toEqual(['attendance', 'employees']);
    });

    it('يوجه إلى شاشات V3 القائمة ولا يضيف وجهات V2', () => {
        expect(REPORT_DESTINATIONS.length).toBeGreaterThanOrEqual(20);
        expect(REPORT_DESTINATIONS.every((report) => report.href.startsWith('/v3/'))).toBe(true);
        expect(new Set(REPORT_DESTINATIONS.map((report) => report.key)).size).toBe(REPORT_DESTINATIONS.length);
    });
});
