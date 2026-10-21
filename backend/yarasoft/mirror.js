/**
 * yarasoft/mirror.js — Cashier mirror: Yarasoft POS orders mirrored into karim.
 * ────────────────────────────────────────────────────────────────────────────
 * Read-only from Oracle (CC_BILLS3 headers + CC_BILL_ENTER3 lines), upsert by
 * DOC_NO (idempotent — re-poll absorbs corrections, never duplicates).
 * Scope: cashiers 1/3/4/5/6/9 (cashier 2 excluded everywhere, same as reports).
 * Latency = Oracle poll cycle (default 1 min). Payment *method* unknown —
 * PAYED stores the paid amount; change = total - payed.
 */
'use strict';

const { pool } = require('../shared-pool');

const MIRROR_CASHIERS = ['1', '3', '4', '5', '6', '9'];
const MIRROR_DAYS = 2; // today + yesterday (late-night spillover)

const NUM = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

async function refreshMirrorOrders({ days = MIRROR_DAYS, cashiers = MIRROR_CASHIERS, io = null } = {}) {
    const out = { ok: true, headers: 0, upserted: 0, cashiers: {}, newDocs: [] };
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
        // بلاغ المالك 2026-10-06: نغمة «أوردر جديد» عند الكاشير — upsert يعيد كل شيء
        // كل دورة، فنميّز المُدرج جديدًا فعلًا: أي مستندات معروفة قبل الحلقة؟
        const allDocs = heads.map((h) => String(h.DOC_NO ?? '').trim()).filter(Boolean);
        const knownDocs = new Set(allDocs.length ? (await pool.query(
            `SELECT doc_no FROM ys_mirror_orders WHERE doc_no = ANY($1::text[])`, [allDocs])).rows.map((r) => String(r.doc_no)) : []);
        // (2026-10) دفعات بدل N+1: كانت الحلقة تنفّذ ~2,321 استعلام أسطر فرديًا على
        // Oracle و~2,321 upsert فرديًا على PG (~67ث/دورة مقيسة). الآن استعلام واحد
        // لكل 200 وثيقة (~12) وإدراج متعدد الصفوف لكل 200 (~12) — نفس المحتوى بالحرف.
        const CHUNK = 200;
        const norm = (v) => (v == null ? null : String(v).trim());
        const linesByDoc = new Map();
        for (let ci = 0; ci < allDocs.length; ci += CHUNK) {
            const chunk = allDocs.slice(ci, ci + CHUNK);
            const ph = chunk.map((_, j) => `:d${j}`).join(',');
            const b = {};
            chunk.forEach((d, j) => { b[`d${j}`] = d; });
            const lrows = (await exec(
                `SELECT DOC_NO, ITM_NO, ITM_NAME, QNT, UNIT, SALE_PRICE, SALE_VAL, DISC_VAL,
                        VAT_RATE, VAT_AMNT, SHIFT_ID, SALER_ID
                 FROM CC_BILL_ENTER3 WHERE DOC_NO IN (${ph}) ORDER BY DOC_NO, ESER, KEY`,
                b)).rows || [];
            for (const l of lrows) {
                const k = norm(l.DOC_NO);
                if (!k) {continue;}
                if (!linesByDoc.has(k)) {linesByDoc.set(k, []);}
                linesByDoc.get(k).push(l);
            }
        }
        const rowsToWrite = [];
        for (const h of heads) {
            const doc = String(h.DOC_NO ?? '').trim();
            if (!doc) {continue;}
            const lines = linesByDoc.get(doc) || [];
            const items = lines.map((l) => ({
                code: norm(l.ITM_NO), name: norm(l.ITM_NAME), qty: NUM(l.QNT),
                unit: norm(l.UNIT), price: NUM(l.SALE_PRICE), total: NUM(l.SALE_VAL),
                discount: NUM(l.DISC_VAL), vat_rate: NUM(l.VAT_RATE), vat: NUM(l.VAT_AMNT),
                saler: l.SALER_ID != null ? String(l.SALER_ID).trim() : null,
            }));
            const vat = NUM(h.H_VAT) > 0 ? NUM(h.H_VAT)
                : Math.round(items.reduce((s, x) => s + x.vat, 0) * 100) / 100;
            // FIX 2026-10-03: toISOString كان بيرجع اليوم يومًا (UTC) — فواتير
            // الجمعة كانت بتتخزن كخميس. الآن نستخرج مكوّنات التاريخ بتوقيت السيرفر.
            const dd = (() => {
                const d = h.DOC_DATE instanceof Date ? h.DOC_DATE : new Date(h.DOC_DATE);
                if (Number.isNaN(d.getTime())) {return String(h.DOC_DATE || '').slice(0, 10);}
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })();
            const saler = items.length && items[0].saler != null ? String(items[0].saler).trim() || null : null;
            // DOC_TIME مثل " 10:59:38 Am" → "HH:MM" بترتيب صحيح
            let hhmm = null;
            const tm = String(h.DOC_TIME || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])M?/i);
            if (tm) {
                let hh = Number(tm[1]) % 12;
                if (/P/i.test(tm[4])) {hh += 12;}
                hhmm = `${String(hh).padStart(2, '0')}:${tm[2]}`;
            }
            const cshr = String(h.CSHR || '').trim();
            rowsToWrite.push({
                doc, cshr,
                vals: [doc, cshr, dd,
                    hhmm,
                    h.SHFT_NO != null ? Number(h.SHFT_NO) : null,
                    NUM(h.NET_VAL), NUM(h.TOTAL_VAL), NUM(h.DSCNT_VL), vat, NUM(h.PAYED),
                    saler,
                    JSON.stringify(items),
                    NUM(h.CASH_PYD), NUM(h.SPAN_PYD), NUM(h.CRDT_PYD), NUM(h.MBL_PYD),
                    h.TABLE_NM != null ? String(h.TABLE_NM).trim() || null : null,
                    h.ZONE_NM != null ? String(h.ZONE_NM).trim() || null : null,
                    h.PRNTD != null && String(h.PRNTD).trim() !== '' && String(h.PRNTD).trim() !== '0'],
                isNew: !knownDocs.has(doc),
                total: NUM(h.TOTAL_VAL),
                table: h.TABLE_NM != null ? String(h.TABLE_NM).trim() || null : null,
            });
        }
        for (let ci = 0; ci < rowsToWrite.length; ci += CHUNK) {
            const chunk = rowsToWrite.slice(ci, ci + CHUNK);
            const params = [];
            const tuples = chunk.map((rw, r) => {
                const o = r * rw.vals.length + 1;
                const phs = rw.vals.map((_, k) => `$${o + k}`);
                phs[2] = phs[2] + '::date';
                phs[11] = phs[11] + '::jsonb';
                params.push(...rw.vals);
                return `(${phs.join(',')},NOW())`;
            }).join(',');
            await pool.query(
                `INSERT INTO ys_mirror_orders
                    (doc_no, cashier_no, doc_date, doc_time, shift_no, net, total, discount, vat, payed, saler_id, lines,
                     pay_cash, pay_network, pay_credit, pay_mobile, table_name, zone_name, printed, synced_at)
                 VALUES ${tuples}
                 ON CONFLICT (doc_no) DO UPDATE SET
                    cashier_no=EXCLUDED.cashier_no, doc_date=EXCLUDED.doc_date, doc_time=EXCLUDED.doc_time,
                    shift_no=EXCLUDED.shift_no, net=EXCLUDED.net, total=EXCLUDED.total,
                    discount=EXCLUDED.discount, vat=EXCLUDED.vat, payed=EXCLUDED.payed,
                    saler_id=EXCLUDED.saler_id, lines=EXCLUDED.lines,
                    pay_cash=EXCLUDED.pay_cash, pay_network=EXCLUDED.pay_network,
                    pay_credit=EXCLUDED.pay_credit, pay_mobile=EXCLUDED.pay_mobile,
                    table_name=EXCLUDED.table_name, zone_name=EXCLUDED.zone_name,
                    printed=EXCLUDED.printed, synced_at=NOW()`, params);
            for (const rw of chunk) {
                out.upserted++;
                out.cashiers[rw.cshr] = (out.cashiers[rw.cshr] || 0) + 1;
                if (rw.isNew) {
                    out.newDocs.push({ doc: rw.doc, cashier: rw.cshr, total: rw.total, table: rw.table });
                }
            }
        }
        if (io && out.upserted > 0) {
            try { io.emit('yarasoft:mirror', { upserted: out.upserted, cashiers: out.cashiers, at: new Date().toISOString() }); } catch (_) {}
        }
        // أوردر جديد من الزائر → حدث فوري تسمعه نغمة الكاشير (realtime.js)
        if (io && out.newDocs.length > 0) {
            try { io.emit('yarasoft:new-orders', { count: out.newDocs.length, orders: out.newDocs.slice(0, 10), at: new Date().toISOString() }); } catch (_) {}
        }
        return out;
    } catch (e) {
        return { ok: false, error: String(e.message || e).slice(0, 300), ...out };
    }
    // ملاحظة: لا نغلق الاتصال — جلسة الحارس الدائمة ملك oracle-link
}

module.exports = { refreshMirrorOrders, MIRROR_CASHIERS, MIRROR_DAYS };

module.exports = { refreshMirrorOrders, MIRROR_CASHIERS, MIRROR_DAYS };
