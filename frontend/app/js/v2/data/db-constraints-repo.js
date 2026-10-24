/**
 * V2 — advisory DB-schema validation. The server remains authoritative.
 * GET /api/schema/constraints is admin-only because it exposes schema details.
 */
import { apiFetch } from '../../core/api.js?v=4.9.151';

const CACHE_TTL = 5 * 60_000;
let constraintsCache = null;
let cacheAt = 0;
let pending = null;

export async function fetchDbConstraints(role, { force = false } = {}) {
    if (role !== 'admin') {throw new Error('قيود قاعدة البيانات متاحة للأدمن فقط');}
    if (!force && constraintsCache && Date.now() - cacheAt < CACHE_TTL) {return constraintsCache;}
    if (pending) {return pending;}
    pending = apiFetch('/schema/constraints').then((result) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error('صيغة قيود قاعدة البيانات غير صالحة');
        }
        constraintsCache = result;
        cacheAt = Date.now();
        return result;
    }).finally(() => {pending = null;});
    return pending;
}

export function invalidateDbConstraints() {
    constraintsCache = null;
    cacheAt = 0;
}

function validateValue(column, value, name) {
    const errors = [];
    if (!column.nullable && (value === null || value === undefined || value === '')) {
        errors.push({ code: 'NOT_NULL', message: `${name} مطلوب` });
    }
    if (value === null || value === undefined || value === '') {return errors;}
    switch (String(column.type || '').toLowerCase()) {
        case 'character varying':
        case 'varchar':
        case 'text':
            if (typeof value !== 'string') {
                errors.push({ code: 'TYPE', message: `${name} يجب أن يكون نصًا` });
            } else if (column.maxLength && value.length > column.maxLength) {
                errors.push({ code: 'MAX_LENGTH', message: `${name} طويل جدًا (الأقصى ${column.maxLength})` });
            }
            break;
        case 'integer':
        case 'bigint':
        case 'smallint':
            if (!Number.isInteger(Number(value))) {
                errors.push({ code: 'TYPE', message: `${name} يجب أن يكون رقمًا صحيحًا` });
            }
            break;
        case 'numeric':
        case 'decimal':
        case 'real':
        case 'double precision':
            if (!Number.isFinite(Number(value))) {
                errors.push({ code: 'TYPE', message: `${name} يجب أن يكون رقمًا` });
            }
            break;
        case 'boolean':
            if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                errors.push({ code: 'TYPE', message: `${name} يجب أن يكون نعم/لا` });
            }
            break;
        case 'date':
        case 'timestamp with time zone':
        case 'timestamp without time zone':
            if (Number.isNaN(Date.parse(value))) {
                errors.push({ code: 'TYPE', message: `${name} تاريخ غير صالح` });
            }
            break;
        default:
            break;
    }
    return errors;
}

export async function validateDbField(tableName, columnName, value, role) {
    const constraints = await fetchDbConstraints(role);
    const column = constraints[tableName]?.columns?.[columnName];
    if (!column) {return { checked: false, ok: true, errors: [] };}
    const errors = validateValue(column, value, columnName);
    return { checked: true, ok: errors.length === 0, errors };
}

export async function validateDbForm(tableName, formData, role) {
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
        throw new Error('بيانات النموذج غير صالحة');
    }
    const constraints = await fetchDbConstraints(role);
    const table = constraints[tableName];
    if (!table || !table.columns || typeof table.columns !== 'object') {
        return { checked: false, ok: true, errors: [] };
    }

    const errors = [];
    for (const [columnName, value] of Object.entries(formData)) {
        errors.push(...validateValue(table.columns[columnName] || {}, value, columnName)
            .map((error) => ({ field: columnName, ...error })));
    }
    for (const [columnName, column] of Object.entries(table.columns)) {
        if (!column.nullable && !column.default && formData[columnName] === undefined) {
            errors.push({ field: columnName, code: 'NOT_NULL', message: `${columnName} مطلوب` });
        }
    }
    return { checked: true, ok: errors.length === 0, errors };
}
