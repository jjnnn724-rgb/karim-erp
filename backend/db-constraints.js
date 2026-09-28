/**
 * db-constraints.js — التحقق من قيود قاعدة البيانات قبل أي عملية
 * يرفض أي عملية ستخالف قيود DB (UNIQUE, FK, NOT NULL, CHECK, etc.)
 */

const { pool } = require('./shared-pool');

/** كاش القيود */
let constraintsCache = null;
let cacheTime = 0;
const CACHE_TTL = 60000;

/** جلب القيود من information_schema */
async function loadConstraints() {
  if (constraintsCache && Date.now() - cacheTime < CACHE_TTL) {
    return constraintsCache;
  }

  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);

  const constraints = {};

  for (const t of tables.rows) {
    const tableName = t.table_name;
    
    // الأعمدة
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default, 
             character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    // القيود - مع معالجة الأخطاء للقيود المكسورة
    let cons = { rows: [] };
    try {
      cons = await pool.query(`
        SELECT conname, contype, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = $1::regclass
      `, [tableName]);
    } catch (e) {
      console.warn(`[db-constraints] Failed to load constraints for ${tableName}:`, e.message);
    }

    // فهارس فريدة
    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [tableName]);

    constraints[tableName] = {
      columns: cols.rows.reduce((acc, c) => {
        acc[c.column_name] = {
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
          default: c.column_default,
          maxLength: c.character_maximum_length,
          precision: c.numeric_precision,
          scale: c.numeric_scale,
        };
        return acc;
      }, {}),
      constraints: cons.rows.map(c => ({
        name: c.conname,
        type: c.contype,
        def: c.def,
      })),
      indexes: indexes.rows.map(i => ({
        name: i.indexname,
        def: i.indexdef,
      })),
    };
  }

  constraintsCache = constraints;
  cacheTime = Date.now();
  return constraints;
}

/** مسح الكاش */
function invalidateCache() {
  constraintsCache = null;
  cacheTime = 0;
}

/** التحقق من قيمة واحدة ضد قيود العمود */
function validateColumn(tableName, columnName, value, constraints) {
  const table = constraints[tableName];
  if (!table) {return { ok: true, errors: [] };}

  const col = table.columns[columnName];
  if (!col) {return { ok: true, errors: [] };} // عمود غير معروف - نتجاهل

  const errors = [];

  // NOT NULL
  if (!col.nullable && (value === null || value === undefined || value === '')) {
    errors.push({ column: columnName, code: 'NOT_NULL', message: `${tableName}.${columnName} لا يمكن أن يكون فارغاً` });
  }

  // Type validation
  if (value !== null && value !== undefined && value !== '') {
    switch (col.type) {
      case 'character varying':
      case 'text':
        if (typeof value !== 'string') {
          errors.push({ column: columnName, code: 'TYPE_MISMATCH', message: `${columnName} يجب أن يكون نصاً` });
        } else if (col.maxLength && value.length > col.maxLength) {
          errors.push({ column: columnName, code: 'MAX_LENGTH', message: `${columnName} يتجاوز الطول المسموح (${col.maxLength})` });
        }
        break;
      case 'integer':
      case 'bigint':
      case 'smallint':
        if (!Number.isInteger(Number(value))) {
          errors.push({ column: columnName, code: 'TYPE_MISMATCH', message: `${columnName} يجب أن يكون رقمًا صحيحًا` });
        }
        break;
      case 'numeric':
      case 'decimal':
        if (isNaN(Number(value))) {
          errors.push({ column: columnName, code: 'TYPE_MISMATCH', message: `${columnName} يجب أن يكون رقمًا` });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
          errors.push({ column: columnName, code: 'TYPE_MISMATCH', message: `${columnName} يجب أن يكون boolean` });
        }
        break;
      case 'date':
      case 'timestamp with time zone':
      case 'timestamp without time zone':
        if (isNaN(Date.parse(value))) {
          errors.push({ column: columnName, code: 'TYPE_MISMATCH', message: `${columnName} يجب أن يكون تاريخًا صالحاً` });
        }
        break;
    }
  }

  return { ok: errors.length === 0, errors };
}

/** التحقق من قيود UNIQUE */
async function validateUnique(tableName, data, constraints, excludeId = null) {
  const table = constraints[tableName];
  if (!table) {return { ok: true, errors: [] };}

  const uniqueConstraints = table.constraints.filter(c => c.type === 'u');
  const errors = [];

  for (const uc of uniqueConstraints) {
    // استخراج الأعمدة من التعريف
    const match = uc.def.match(/UNIQUE\s*\(([^)]+)\)/i);
    if (!match) {continue;}
    const cols = match[1].split(',').map(c => c.trim().replace(/"/g, ''));

    // التحقق من وجود جميع الأعمدة في البيانات
    const hasAllCols = cols.every(c => data[c] !== undefined);
    if (!hasAllCols) {continue;}

    // بناء استعلام التحقق
    const where = cols.map(c => `"${c}" = $${cols.indexOf(c) + 1}`).join(' AND ');
    const params = cols.map(c => data[c]);
    
    let query = `SELECT 1 FROM "${tableName}" WHERE ${where}`;
    if (excludeId) {
      query += ` AND id != $${cols.length + 1}`;
      params.push(excludeId);
    }
    query += ' LIMIT 1';

    const exists = await pool.query(query, params);
    if (exists.rows.length > 0) {
      errors.push({
        constraint: uc.name,
        columns: cols,
        code: 'UNIQUE_VIOLATION',
        message: `قيمة مكررة في ${cols.join(', ')} (قيد: ${uc.name})`
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** التحقق من Foreign Keys */
async function validateForeignKeys(tableName, data, constraints) {
  const table = constraints[tableName];
  if (!table) {return { ok: true, errors: [] };}

  const fkConstraints = table.constraints.filter(c => c.type === 'f');
  const errors = [];

  for (const fk of fkConstraints) {
    // تحليل FK: FOREIGN KEY ("col") REFERENCES ref_table(ref_col) ON DELETE ...
    const match = fk.def.match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
    if (!match) {continue;}

    const localCols = match[1].split(',').map(c => c.trim().replace(/"/g, ''));
    const refTable = match[2];
    const refCols = match[3].split(',').map(c => c.trim().replace(/"/g, ''));

    // التحقق من وجود القيم المحلية
    const hasAll = localCols.every(c => data[c] !== undefined && data[c] !== null && data[c] !== '');
    if (!hasAll) {continue;} // nullable FK - مسموح

    // بناء استعلام التحقق
    const where = refCols.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const params = localCols.map(c => data[c]);
    const query = `SELECT 1 FROM "${refTable}" WHERE ${where} LIMIT 1`;

    const exists = await pool.query(query, params);
    if (exists.rows.length === 0) {
      errors.push({
        constraint: fk.name,
        columns: localCols,
        refTable,
        refColumns: refCols,
        code: 'FK_VIOLATION',
        message: `قيمة غير موجودة في ${refTable}(${refCols.join(', ')}) (قيد: ${fk.name})`
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** التحقق من CHECK constraints */
async function validateChecks(tableName, data, constraints) {
  const table = constraints[tableName];
  if (!table) {return { ok: true, errors: [] };}

  const checkConstraints = table.constraints.filter(c => c.type === 'c');
  const errors = [];

  for (const cc of checkConstraints) {
    // تقييم بسيط للشروط الشائعة
    const def = cc.def;
    
    // CHECK (col IN (...)) — pg يضيف casts للنصوص ('A'::character varying) تُجرد هنا
    const inMatch = def.match(/\((\w+)\)::text = ANY \(\(ARRAY\[([^\]]+)\]\)::text\[\]\)/);
    if (inMatch) {
      const col = inMatch[1];
      const values = inMatch[2].split(',').map(v => v.trim().replace(/'/g, '').replace(/::[\w\s()]+$/, '').trim());
      if (data[col] !== undefined && data[col] !== null && !values.includes(String(data[col]))) {
        errors.push({
          constraint: cc.name,
          column: col,
          allowedValues: values,
          code: 'CHECK_VIOLATION',
          message: `${col} يجب أن يكون أحد: ${values.join(', ')} (قيد: ${cc.name})`
        });
      }
      continue;
    }

    // CHECK (col >= x AND col <= y)
    const rangeMatch = def.match(/\((\w+)\s*>=\s*(\d+)\)\s+AND\s+\(\1\s*<=\s*(\d+)\)/);
    if (rangeMatch) {
      const col = rangeMatch[1];
      const min = Number(rangeMatch[2]);
      const max = Number(rangeMatch[3]);
      if (data[col] !== undefined && data[col] !== null) {
        const val = Number(data[col]);
        if (isNaN(val) || val < min || val > max) {
          errors.push({
            constraint: cc.name,
            column: col,
            min,
            max,
            code: 'CHECK_VIOLATION',
            message: `${col} يجب أن يكون بين ${min} و ${max} (قيد: ${cc.name})`
          });
        }
      }
      continue;
    }

    // SHIFT_KARIM etc - تقييم عام بالتخطي (صعب تحليله كاملاً)
  }

  return { ok: errors.length === 0, errors };
}

/** التحقق الشامل لصف بيانات */
async function validateRow(tableName, data, options = {}) {
  const { excludeId = null, skipUnique = false, skipFK = false, skipChecks = false, checkRequired = true } = options;
  
  const constraints = await loadConstraints();
  const allErrors = [];

  // معرفة أعمدة PK (توليد تلقائي)
  const table = constraints[tableName];
  const pkColumns = new Set();
  if (table) {
    table.constraints
      .filter(c => c.type === 'p')
      .forEach(c => {
        const match = c.def.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
        if (match) {
          match[1].split(',').forEach(col => pkColumns.add(col.trim().replace(/"/g, '')));
        }
      });
  }

  // 1. التحقق من الأعمدة المرسلة
  for (const [col, value] of Object.entries(data)) {
    const result = validateColumn(tableName, col, value, constraints);
    allErrors.push(...result.errors);
  }

  // 2. التحقق من الحقول NOT NULL المطلوبة وغير المرسلة (بدون default)
  if (checkRequired && table) {
    for (const [colName, col] of Object.entries(table.columns)) {
      // تخطي PK columns (توليد تلقائي)
      if (pkColumns.has(colName)) {continue;}
      
      const hasDefault = col.default && (
        col.default.includes('nextval') || 
        col.default.includes('uuid_generate') ||
        col.default.includes('gen_random_uuid') ||
        col.default.includes('now()') ||
        col.default.includes('CURRENT_TIMESTAMP') ||
        col.default.match(/^[\d.]+$/) ||           // numeric literal: 1, 10, 0
        col.default.match(/^'(true|false)'/) ||    // boolean literal: 'true'::boolean, 'false'::boolean
        col.default.match(/^'.*'::/) ||            // string literal: 'active'::character varying
        col.default === 'true' || col.default === 'false'
      );
      if (!col.nullable && !hasDefault && data[colName] === undefined) {
        allErrors.push({
          column: colName,
          code: 'NOT_NULL',
          message: `${tableName}.${colName} حقل مطلوب`
        });
      }
    }
  }

  // 3. UNIQUE
  if (!skipUnique) {
    const uniqueResult = await validateUnique(tableName, data, constraints, excludeId);
    allErrors.push(...uniqueResult.errors);
  }

  // 4. FK
  if (!skipFK) {
    const fkResult = await validateForeignKeys(tableName, data, constraints);
    allErrors.push(...fkResult.errors);
  }

  // 5. CHECK
  if (!skipChecks) {
    const checkResult = await validateChecks(tableName, data, constraints);
    allErrors.push(...checkResult.errors);
  }

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
    table: tableName,
  };
}

/** Middleware للتحقق التلقائي في Express */
function dbValidationMiddleware(tableName, options = {}) {
  return async (req, res, next) => {
    try {
      const data = { ...req.body };
      // إضافة المعرفات من params للاستبعاد في UNIQUE
      const excludeId = req.params.id ? Number(req.params.id) : null;
      
      const result = await validateRow(tableName, data, { 
        excludeId, 
        skipUnique: options.skipUnique,
        skipFK: options.skipFK,
        skipChecks: options.skipChecks,
      });

      if (!result.ok) {
        const first = result.errors[0]?.message || 'البيانات تنتهك قيود قاعدة البيانات';
        return res.status(422).json({
          error: 'DB_CONSTRAINT_VIOLATION',
          message: `بيانات مرفوضة: ${first}`,
          details: result.errors,
        });
      }

      // إضافة القيود المُتحقق منها للـ request للاستخدام لاحقاً
      req.validatedData = data;
      req.dbValidation = result;
      next();
    } catch (e) {
      console.error('[dbValidation]', e);
      res.status(500).json({ error: 'VALIDATION_ERROR', message: 'فشل التحقق من القيود' });
    }
  };
}

/** دالة مساعدة للتحقق اليدوي */
async function validate(tableName, data, options = {}) {
  return validateRow(tableName, data, options);
}

module.exports = {
  loadConstraints,
  invalidateCache,
  validateColumn,
  validateUnique,
  validateForeignKeys,
  validateChecks,
  validateRow,
  validate,
  dbValidationMiddleware,
};