'use strict';
/**
 * عقود معاملة المستأجر — نقية (بلا قاعدة بيانات، بلا شبكة).
 */
const { runWithTenant, applyTenantToClient, UUID_RE } = require('../backend/saas/tenant-db');
const { AsyncLocalStorage: store, getTenantClient, getTenantId, updateTenantContext } =
    require('../backend/middleware/correlation');

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeClient() {
    return {
        calls: [],
        released: false,
        async query(sql, params) {
            this.calls.push({ sql, params });
            if (String(sql).includes('FAIL')) { throw new Error('boom'); }
            return { rows: [] };
        },
        release() { this.released = true; },
    };
}
function fakePool(client) {
    return { async connect() { return client; } };
}
function inRequest(fn, tenantId = T1) {
    return new Promise((resolve, reject) => {
        store.run({ requestId: 'req_test', tenantId: null, tenantClient: null }, () => {
            updateTenantContext({ id: tenantId, slug: 'main' });
            Promise.resolve().then(fn).then(resolve, reject);
        });
    });
}

describe('tenant-db / UUID_RE', () => {
    test('يقبل uuid صالح ويرفض الحقن', () => {
        expect(UUID_RE.test(T1)).toBe(true);
        expect(UUID_RE.test("x'; DROP TABLE users; --")).toBe(false);
        expect(UUID_RE.test('not-a-uuid')).toBe(false);
    });
});

describe('tenant-db / runWithTenant', () => {
    test('يرفض معرّفاً غير uuid قبل أي اتصال', async () => {
        const client = fakeClient();
        await expect(runWithTenant('bad', async () => 1, { pool: fakePool(client) }))
            .rejects.toMatchObject({ code: 'INVALID_TENANT_ID' });
        expect(client.calls).toHaveLength(0);
    });

    test('يرفض غياب الدالة', async () => {
        await expect(runWithTenant(T1, null, { pool: fakePool(fakeClient()) }))
            .rejects.toMatchObject({ code: 'TENANT_FN_REQUIRED' });
    });

    test('يضبط السياق بمعاملات ويُغلق المعاملة بنجاح', async () => {
        const client = fakeClient();
        let seenInside = null;
        const result = await inRequest(() => runWithTenant(T1, async () => {
            seenInside = { client: getTenantClient(), tenant: getTenantId() };
            return 42;
        }, { pool: fakePool(client) }));

        expect(result).toBe(42);
        expect(seenInside.client).toBe(client);
        expect(seenInside.tenant).toBe(T1);
        expect(client.calls[0].sql).toBe('BEGIN');
        expect(client.calls[1].sql).toBe('SELECT set_config($1, $2, true)');
        expect(client.calls[1].params).toEqual(['app.tenant_id', T1]);
        expect(client.calls[2].sql).toBe('COMMIT');
        expect(client.released).toBe(true);
        expect(getTenantClient()).toBeNull();
    });

    test('يتراجع ويُحرّر الاتصال عند خطأ', async () => {
        const client = fakeClient();
        await expect(inRequest(() => runWithTenant(T1, async () => {
            await client.query('SELECT FAIL');
        }, { pool: fakePool(client) }))).rejects.toThrow('boom');
        expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
        expect(client.calls).not.toContainEqual(expect.objectContaining({ sql: 'COMMIT' }));
        expect(client.released).toBe(true);
        expect(getTenantClient()).toBeNull();
    });

    test('applyTenantToClient يضبط GUC بمعاملات بلا بدء معاملة', async () => {
        const client = fakeClient();
        await applyTenantToClient(client, T1);
        expect(client.calls).toEqual([
            { sql: 'SELECT set_config($1, $2, true)', params: ['app.tenant_id', T1] },
        ]);
    });

    test('applyTenantToClient يرفض معرّفاً غير uuid', async () => {
        const client = fakeClient();
        await expect(applyTenantToClient(client, "x'); DROP TABLE users; --"))
            .rejects.toMatchObject({ code: 'INVALID_TENANT_ID' });
        expect(client.calls).toHaveLength(0);
    });

    test('يرفض التداخل', async () => {
        const client = fakeClient();
        await expect(inRequest(() => runWithTenant(T1, async () => {
            return runWithTenant(T1, async () => 1, { pool: fakePool(client) });
        }, { pool: fakePool(client) }))).rejects.toMatchObject({ code: 'NESTED_TENANT_TRANSACTION' });
        expect(client.released).toBe(true);
    });
});
