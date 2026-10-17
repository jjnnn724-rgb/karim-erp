/**
 * V2 — Cashier-monitor repository (الباب الوحيد إلى /api/cashier-monitor)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER (backend/cashier-monitor-routes.js:1-52)
 *   GET /cashier-monitor/summary?date=&live=  → { cashiers[] } — مرآة
 *     كاشير 1/4/5/6/9 (كاشير 2 مستثنى هنا وهناك :9-10)
 *   GET /cashier-monitor/orders?date=&cashier=&limit=&offset= → { orders[], total }
 *   GET /cashier-monitor/orders/:doc          → { order{...lines[]} }
 * الوصول: admin بالدور أو 'cashier-monitor.view' بالمنح (:24-25) — أي حد
 * تاني 403. لا كتابة إطلاقًا (:11).
 * live=1 لليوم الحالي فقط وتشغّل مزامنة خفيفة بحد 45 ثانية (:27-46).
 */

import { apiFetch } from '../../core/api.js?v=4.9.154';

/** Riyadh YYYY-MM-DD — مرآة cmToday (features/cashier-monitor.js:15). */
export function mirrorToday() {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
    } catch {return new Date().toISOString().slice(0, 10);}
}

export async function fetchMonitorSummary(date, live = false) {
    const q = `/cashier-monitor/summary?date=${encodeURIComponent(date)}${live ? '&live=1' : ''}`;
    const res = await apiFetch(q);
    return Array.isArray(res && res.cashiers) ? res.cashiers : [];
}

export async function fetchMonitorOrders({ date, cashier = '', limit = 50, offset = 0 }) {
    const res = await apiFetch(
        `/cashier-monitor/orders?date=${encodeURIComponent(date)}`
        + `&cashier=${encodeURIComponent(cashier || '')}&limit=${limit}&offset=${offset}`,
    );
    return {
        orders: Array.isArray(res && res.orders) ? res.orders : [],
        total: Number(res && res.total) || 0,
    };
}

export async function fetchMonitorOrder(docNo) {
    const res = await apiFetch(`/cashier-monitor/orders/${encodeURIComponent(docNo)}`);
    const o = res && res.order && typeof res.order === 'object' ? res.order : {};
    return { ...o, lines: Array.isArray(o.lines) ? o.lines : [] };
}

/** مجاميع اللوحة — نفس جمع القديم (:91-95). */
export function summarizeCashiers(cashiers = []) {
    const n = (v) => Number(v) || 0;
    return {
        invoices: cashiers.reduce((s, c) => s + n(c.invoices), 0),
        revenue: cashiers.reduce((s, c) => s + n(c.revenue), 0),
        revenueEx: cashiers.reduce((s, c) => s + n(c.revenue_ex_vat), 0),
        cash: cashiers.reduce((s, c) => s + n(c.pay_cash), 0),
        network: cashiers.reduce((s, c) => s + n(c.pay_network), 0),
    };
}

/**
 * حداثة المرآة — نفس قاعدة القديم (:96-105): لا مزامنة أو > 45 دقيقة = متوقفة.
 * @returns {{ state: 'none'|'stale'|'live', ageMin: number|null }}
 */
export function mirrorFreshness(cashiers = [], nowMs = Date.now()) {
    const times = (cashiers || []).map((c) => c.synced_at).filter(Boolean);
    if (!times.length) {return { state: 'none', ageMin: null };}
    const last = times.sort().reverse()[0];
    const ageMin = Math.round((nowMs - new Date(last).getTime()) / 60000);
    if (ageMin === null || Number.isNaN(ageMin) || ageMin > 45) {return { state: 'stale', ageMin };}
    return { state: 'live', ageMin };
}
