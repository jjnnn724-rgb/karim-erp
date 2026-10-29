/**
 * dispatch-list-projection.test.js — قوائم بلا صور تواقيع base64 (2026-10-29)
 * ══════════════════════════════════════════════════════════════════════════
 * القرار: صور التواقيع تُجلب من نقطة التفاصيل عند الطباعة فقط. قوائم الصرف
 * والجرد كانت تجلبها بـSELECT * ثم تحذفها (أو تشحنها بلا مستهلك). الآن
 * يُستثنى العمود في SQL نفسها عبر backend/heavy-columns.js، مع رجوع آمن إلى
 * `*` إن تعذّر قراءة الأعمدة — فلا تتغير أسماء الحقول في أي استجابة.
 */
'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../backend/shared-pool', () => ({ pool: { query: jest.fn() } }));

const ROOT = path.join(__dirname, '..');
const { pool } = require(path.join(ROOT, 'backend', 'shared-pool'));
const { listColumnsExcluding } = require(path.join(ROOT, 'backend', 'heavy-columns'));
const { buildPaginatedQuery } = require(path.join(ROOT, 'backend', 'pagination.js'));

const HEAVY = [
    'requestSignatureData', 'chefApprovalSignatureData', 'chefRejectionSignatureData',
    'warehouseApprovalSignatureData', 'warehouseRejectionSignatureData', 'kitchenReceiptSignatureData',
];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('listColumnsExcluding — إسقاط آمن ومخزَّن', () => {
    test('يستثني الأعمدة الثقيلة ويُخزِّن النتيجة لكل جدول', async () => {
        pool.query.mockResolvedValueOnce({ rows: [
            { column_name: 'id' }, { column_name: 'status' }, { column_name: 'count_signature_data' },
        ] });
        const first = await listColumnsExcluding('t_cache_ok', ['count_signature_data']);
        const second = await listColumnsExcluding('t_cache_ok', ['count_signature_data']);
        expect(first).toEqual(['id', 'status']);
        expect(second).toEqual(['id', 'status']);
        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('أسماء لا تطابق قاعدة المعرّف تُسقط قبل الحقن', async () => {
        pool.query.mockResolvedValueOnce({ rows: [
            { column_name: 'id' }, { column_name: 'x" FROM "users"; --' }, { column_name: '9bad' },
        ] });
        expect(await listColumnsExcluding('t_ident', [])).toEqual(['id']);
    });

    test('فشل القراءة يُرجع null (رجوع المستدعي إلى *) ولا يُخزَّن', async () => {
        pool.query.mockRejectedValueOnce(new Error('boom'));
        expect(await listColumnsExcluding('t_retry', [])).toBeNull();
        pool.query.mockResolvedValueOnce({ rows: [{ column_name: 'id' }] });
        expect(await listColumnsExcluding('t_retry', [])).toEqual(['id']);
    });

    test('جدول بلا أعمدة معروفة → null', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });
        expect(await listColumnsExcluding('t_missing', [])).toBeNull();
    });
});

describe('buildPaginatedQuery — إسقاط أعمدة القائمة', () => {
    test('selectColumns يصبح إسقاطًا مُقتبسًا بين SELECT وFROM', () => {
        const q = buildPaginatedQuery('dispatches', { page: 1, limit: 50, offset: 0, sort: 'id', order: 'DESC' }, {
            selectColumns: ['id', 'date', 'status'],
        });
        expect(q.dataQuery).toContain('SELECT "id", "date", "status" FROM "dispatches"');
        expect(q.dataQuery).toContain('ORDER BY "id" DESC');
        expect(q.dataQuery).not.toContain('SELECT *');
    });

    test('أسماء غير صالحة تُسقط؛ ولو لم يبقَ عمود صالح يعود SELECT *', () => {
        const q = buildPaginatedQuery('dispatches', { page: 1, limit: 50, offset: 0, sort: 'id', order: 'ASC' }, {
            selectColumns: ['id', 'x" FROM "users"; --', '9bad', ''],
        });
        expect(q.dataQuery).toContain('SELECT "id" FROM "dispatches"');
        const empty = buildPaginatedQuery('dispatches', { page: 1, limit: 50, offset: 0, sort: 'id', order: 'ASC' }, {
            selectColumns: ['DROP TABLE users', '1=1'],
        });
        expect(empty.dataQuery).toContain('SELECT * FROM "dispatches"');
    });

    test('COUNT لا يتأثر بالإسقاط وبارامتراته مستقلة', () => {
        const q = buildPaginatedQuery('dispatches', { page: 2, limit: 20, offset: 20, sort: 'id', order: 'ASC' }, {
            branchId: 3,
            selectColumns: ['id', 'status'],
        });
        expect(q.countQuery).toBe('SELECT COUNT(*) AS total FROM "dispatches" WHERE "branch_id" = $1');
        expect(q.countParams).toEqual([3]);
        expect(q.params).toEqual([3, 20, 20]);
        expect(q.dataQuery).toContain('SELECT "id", "status" FROM "dispatches" WHERE "branch_id" = $1');
    });
});

describe('backend/server.js — توصيل الإسقاط في مسار قائمة الصرف', () => {
    const src = () => read('backend/server.js');

    test('قائمة الأعمدة الثقيلة تطابق ما يُحذف بعد الجلب (ستة تواقيع)، والحذف باقٍ احتياطًا', () => {
        const s = src();
        const start = s.indexOf('const DISPATCH_SIGNATURE_COLUMNS = [');
        expect(start).toBeGreaterThan(-1);
        const list = s.slice(start, s.indexOf('];', start));
        for (const col of HEAVY) {expect(list).toContain(`'${col}'`);}
        const loopStart = s.indexOf("if (entity === 'dispatches') {", s.indexOf('const listRows = '));
        expect(loopStart).toBeGreaterThan(-1);
        const loop = s.slice(loopStart, s.indexOf('return res.json', loopStart));
        for (const col of HEAVY) {expect(loop).toContain(`delete r.${col};`);}
    });

    test('المسار يمرر selectColumns قبل بناء الاستعلام', () => {
        const s = src();
        const route = s.indexOf('// GET all (authenticated');
        expect(route).toBeGreaterThan(-1);
        const body = s.slice(route, s.indexOf('// GET by id', route));
        const wire = body.indexOf("if (entity === 'dispatches') {");
        const build = body.indexOf('buildPaginatedQuery(entity, pagination, queryOptions)');
        expect(wire).toBeGreaterThan(-1);
        expect(build).toBeGreaterThan(wire);
        const block = body.slice(wire, build);
        expect(block).toContain('await dispatchListColumns()');
        expect(block).toContain('queryOptions.selectColumns = listColumns;');
    });

    test('المُحلِّل مشترك: listColumnsExcluding على جدول dispatches', () => {
        expect(src()).toMatch(/const dispatchListColumns = \(\) => listColumnsExcluding\('dispatches', DISPATCH_SIGNATURE_COLUMNS\);/);
        expect(src()).toMatch(/const \{ listColumnsExcluding \} = require\('\.\/heavy-columns'\);/);
    });
});
