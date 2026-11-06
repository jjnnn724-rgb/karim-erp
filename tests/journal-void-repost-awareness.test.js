/**
 * journal-void-repost-awareness.test.js — وعي الإبطال في postJournal
 * ────────────────────────────────────────────────────────────────────────
 * القاعدة (2026-11-06):
 *   • افتراضيًا (كل المُرحِّلات الآلية): سطر status='void' = «المرجع محجوز» ⇒
 *     replay، فلا يُنقض قرار إبطال بشري بترحيل تلقائي.
 *   • repostVoided=true (المسار البشري POST /journal وحده): المُبطل خارج الأستاذ
 *     العام فلا يُعد موجودًا، والتكرار المستحيل بـ uq_journal_source يُحلّ بمرجع
 *     مراجعة `#rN` — مع قيد مرحّل واحد فقط للمصدر.
 *   • إن كان في العائلة سطر حيّ أصلًا ⇒ replay له، ولا ثالث نسخة.
 *
 * الادّعاءات هنا سلوكية على SQL حقيقي (موجّه لمسبح في الذاكرة)، لا نصية:
 * البوابة النصية في tests/dispatch-financial-guards.test.js.
 */
'use strict';

jest.mock('../backend/accounting-periods', () => ({
    assertPeriodOpen: async () => {},
    assertPeriodOpenInTx: async () => {},
    isPeriodClosed: async () => false,
}));

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/shared-pool', () => {
    const noop = async () => ({ rows: [] });
    return {
        __esModule: true,
        pool: { query: noop, connect: async () => ({ query: noop, release: () => {} }), end: async () => {} },
        safeQuery: noop,
        reinitPool: async () => {},
    };
});

const { postJournal } = require('../backend/accounting-routes');

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
let idSeq = 5000;

/** مسبح في الذاكرة يفهم العبارات التي يرميها postJournal فعلًا. */
function makeStore(entries) {
    const store = { entries: entries.map((e) => ({ id: ++idSeq, entry_no: `JE-X-${e.n}`, created_at: new Date('2026-11-01T08:00:00Z'), ...e })), lines: [], calls: [] };
    const byId = (id) => store.entries.find((e) => String(e.id) === String(id));
    const db = {
        release: () => {},
        query: async (rawSql, params = []) => {
            const sql = norm(rawSql);
            store.calls.push({ sql, params });
            if (/chart_of_accounts/.test(sql)) {return { rows: params[0].map((code) => ({ code })) };}
            if (/FROM cost_centers/.test(sql)) {return { rows: [{ code: 'CC' }] };}
            if (/source_type = 'manual' AND source_id LIKE 'manual:%'/.test(sql)) {
                const liveOnly = /status <> 'void'/.test(sql);
                return { rows: store.entries
                    .filter((e) => e.source_type === 'manual' && String(e.source_id).startsWith('manual:'))
                    .filter((e) => !liveOnly || e.status !== 'void')
                    .filter((e) => String(e.created_by) === String(params[0]) && e.date === params[1])
                    .map((e) => ({ id: e.id, memo: e.memo })) };
            }
            if (/FROM journal_lines WHERE entry_id = \$1/.test(sql)) {
                return { rows: store.lines.filter((l) => String(l.entry_id) === String(params[0])) };
            }
            if (/^INSERT INTO journal_lines/.test(sql)) {
                store.lines.push({ id: params[0], entry_id: params[1], account_code: params[2], debit: params[3], credit: params[4], memo: params[5] });
                return { rows: [] };
            }
            if (/^INSERT INTO journal_entries/.test(sql)) {
                const row = { id: params[0], entry_no: params[1], date: params[2], memo: params[3], source_type: params[4], source_id: params[5], created_by: params[6], status: params[7] };
                store.entries.push(row);
                return { rows: [row] };
            }
            if (/COALESCE\(MAX\(CAST\(SUBSTRING\(entry_no/.test(sql)) {return { rows: [{ m: store.entries.length }] };}
            if (/SELECT 1 FROM journal_entries WHERE entry_no = \$1/.test(sql)) {return { rows: [] };}
            if (/SELECT \* FROM journal_entries WHERE id = \$1/.test(sql)) {return { rows: [byId(params[0])].filter(Boolean) };}
            if (/source_id LIKE \$2 \|\| '#r%' AND status <> 'void'/.test(sql)) {
                const [st, base] = params;
                return { rows: store.entries.filter((e) => e.source_type === st && String(e.source_id).startsWith(`${base}#r`) && e.status !== 'void') };
            }
            if (/^SELECT source_id FROM journal_entries/.test(sql)) {
                const [st, base] = params;
                return { rows: store.entries.filter((e) => e.source_type === st && (e.source_id === base || String(e.source_id).startsWith(`${base}#r`))).map((e) => ({ source_id: e.source_id })) };
            }
            if (/WHERE source_type = \$1 AND source_id = \$2 AND status = 'void' LIMIT 1/.test(sql)) {
                const [st, ref] = params;
                return { rows: store.entries.filter((e) => e.source_type === st && e.source_id === ref && e.status === 'void').map(() => ({ '?column?': 1 })) };
            }
            if (/WHERE source_type = \$1 AND source_id = \$2 AND status <> 'void' LIMIT 1/.test(sql)) {
                const [st, ref] = params;
                return { rows: store.entries.filter((e) => e.source_type === st && e.source_id === ref && e.status !== 'void') };
            }
            if (/WHERE source_type = \$1 AND source_id = \$2 LIMIT 1/.test(sql)) {
                const [st, ref] = params;
                return { rows: store.entries.filter((e) => e.source_type === st && e.source_id === ref) };
            }
            throw new Error(`SQL غير معروف في المسبح الوهمي: ${sql.slice(0, 140)}`);
        },
    };
    return { db, store };
}

const LINES = [{ account_code: '1000', debit: 100, credit: 0 }, { account_code: '6900', debit: 0, credit: 100 }];
const post = (db, extra = {}) => postJournal(db, { date: '2026-11-06', memo: 'اختبار', source_type: 'dispatch', source_id: '412', lines: LINES, created_by: 7, ...extra });
const inserts = (store) => store.calls.filter((c) => /^INSERT INTO journal_entries/.test(c.sql));

describe('postJournal ووعي الإبطال', () => {
    it('افتراضيًا: المرجع المحجوز بقيد مُبطَل = موجود ⇒ replay بلا أي كتابة', async () => {
        const { db, store } = makeStore([{ n: 1, source_type: 'dispatch', source_id: '412', status: 'void' }]);
        const out = await post(db);
        expect(out.replay).toBe(true);
        expect(out.entry.status).toBe('void');
        expect(inserts(store)).toHaveLength(0);
    });

    it('repostVoided: المرجع محجوز بمُبطَل وحده ⇒ قيد جديد بمرجع 412#r2', async () => {
        const { db, store } = makeStore([{ n: 1, source_type: 'dispatch', source_id: '412', status: 'void' }]);
        const out = await post(db, { repostVoided: true });
        expect(out.replay).toBe(false);
        expect(out.entry.source_id).toBe('412#r2');
        expect(out.entry.status).toBe('posted');
        expect(inserts(store)).toHaveLength(1);
        // المُبطَل الأصلي لم يُمسّ: الأستاذ لا يزال فيه قيد مرحّل واحد لهذا المصدر
        const live = store.entries.filter((e) => String(e.source_id).startsWith('412') && e.status === 'posted');
        expect(live).toHaveLength(1);
        expect(store.entries.find((e) => e.source_id === '412').status).toBe('void');
    });

    it('repostVoided: العائلة فيها مرحّل فعاد replay له — لا نسخة ثالثة', async () => {
        const { db, store } = makeStore([
            { n: 1, source_type: 'dispatch', source_id: '412', status: 'void' },
            { n: 2, source_type: 'dispatch', source_id: '412#r2', status: 'posted' },
        ]);
        const out = await post(db, { repostVoided: true });
        expect(out.replay).toBe(true);
        expect(out.entry.source_id).toBe('412#r2');
        expect(inserts(store)).toHaveLength(0);
    });

    it('repostVoided: لا سطر إطلاقًا ⇒ المرجع الأصلي بلا لاحقة، ولا مسح العائلة', async () => {
        const { db, store } = makeStore([]);
        const out = await post(db, { repostVoided: true });
        expect(out.replay).toBe(false);
        expect(out.entry.source_id).toBe('412');
        expect(store.calls.filter((c) => /'#r%'/.test(c.sql))).toHaveLength(0);
    });

    it('repostVoided: مراجعات متعددة تأخذ اللاحقة التالية (412#r3)', async () => {
        const { db, store } = makeStore([
            { n: 1, source_type: 'dispatch', source_id: '412', status: 'void' },
            { n: 2, source_type: 'dispatch', source_id: '412#r2', status: 'void' },
        ]);
        const out = await post(db, { repostVoided: true });
        expect(out.entry.source_id).toBe('412#r3');
        expect(store.entries.filter((e) => e.status === 'posted')).toHaveLength(1);
    });

    it('يدوي بلا مرجع: البصمة تتخطى المُبطل عند repostVoided فقط', async () => {
        const seeded = [{ n: 1, source_type: 'manual', source_id: 'manual:1:2', status: 'void', created_by: 7, date: '2026-11-06', memo: 'اختبار' }];
        const a = makeStore(seeded);
        a.store.lines.push({ entry_id: a.store.entries[0].id, account_code: '1000', debit: 100, credit: 0 },
            { entry_id: a.store.entries[0].id, account_code: '6900', debit: 0, credit: 100 });
        const outA = await postJournal(a.db, { date: '2026-11-06', memo: 'اختبار', source_type: 'manual', source_id: null, lines: LINES, created_by: 7, repostVoided: true });
        expect(outA.replay).toBe(false);
        expect(inserts(a.store)).toHaveLength(1);

        const b = makeStore(seeded.map((e) => ({ ...e })));
        b.store.lines.push({ entry_id: b.store.entries[0].id, account_code: '1000', debit: 100, credit: 0 },
            { entry_id: b.store.entries[0].id, account_code: '6900', debit: 0, credit: 100 });
        const outB = await postJournal(b.db, { date: '2026-11-06', memo: 'اختبار', source_type: 'manual', source_id: null, lines: LINES, created_by: 7 });
        expect(outB.replay).toBe(true);
        expect(inserts(b.store)).toHaveLength(0);
    });

    it('سباق 23505 مع repostVoided: يُرجع الراحل حيًّا ولا يكسر العملية', async () => {
        const { db, store } = makeStore([]);
        const real = db.query;
        let armed = false;
        db.query = async (sql, params) => {
            const s = norm(sql);
            if (/^INSERT INTO journal_entries/.test(s) && !armed) {
                armed = true;
                store.entries.push({ id: 999, entry_no: 'JE-RACE', source_type: 'dispatch', source_id: '412', status: 'posted' });
                const err = new Error('duplicate key value violates unique constraint "uq_journal_source"');
                err.code = '23505';
                throw err;
            }
            return real(sql, params);
        };
        const out = await post(db, { repostVoided: true });
        expect(out.replay).toBe(true);
        expect(out.entry.source_id).toBe('412');
    });
});
