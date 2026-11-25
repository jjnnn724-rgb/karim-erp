import { z } from 'zod';

/**
 * ترقيم الصفحات — حدود القديم نفسها: `/journal` يقصّ limit على [1, 200]
 * والافتراضي 50. `offset` غير موجود في القديم، فلا يُدخل في عقد التكافؤ.
 */
export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;

export const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
