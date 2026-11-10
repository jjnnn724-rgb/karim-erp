import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * بيانات Oracle المنسوخة — عرضٌ قرائي فقط من العقد القديم نفسه:
 *
 *   GET /api/oracle-data/tables
 *     { ok, tables:[{pg_name, oracle_name, oracle_rows, imported_at, live_count}] }
 *   GET /api/oracle-data/:table?page&limit&search
 *     { ok, table, columns[], rows[], total, page, limit, totalPages }
 *   GET /api/oracle-data/:table/columns
 *     { ok, table, columns:[{column_name,data_type}] }
 *
 * العقد مقروء من `backend/yarasoft/oracle-data-routes.js:23,47,63` و
 * `frontend/app/js/v2/data/oracle-repo.js:20,32` — لا حقول مخترعة.
 * `:table` يعيد `columns` نصية جاهزة، فلا حاجة لنداء `/columns` في العرض
 * (مُوثَّق هنا لأن العقد قائم؛ الشاشة لا تستدعيه).
 *
 * **المزامنة**: `POST /api/oracle-data/refresh` — نفس زرّ القديم
 * (`oracle-data.js`): يعيد عدّ كل جدول معلن ويحدّث `oracle_rows`/`imported_at`
 * فقط بلا مساس بالبيانات. أدواره admin/manager/accountant/auditor/hr،
 * وتعرضه شاشة admin/accountant. الاستجابة `{ok, refreshed, failed, total}`.
 * `live_count = -1` يعني أن الخادم فشل في عدّ الجدول — يُعرض «—» ولا يدخل في
 * أي مجموع (خلافًا لجمع القديم الأعمى).
 */

const nullableText = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

export const oracleTableSchema = z
    .object({
        pg_name: z.string(),
        oracle_name: nullableText,
        oracle_rows: numLike,
        imported_at: nullableText,
        live_count: numLike,
    })
    .passthrough();

export const oracleTablesResponseSchema = z
    .object({
        ok: z.boolean().optional(),
        tables: z.array(oracleTableSchema).optional(),
    })
    .passthrough();

const oracleRowSchema = z.record(z.string(), z.unknown());

export const oracleTableContentSchema = z
    .object({
        ok: z.boolean().optional(),
        table: nullableText,
        columns: z.array(z.string()).optional(),
        rows: z.array(oracleRowSchema).optional(),
        total: numLike,
        page: numLike,
        limit: numLike,
        totalPages: numLike,
    })
    .passthrough();

export const oracleRefreshSchema = z
    .object({
        ok: z.boolean().optional(),
        refreshed: numLike,
        failed: numLike,
        total: numLike,
    })
    .passthrough();

export type OracleTable = z.infer<typeof oracleTableSchema>;
export type OracleTablesResponse = z.infer<typeof oracleTablesResponseSchema>;
export type OracleTableContent = z.infer<typeof oracleTableContentSchema>;
export type OracleRefreshResponse = z.infer<typeof oracleRefreshSchema>;
export type OracleRow = z.infer<typeof oracleRowSchema>;

/** استجابة الجدول بعد تطبيع الأرقام — ما تستقبله الشاشة فعلًا. */
export interface OracleTablePage {
    table: string;
    columns: string[];
    rows: OracleRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export const ORACLE_PAGE_SIZE = 50;

/** الخادم يضيف `ora_` للمعامل من تلقاء نفسه — القديم يجرّده قبل النداء. */
export function shortTableName(pgName: string): string {
    return String(pgName ?? '').replace(/^ora_/, '');
}

/** عدّاد صفوف صالح للعرض؛ `null` يعني فشل العدّ في الخادم (-1). */
export function liveCountOf(table: OracleTable): number | null {
    const count = Number(table.live_count ?? 0);
    if (!Number.isFinite(count) || count < 0) {
        return null;
    }
    return count;
}

/** مجموع صفوف الجداول المعروفة فقط — الجداول غير المعدودة لا تُحسب صفرًا. */
export function knownRowsTotal(tables: readonly OracleTable[]): number {
    return tables.reduce((total, table) => total + (liveCountOf(table) ?? 0), 0);
}

/** عدد الجداول التي فشل الخادم في عدّها — مؤشر صدق لا يُخفى. */
export function unknownCountTables(tables: readonly OracleTable[]): number {
    return tables.filter((table) => liveCountOf(table) === null).length;
}

/** يعيد عدّ الجداول المعلنة من قواعدها ويحدّث الطوابع — لا كتابة في البيانات. */
export async function refreshOracleTables(): Promise<OracleRefreshResponse> {
    return fetchJson(oracleRefreshSchema, '/api/oracle-data/refresh', getAccessToken(), { method: 'POST' });
}

export async function fetchOracleTables(signal?: AbortSignal): Promise<OracleTablesResponse> {
    return fetchJson(
        oracleTablesResponseSchema,
        '/api/oracle-data/tables',
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export interface OracleTableQuery {
    page?: number;
    limit?: number;
    search?: string;
}

export async function fetchOracleTable(
    pgName: string,
    query: OracleTableQuery = {},
    signal?: AbortSignal,
): Promise<OracleTablePage> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? ORACLE_PAGE_SIZE)));
    const search = String(query.search ?? '').trim();
    const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
    });
    const body = await fetchJson(
        oracleTableContentSchema,
        `/api/oracle-data/${encodeURIComponent(shortTableName(pgName))}?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    const totalPages = Number(body.totalPages ?? 0);
    return {
        table: String(body.table ?? pgName),
        columns: body.columns ?? [],
        rows: body.rows ?? [],
        total: Number(body.total ?? 0) || 0,
        page: Number(body.page ?? page) || page,
        limit: Number(body.limit ?? limit) || limit,
        totalPages: Math.max(1, Number.isFinite(totalPages) ? totalPages : 0),
    };
}

/** خلية جدول Oracle: القيمة كما هي نصًّا؛ الغائب فراغ لا «null». */
export function cellText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}
