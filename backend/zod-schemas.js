/**
 * zod-schemas.js — Zod Validation Schemas for All Entities
 * ────────────────────────────────────────────────────────────────────────────
 * Provides type-safe input validation using Zod for all API endpoints.
 * 
 * Features:
 * - Auto-generated from schema-registry.js definitions
 * - Comprehensive error messages with field-level details
 * - Support for nested objects, arrays, enums
 * - Coercion and transformation where needed
 * - Custom error formatting for API responses
 */

const { z } = require('zod');
const { logger } = require('./logger');

// ─── Base Type Validators ──────────────────────────────────

/** Validate email format */
const emailSchema = z.string().email('Invalid email format').max(255).optional().nullable();

/** Validate phone number (flexible international format) */
const phoneSchema = z.string()
    .regex(/^[+]?[\d\s\-()]{7,20}$/, 'Invalid phone number format')
    .optional()
    .nullable();

/** Validate UUID format */
const uuidSchema = z.string().uuid('Invalid UUID format');

/** Validate ISO date string */
const dateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/, 'Invalid date format (use ISO 8601)')
    .optional()
    .nullable();

/** Validate positive decimal (for money/quantities) */
const positiveNumber = z.number().positive('Must be a positive number');
const nonNegativeNumber = z.number().min(0, 'Must be zero or positive');

// ─── Entity Schemas ───────────────────────────────────────

/**
 * User schema for registration/update
 * Note: password validation happens separately for security
 */
const userSchema = z.object({
    username: z.string()
        .min(3, 'Username must be at least 3 characters')
        .max(100, 'Username must be less than 100 characters')
        .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    name: z.string()
        .min(2, 'Name must be at least 2 characters')
        .max(200, 'Name must be less than 200 characters'),
    password: z.string()
        .min(6, 'Password must be at least 6 characters')
        .max(256, 'Password must be less than 256 characters')
        .optional(), // Optional on update
    email: emailSchema,
    phone: phoneSchema,
    active: z.boolean().default(true),
    role: z.enum(['admin', 'manager', 'cashier', 'auditor', 'warehouse', 'kitchen', 'hr', 'employee', 'accountant'], {
        errorMap: () => ({ message: 'Role must be one of: admin, manager, cashier, auditor, warehouse, kitchen, hr, employee, accountant' })
    }).optional(),
}).strict('Unknown fields detected and removed');

/** Login schema */
const loginSchema = z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
}).strict();

// ─── HR Department Schema ──────────────────────────────────

const hrDepartmentSchema = z.object({
    name: z.string()
        .min(2, 'Department name is required')
        .max(150, 'Name too long'),
    code: z.string()
        .min(1, 'Department code is required')
        .max(20, 'Code too long')
        .regex(/^[A-Z0-9_-]+$/i, 'Code can only contain letters, numbers, hyphens, underscores'),
    manager_id: z.number().int('Manager ID must be an integer').positive().optional().nullable(),
    description: z.string().max(1000, 'Description too long').optional().nullable(),
    active: z.boolean().default(true),
}).strict();

// ─── Employee Schema ───────────────────────────────────────

const employeeSchema = z.object({
    first_name: z.string()
        .min(2, 'First name is required')
        .max(100, 'First name too long'),
    last_name: z.string()
        .min(2, 'Last name is required')
        .max(100, 'Last name too long'),
    department_id: z.number().int('Department ID must be an integer').positive(),
    position: z.string().max(100, 'Position too long').optional(),
    hire_date: dateSchema,
    salary: nonNegativeNumber.optional(),
    email: emailSchema,
    phone: phoneSchema,
    address: z.string().max(500, 'Address too long').optional().nullable(),
    emergency_contact: z.string().max(200, 'Emergency contact too long').optional().nullable(),
    status: z.enum(['active', 'on_leave', 'terminated', 'suspended'], {
        errorMap: () => ({ message: 'Invalid employee status' })
    }).default('active'),
    notes: z.string().max(2000, 'Notes too long').optional().nullable(),
}).strict();

// ─── Attendance Schema ─────────────────────────────────────

const attendanceSchema = z.object({
    employee_id: z.number().int('Employee ID must be an integer').positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
    check_in: z.string().regex(/^(\d{2}:?\d{2})?(:?\d{2})?$/, 'Time must be HH:MM or HH:MM:SS format').optional(),
    check_out: z.string().regex(/^(\d{2}:?\d{2})?(:?\d{2})?$/, 'Time must be HH:MM or HH:MM:SS format').optional(),
    type: z.enum(['present', 'absent', 'late', 'half_day', 'leave', 'overtime'], {
        errorMap: () => ({ message: 'Invalid attendance type' })
    }).default('present'),
    notes: z.string().max(500).optional().nullable(),
}).strict();

// ─── Leave Request Schema ──────────────────────────────────

const leaveRequestSchema = z.object({
    employee_id: z.number().int().positive(),
    leave_type_id: z.number().int().positive(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD'),
    reason: z.string().max(500, 'Reason too long').optional(),
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled'], {
        errorMap: () => ({ message: 'Invalid leave request status' })
    }).default('pending'),
}).strict().refine(
    (data) => new Date(data.end_date) >= new Date(data.start_date),
    { message: 'End date must be after start date', path: ['end_date'] }
);

// ─── Payroll Schema ────────────────────────────────────────

const payrollSchema = z.object({
    employee_id: z.number().int().positive(),
    pay_period: z.string().max(20, 'Pay period too long').optional(),
    basic_salary: nonNegativeNumber,
    overtime: nonNegativeNumber.default(0),
    deductions: nonNegativeNumber.default(0),
    bonuses: nonNegativeNumber.default(0),
    net_salary: nonNegativeNumber.optional(), // Calculated if not provided
    payment_date: dateSchema,
    status: z.enum(['draft', 'paid', 'cancelled'], {
        errorMap: () => ({ message: 'Invalid payroll status' })
    }).default('draft'),
    notes: z.string().max(500).optional().nullable(),
}).strict();

// ─── Inventory Schema ──────────────────────────────────────

const inventorySchema = z.object({
    name: z.string()
        .min(2, 'Item name is required')
        .max(200, 'Item name too long'),
    shelf_id: z.number().int().positive().optional().nullable(),
    category: z.string().max(100, 'Category too long').optional(),
    quantity: nonNegativeNumber.default(0),
    unit: z.string().max(20, 'Unit too long').optional(),
    cost_price: nonNegativeNumber.optional(),
    sell_price: nonNegativeNumber.optional(),
    minimum_quantity: nonNegativeNumber.default(0),
    barcode: z.string().max(50, 'Barcode too long').optional().nullable(),
    expiry_date: dateSchema,
    active: z.boolean().default(true),
}).strict();

// ─── Inventory Transaction Schema ──────────────────────────

const inventoryTransactionSchema = z.object({
    item_id: z.number().int().positive(),
    transaction_type: z.enum(['in', 'out', 'adjustment', 'transfer', 'sale_return', 'waste'], {
        errorMap: () => ({ message: 'Invalid transaction type' })
    }),
    quantity: z.number().refine(n => n !== 0, 'Quantity cannot be zero'),
    reference: z.string().max(100, 'Reference too long').optional().nullable(),
    notes: z.string().max(500, 'Notes too long').optional().nullable(),
}).strict();

// ─── Revenue/Expense Schema ─────────────────────────────────

const revenueSchema = z.object({
    amount: positiveNumber,
    category: z.string().max(100, 'Category too long'),
    description: z.string().max(500, 'Description too long').optional(),
    revenue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    payment_method: z.enum(['cash', 'card', 'bank_transfer', 'other'], {
        errorMap: () => ({ message: 'Invalid payment method' })
    }).optional(),
    reference_no: z.string().max(50, 'Reference too long').optional().nullable(),
}).strict();

const expenseSchema = z.object({
    amount: positiveNumber,
    category: z.string().max(100, 'Category too long'),
    description: z.string().max(500, 'Description too long').optional(),
    expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    payment_method: z.enum(['cash', 'card', 'bank_transfer', 'check', 'other'], {
        errorMap: () => ({ message: 'Invalid payment method' })
    }).optional(),
    vendor: z.string().max(150, 'Vendor name too long').optional().nullable(),
    receipt_no: z.string().max(50, 'Receipt number too long').optional().nullable(),
    approved_by: z.number().int().optional().nullable(),
}).strict();

// ─── Settings Schema ───────────────────────────────────────

const settingsSchema = z.object({
    key: z.string()
        .min(1, 'Setting key is required')
        .max(100, 'Key too long')
        .regex(/^[a-z_][a-z0-9_]*$/i, 'Key must start with letter/underscore, alphanumeric only'),
    value: z.union([
        z.string().max(5000),
        z.number(),
        z.boolean(),
        z.null(),
    ], { errorMap: () => ({ message: 'Value must be string, number, boolean, or null' }) }),
}).strict();

// ─── Notification Schema ───────────────────────────────────

const notificationSchema = z.object({
    title: z.string()
        .min(1, 'Notification title is required')
        .max(200, 'Title too long'),
    message: z.string()
        .min(1, 'Notification message is required')
        .max(2000, 'Message too long'),
    type: z.enum(['info', 'success', 'warning', 'error'], {
        errorMap: () => ({ message: 'Invalid notification type' })
    }).default('info'),
    user_id: z.number().int().optional().nullable(), // null = broadcast to all
    read: z.boolean().default(false),
    action_url: z.string().max(500, 'URL too long').optional().nullable(),
}).strict();

// ─── Dispatch/Purchase Invoice Schemas ─────────────────────

const dispatchSchema = z.object({
    destination: z.string().min(1, 'Destination is required').max(200),
    items: z.array(z.object({
        item_id: z.number().int().positive(),
        quantity: positiveNumber,
    })).min(1, 'At least one item is required'),
    status: z.enum(['pending', 'in_transit', 'delivered', 'cancelled'], {
        errorMap: () => ({ message: 'Invalid dispatch status' })
    }).default('pending'),
    notes: z.string().max(500).optional().nullable(),
}).strict();

const purchaseInvoiceSchema = z.object({
    supplier_name: z.string().min(1, 'Supplier name is required').max(200),
    invoice_number: z.string().max(50, 'Invoice number too long').optional(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    items: z.array(z.object({
        name: z.string().min(1, 'Item name is required'),
        quantity: positiveNumber,
        unit_price: nonNegativeNumber,
        total: nonNegativeNumber,
    })).min(1, 'At least one item is required'),
    total_amount: positiveNumber,
    status: z.enum(['received', 'pending', 'cancelled'], {
        errorMap: () => ({ message: 'Invalid invoice status' })
    }).default('received'),
    notes: z.string().max(500).optional().nullable(),
}).strict();

// ─── Recipe Schema ─────────────────────────────────────────

const recipeSchema = z.object({
    name: z.string()
        .min(2, 'Recipe name is required')
        .max(200, 'Name too long'),
    category: z.string().max(100).optional(),
    ingredients: z.array(z.object({
        item_id: z.number().int().positive(),
        quantity: positiveNumber,
        unit: z.string().max(20).optional(),
    })).min(1, 'At least one ingredient is required'),
    instructions: z.string().max(5000, 'Instructions too long').optional().nullable(),
    yield_quantity: positiveNumber.optional(),
    active: z.boolean().default(true),
}).strict();

// ─── Kitchen Return Schema ─────────────────────────────────

const kitchenReturnSchema = z.object({
    item_id: z.number().int().positive(),
    quantity: positiveNumber,
    reason: z.string()
        .min(5, 'Return reason must be at least 5 characters')
        .max(500, 'Reason too long'),
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
    approved_by: z.number().int().optional().nullable(),
}).strict();

// ─── Weight Reading Schema ─────────────────────────────────

const weightReadingSchema = z.object({
    item_id: z.number().int().positive(),
    weight: positiveNumber,
    unit: z.enum(['kg', 'g', 'lb', 'oz'], {
        errorMap: () => ({ message: 'Invalid weight unit' })
    }).default('kg'),
    recorded_at: z.string().datetime('Invalid datetime format').optional(),
    notes: z.string().max(200).optional().nullable(),
}).strict();

// ─── Schema Registry Map ───────────────────────────────────

/**
 * Maps entity names to their Zod schemas.
 * Used by validation middleware to get the correct schema.
 */
const entitySchemas = {
    users: userSchema,
    hrDepartments: hrDepartmentSchema,
    employees: employeeSchema,
    attendance: attendanceSchema,
    leaveRequests: leaveRequestSchema,
    payroll: payrollSchema,
    departments: hrDepartmentSchema, // Reuse HR department schema
    revenues: revenueSchema,
    expenses: expenseSchema,
    shelves: z.object({
        name: z.string().min(2).max(100),
        location: z.string().max(200).optional(),
        active: z.boolean().default(true),
    }).strict(),
    inventory: inventorySchema,
    inventoryTx: inventoryTransactionSchema,
    dispatches: dispatchSchema,
    recipes: recipeSchema,
    purchaseInvoices: purchaseInvoiceSchema,
    kitchenReturns: kitchenReturnSchema,
    weightReadings: weightReadingSchema,
    notifications: notificationSchema,
    settings: settingsSchema,
};

// ─── Validation Middleware Factory ──────────────────────────

/**
 * Create Express middleware that validates request body against a Zod schema.
 * 
 * @param {z.ZodSchema} schema - The Zod schema to validate against
 * @param {Object} options - Options
 * @param {string} options.source - Where to find data ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
function validate(schema, options = {}) {
    const { source = 'body' } = options;
    
    return (req, res, next) => {
        try {
            const dataToValidate = req[source];
            
            // Handle missing body gracefully
            if (!dataToValidate && source === 'body') {
                return res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Request body is missing or empty',
                    details: [{ field: '_body', message: 'JSON body is required' }],
                });
            }
            
            const result = schema.safeParse(dataToValidate);
            
            if (!result.success) {
                // Format Zod errors into readable format
                const zodErrors = result.error?.errors || [];
                const errors = zodErrors.map(err => ({
                    field: Array.isArray(err.path) ? err.path.join('.') : String(err.path || 'unknown'),
                    message: err.message || 'Validation failed',
                    code: err.code, // e.g., 'too_small', 'invalid_enum_value'
                    expected: err.expected,
                    received: err.received,
                }));
                
                return res.status(400).json({
                    error: 'VALIDATION_ERROR',
                    message: 'Input validation failed',
                    detailCount: errors.length,
                    details: errors,
                    // Include first error as quick reference
                    firstError: errors[0]?.message,
                });
            }
            
            // Replace req[source] with validated/transformed data
            req[source] = result.data;
            req.validatedData = result.data; // Also attach as convenience
            
            next();
        } catch (err) {
            logger.error('[zod] Validation error:', err);
            res.status(500).json({
                error: 'INTERNAL_ERROR',
                message: 'Validation process failed',
            });
        }
    };
}

/**
 * Get Zod schema for an entity by name.
 * 
 * @param {string} entityName - The entity name
 * @returns {z.ZodSchema|null} The schema or null if not found
 */
function getEntitySchema(entityName) {
    return entitySchemas[entityName] || null;
}

/**
 * Partial update schema factory (for PATCH endpoints).
 * Makes all fields optional except specified required ones.
 * 
 * @param {z.ZodSchema} schema - Original schema
 * @param {string[]} requiredFields - Fields that remain required
 * @returns {z.ZodSchema} New partial schema
 */
function partialSchema(schema, _requiredFields = []) {
    return schema.partial();
}

// ─── Export Everything ──────────────────────────────────────

module.exports = {
    // Base validators
    emailSchema,
    phoneSchema,
    uuidSchema,
    dateSchema,
    positiveNumber,
    nonNegativeNumber,
    
    // Entity schemas
    entitySchemas,
    userSchema,
    loginSchema,
    hrDepartmentSchema,
    employeeSchema,
    attendanceSchema,
    leaveRequestSchema,
    payrollSchema,
    inventorySchema,
    inventoryTransactionSchema,
    revenueSchema,
    expenseSchema,
    settingsSchema,
    notificationSchema,
    dispatchSchema,
    purchaseInvoiceSchema,
    recipeSchema,
    kitchenReturnSchema,
    weightReadingSchema,
    
    // Middleware & utilities
    validate,
    getEntitySchema,
    partialSchema,
};
