/**
 * db-validation-middleware.js — Middleware يطبق على جميع routes
 * يربط بين route parameters و table names ويفعل التحقق تلقائياً
 */

const { dbValidationMiddleware, invalidateCache } = require('./db-constraints');

/** خريطة route patterns إلى table names */
const ROUTE_TABLE_MAP = {
  // Employees
  '/api/hr/employees': 'employees',
  '/api/hr/employees/:id': 'employees',
  '/api/hr/employees/:id/card': 'employees',
  '/api/hr/employees/:id/qr/regenerate': 'employees',
  '/api/hr/employees/:id/lux-card': 'employees',
  '/api/hr/card/verify': 'employees', // للقراءة فقط
  
  // Attendance
  '/api/hr/attendance/report': 'attendance',
  '/api/hr/attendance/monthly': 'attendance',
  '/api/hr/attendance/scan': 'attendance',
  '/api/hr/attendance/revert-inferred': 'attendance',
  
  // Payroll
  '/api/hr/payroll-runs/generate': 'payroll',
  '/api/hr/payroll': 'payroll',
  
  // Leave
  '/api/hr/leave': 'leaveRequests',
  '/api/hr/leave/:id': 'leaveRequests',
  '/api/hr/leave-types': 'leaveTypes',
  
  // Devices
  '/api/zk/devices': 'attendance_devices',
  '/api/zk/devices/:id': 'attendance_devices',
  '/api/zk/sync': 'attendance_logs',
  
  // Inventory
  '/api/inventory': 'inventory_items',
  '/api/inventory/:id': 'inventory_items',
  '/api/inventory/categories': 'inventory_categories',
  '/api/inventory/units': 'inventory_units',
  '/api/inventory/warehouses': 'warehouses',
  '/api/inventory/stock-movements': 'stock_movements',
  '/api/inventory/adjustments': 'stock_adjustments',
  
  // Dispatch
  '/api/dispatch': 'dispatches',
  '/api/dispatch/:id': 'dispatches',
  
  // Cashier / POS
  '/api/cashier/orders': 'pos_orders',
  '/api/cashier/orders/:id': 'pos_orders',
  '/api/cashier/products': 'pos_products',
  '/api/cashier/products/:id': 'pos_products',
  '/api/cashier/categories': 'pos_categories',
  '/api/cashier/tables': 'pos_tables',
  
  // Accounting
  '/api/accounting/journal-entries': 'journal_entries',
  '/api/accounting/accounts': 'chart_of_accounts',
  '/api/accounting/fiscal-years': 'fiscal_years',
};

/** استخراج table name من المسار */
function getTableFromPath(path, method) {
  // البحث عن تطابق دقيق أولاً
  if (ROUTE_TABLE_MAP[path]) return ROUTE_TABLE_MAP[path];
  
  // البحث عن pattern مع :id
  for (const [pattern, table] of Object.entries(ROUTE_TABLE_MAP)) {
    const regex = new RegExp('^' + pattern.replace(/:id/g, '\\d+') + '$');
    if (regex.test(path)) return table;
  }
  
  // fallback: محاولة استخراج من المسار
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'api') {
    // /api/hr/employees -> employees
    // /api/inventory/categories -> inventory_categories
    const resource = parts.slice(2).join('_');
    return resource;
  }
  
  return null;
}

/** Middleware عام للتحقق من قيود DB */
function autoDbValidation(options = {}) {
  return async (req, res, next) => {
    // req.path عند التركيب على '/api' يكون نسبيًا (بدون البادئة)،
    // بينما الخريطة بمفاتيح كاملة — نعيد بناء المسار الكامل أولًا.
    const fullPath = ((req.baseUrl || '') + (req.path || '')).replace(/\/+$/, '') || '/';
    const tableName = getTableFromPath(fullPath, req.method);

    if (!tableName) {
      // لا يوجد mapping - نتخطى
      return next();
    }

    // فقط للعمليات الكتابية
    const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!writeMethods.includes(req.method)) {
      return next();
    }

    // تخطي بعض المسارات المعفاة
    const exemptPaths = options.exemptPaths || [];
    if (exemptPaths.some(p => fullPath === p || fullPath.startsWith(p + '/'))) {
      return next();
    }
    
    try {
      const data = req.method === 'DELETE' ? { id: req.params.id } : { ...req.body };
      const excludeId = req.params.id ? Number(req.params.id) : null;
      
      const { validateRow } = require('./db-constraints');
      // صارم لكن عادل: نتحقق فقط مما أُرسل فعلًا (نوع/فريد/مرجع/فحص)،
      // ولا نطالب بحقول ناقصة — فالمسار قد يكون تعديلًا جزئيًا أو إجراءً
      // (مثل /scan) لا يرسل صف جدول أصلًا. الحقول المطلوبة يفرضها كل مسار
      // برسائله العربية الخاصة (مثل فحص نوع الإجازة والتواريخ).
      const result = await validateRow(tableName, data, {
        excludeId,
        checkRequired: false,
        skipUnique: options.skipUnique,
        skipFK: options.skipFK,
        skipChecks: options.skipChecks,
      });
      
      if (!result.ok) {
        const first = result.errors[0]?.message || `البيانات تنتهك قيود جدول ${tableName}`;
        return res.status(422).json({
          error: 'DB_CONSTRAINT_VIOLATION',
          message: `بيانات مرفوضة: ${first}`,
          table: tableName,
          details: result.errors,
        });
      }
      
      req.validatedData = data;
      req.dbValidation = result;
      next();
    } catch (e) {
      console.error('[autoDbValidation]', e);
      // لا نمنع الطلب في حالة خطأ في التحقق - نترك الـ DB يتعامل معه
      next();
    }
  };
}

/** دالة لتسجيل route mappings جديدة */
function registerRouteMapping(pattern, tableName) {
  ROUTE_TABLE_MAP[pattern] = tableName;
}

/** الحصول على جميع mappings */
function getRouteMappings() {
  return { ...ROUTE_TABLE_MAP };
}

module.exports = {
  autoDbValidation,
  getTableFromPath,
  registerRouteMapping,
  getRouteMappings,
  invalidateCache,
};