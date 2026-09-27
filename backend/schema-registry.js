/**
 * schema-registry.js — Entity Schema & Column Whitelist Registry
 * ────────────────────────────────────────────────────────────────────────────
 * Defines allowed columns, types, and constraints for each entity.
 * Used by CRUD middleware to prevent identifier injection and enforce data integrity.
 *
 * Security: Any column NOT in the whitelist will be rejected before reaching SQL.
 */

// ─── Column Type Definitions ─────────────────────────────
const TYPES = {
    STRING: 'string',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    DATE: 'date',
    JSON: 'json',
    TEXT: 'text',       // Long string (no length limit)
    UUID: 'uuid',       // UUID format
    ENUM: 'enum',       // Enumerated value (see allowedValues)
};

// ─── Entity Schemas ──────────────────────────────────────
/**
 * Schema definition for each entity:
 * - writeable: Columns that can be set during INSERT/UPDATE
 * - required: Columns that MUST be present during INSERT
 * - types: Map of column → data type
 * - allowedValues: For enum columns, list of valid values
 * - readOnly: Columns that exist but should never be set by client (auto-filled)
 * - maxLength: Max string length (for text fields)
 */
const entitySchemas = {
    // ─── Users (sensitive: role/id are admin-only) ────
    users: {
        writeable: ['username', 'password', 'name', 'email', 'phone', 'active', 'role', 'dept_code'],
        required: ['username', 'name'],
        types: {
            username: TYPES.STRING,
            password: TYPES.STRING,
            name: TYPES.STRING,
            email: TYPES.STRING,
            phone: TYPES.STRING,
            active: TYPES.BOOLEAN,
            role: TYPES.ENUM,
            dept_code: TYPES.STRING,
        },
        allowedValues: {
            // Must match the roles defined in frontend/app/js/app.js (ROLES)
            // and the seed data in database/migrations/002_seed.sql.
            role: ['admin', 'manager', 'cashier', 'auditor', 'warehouse', 'kitchen', 'hr', 'employee', 'accountant', 'dept_head'],
        },
        maxLength: {
            username: 100,
            name: 200,
            email: 255,
            phone: 20,
            dept_code: 50,
        },
        // These should NEVER come from req.body (server-managed)
        protected: ['id', 'created_at', 'updated_at', 'last_login_at', 'is_admin'],
        description: 'System users with authentication',
    },

    // ─── HR Departments ─────────────────────────────────
    // NOTE: column names must match migration 001 (camelCase quoted identifiers)
    hrDepartments: {
        writeable: ['name', 'code', 'manager'],
        required: ['name', 'code'],
        types: {
            name: TYPES.STRING,
            code: TYPES.STRING,
            manager: TYPES.STRING,
        },
        maxLength: { name: 150, code: 20, manager: 255 },
        protected: ['id'],
        description: 'HR organizational departments',
    },

    // ─── Employees (migration 001: camelCase quoted columns) ────
    employees: {
        writeable: [
            'name', 'employeeId', 'department', 'position',
            'phone', 'email', 'joinDate', 'salary', 'status',
            'userId', 'iqamaExpiry', 'healthCertExpiry', 'healthEduExpiry',
            'photo', 'digitalFingerprint', 'cardId',
            'deviceUserId',  // رقم الموظف على جهاز البصمة (migration 038)
            'shift_start', 'shift_karim',  // الوردية (migration 040)
            'auto_checkout',  // انصراف تلقائي — مدير فقط (migration 044)
            'auto_lock'  // قفل اليوم بعد الإغلاق التلقائي — مدير فقط (migration 046)
        ],
        required: ['name', 'employeeId'],
        types: {
            name: TYPES.STRING,
            employeeId: TYPES.STRING,
            department: TYPES.STRING,
            position: TYPES.STRING,
            phone: TYPES.STRING,
            email: TYPES.STRING,
            joinDate: TYPES.STRING,      // stored as VARCHAR(50)
            salary: TYPES.NUMBER,
            status: TYPES.STRING,        // free-form (active, on_leave, ...)
            userId: TYPES.NUMBER,
            iqamaExpiry: TYPES.STRING,
            healthCertExpiry: TYPES.STRING,
            healthEduExpiry: TYPES.STRING,
            photo: TYPES.TEXT,
            digitalFingerprint: TYPES.STRING,
            cardId: TYPES.STRING,
            deviceUserId: TYPES.STRING,
            shift_start: TYPES.STRING,
            shift_karim: TYPES.NUMBER,
            auto_checkout: TYPES.BOOLEAN,
            auto_lock: TYPES.BOOLEAN,
        },
        maxLength: {
            name: 255, employeeId: 50, department: 50, position: 255,
            phone: 50, email: 255, status: 50,
            iqamaExpiry: 50, healthCertExpiry: 50, healthEduExpiry: 50,
            digitalFingerprint: 100, cardId: 100,
            deviceUserId: 64, shift_start: 5,
        },
        protected: ['id'],
        description: 'Employee records',
    },

    // ─── Attendance (migration 001) ────────────────────
    attendance: {
        writeable: ['employeeId', 'date', 'checkIn', 'checkOut', 'late', 'notes', 'early_leave',
            'checkInAt', 'checkOutAt', 'workMinutes', 'checkin_inferred', 'checkout_inferred'],
        required: ['employeeId', 'date'],
        types: {
            employeeId: TYPES.NUMBER,
            date: TYPES.STRING,
            checkIn: TYPES.STRING,
            checkOut: TYPES.STRING,
            late: TYPES.BOOLEAN,
            notes: TYPES.TEXT,
            early_leave: TYPES.BOOLEAN,
            checkInAt: TYPES.STRING,
            checkOutAt: TYPES.STRING,
            workMinutes: TYPES.NUMBER,
            checkin_inferred: TYPES.BOOLEAN,
            checkout_inferred: TYPES.BOOLEAN,
        },
        protected: ['id'],
        description: 'Employee attendance records',
    },

    // ─── HR Suite (migration 048) ────
    salary_advances: {
        writeable: ['employeeId', 'amount', 'date', 'monthly_deduction', 'remaining', 'status', 'notes'],
        required: ['employeeId', 'amount', 'date'],
        types: { employeeId: TYPES.NUMBER, amount: TYPES.NUMBER, date: TYPES.STRING, monthly_deduction: TYPES.NUMBER, remaining: TYPES.NUMBER, status: TYPES.STRING, notes: TYPES.TEXT },
        protected: ['id'],
        description: 'Employee salary advances',
    },
    payroll_adjustments: {
        writeable: ['employeeId', 'month', 'kind', 'amount', 'reason'],
        required: ['employeeId', 'month', 'kind', 'amount'],
        types: { employeeId: TYPES.NUMBER, month: TYPES.STRING, kind: TYPES.STRING, amount: TYPES.NUMBER, reason: TYPES.STRING },
        protected: ['id'],
        description: 'Payroll penalties and bonuses',
    },
    employee_contracts: {
        writeable: ['employeeId', 'start_date', 'end_date', 'salary', 'notes'],
        required: ['employeeId', 'start_date', 'end_date'],
        types: { employeeId: TYPES.NUMBER, start_date: TYPES.STRING, end_date: TYPES.STRING, salary: TYPES.NUMBER, notes: TYPES.TEXT },
        protected: ['id'],
        description: 'Employment contracts',
    },
    employee_evaluations: {
        writeable: ['employeeId', 'period', 'score', 'notes', 'evaluator'],
        required: ['employeeId', 'period', 'score'],
        types: { employeeId: TYPES.NUMBER, period: TYPES.STRING, score: TYPES.NUMBER, notes: TYPES.TEXT, evaluator: TYPES.STRING },
        protected: ['id'],
        description: 'Performance evaluations',
    },
    payroll_runs: {
        writeable: ['employeeId', 'period', 'grossAmount', 'netAmount', 'status'],
        required: ['employeeId', 'period'],
        types: {
            employeeId: TYPES.NUMBER,
            period: TYPES.STRING,
            grossAmount: TYPES.NUMBER,
            netAmount: TYPES.NUMBER,
            status: TYPES.STRING,
        },
        protected: ['id'],
        description: 'Payroll run headers (system-generated)',
    },

    // ─── Leave Types (migration 001) ───────────────────
    leaveTypes: {
        writeable: ['name', 'days', 'icon', 'paid'],
        required: ['name'],
        types: {
            name: TYPES.STRING,
            days: TYPES.NUMBER,
            icon: TYPES.STRING,
            paid: TYPES.BOOLEAN,
        },
        maxLength: { name: 255, icon: 50 },
        protected: ['id'],
        description: 'Leave type definitions',
    },

    // ─── Leave Requests (migration 001) ────────────────
    leaveRequests: {
        writeable: ['employeeId', 'leaveTypeId', 'startDate', 'endDate', 'status', 'reason', 'requestDate', 'requestedBy', 'approvedBy', 'approvedDate', 'rejectionReason', 'rejectedBy', 'rejectedDate'],
        required: ['employeeId'],
        types: {
            employeeId: TYPES.NUMBER,
            leaveTypeId: TYPES.NUMBER,
            startDate: TYPES.STRING,
            endDate: TYPES.STRING,
            status: TYPES.STRING,
            reason: TYPES.TEXT,
            requestDate: TYPES.STRING,
            requestedBy: TYPES.NUMBER,
            approvedBy: TYPES.NUMBER,
            approvedDate: TYPES.STRING,
            rejectionReason: TYPES.TEXT,
            rejectedBy: TYPES.NUMBER,
            rejectedDate: TYPES.STRING,
        },
        maxLength: { status: 50, startDate: 50, endDate: 50, requestDate: 50, approvedDate: 50, rejectedDate: 50 },
        protected: ['id'],
        description: 'Employee leave requests',
    },

    // ─── Payroll (HIGHLY SENSITIVE — admin only) ──────
    payroll: {
        writeable: [
            'employeeId', 'month', 'year',
            'basicSalary', 'allowances', 'deductions', 'netSalary', 'status'
        ],
        required: ['employeeId'],
        types: {
            employeeId: TYPES.NUMBER,
            month: TYPES.STRING,
            year: TYPES.NUMBER,
            basicSalary: TYPES.NUMBER,
            allowances: TYPES.NUMBER,
            deductions: TYPES.NUMBER,
            netSalary: TYPES.NUMBER,
            status: TYPES.STRING,
        },
        maxLength: { month: 50, status: 50 },
        protected: ['id'],
        description: 'Payroll records (admin/manager only)',
    },

    // ─── Departments (Operational — migration 001) ─────
    departments: {
        writeable: ['code', 'name', 'icon', 'color', 'parent_code'],
        required: ['code', 'name'],
        types: {
            code: TYPES.STRING,
            name: TYPES.STRING,
            icon: TYPES.STRING,
            color: TYPES.STRING,
            parent_code: TYPES.STRING,
        },
        maxLength: { code: 50, name: 255, icon: 50, color: 50, parent_code: 50 },
        protected: ['id'],
        description: 'Operational departments',
    },

    // ─── Revenues (migration 001) ──────────────────────
    revenues: {
        writeable: ['deptId', 'source', 'amount', 'date', 'notes'],
        required: ['amount', 'date'],
        types: {
            deptId: TYPES.STRING,
            source: TYPES.STRING,
            amount: TYPES.NUMBER,
            date: TYPES.STRING,
            notes: TYPES.TEXT,
        },
        maxLength: { deptId: 50, source: 255 },
        protected: ['id'],
        description: 'Revenue entries',
    },

    // ─── Expenses (migration 001) ──────────────────────
    expenses: {
        writeable: ['deptId', 'desc', 'amount', 'date', 'notes', 'autoGenerated', 'category', 'adjustmentType'],
        required: ['amount', 'date'],
        types: {
            deptId: TYPES.STRING,
            desc: TYPES.STRING,
            amount: TYPES.NUMBER,
            date: TYPES.STRING,
            notes: TYPES.TEXT,
            autoGenerated: TYPES.BOOLEAN,
            category: TYPES.STRING,
            adjustmentType: TYPES.STRING,
        },
        maxLength: { deptId: 50, desc: 255, category: 100, adjustmentType: 50 },
        protected: ['id'],
        description: 'Expense entries',
    },

    // ─── Shelves (migration 001) ───────────────────────
    shelves: {
        writeable: ['name', 'code', 'location', 'capacity', 'icon'],
        required: ['name'],
        types: {
            name: TYPES.STRING,
            code: TYPES.STRING,
            location: TYPES.STRING,
            capacity: TYPES.NUMBER,
            icon: TYPES.STRING,
        },
        maxLength: { name: 255, code: 50, location: 255, icon: 50 },
        protected: ['id'],
        description: 'Storage shelves/locations',
    },

    // ─── Inventory (migration 001 + 010: barcode + 061: catch weight + 066: secondary units) ──────
    inventory: {
        writeable: [
            'name', 'category', 'unit', 'qty', 'avgCost',
            'minQty', 'shelfId', 'weight', 'barcode',
            'catch_weight_enabled', 'inventory_uom', 'packaging_uom', 'catch_weight_uom',
            'secondary_units'
        ],
        required: ['name'],
        types: {
            name: TYPES.STRING,
            category: TYPES.STRING,
            unit: TYPES.STRING,
            qty: TYPES.NUMBER,
            avgCost: TYPES.NUMBER,
            minQty: TYPES.NUMBER,
            shelfId: TYPES.NUMBER,
            weight: TYPES.NUMBER,
            barcode: TYPES.STRING,
            catch_weight_enabled: TYPES.BOOLEAN,
            inventory_uom: TYPES.STRING,
            packaging_uom: TYPES.STRING,
            catch_weight_uom: TYPES.STRING,
            secondary_units: TYPES.JSON,
        },
        maxLength: { name: 255, category: 100, unit: 50, barcode: 100, inventory_uom: 20, packaging_uom: 20, catch_weight_uom: 20 },
        protected: ['id'],
        description: 'Inventory items',
    },

    // ─── Inventory Transactions (migration 001 + 061: catch weight) ───────
    inventoryTx: {
        writeable: [
            'itemId', 'itemName', 'qty', 'type', 'date',
            'cost', 'totalValue', 'notes', 'invoiceNumber',
            'supplierName', 'weight', 'dispatchId',
            'catch_weight_qty', 'catch_weight_unit'
        ],
        required: ['itemId', 'qty', 'type'],
        types: {
            itemId: TYPES.NUMBER,
            itemName: TYPES.STRING,
            qty: TYPES.NUMBER,
            type: TYPES.STRING,
            date: TYPES.STRING,
            cost: TYPES.NUMBER,
            totalValue: TYPES.NUMBER,
            notes: TYPES.TEXT,
            invoiceNumber: TYPES.STRING,
            supplierName: TYPES.STRING,
            weight: TYPES.NUMBER,
            dispatchId: TYPES.STRING,
            catch_weight_qty: TYPES.NUMBER,
            catch_weight_unit: TYPES.STRING,
        },
        maxLength: { itemName: 255, type: 50, invoiceNumber: 255, supplierName: 255, dispatchId: 255, catch_weight_unit: 20 },
        protected: ['id'],
        description: 'Inventory movement transactions',
    },

    // ─── Dispatches (migration 001) ───────────────────
    dispatches: {
        writeable: ['deptCode', 'deptName', 'items', 'status', 'date', 'createdBy', 'notes', 'approvedDate', 'approvedBy', 'approveNotes', 'approvedItems', 'rejectionReason', 'rejectedBy', 'rejectedDate'],
        required: ['items'],
        types: {
            deptCode: TYPES.STRING,
            deptName: TYPES.STRING,
            items: TYPES.JSON,
            status: TYPES.STRING,
            date: TYPES.STRING,
            createdBy: TYPES.STRING,
            notes: TYPES.TEXT,
            approvedDate: TYPES.STRING,
            approvedBy: TYPES.STRING,
            approveNotes: TYPES.TEXT,
            approvedItems: TYPES.JSON,
            rejectionReason: TYPES.TEXT,
            rejectedBy: TYPES.STRING,
            rejectedDate: TYPES.STRING,
        },
        maxLength: { deptCode: 50, deptName: 255, status: 50, date: 50, createdBy: 100, approvedDate: 50, approvedBy: 100, rejectedBy: 100, rejectedDate: 50 },
        protected: [
            'id',
            // Task 19: حقول اعتماد الشيف العمومي تُدار حصريًا عبر مسارات /warehouse/dispatches
            'creatorRole', 'needsChefApproval',
            'chefApprovedAt', 'chefApprovedBy', 'chefApprovalSignatureData', 'chefApprovalSignatureHash',
            'chefRejectedAt', 'chefRejectedBy', 'chefRejectionSignatureData', 'chefRejectionSignatureHash',
        ],
        description: 'Inter-department dispatches',
    },

    // ─── Recipes (migration 001) ───────────────────────
    recipes: {
        writeable: ['name', 'deptId', 'sellingPrice', 'totalCost', 'costRatio'],
        required: ['name'],
        types: {
            name: TYPES.STRING,
            deptId: TYPES.STRING,
            sellingPrice: TYPES.NUMBER,
            totalCost: TYPES.NUMBER,
            costRatio: TYPES.NUMBER,
        },
        maxLength: { name: 255, deptId: 50 },
        protected: ['id'],
        description: 'Recipes with cost analysis',
    },

    // ─── Purchase Invoices (migration 001) ────────────
    purchaseInvoices: {
        writeable: [
            'invoiceNumber', 'date', 'supplierName', 'supplierPhone',
            'items', 'totalAmount', 'paymentMethod', 'notes',
            'createdAt', 'createdBy'
        ],
        required: ['totalAmount'],
        types: {
            invoiceNumber: TYPES.STRING,
            date: TYPES.STRING,
            supplierName: TYPES.STRING,
            supplierPhone: TYPES.STRING,
            items: TYPES.JSON,
            totalAmount: TYPES.NUMBER,
            paymentMethod: TYPES.STRING,
            notes: TYPES.TEXT,
            createdAt: TYPES.STRING,
            createdBy: TYPES.STRING,
        },
        maxLength: {
            invoiceNumber: 255, date: 50, supplierName: 255,
            supplierPhone: 50, paymentMethod: 50, createdAt: 50, createdBy: 100,
        },
        protected: ['id'],
        description: 'Purchase invoices from vendors',
    },

    // ─── Kitchen Returns (migration 001) ──────────────
    kitchenReturns: {
        writeable: ['date', 'items', 'status', 'notes', 'reason', 'dispatchId', 'deptCode', 'deptName', 'totalValue', 'createdBy'],
        required: ['items'],
        types: {
            date: TYPES.STRING,
            items: TYPES.JSON,
            status: TYPES.STRING,
            notes: TYPES.TEXT,
            reason: TYPES.TEXT,
            dispatchId: TYPES.STRING,
            deptCode: TYPES.STRING,
            deptName: TYPES.STRING,
            totalValue: TYPES.NUMBER,
            createdBy: TYPES.STRING,
        },
        maxLength: { date: 50, status: 50, dispatchId: 255, deptCode: 50, deptName: 255, createdBy: 100 },
        protected: ['id'],
        description: 'Kitchen item returns/refunds',
    },

    // ─── Weight Readings (migration 001) ──────────────
    weightReadings: {
        writeable: ['weight', 'unit', 'date', 'itemId', 'time', 'timestamp', 'itemName', 'notes', 'recordedBy'],
        required: ['weight'],
        types: {
            weight: TYPES.NUMBER,
            unit: TYPES.STRING,
            date: TYPES.STRING,
            itemId: TYPES.NUMBER,
            time: TYPES.STRING,
            timestamp: TYPES.STRING,
            itemName: TYPES.STRING,
            notes: TYPES.TEXT,
            recordedBy: TYPES.STRING,
        },
        maxLength: { unit: 50, date: 50, time: 50, timestamp: 50, itemName: 255, recordedBy: 100 },
        protected: ['id'],
        description: 'Scale weight readings',
    },

    // ─── Notifications (migration 001) ────────────────
    notifications: {
        writeable: ['title', 'message', 'type', 'date', 'read'],
        required: ['title', 'message'],
        types: {
            title: TYPES.STRING,
            message: TYPES.TEXT,
            type: TYPES.STRING,
            date: TYPES.STRING,
            read: TYPES.BOOLEAN,
        },
        maxLength: { title: 255, type: 50, date: 50 },
        protected: ['id'],
        description: 'User notifications',
    },

    // ─── Settings (ADMIN ONLY — migration 001) ────────
    settings: {
        writeable: ['name', 'logo', 'logoB64', 'currency', 'lowStockAlert', 'workStartHour'],
        required: ['name'],
        types: {
            name: TYPES.STRING,
            logo: TYPES.STRING,
            logoB64: TYPES.TEXT,
            currency: TYPES.STRING,
            lowStockAlert: TYPES.BOOLEAN,
            workStartHour: TYPES.NUMBER,
        },
        maxLength: { name: 255, logo: 100, currency: 50 },
        protected: ['id'],
        description: 'System settings (admin only)',
    },
};

// ─── Validation Functions ──────────────────────────────

/**
 * Validate a column name against security rules.
 * Only allows alphanumeric characters and underscores.
 *
 * @param {string} columnName - The column name to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateColumnName(columnName) {
    if (typeof columnName !== 'string') {
        return { valid: false, reason: 'اسم العمود يجب أن يكون نصًا' };
    }

    // Only allow [a-zA-Z0-9_]
    const safePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!safePattern.test(columnName)) {
        return { valid: false, reason: `اسم العمود غير صالح: "${columnName}" — يُسمح بالحروف والأرقام والشرطة السفلية فقط` };
    }

    // Prevent reserved SQL keywords that shouldn't be column names
    const reservedKeywords = new Set([
        'select', 'insert', 'update', 'delete', 'drop', 'truncate',
        'exec', 'execute', 'union', 'where', 'from', 'join', 'table',
        'column', 'database', 'schema', 'index', 'constraint', 'trigger',
        'function', 'procedure', 'grant', 'revoke', 'commit', 'rollback',
    ]);

    if (reservedKeywords.has(columnName.toLowerCase())) {
        return { valid: false, reason: `كلمة محجوزة لا تصلح اسم عمود: "${columnName}"` };
    }

    return { valid: true };
}

/**
 * Get the schema definition for an entity.
 *
 * @param {string} entityName - The entity/table name
 * @returns {object|null} The schema or null if not found
 */
function getSchema(entityName) {
    return entitySchemas[entityName] || null;
}

/**
 * Check if an entity exists in the registry.
 *
 * @param {string} entityName - The entity/table name
 * @returns {boolean}
 */
function entityExists(entityName) {
    return entityName in entitySchemas;
}

/**
 * Filter request body against entity's whitelist.
 * Removes any keys not in the writeable list and validates values.
 *
 * @param {string} entityName - The entity name
 * @param {object} body - The request body to filter
 * @param {string} [operation='create'] - 'create' (POST) or 'update' (PUT).
 *        Required-field checks are skipped for 'update' (partial update).
 * @returns {{ filtered: object, errors: string[], removedKeys: string[] }}
 */
function filterBody(entityName, body, operation = 'create') {
    const schema = getSchema(entityName);

    if (!schema) {
        return {
            filtered: {},
            errors: [`نوع البيانات غير معروف: "${entityName}"`],
            removedKeys: Object.keys(body || {}),
        };
    }

    if (!body || typeof body !== 'object') {
        return {
            filtered: {},
            errors: ['يجب إرسال بيانات بصيغة صحيحة (JSON object)'],
            removedKeys: [],
        };
    }

    const filtered = {};
    const errors = [];
    const removedKeys = [];

    for (const [key, value] of Object.entries(body)) {
        // Check if key is in whitelist
        if (!schema.writeable.includes(key)) {
            // Check if it's a protected field (more severe)
            if (schema.protected && schema.protected.includes(key)) {
                errors.push(`الحقل "${key}" محمي ولا يمكن تعديله`);
            } else {
                removedKeys.push(key);
            }
            continue;
        }

        // Validate column name format
        const colValidation = validateColumnName(key);
        if (!colValidation.valid) {
            errors.push(colValidation.reason);
            continue;
        }

        // Validate value type if defined
        const expectedType = schema.types[key];
        if (expectedType && value !== null && value !== undefined) {
            const typeValidation = validateType(key, value, expectedType, schema);
            if (!typeValidation.valid) {
                errors.push(typeValidation.error);
                continue;
            }
        }

        // Check max length for strings
        if (schema.maxLength && schema.maxLength[key] && typeof value === 'string' && value.length > schema.maxLength[key]) {
            errors.push(`الحقل "${key}" أطول من المسموح (الحد الأقصى ${schema.maxLength[key]} حرفًا)`);
            continue;
        }

        // Check enum values
        if (schema.allowedValues && schema.allowedValues[key] && value !== null && value !== undefined && !schema.allowedValues[key].includes(value)) {
            errors.push(`قيمة غير صالحة للحقل "${key}" — القيم المسموحة: ${schema.allowedValues[key].join('، ')}`);
            continue;
        }

        filtered[key] = value;
    }

    // Check required fields ONLY for create (POST). For update (PUT),
    // partial updates are allowed — only the fields the client sent are
    // validated, and required fields already in the DB remain untouched.
    if (operation === 'create') {
        const missingRequired = (schema.required || []).filter(req => !(req in filtered));
        if (missingRequired.length > 0) {
            errors.push(`حقول مطلوبة ناقصة: ${missingRequired.join('، ')}`);
        }
    }

    return { filtered, errors, removedKeys };
}

/**
 * Validate a value against its expected type.
 *
 * @param {string} fieldName - Field name for error messages
 * @param {*} value - Value to validate
 * @param {string} expectedType - Expected type constant
 * @param {object} schema - Full schema for context
 * @returns {{ valid: boolean, error?: string }}
 */
function validateType(fieldName, value, expectedType, schema) {
    switch (expectedType) {
        case TYPES.NUMBER:
            if (typeof value !== 'number' && isNaN(Number(value))) {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون رقمًا` };
            }
            break;

        case TYPES.BOOLEAN:
            if (typeof value !== 'boolean' && value !== 0 && value !== 1) {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون نعم/لا (true/false)` };
            }
            break;

        case TYPES.DATE:
            if (!(value instanceof Date) && isNaN(Date.parse(value))) {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون تاريخًا صحيحًا` };
            }
            break;

        case TYPES.JSON:
            try {
                if (typeof value === 'string') {
                    JSON.parse(value);
                } else if (typeof value !== 'object') {
                    return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون بيانات JSON صحيحة` };
                }
            } catch (e) {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون بيانات JSON صحيحة` };
            }
            break;

        case TYPES.UUID:
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidPattern.test(value)) {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون معرفًا فريدًا صحيحًا (UUID)` };
            }
            break;

        case TYPES.STRING:
        case TYPES.TEXT:
            if (typeof value !== 'string') {
                return { valid: false, error: `الحقل "${fieldName}" يجب أن يكون نصًا` };
            }
            break;

        default:
            // Allow any type if not explicitly defined
            break;
    }

    return { valid: true };
}

/**
 * Get all registered entity names.
 *
 * @returns {string[]}
 */
function getEntityNames() {
    return Object.keys(entitySchemas);
}

/**
 * Get allowed sort columns for pagination queries.
 * Returns all writeable + id columns.
 *
 * @param {string} entityName - Entity name
 * @returns {string[]}
 */
function getSortableColumns(entityName) {
    const schema = getSchema(entityName);
    if (!schema) {return [];}
    return [...(schema.writeable || []), 'id'];
}

// ─── Security audit (2026-09-03): write-role map for generic CRUD ────────────
// الكيانات التي لا تدخل في adminEntities كانت تُكتب (POST/PUT/DELETE) بأي حساب
// مُصادق — ثغرة تصعيد صلاحيات أفقية مؤكدة حيًا (مستخدم مطبخ أنشأ وحذف مصروفًا
// بـ 201/200). هذه الخريطة تُقفل الكتابة على الأدوار التي تملك الشاشة فعلًا
// (مطابقة لخريطة قوائم الواجهة ROLES في app.js). notifications تبقى مفتوحة
// عمدًا (كل مستخدم يرسل إشعارات)، والكيانات الإدارية لها حرسها الخاص.
const OPEN_ENTITY_WRITE_ROLES = Object.freeze({
    revenues:        ['admin', 'manager', 'accountant'],
    expenses:        ['admin', 'manager', 'accountant'],
    purchaseInvoices:['admin', 'manager', 'warehouse', 'accountant'],
    inventory:       ['admin', 'manager', 'warehouse'],
    inventoryTx:     ['admin', 'manager', 'warehouse'],
    shelves:         ['admin', 'manager', 'warehouse'],
    employees:       ['admin', 'manager', 'hr'],
    hrDepartments:   ['admin', 'manager', 'hr'],
    // attendance خارج الخريطة عمداً: تسجيل الدخول/الانصراف خدمة ذاتية لأي موظف
    // مرتبط — الحماية عبر enforceAttendanceSelfService (نفسه فقط) في server.js،
    // وadmin/manager/hr يتحكمون بكل السجلات.
    leaveTypes:      ['admin', 'manager', 'hr'],
    leaveRequests:   ['admin', 'manager', 'hr'], // الإرسال الفعلي عبر /api/hr/leave-requests
    departments:     ['admin', 'manager'],
    recipes:         ['admin', 'manager', 'kitchen'],
    kitchenReturns:  ['admin', 'manager', 'warehouse', 'kitchen', 'dept_head'],
    weightReadings:  ['admin', 'manager', 'kitchen', 'warehouse'],
    salary_advances:      ['admin', 'manager', 'hr'],
    payroll_adjustments:  ['admin', 'manager', 'hr'],
    employee_contracts:   ['admin', 'manager', 'hr'],
    employee_evaluations: ['admin', 'manager', 'hr'],
    payroll_runs:         ['admin', 'manager', 'hr', 'accountant'],
});

/**
 * Returns the allowed write roles for a generic entity, or null when the
 * entity stays open to every authenticated principal (notifications).
 */
function getEntityWriteRoles(entityName) {
    return OPEN_ENTITY_WRITE_ROLES[entityName] || null;
}

// ─── Security audit round 2 (2026-09-03): append-only / protected entities ──
// حذف هذه السجلات عبر CRUD العام يهدم السلامة المالية:
//   inventoryTx      — دفتر حركات المخزون (تاريخ مالي؛ حذفه تزوير للسجل)
//   kitchenReturns   — المرتجعات تُغلق سقف الإرجاع؛ حذف صفها يعيد فتح السقف
//                      فيسمح بإرجاع نفس الكمية مرة أخرى (تضخيم مخزون)
//   purchaseInvoices — رصيد المورد المستحق = مجموع الفواتير − الدفعات؛
//                      حذف فاتورة غير مسددة يمحو دينًا حقيقيًا
// الواجهة لا تستدعي DELETE على أي منها (persistRemove تُستخدم فقط على
// employees/inventory/shelves/recipes/revenues/expenses/departments/hrDepartments/users)
const PROTECTED_DELETE_ENTITIES = Object.freeze(['inventoryTx', 'kitchenReturns',
'purchaseInvoices', 'payroll_runs']);

function isProtectedDeleteEntity(entityName) {
    return PROTECTED_DELETE_ENTITIES.includes(entityName);
}

// ─── Security audit round 2: إخفاء رواتب الموظفين عن الأدوار غير المرتفعة ────
// شاشة الموظفين في الواجهة مقصورة على admin/manager/hr، لكن بوابة الموظف
// (لكل الأدوار) تحتاج قراءة ملفه الشخصي من قائمة employees — فالقائمة تبقى
// متاحة والحقول المالية (salary) تُخفى لغير الأدوار المرتفعة.
const EMPLOYEE_SENSITIVE_FIELDS = Object.freeze(['salary']);
const EMPLOYEE_ELEVATED_ROLES = Object.freeze(['admin', 'manager', 'hr']);

function maskEmployeeRowForRole(row, role) {
    if (!row || typeof row !== 'object') {return row;}
    if (EMPLOYEE_ELEVATED_ROLES.includes(role)) {return row;}
    const safe = { ...row };
    for (const field of EMPLOYEE_SENSITIVE_FIELDS) {delete safe[field];}
    return safe;
}

module.exports = {
    // Constants
    TYPES,
    entitySchemas,
    OPEN_ENTITY_WRITE_ROLES,
    PROTECTED_DELETE_ENTITIES,
    EMPLOYEE_SENSITIVE_FIELDS,
    EMPLOYEE_ELEVATED_ROLES,

    // Validation functions
    validateColumnName,
    getSchema,
    entityExists,
    filterBody,
    validateType,
    getEntityNames,
    getSortableColumns,
    getEntityWriteRoles,
    isProtectedDeleteEntity,
    maskEmployeeRowForRole,
};
