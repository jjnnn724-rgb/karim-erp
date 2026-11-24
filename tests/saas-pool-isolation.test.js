'use strict';
/**
 * عزل pool.query في وضع SaaS — اختبارات نقية بـpg وهمي (بلا قاعدة وبلا خادم).
 * يثبت أن الاستعلام في سياق مستأجر يُغلَّف بمعاملة تحمل app.tenant_id، وأن
 * المسار الافتراضي (SaaS مطفأ) لم يتغيّر.
 */
const mockCalls = [];
const mockClient = {
  query: jest.fn(async (sql, params) => {
    mockCalls.push({ via: 'client', sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    if (/BOOM/.test(String(sql))) {
      throw new Error('boom');
    }
    return { rows: [{ ok: 1 }] };
  }),
  release: jest.fn(),
};
const mockPool = {
  query: jest.fn(async (sql) => {
    mockCalls.push({ via: 'pool', sql: String(sql).replace(/\s+/g, ' ').trim() });
    return { rows: [] };
  }),
  connect: jest.fn(async () => mockClient),
  on: jest.fn(),
  end: jest.fn(),
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
};

jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool), Client: jest.fn() }));

const { pool } = require('../backend/shared-pool');
const { AsyncLocalStorage, updateTenantContext, setTenantClient } = require('../backend/middleware/correlation');

const TENANT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mockCalls.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.query.mockClear();
  mockPool.connect.mockClear();
});

describe('SaaS / عزل pool.query', () => {
  test('بلا سياق مستأجر: المسار القديم حرفياً', async () => {
    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [] });
    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  test('في سياق مستأجر: معاملة قصيرة بـapp.tenant_id ثم COMMIT', async () => {
    await AsyncLocalStorage.run({}, async () => {
      updateTenantContext({ id: TENANT, slug: 'shorfa' });
      await pool.query('SELECT * FROM orders');
    });
    const sqls = mockCalls.map((c) => c.sql);
    expect(sqls[0]).toMatch(/^BEGIN$/);
    expect(sqls[1]).toMatch(/set_config\(\$1,\$2,true\)/i);
    expect(mockCalls[1].params).toEqual(['app.tenant_id', TENANT]);
    expect(sqls[2]).toBe('SELECT * FROM orders');
    expect(sqls[3]).toMatch(/^COMMIT$/);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('عند فشل الاستعلام: ROLLBACK ولا تسريب اتصال', async () => {
    await expect(AsyncLocalStorage.run({}, async () => {
      updateTenantContext({ id: TENANT, slug: 'shorfa' });
      return pool.query('SELECT BOOM');
    })).rejects.toThrow('boom');
    const sqls = mockCalls.map((c) => c.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('داخل معاملة مستأجر محجوزة: يُعاد توجيه الاستعلام للعميل نفسه', async () => {
    await AsyncLocalStorage.run({}, async () => {
      updateTenantContext({ id: TENANT, slug: 'shorfa' });
      const fakeScoped = { query: jest.fn(async () => ({ rows: ['scoped'] })) };
      setTenantClient(fakeScoped);
      const result = await pool.query('SELECT 1');
      expect(result.rows).toEqual(['scoped']);
      expect(fakeScoped.query).toHaveBeenCalledWith('SELECT 1');
      expect(mockPool.connect).not.toHaveBeenCalled();
      setTenantClient(null);
    });
  });
});
