import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { fetchInventoryRegister } from './inventory-register';
import { isWriteRole, writeJson } from './write';

/**
 * تكامل قاعدة الكاشير (Yarasoft) — نقل حرفي لعقود
 * `frontend/app/js/v2/data/yarasoft-repo.js` إلى V3، والأدوار نفسها:
 * `admin|manager` يكتبان، والخادم (`backend/yarasoft/routes.js`) هو الفاصل.
 *
 * كل المسارات تحت `/api/yarasoft` (server.js:784). القراءات متسامحة لأن
 * الخادم يعيد الأرقام نصًّا أو رقمًا حسب العمود، والكتابات تُتحقَّق بـZod
 * قبل الخروج — أي شكل غير متوقع يُسقط الطلب بدل تمريره صامتًا.
 */

export const YARASOFT_WRITE_ROLES = Object.freeze(['admin', 'manager']);

export function canWriteYarasoft(role: string | null | undefined): boolean {
    return isWriteRole(role, YARASOFT_WRITE_ROLES);
}

const numLike = z.union([z.string(), z.number()]).nullable().optional();
const textLike = z.string().nullable().optional();
const idLike = z.union([z.string(), z.number()]);

export const YS_TEXT = Object.freeze({
    ran: 'تم تشغيل دورة الفحص؛ راجع سجل الاستيراد.',
    reprocessed: 'أُعيد فتح الفاتورة للمعالجة.',
    sectionApproved: 'تم اعتماد القسم.',
    sectionRenamed: 'تم تحديث اسم القسم والإيرادات المرتبطة به.',
    sectionCreated: 'أُنشئ القسم.',
    reclassified: 'نُقلت الفواتير المحددة.',
    mappingSaved: 'تم حفظ الربط الصريح.',
    mappingDeactivated: 'تم تعطيل الربط.',
    reviewResolved: 'تم حفظ ربط الصنف وإعادة تقييم الفاتورة.',
    oracleTested: 'نجح فحص الاتصال.',
    oraclePolled: 'اكتمل السحب الفوري.',
    itemsPreviewed: 'اكتملت المعاينة بلا كتابة للمخزون.',
    itemsImported: 'تم استيراد الأصناف الجديدة.',
    reconciled: 'اكتملت المقارنة.',
    catchUpStarted: 'بدأت مهمة اللحاق في الخلفية.',
    catchUpRunning: 'توجد مهمة لحاق تعمل بالفعل.',
    organized: 'تم تنظيم الأقسام.',
    balancesSynced: 'تمت مزامنة الأرصدة.',
    previewed: 'اكتمل التحليل دون أي كتابة.',
    mirrorRefreshed: 'اكتمل تحديث المرآة.',
});

/* ─── الحالة والسجل ─────────────────────────────────────────────────────── */

export const yarasoftStatusSchema = z
    .object({
        engine: z
            .object({
                enabled: z.boolean().optional(),
                running: z.boolean().optional(),
                lastError: textLike,
            })
            .passthrough()
            .optional(),
        logCounts: z
            .object({
                completed: numLike,
                failed: numLike,
                duplicates: numLike,
                review: numLike,
                needs_mapping: numLike,
                dry_runs: numLike,
                pending: numLike,
            })
            .passthrough()
            .optional(),
        openReviewItems: numLike,
        openSections: numLike,
    })
    .passthrough();

export const yarasoftLogRowSchema = z
    .object({
        id: idLike,
        source_file: textLike,
        external_invoice_number: textLike,
        status: textLike,
        stage: textLike,
        items_count: numLike,
        total_amount: numLike,
        retry_count: numLike,
        error_message: textLike,
        created_at: textLike,
        processed_at: textLike,
    })
    .passthrough();

export const yarasoftLogResponseSchema = z.array(yarasoftLogRowSchema);

const invoiceItemSchema = z
    .object({
        name: textLike,
        externalCode: textLike,
        quantity: numLike,
        total: numLike,
    })
    .passthrough();

export const yarasoftInvoiceDetailSchema = z
    .object({
        id: idLike.optional(),
        external_invoice_number: textLike,
        status: textLike,
        items_count: numLike,
        total_amount: numLike,
        payload: z.unknown().optional(),
        created_at: textLike,
        processed_at: textLike,
    })
    .passthrough();

export type YarasoftStatus = z.infer<typeof yarasoftStatusSchema>;
export type YarasoftLogRow = z.infer<typeof yarasoftLogRowSchema>;
export type YarasoftInvoiceDetail = z.infer<typeof yarasoftInvoiceDetailSchema>;

/** بنود الفاتورة من `payload.items` بعد تطبيع الشكل — `[]` لأي شكل آخر. */
export function invoicePayloadItems(detail: YarasoftInvoiceDetail | null | undefined): z.infer<typeof invoiceItemSchema>[] {
    if (!detail || typeof detail.payload !== 'object' || detail.payload === null) {
        return [];
    }
    const items = (detail.payload as { items?: unknown }).items;
    if (!Array.isArray(items)) {
        return [];
    }
    return items
        .map((item) => invoiceItemSchema.safeParse(item))
        .filter((parsed): parsed is { success: true; data: z.infer<typeof invoiceItemSchema> } => parsed.success)
        .map((parsed) => parsed.data);
}

/* ─── المراجعة ─────────────────────────────────────────────────────────── */

export const yarasoftReviewItemSchema = z
    .object({
        id: idLike,
        import_id: numLike,
        external_invoice_number: textLike,
        external_item_code: textLike,
        external_barcode: textLike,
        item_name: textLike,
        quantity: numLike,
        reason: textLike,
    })
    .passthrough();

export const yarasoftReviewResponseSchema = z.array(yarasoftReviewItemSchema);
export type YarasoftReviewItem = z.infer<typeof yarasoftReviewItemSchema>;

/* ─── روابط المنتجات ────────────────────────────────────────────────────── */

export const yarasoftMappingSchema = z
    .object({
        id: idLike,
        external_code: textLike,
        external_barcode: textLike,
        internal_product_id: numLike,
        product_name: textLike,
        product_barcode: textLike,
        active: z.boolean().optional(),
    })
    .passthrough();

export const yarasoftMappingsResponseSchema = z.array(yarasoftMappingSchema);
export type YarasoftMapping = z.infer<typeof yarasoftMappingSchema>;

/* ─── أقسام الإيراد ─────────────────────────────────────────────────────── */

export const yarasoftSectionMapRowSchema = z
    .object({
        id: idLike,
        src_table: textLike,
        src_name: textLike,
        display_ar: textLike,
        display_en: textLike,
        dept_code: textLike,
        active: z.boolean().optional(),
        posted_count: numLike,
        posted_total: numLike,
        posted_expenses: numLike,
    })
    .passthrough();

export const yarasoftSectionMapResponseSchema = z.array(yarasoftSectionMapRowSchema);

export const yarasoftUnmappedSectionSchema = z
    .object({
        id: idLike,
        src_table: textLike,
        src_name: textLike,
        invoices_count: numLike,
        total_amount: numLike,
        last_seen: textLike,
    })
    .passthrough();

export const yarasoftUnmappedResponseSchema = z.array(yarasoftUnmappedSectionSchema);

export const yarasoftSectionInvoiceRowSchema = z
    .object({
        id: idLike,
        dept_code: textLike,
        source: textLike,
        amount: numLike,
        date: textLike,
        notes: textLike,
        external_ref: textLike,
        import_status: textLike,
        items_count: numLike,
    })
    .passthrough();

export const yarasoftSectionInvoicesSchema = z
    .object({
        ok: z.boolean().optional(),
        section: z.object({ id: idLike.optional(), dept_code: textLike, display_ar: textLike }).passthrough().optional(),
        page: numLike,
        limit: numLike,
        total: numLike,
        pages: numLike,
        rows: z.array(yarasoftSectionInvoiceRowSchema).optional(),
    })
    .passthrough();

const sectionDetailLineSchema = z
    .object({
        code: textLike,
        name: textLike,
        qty: numLike,
        unit: textLike,
        price: numLike,
        total: numLike,
        vat: numLike,
    })
    .passthrough();

export const yarasoftSectionInvoiceDetailSchema = z
    .object({
        ok: z.boolean().optional(),
        ref: textLike,
        local: z.object({ date: textLike }).passthrough().nullable().optional(),
        header: z.object({ CSHR: textLike, SHFT_NO: textLike, DOC_DATE: textLike }).passthrough().nullable().optional(),
        lines: z.array(sectionDetailLineSchema).optional(),
        live: z.boolean().optional(),
    })
    .passthrough();

export type YarasoftSectionMapRow = z.infer<typeof yarasoftSectionMapRowSchema>;
export type YarasoftUnmappedSection = z.infer<typeof yarasoftUnmappedSectionSchema>;
export type YarasoftSectionInvoices = z.infer<typeof yarasoftSectionInvoicesSchema>;
export type YarasoftSectionInvoiceRow = z.infer<typeof yarasoftSectionInvoiceRowSchema>;
export type YarasoftSectionInvoiceDetail = z.infer<typeof yarasoftSectionInvoiceDetailSchema>;

/* ─── Oracle ────────────────────────────────────────────────────────────── */

export const yarasoftOracleStatusSchema = z
    .object({
        ok: z.boolean().optional(),
        oracle: z
            .object({
                enabled: z.boolean().optional(),
                driver: z.boolean().nullable().optional(),
                running: z.boolean().optional(),
                stagedTotal: numLike,
                host: textLike,
                port: numLike,
                service: textLike,
                hasUser: z.boolean().optional(),
                hasPassword: z.boolean().optional(),
                hasSql: z.boolean().optional(),
                lastOk: textLike,
                lastError: textLike,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export const yarasoftCatchUpStatusSchema = z
    .object({
        ok: z.boolean().optional(),
        job: z
            .object({
                running: z.boolean().optional(),
                startedAt: textLike,
                finishedAt: textLike,
                posted: numLike,
                dups: numLike,
                error: textLike,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export const yarasoftReconcileRowSchema = z
    .object({
        day: textLike,
        ora_cc: numLike,
        ora_b4: numLike,
        local_count: numLike,
        status: textLike,
    })
    .passthrough();

export const yarasoftReconcileSchema = z
    .object({
        ok: z.boolean().optional(),
        overall: textLike,
        totalOra: numLike,
        totalLocal: numLike,
        days: numLike,
        rows: z.array(yarasoftReconcileRowSchema).optional(),
    })
    .passthrough();

export const yarasoftItemPreviewSchema = z
    .object({
        ok: z.boolean().optional(),
        total: numLike,
        fresh: numLike,
        skipped: numLike,
        groups: numLike,
        error: textLike,
        message: textLike,
    })
    .passthrough();

export const yarasoftItemImportSchema = z
    .object({
        ok: z.boolean().optional(),
        imported: numLike,
        skipped: numLike,
        error: textLike,
    })
    .passthrough();

export const yarasoftOracleTestSchema = z
    .object({
        ok: z.boolean().optional(),
        ms: numLike,
        message: textLike,
        error: textLike,
    })
    .passthrough();

export const yarasoftPollSchema = z
    .object({
        ok: z.boolean().optional(),
        rows: numLike,
        message: textLike,
        error: textLike,
    })
    .passthrough();

export const yarasoftCatchUpStartSchema = z
    .object({
        ok: z.boolean().optional(),
        alreadyRunning: z.boolean().optional(),
        started: z.boolean().optional(),
        job: z
            .object({
                running: z.boolean().optional(),
                posted: numLike,
                dups: numLike,
                error: textLike,
            })
            .passthrough()
            .optional(),
        message: textLike,
        error: textLike,
    })
    .passthrough();

export type YarasoftOracleStatus = z.infer<typeof yarasoftOracleStatusSchema>;
export type YarasoftCatchUpStatus = z.infer<typeof yarasoftCatchUpStatusSchema>;
export type YarasoftReconcile = z.infer<typeof yarasoftReconcileSchema>;
export type YarasoftItemPreview = z.infer<typeof yarasoftItemPreviewSchema>;

/* ─── الجودة ────────────────────────────────────────────────────────────── */

export const yarasoftCatalogStatusSchema = z
    .object({
        ok: z.boolean().optional(),
        withQty: numLike,
        zeroQty: numLike,
        customers: numLike,
        assets: numLike,
        purchases: z.object({ n: numLike, t: numLike }).passthrough().optional(),
    })
    .passthrough();

export const yarasoftQuarantineRowSchema = z
    .object({
        kind: textLike,
        ref_code: textLike,
        qty: numLike,
        value_amount: numLike,
        unit_cost: numLike,
        reason: textLike,
    })
    .passthrough();

export const yarasoftQuarantineSchema = z.union([
    z.array(yarasoftQuarantineRowSchema),
    z.object({ rows: z.array(yarasoftQuarantineRowSchema).optional() }).passthrough(),
]);

export const yarasoftOrganizeSchema = z
    .object({
        ok: z.boolean().optional(),
        categorized: numLike,
        groups: numLike,
        alreadyOk: numLike,
        unmapped: numLike,
        error: textLike,
    })
    .passthrough();

export const yarasoftSyncBalancesSchema = z
    .object({
        ok: z.boolean().optional(),
        applied: numLike,
        quarantined: numLike,
        unmapped: numLike,
        error: textLike,
    })
    .passthrough();

export type YarasoftCatalogStatus = z.infer<typeof yarasoftCatalogStatusSchema>;
export type YarasoftQuarantineRow = z.infer<typeof yarasoftQuarantineRowSchema>;

/** الحجر يعود مصفوفة أو `{rows}` حسب إصدار الخادم — تطبيع واحد. */
export function quarantineRows(payload: unknown): YarasoftQuarantineRow[] {
    const parsed = yarasoftQuarantineSchema.safeParse(payload);
    if (!parsed.success) {
        return [];
    }
    return Array.isArray(parsed.data) ? parsed.data : (parsed.data.rows ?? []);
}

/* ─── معاينة الصيغة ─────────────────────────────────────────────────────── */

const previewMatchItemSchema = z
    .object({
        item: textLike,
        product: textLike,
        productId: idLike.optional(),
        via: textLike,
        name: textLike,
        code: textLike,
        barcode: textLike,
        reason: textLike,
    })
    .passthrough();

export const yarasoftDryRunSchema = z
    .object({
        ok: z.boolean().optional(),
        parsed: z
            .object({
                kind: textLike,
                invoices: z
                    .array(
                        z
                            .object({
                                invoiceNumber: textLike,
                                date: textLike,
                                paymentMethod: textLike,
                                items: z.array(z.unknown()).optional(),
                                matching: z
                                    .object({
                                        resolved: z.array(previewMatchItemSchema).optional(),
                                        unmapped: z.array(previewMatchItemSchema).optional(),
                                    })
                                    .passthrough()
                                    .optional(),
                            })
                            .passthrough(),
                    )
                    .optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
        suggestedProfile: z.unknown().optional(),
        error: textLike,
        message: textLike,
    })
    .passthrough();

export type YarasoftDryRunPreview = z.infer<typeof yarasoftDryRunSchema>;

/* ─── المرآة ────────────────────────────────────────────────────────────── */

export const yarasoftMirrorCashiersSchema = z
    .object({
        ok: z.boolean().optional(),
        date: textLike,
        cashiers: z
            .array(
                z
                    .object({
                        cashier_no: idLike,
                        invoices: numLike,
                        revenue: numLike,
                        last_time: textLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export const yarasoftMirrorOrderRowSchema = z
    .object({
        doc_no: idLike,
        cashier_no: idLike.optional(),
        doc_date: textLike,
        doc_time: textLike,
        total: numLike,
        payed: numLike,
        lines_count: numLike,
        table_name: textLike,
        zone_name: textLike,
    })
    .passthrough();

export const yarasoftMirrorOrdersSchema = z
    .object({
        ok: z.boolean().optional(),
        date: textLike,
        total: numLike,
        orders: z.array(yarasoftMirrorOrderRowSchema).optional(),
    })
    .passthrough();

const mirrorLineSchema = z
    .object({
        code: textLike,
        name: textLike,
        qty: numLike,
        price: numLike,
        total: numLike,
    })
    .passthrough();

export const yarasoftMirrorOrderSchema = z
    .object({
        ok: z.boolean().optional(),
        order: z
            .object({
                doc_no: idLike.optional(),
                cashier_no: idLike.optional(),
                doc_date: textLike,
                doc_time: textLike,
                total: numLike,
                net: numLike,
                lines: z.array(mirrorLineSchema).optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough();

export const yarasoftMirrorCloseSchema = z
    .object({
        ok: z.boolean().optional(),
        date: textLike,
        cashier_no: idLike.optional(),
        invoices: numLike,
        gross: numLike,
        discount: numLike,
        vat: numLike,
        net: numLike,
        payed: numLike,
        open: numLike,
        avg: numLike,
        pay_split: z.object({ cash: numLike, network: numLike, credit: numLike, mobile: numLike }).passthrough().optional(),
        by_hour: z.record(z.string(), z.object({ invoices: numLike, revenue: numLike }).passthrough()).optional(),
        top_items: z.array(z.object({ code: textLike, name: textLike, qty: numLike, total: numLike }).passthrough()).optional(),
    })
    .passthrough();

export const yarasoftMirrorRefreshSchema = z
    .object({
        ok: z.boolean().optional(),
        rows: numLike,
        message: textLike,
        error: textLike,
    })
    .passthrough();

export type YarasoftMirrorCashiers = z.infer<typeof yarasoftMirrorCashiersSchema>;
export type YarasoftMirrorOrderRow = z.infer<typeof yarasoftMirrorOrderRowSchema>;
export type YarasoftMirrorOrders = z.infer<typeof yarasoftMirrorOrdersSchema>;
export type YarasoftMirrorOrderDetail = z.infer<typeof yarasoftMirrorOrderSchema>['order'];
export type YarasoftMirrorClose = z.infer<typeof yarasoftMirrorCloseSchema>;

/* ─── نتائج الكتابة ─────────────────────────────────────────────────────── */

export const yarasoftReprocessSchema = z
    .object({
        ok: z.boolean().optional(),
        message: textLike,
        row: z.unknown().optional(),
    })
    .passthrough();

export const yarasoftResolveSchema = z
    .object({
        ok: z.boolean().optional(),
        remainingForInvoice: numLike,
        message: textLike,
    })
    .passthrough();

export const yarasoftApproveSectionSchema = z
    .object({
        ok: z.boolean().optional(),
        mapId: idLike.nullable().optional(),
        deptCode: textLike,
        displayAr: textLike,
        reopenedInvoices: numLike,
        error: textLike,
        message: textLike,
    })
    .passthrough();

export const yarasoftRenameSchema = z
    .object({
        ok: z.boolean().optional(),
        id: idLike.optional(),
        displayAr: textLike,
    })
    .passthrough();

export const yarasoftReclassifySchema = z
    .object({
        ok: z.boolean().optional(),
        moved: numLike,
        to_dept: textLike,
        to_name: textLike,
    })
    .passthrough();

const ackSchema = z.object({ ok: z.boolean().optional() }).passthrough();

/* ─── القراءات ──────────────────────────────────────────────────────────── */

export function fetchYarasoftStatus(signal?: AbortSignal) {
    return fetchJson(yarasoftStatusSchema, '/api/yarasoft/status', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftLog(limit = 150, signal?: AbortSignal) {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 150)));
    return fetchJson(yarasoftLogResponseSchema, `/api/yarasoft/log?limit=${String(safeLimit)}`, getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftInvoiceDetail(id: string | number) {
    return fetchJson(yarasoftInvoiceDetailSchema, `/api/yarasoft/log/${encodeURIComponent(String(id))}/detail`, getAccessToken(), {});
}

export function fetchYarasoftReview(open = true, signal?: AbortSignal) {
    return fetchJson(
        yarasoftReviewResponseSchema,
        `/api/yarasoft/review?open=${open ? '1' : '0'}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchYarasoftMappings(signal?: AbortSignal) {
    return fetchJson(yarasoftMappingsResponseSchema, '/api/yarasoft/mappings', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftSectionMap(signal?: AbortSignal) {
    return fetchJson(yarasoftSectionMapResponseSchema, '/api/yarasoft/sections/map', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftUnmappedSections(signal?: AbortSignal) {
    return fetchJson(yarasoftUnmappedResponseSchema, '/api/yarasoft/sections/unmapped', getAccessToken(), signal ? { signal } : {});
}

export interface SectionInvoiceQuery {
    page?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    query?: string;
}

export function fetchYarasoftSectionInvoices(mapId: number, query: SectionInvoiceQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams({
        map_id: String(mapId),
        page: String(Math.max(1, Math.floor(Number(query.page) || 1))),
        limit: String(Math.max(5, Math.min(100, Math.floor(Number(query.limit) || 20)))),
    });
    if (query.dateFrom) {
        params.set('date_from', query.dateFrom);
    }
    if (query.dateTo) {
        params.set('date_to', query.dateTo);
    }
    if (query.query) {
        params.set('q', String(query.query).trim().slice(0, 60));
    }
    return fetchJson(
        yarasoftSectionInvoicesSchema,
        `/api/yarasoft/sections/invoices?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchYarasoftSectionInvoiceDetail(ref: string, signal?: AbortSignal) {
    return fetchJson(
        yarasoftSectionInvoiceDetailSchema,
        `/api/yarasoft/sections/invoice-detail?ref=${encodeURIComponent(ref)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchYarasoftOracleStatus(signal?: AbortSignal) {
    return fetchJson(yarasoftOracleStatusSchema, '/api/yarasoft/oracle/status', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftOracleCatchUpStatus(signal?: AbortSignal) {
    return fetchJson(yarasoftCatchUpStatusSchema, '/api/yarasoft/oracle/catch-up/status', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftOracleReconcile(days = 14, signal?: AbortSignal) {
    const safeDays = Math.max(1, Math.min(90, Math.floor(Number(days) || 14)));
    return fetchJson(
        yarasoftReconcileSchema,
        `/api/yarasoft/oracle/reconcile?days=${String(safeDays)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchYarasoftCatalogStatus(signal?: AbortSignal) {
    return fetchJson(yarasoftCatalogStatusSchema, '/api/yarasoft/oracle/catalog-status', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftQuarantine(signal?: AbortSignal) {
    return fetchJson(yarasoftQuarantineSchema, '/api/yarasoft/quality/quarantine', getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftMirrorCashiers(date = '', signal?: AbortSignal) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetchJson(yarasoftMirrorCashiersSchema, `/api/yarasoft/mirror/cashiers${query}`, getAccessToken(), signal ? { signal } : {});
}

export function fetchYarasoftMirrorOrders(
    { date = '', cashier = '', limit = 50, offset = 0 }: { date?: string; cashier?: string; limit?: number; offset?: number } = {},
    signal?: AbortSignal,
) {
    const params = new URLSearchParams();
    if (date) {
        params.set('date', date);
    }
    if (cashier) {
        params.set('cashier', cashier);
    }
    params.set('limit', String(Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))));
    params.set('offset', String(Math.max(0, Math.floor(Number(offset) || 0))));
    return fetchJson(
        yarasoftMirrorOrdersSchema,
        `/api/yarasoft/mirror/orders?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function fetchYarasoftMirrorOrder(docNo: string) {
    return fetchJson(
        yarasoftMirrorOrderSchema,
        `/api/yarasoft/mirror/orders/${encodeURIComponent(String(docNo).trim())}`,
        getAccessToken(),
        {},
    );
}

export function fetchYarasoftMirrorClose({ date = '', cashier }: { date?: string; cashier: string }) {
    const params = new URLSearchParams({ cashier });
    if (date) {
        params.set('date', date);
    }
    return fetchJson(yarasoftMirrorCloseSchema, `/api/yarasoft/mirror/close?${params.toString()}`, getAccessToken(), {});
}

/* ─── الكتابات ──────────────────────────────────────────────────────────── */

export function runYarasoftNow() {
    return writeJson(ackSchema, '/api/yarasoft/run-now', 'POST');
}

export function reprocessYarasoftInvoice(id: string | number) {
    return writeJson(yarasoftReprocessSchema, `/api/yarasoft/reprocess/${encodeURIComponent(String(id))}`, 'POST');
}

export function resolveYarasoftReview(id: string | number, internalProductId: number) {
    return writeJson(yarasoftResolveSchema, `/api/yarasoft/review/${encodeURIComponent(String(id))}/resolve`, 'POST', {
        internalProductId: Number(internalProductId),
    });
}

export function approveYarasoftSection(
    id: string | number,
    { displayAr = '', displayEn = '', mergeMapId }: { displayAr?: string; displayEn?: string; mergeMapId?: string | number | null } = {},
) {
    const body: Record<string, unknown> = { displayAr: String(displayAr).trim(), displayEn: String(displayEn).trim() };
    if (mergeMapId !== undefined && mergeMapId !== null && mergeMapId !== '') {
        body.mergeMapId = Number(mergeMapId);
    }
    return writeJson(
        yarasoftApproveSectionSchema,
        `/api/yarasoft/sections/unmapped/${encodeURIComponent(String(id))}/approve`,
        'POST',
        body,
    );
}

export function renameYarasoftSection(
    id: string | number,
    { displayAr = '', displayEn = '' }: { displayAr?: string; displayEn?: string } = {},
) {
    return writeJson(yarasoftRenameSchema, `/api/yarasoft/sections/map/${encodeURIComponent(String(id))}/rename`, 'POST', {
        displayAr: String(displayAr).trim(),
        displayEn: String(displayEn).trim(),
    });
}

export function createYarasoftManualSection({ displayAr = '', displayEn = '' }: { displayAr?: string; displayEn?: string } = {}) {
    return writeJson(yarasoftRenameSchema, '/api/yarasoft/sections/manual', 'POST', {
        displayAr: String(displayAr).trim(),
        displayEn: String(displayEn).trim(),
    });
}

export function reclassifyYarasoftRevenue(ids: readonly number[], toMapId: number) {
    const revenueIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
    return writeJson(yarasoftReclassifySchema, '/api/yarasoft/sections/reclassify', 'POST', {
        revenue_ids: revenueIds,
        to_map_id: Number(toMapId),
    });
}

export function saveYarasoftMapping({
    externalCode = '',
    externalBarcode = '',
    internalProductId,
}: {
    externalCode?: string;
    externalBarcode?: string;
    internalProductId: number;
}) {
    return writeJson(ackSchema, '/api/yarasoft/mappings', 'POST', {
        externalCode: String(externalCode).trim(),
        externalBarcode: String(externalBarcode).trim(),
        internalProductId: Number(internalProductId),
    });
}

export function deactivateYarasoftMapping(id: string | number) {
    return writeJson(ackSchema, `/api/yarasoft/mappings/${encodeURIComponent(String(id))}`, 'DELETE');
}

export function testYarasoftOracle() {
    return writeJson(yarasoftOracleTestSchema, '/api/yarasoft/oracle/test', 'POST');
}

export function pollYarasoftOracleNow() {
    return writeJson(yarasoftPollSchema, '/api/yarasoft/oracle/poll-now', 'POST');
}

export function previewYarasoftOracleItems() {
    return fetchJson(yarasoftItemPreviewSchema, '/api/yarasoft/oracle/import-items/preview', getAccessToken(), {});
}

export function importYarasoftOracleItems() {
    return writeJson(yarasoftItemImportSchema, '/api/yarasoft/oracle/import-items', 'POST');
}

export function startYarasoftOracleCatchUp(days = 14) {
    const safeDays = Math.max(1, Math.min(90, Math.floor(Number(days) || 14)));
    return writeJson(yarasoftCatchUpStartSchema, '/api/yarasoft/oracle/catch-up', 'POST', { days: safeDays });
}

export function organizeYarasoftCategories() {
    return writeJson(yarasoftOrganizeSchema, '/api/yarasoft/oracle/organize', 'POST');
}

export function syncYarasoftBalances(force = false) {
    return writeJson(yarasoftSyncBalancesSchema, '/api/yarasoft/oracle/sync-balances', 'POST', { force: Boolean(force) });
}

export function previewYarasoftInvoiceText(text: string) {
    const source = String(text ?? '');
    const error = previewTextError(source);
    if (error) {
        throw new Error(error);
    }
    return writeJson(yarasoftDryRunSchema, '/api/yarasoft/dry-run-preview', 'POST', { text: source });
}

export function refreshYarasoftMirror() {
    return writeJson(yarasoftMirrorRefreshSchema, '/api/yarasoft/mirror/refresh', 'POST', {});
}

/* ─── البحث عن منتج (نفس نداء V2: صفحتان كحد أقصى) ──────────────────────── */

export interface YarasoftProduct {
    id: number;
    name: string;
    barcode: string;
}

export async function searchYarasoftProducts(query: string, signal?: AbortSignal) {
    const result = await fetchInventoryRegister({ q: String(query ?? '').trim(), category: 'all', stock: 'all' }, signal, 2);
    const rows: YarasoftProduct[] = [];
    for (const item of result.rows) {
        const id = Number(item.id);
        if (!Number.isInteger(id) || id <= 0) {
            continue;
        }
        rows.push({
            id,
            name: item.name ? String(item.name) : `#${String(item.id)}`,
            barcode: item.barcode ? String(item.barcode) : '',
        });
    }
    return { rows, truncated: result.truncated };
}

/* ─── تحقق النماذج (رسائل V2 نفسها) ────────────────────────────────────── */

export function productSearchError(query: string): string {
    return String(query ?? '').trim().length < 2 ? 'اكتب حرفين على الأقل للبحث عن المنتج.' : '';
}

export function approveSectionError({ displayAr, mergeMapId }: { displayAr: string; mergeMapId?: string }): string {
    return !mergeMapId && !String(displayAr ?? '').trim() ? 'اسم العرض مطلوب.' : '';
}

export function mappingFormError({
    externalCode,
    externalBarcode,
    internalProductId,
}: {
    externalCode: string;
    externalBarcode: string;
    internalProductId: string | number;
}): string {
    if (!String(externalCode ?? '').trim() && !String(externalBarcode ?? '').trim()) {
        return 'أدخل كود الكاشير أو باركوداً واحداً على الأقل.';
    }
    if (!Number(internalProductId)) {
        return 'ابحث واختر المنتج الداخلي أولاً.';
    }
    return '';
}

export function reclassifyError(ids: readonly number[], toMapId: string | number): string {
    return ids.length > 0 && Number(toMapId) ? '' : 'حدد فاتورة واحدة على الأقل واختر القسم المستهدف.';
}

/** أيام المقارنة/اللحاق: عدد صحيح 1–90 كما في V2. */
export function oracleDaysError(value: string | number): string {
    const days = Number(value);
    return Number.isInteger(days) && days >= 1 && days <= 90 ? '' : 'حدد فترة من يوم إلى 90 يوماً.';
}

export function previewTextError(text: string): string {
    const source = String(text ?? '');
    if (!source.trim()) {
        return 'ألصق محتوى ملف فاتورة للمعاينة أولاً.';
    }
    if (new TextEncoder().encode(JSON.stringify({ text: source })).byteLength > 2 * 1024 * 1024) {
        return 'حجم محتوى المعاينة يتجاوز الحد الأقصى للخادم (2 ميغابايت).';
    }
    return '';
}

/* ─── العرض ─────────────────────────────────────────────────────────────── */

export type YarasoftTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral';

const STATUS_STYLES: Record<string, { label: string; tone: YarasoftTone }> = {
    COMPLETED: { label: 'مكتملة', tone: 'success' },
    DUPLICATE: { label: 'مكررة', tone: 'info' },
    FAILED: { label: 'فاشلة', tone: 'danger' },
    REQUIRES_REVIEW: { label: 'تحتاج مراجعة', tone: 'warning' },
    NEEDS_MAPPING: { label: 'بانتظار اعتماد القسم', tone: 'warning' },
    DRY_RUN: { label: 'معاينة فقط', tone: 'neutral' },
    PROCESSING: { label: 'قيد المعالجة', tone: 'info' },
    DETECTED: { label: 'مكتشفة', tone: 'neutral' },
};

/** شارة حالة الاستيراد — نفس جدول V2 حرفيًّا. */
export function yarasoftStatusBadge(status: string | null | undefined): { label: string; tone: YarasoftTone } {
    const key = String(status ?? '')
        .trim()
        .toUpperCase();
    return STATUS_STYLES[key] ?? { label: key || 'غير معروف', tone: 'neutral' };
}

const MONEY_FORMAT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** عدد من الخادم (float) → نص مالي بمنزلتين — العرض فقط. */
export function moneyText(value: unknown): string {
    const number = Number(value ?? 0);
    return MONEY_FORMAT.format(Number.isFinite(number) ? number : 0);
}

export function intText(value: unknown): string {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? Math.trunc(number).toLocaleString('en-US') : '0';
}

/** اسم الملف من مسار الخادم — `source_file` قد يأتي مسارًا كاملًا. */
export function sourceFileName(value: string | null | undefined): string {
    const parts = String(value ?? '').split(/[\\/]/);
    return parts[parts.length - 1] || '—';
}

/** مرجع الفاتورة بلا بادئة `ora:` كما في V2. */
export function externalRefText(value: string | null | undefined, fallback: string | number): string {
    const cleaned = String(value ?? '').replace(/^ora:/, '');
    return cleaned || String(fallback);
}
