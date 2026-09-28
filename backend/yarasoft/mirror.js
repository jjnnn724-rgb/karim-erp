/**
 * yarasoft/mirror.js — Cashier mirror: Yarasoft POS orders mirrored into karim.
 * ────────────────────────────────────────────────────────────────────────────
 * Read-only from Oracle (CC_BILLS3 headers + CC_BILL_ENTER3 lines), upsert by
 * DOC_NO (idempotent — re-poll absorbs corrections, never duplicates).
 * Scope: cashiers 1/4/5/6/9 (cashier 2 excluded everywhere, same as reports).
 * Latency = Oracle poll cycle (default 1 min). Payment *method* unknown —
 * PAYED stores the paid amount; change = total - payed.
 */
'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const MIRROR_CASHIERS = ['1', '4', '5', '6', '9'];
const MIRROR_DAYS = 2; // today + yesterday (late-night spillover)

const NUM = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

async function refreshMirrorOrders({ days = MIRROR_DAYS, cashiers = MIRROR_CASHIERS, io = null } = {}) {
    const out = { ok: true, headers: 0, upserted: 0, cashiers: {} };
    try {
        // جلسة دائمة موسومة بهويتنا (تبقى حية حتى لو غيّروا الباسورد)
        const { getKeptConn } = require('./oracle-link');
        const oracledb = require('oracledb');
        const conn = await getKeptConn('mirror');
        const exec = (sql, binds = {}) => conn.execute(sql, binds, { outFormat: oracledb.OBJECT });
        const since = Math.max(1, Math.min(30, Number(days) || MIRROR_DAYS));
        const list = cashiers.map((c) => String(c).trim()).filter(Boolean);
        const inList = list.map((_, i) => `:c${i}`).join(',');
        const binds = {};
        list.forEach((c, i) => { binds[`c${i}`] = c; });
        const heads = (await exec(
            `SELECT DOC_NO, TRIM(CSHR_NO) AS CSHR, DOC_DATE, DOC_TIME, SHFT_NO, NET_VAL, TOTAL_VAL,
                    DSCNT_VL, PAYED, CASH_PYD, SPAN_PYD, CRDT_PYD, MBL_PYD,
                    TABLE_NM, ZONE_NM, VAT_AMNT AS H_VAT, PRNTD, NOTES
             FROM CC_BILLS3
             WHERE DOC_DATE >= TRUNC(SYSDATE) - ${since} AND PSTD = 'Y'
               AND TRIM(CSHR_NO) IN (${inList})
             ORDER BY DOC_DATE DESC, DOC_NO DESC`,
            binds)).rows || [];
        out.headers = heads.length;
        for (const h of heads) {
            const doc = String(h.DOC_NO ?? '').trim();
            if (!doc) {continue;}
            const lines = (await exec(
                `SELECT ITM_NO, ITM_NAME, QNT, UNIT, SALE_PRICE, SALE_VAL, DISC_VAL,
                        VAT_RATE, VAT_AMNT, SHIFT_ID, SALER_ID
                 FROM CC_BILL_ENTER3 WHERE DOC_NO = :doc ORDER BY ESER, KEY`,
                { doc })).rows || [];
            const norm = (v) => (v == null ? null : String(v).trim());
            const items = lines.map((l) => ({
                code: norm(l.ITM_NO), name: norm(l.ITM_NAME), qty: NUM(l.QNT),
                unit: norm(l.UNIT), price: NUM(l.SALE_PRICE), total: NUM(l.SALE_VAL),
                discount: NUM(l.DISC_VAL), vat_rate: NUM(l.VAT_RATE), vat: NUM(l.VAT_AMNT),
                saler: l.SALER_ID != null ? String(l.SALER_ID).trim() : null,
            }));
            const vat = NUM(h.H_VAT) > 0 ? NUM(h.H_VAT)
                : Math.round(items.reduce((s, x) => s + x.vat, 0) * 100) / 100;
            const dd = h.DOC_DATE instanceof Date ? h.DOC_DATE.toISOString().slice(0, 10) : String(h.DOC_DATE || '').slice(0, 10);
            const saler = items.length && items[0].saler != null ? String(items[0].saler).trim() || null : null;
            // DOC_TIME مثل " 10:59:38 Am" → "HH:MM" بترتيب صحيح
            let hhmm = null;
            const tm = String(h.DOC_TIME || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])M?/i);
            if (tm) {
                let hh = Number(tm[1]) % 12;
                if (/P/i.test(tm[4])) {hh += 12;}
                hhmm = `${String(hh).padStart(2, '0')}:${tm[2]}`;
            }
            await pool.query(
                `INSERT INTO ys_mirror_orders
                    (doc_no, cashier_no, doc_date, doc_time, shift_no, net, total, discount, vat, payed, saler_id, lines,
                     pay_cash, pay_network, pay_credit, pay_mobile, table_name, zone_name, printed, synced_at)
                 VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,NOW())
                 ON CONFLICT (doc_no) DO UPDATE SET
                    cashier_no=EXCLUDED.cashier_no, doc_date=EXCLUDED.doc_date, doc_time=EXCLUDED.doc_time,
                    shift_no=EXCLUDED.shift_no, net=EXCLUDED.net, total=EXCLUDED.total,
                    discount=EXCLUDED.discount, vat=EXCLUDED.vat, payed=EXCLUDED.payed,
                    saler_id=EXCLUDED.saler_id, lines=EXCLUDED.lines,
                    pay_cash=EXCLUDED.pay_cash, pay_network=EXCLUDED.pay_network,
                    pay_credit=EXCLUDED.pay_credit, pay_mobile=EXCLUDED.pay_mobile,
                    table_name=EXCLUDED.table_name, zone_name=EXCLUDED.zone_name,
                    printed=EXCLUDED.printed, synced_at=NOW()`,
                [doc, String(h.CSHR || '').trim(), dd,
                    hhmm,
                    h.SHFT_NO != null ? Number(h.SHFT_NO) : null,
                    NUM(h.NET_VAL), NUM(h.TOTAL_VAL), NUM(h.DSCNT_VL), vat, NUM(h.PAYED),
                    saler,
                    JSON.stringify(items),
                    NUM(h.CASH_PYD), NUM(h.SPAN_PYD), NUM(h.CRDT_PYD), NUM(h.MBL_PYD),
                    h.TABLE_NM != null ? String(h.TABLE_NM).trim() || null : null,
                    h.ZONE_NM != null ? String(h.ZONE_NM).trim() || null : null,
                    h.PRNTD != null && String(h.PRNTD).trim() !== '' && String(h.PRNTD).trim() !== '0']);
            out.upserted++;
            out.cashiers[String(h.CSHR || '').trim()] = (out.cashiers[String(h.CSHR || '').trim()] || 0) + 1;
        }
        if (io && out.upserted > 0) {
            try { io.emit('yarasoft:mirror', { upserted: out.upserted, cashiers: out.cashiers, at: new Date().toISOString() }); } catch (_) {}
        }
        return out;
    } catch (e) {
        return { ok: false, error: String(e.message || e).slice(0, 300), ...out };
    }
    // ملاحظة: لا نغلق الاتصال — جلسة الحارس الدائمة ملك oracle-link
}

module.exports = { refreshMirrorOrders, MIRROR_CASHIERS, MIRROR_DAYS };

module.exports = { refreshMirrorOrders, MIRROR_CASHIERS, MIRROR_DAYS };
