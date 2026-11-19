import { createRequire } from 'node:module';
import { test } from '@playwright/test';

/**
 * بذر إذن صرف معلّق لاختبارات النوافذ الحية — على قاعدة الاختبار المعزولة فقط
 * (E2E_DB_* تُمرَّر من مشغّل خادم التحقق؛ بلا هذه المتغيرات تُتخطّى الاختبارات
 * المعتمدة على البذر صراحةً بدل فشل غامض). الصف موسوم zz-e2e ويُحذف بعد كل اختبار.
 */
const require = createRequire(import.meta.url);
const DB = {
    host: process.env.E2E_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.E2E_DB_PORT ?? 5432),
    user: process.env.E2E_DB_USER ?? '',
    password: process.env.E2E_DB_PASS ?? '',
    database: process.env.E2E_DB_NAME ?? '',
};
export const HAS_SEED_DB = Boolean(DB.user && DB.database);
export const SKIP_NO_SEED = 'يتطلب E2E_DB_* لبذر إذن الصرف (قاعدة الاختبار المعزولة)';
export const SEED_DISPATCH_ID = '999900101'; // bigint — معرف رقمي موسوم لنطاق الاختبار

// pg من جذر المستودع (لا تبعية جديدة في v3).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pg: any = null;
function loadPg(): any {
    if (!pg) { pg = require('../../../../../node_modules/pg'); }
    return pg;
}

export async function seedPendingDispatch(): Promise<void> {
    const { Client } = loadPg();
    const c = new Client({ ...DB, connectionTimeoutMillis: 5000 });
    await c.connect();
    try {
        // قسم موجود فعلًا (FK dispatches_deptCode_fkey) — أول قسم في القاعدة.
        const dept = (await c.query('SELECT code, name FROM departments ORDER BY code LIMIT 1')).rows[0];
        if (!dept) { throw new Error('لا أقسام في قاعدة الاختبار — لا يمكن بذر إذن صرف'); }
        await c.query(
            `INSERT INTO dispatches (id, "deptCode", "deptName", items, status, date, "createdBy", "needsChefApproval", "creatorRole", "requestedAt")
             VALUES ($1, $2, $3, $4::jsonb, 'pending', CURRENT_DATE, 'e2e-verifier', false, 'admin', now())
             ON CONFLICT (id) DO UPDATE SET status = 'pending', "needsChefApproval" = false,
               "approvedDate" = NULL, "approvedBy" = NULL, "rejectedDate" = NULL, "closedAt" = NULL`,
            [SEED_DISPATCH_ID, dept.code, dept.name, JSON.stringify([{ name: 'صنف تحقق حي', qty: 2, unit: 'حبة' }])],
        );
    } finally { await c.end(); }
}

export async function removeSeedDispatch(): Promise<void> {
    if (!HAS_SEED_DB) { return; }
    const { Client } = loadPg();
    const c = new Client({ ...DB, connectionTimeoutMillis: 5000 });
    await c.connect();
    try { await c.query('DELETE FROM dispatches WHERE id = $1', [SEED_DISPATCH_ID]); }
    finally { await c.end(); }
}

/** تسجيل البذر/التنظيف على وصف اختبار قائم. */
export function useSeedDispatch(): void {
    test.beforeEach(async () => { await seedPendingDispatch(); });
    test.afterEach(async () => { await removeSeedDispatch(); });
}
