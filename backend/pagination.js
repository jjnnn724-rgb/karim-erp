/**
 * pagination.js — Query Parameter Parsing & SQL Pagination Helpers
 * ────────────────────────────────────────────────────────────────────────────
 * Provides middleware and utilities for paginated, sorted API responses.
 * 
 * Features:
 * - Page/limit parsing with defaults and max limits
 * - Sort column validation against whitelist
 * - Order direction enforcement (ASC/DESC only)
 * - Total count header for client-side pagination info
 * - SQL query builder helpers with safe parameterization
 */

// ─── Configuration Constants ──────────────────────────────
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;       // LAN app + JWT: bigger pages = ~5x fewer boot round-trips (was 200)
const MAX_OFFSET = 50000;     // Allow loading large attendance datasets

/**
 * Parse and validate pagination parameters from request query.
 * 
 * @param {Object} req.query - Express request query object
 * @param {string[]} allowedSortColumns - Whitelist of sortable column names
 * @returns {{ page: number, limit: number, offset: number, sort: string, order: 'ASC'|'DESC', valid: boolean, errors: string[] }}
 */
function parsePaginationParams(query, allowedSortColumns = ['id']) {
    const errors = [];
    
    // Handle null/undefined query gracefully
    if (!query || typeof query !== 'object') {
        query = {};
    }
    
    // Parse page
    let page = parseInt(query.page, 10);
    if (isNaN(page) || page < 1) {
        page = DEFAULT_PAGE;
    }
    
    // Parse limit with maximum cap
    let limit = parseInt(query.limit, 10);
    if (isNaN(limit) || limit < 1) {
        limit = DEFAULT_LIMIT;
    } else if (limit > MAX_LIMIT) {
        errors.push(`Limit ${limit} exceeds maximum of ${MAX_LIMIT}`);
        limit = MAX_LIMIT;
    }
    
    // Calculate offset (recomputed after any page clamping below)
    let offset = (page - 1) * limit;
    if (offset > MAX_OFFSET) {
        errors.push(`Page ${page} exceeds maximum offset of ${MAX_OFFSET}`);
        // Clamp to max offset and recompute the effective offset
        page = Math.floor(MAX_OFFSET / limit) + 1;
        offset = (page - 1) * limit;
    }
    
    // Parse sort column (must be in whitelist)
    let sort = (query.sort || 'id').trim();
    
    // Security: Only allow alphanumeric + underscore
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sort)) {
        errors.push(`Invalid sort column format: "${sort}"`);
        sort = 'id'; // Fallback to safe default
    }
    
    // Validate against whitelist
    if (!allowedSortColumns.includes(sort)) {
        errors.push(`Sort column "${sort}" not allowed. Allowed: ${allowedSortColumns.join(', ')}`);
        sort = allowedSortColumns[0] || 'id';
    }
    
    // Parse order direction
    const orderInput = (query.order || 'ASC').toUpperCase();
    const validOrders = ['ASC', 'DESC'];
    const order = validOrders.includes(orderInput) ? orderInput : 'ASC';
    
    return {
        page,
        limit,
        offset,
        sort,
        order,
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Build paginated SQL SELECT query with COUNT.
 * Returns both the data query and count query for total records.
 *
 * @param {string} tableName - The table to query (must be validated beforehand)
 * @param {Object} params - Parsed pagination params from parsePaginationParams()
 * @param {Object} [options] - { branchId?: number } — تصفية اختيارية حسب الفرع (branch_id)
 * @returns {{ dataQuery: string, countQuery: string, params: any[] }}
 */
function buildPaginatedQuery(tableName, params, options = {}) {
    const { limit, offset, sort, order } = params;
    const branchId = options.branchId != null ? Number(options.branchId) : null;

    // Note: tableName MUST come from trusted source (entities array), not user input
    const where = branchId != null ? ' WHERE "branch_id" = $3' : '';
    const dataQuery = `SELECT * FROM "${tableName}"${where} ORDER BY "${sort}" ${order} LIMIT $1 OFFSET $2`;
    const countQuery = `SELECT COUNT(*) AS total FROM "${tableName}"${where}`;

    return {
        dataQuery,
        countQuery,
        params: branchId != null ? [limit, offset, branchId] : [limit, offset],
    };
}

/**
 * Express middleware factory for automatic pagination.
 * Attaches parsed pagination to req.pagination for route handlers to use.
 * 
 * @param {string[]} allowedSortColumns - Columns that can be used for sorting
 * @returns {Function} Express middleware function
 */
function paginationMiddleware(allowedSortColumns = ['id']) {
    return (req, res, next) => {
        try {
            req.pagination = parsePaginationParams(req.query, allowedSortColumns);
            
            // Return 400 if there were validation errors (but still attach parsed params)
            if (!req.pagination.valid && req.pagination.errors.length > 0) {
                return res.status(400).json({
                    error: 'INVALID_PAGINATION_PARAMS',
                    details: req.pagination.errors,
                    received: {
                        page: req.query.page,
                        limit: req.query.limit,
                        sort: req.query.sort,
                        order: req.query.order,
                    },
                    defaults: {
                        page: DEFAULT_PAGE,
                        limit: DEFAULT_LIMIT,
                        maxLimit: MAX_LIMIT,
                        allowedSortColumns,
                    },
                });
            }
            
            next();
        } catch (err) {
            res.status(400).json({
                error: 'PAGINATION_PARSE_ERROR',
                message: 'Failed to parse pagination parameters',
            });
        }
    };
}

/**
 * Send a paginated response with standard headers and structure.
 * 
 * @param {Object} res - Express response object
 * @param {Array} data - Array of results for current page
 * @param {number} total - Total number of records (unpaginated)
 * @param {Object} pagination - Parsed pagination params
 */
function sendPaginatedResponse(res, data, total, pagination) {
    const { page, limit, sort, order } = pagination;
    const totalPages = Math.ceil(total / limit);
    
    // Set standard pagination headers for API consumers
    // res.req is the originating Express request — build real URLs per page
    const baseUrl = (res.req && (res.req.originalUrl || res.req.url)) || '';
    const pageUrl = (targetPage) => setQueryParam(baseUrl, 'page', targetPage);
    res.set({
        'X-Total-Count': total,
        'X-Total-Pages': totalPages,
        'X-Current-Page': page,
        'X-Per-Page': limit,
        'X-Sort': `${sort} ${order}`,
        'Link': buildLinkHeader(pageUrl, page, totalPages),
    });
    
    return res.json({
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            sort,
            order,
        },
    });
}

/**
 * Build RFC 5988 Link header for pagination navigation.
 * 
 * @param {Function} urlGetter - Function to get base URL
 * @param {number} currentPage - Current page number
 * @param {number} totalPages - Total pages available
 * @returns {string} Link header value
 */
function buildLinkHeader(urlGetter, currentPage, totalPages) {
    const links = [];
    
    if (currentPage > 1) {
        links.push(`<${urlGetter(1)}>; rel="first"`);
        links.push(`<${urlGetter(currentPage - 1)}>; rel="prev"`);
    }
    
    if (currentPage < totalPages) {
        links.push(`<${urlGetter(currentPage + 1)}>; rel="next"`);
        links.push(`<${urlGetter(totalPages)}>; rel="last"`);
    }
    
    return links.join(', ');
}

/**
 * Create a URL with modified query parameter for Link headers.
 * 
 * @param {string} baseUrl - Original URL
 * @param {string} param - Parameter name to modify
 * @param {*} value - New parameter value
 * @returns {string} Modified URL
 */
function setQueryParam(baseUrl, param, value) {
    const url = new URL(baseUrl, 'http://localhost');
    url.searchParams.set(param, value);
    return url.pathname + url.search;
}

module.exports = {
    // Constants
    DEFAULT_PAGE,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MAX_OFFSET,
    
    // Main functions
    parsePaginationParams,
    buildPaginatedQuery,
    paginationMiddleware,
    sendPaginatedResponse,
    buildLinkHeader,
    setQueryParam,
};
