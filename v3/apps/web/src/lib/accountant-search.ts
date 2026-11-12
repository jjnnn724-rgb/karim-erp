import { rangeProblem } from './reporting';

export interface AccountantDashboardSearch {
    from?: string;
    to?: string;
    q?: string;
}

function isoDate(value: unknown): string | undefined {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

export function validateAccountantDashboardSearch(search: Record<string, unknown>): AccountantDashboardSearch {
    const from = isoDate(search.from);
    const to = isoDate(search.to);
    const validRange = from && to && !rangeProblem(from, to, 366);
    return {
        ...(validRange ? { from, to } : {}),
        ...(typeof search.q === 'string' ? { q: search.q.slice(0, 200) } : {}),
    };
}
