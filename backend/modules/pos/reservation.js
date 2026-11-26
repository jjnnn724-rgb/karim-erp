'use strict';
/**
 * pos/reservation — حجز مخزون مؤقت للبيع المتصل (B1.2).
 * الخادم وحده يملك الرصيد؛ العميل لا يخصم محليًا. الحجز ينتهي تلقائيًا.
 */
async function reserveStock(pool, { tenantId, saleUuid, productId, quantity, ttlMinutes = 30 }) {
    if (!tenantId || !saleUuid || !productId || !(Number(quantity) > 0)) {
        throw Object.assign(new Error('INVALID_RESERVATION'), { code: 'INVALID_RESERVATION' });
    }
    const r = await pool.query(
        `INSERT INTO public.pos_stock_reservations (tenant_id, sale_uuid, product_id, quantity, expires_at)
         VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)
         ON CONFLICT (sale_uuid) DO UPDATE SET expires_at = EXCLUDED.expires_at
         RETURNING id, sale_uuid, quantity, expires_at`,
        [tenantId, String(saleUuid), productId, Number(quantity), Number(ttlMinutes)],
    );
    return r.rows[0];
}

async function releaseReservation(pool, saleUuid) {
    await pool.query('DELETE FROM public.pos_stock_reservations WHERE sale_uuid=$1', [String(saleUuid)]);
}

async function activeReservations(pool, tenantId, productId) {
    const r = await pool.query(
        `SELECT coalesce(sum(quantity),0)::text AS qty
           FROM public.pos_stock_reservations
          WHERE tenant_id=$1 AND product_id=$2 AND expires_at > now()`,
        [tenantId, productId],
    );
    return Number(r.rows[0]?.qty || 0);
}

module.exports = { reserveStock, releaseReservation, activeReservations };
