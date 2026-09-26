/**
 * db-constraints-client.js — تحقق من قيود DB في الفرونت إند
 * يستخدم من قبل النماذج (forms) لمنع الإرسال لو البيانات غير صالحة
 * يتم تحديثه تلقائياً من /api/schema/constraints
 */

// كاش القيود من الخادم
let constraintsCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

/** جلب القيود من الخادم */
async function fetchConstraints() {
  if (constraintsCache && Date.now() - cacheTime < CACHE_TTL) {
    return constraintsCache;
  }
  
  try {
    const res = await fetch('/api/schema/constraints', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
    });
    if (!res.ok) throw new Error('Failed to fetch constraints');
    constraintsCache = await res.json();
    cacheTime = Date.now();
    return constraintsCache;
  } catch (e) {
    console.warn('[db-constraints-client] Failed to fetch constraints:', e.message);
    return null;
  }
}

/** مسح الكاش */
function invalidateConstraintsCache() {
  constraintsCache = null;
  cacheTime = 0;
}

/** التحقق من حقل واحد */
async function validateField(tableName, columnName, value) {
  const constraints = await fetchConstraints();
  if (!constraints || !constraints[tableName]) return { ok: true, errors: [] };
  
  const table = constraints[tableName];
  const col = table.columns[columnName];
  if (!col) return { ok: true, errors: [] };
  
  const errors = [];
  
  // NOT NULL
  if (!col.nullable && (value === null || value === undefined || value === '')) {
    errors.push({ code: 'NOT_NULL', message: `${columnName} مطلوب` });
  }
  
  // Type & Length
  if (value !== null && value !== undefined && value !== '') {
    switch (col.type) {
      case 'character varying':
      case 'text':
        if (typeof value !== 'string') {
          errors.push({ code: 'TYPE', message: `${columnName} يجب أن يكون نصاً` });
        } else if (col.maxLength && value.length > col.maxLength) {
          errors.push({ code: 'MAX_LENGTH', message: `${columnName} طويل جداً (الأقصى ${col.maxLength})` });
        }
        break;
      case 'integer':
      case 'bigint':
      case 'smallint':
        if (!Number.isInteger(Number(value))) {
          errors.push({ code: 'TYPE', message: `${columnName} يجب أن يكون رقمًا صحيحًا` });
        }
        break;
      case 'numeric':
      case 'decimal':
        if (isNaN(Number(value))) {
          errors.push({ code: 'TYPE', message: `${columnName} يجب أن يكون رقمًا` });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push({ code: 'TYPE', message: `${columnName} يجب أن يكون نعم/لا` });
        }
        break;
      case 'date':
      case 'timestamp with time zone':
      case 'timestamp without time zone':
        if (isNaN(Date.parse(value))) {
          errors.push({ code: 'TYPE', message: `${columnName} تاريخ غير صالح` });
        }
        break;
    }
  }
  
  return { ok: errors.length === 0, errors };
}

/** التحقق من نموذج كامل */
async function validateForm(tableName, formData) {
  const constraints = await fetchConstraints();
  if (!constraints || !constraints[tableName]) return { ok: true, errors: [] };
  
  const table = constraints[tableName];
  const allErrors = [];
  
  // حقول مرسلة
  for (const [colName, value] of Object.entries(formData)) {
    const result = await validateField(tableName, colName, value);
    if (!result.ok) {
      allErrors.push(...result.errors.map(e => ({ field: colName, ...e })));
    }
  }
  
  // حقول NOT NULL مطلوبة وغير مرسلة
  for (const [colName, col] of Object.entries(table.columns)) {
    if (!col.nullable && !col.default && formData[colName] === undefined) {
      allErrors.push({ field: colName, code: 'NOT_NULL', message: `${colName} مطلوب` });
    }
  }
  
  // UNIQUE - يتحقق من الخادم (يحتاج API call)
  // FK - يتحقق من الخادم
  
  return { ok: allErrors.length === 0, errors: allErrors };
}

/** عرض أخطاء في نموذج HTML */
function showFormErrors(formElement, errors) {
  // إزالة الأخطاء السابقة
  formElement.querySelectorAll('.db-error').forEach(el => el.remove());
  formElement.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  
  // تجميع الأخطاء حسب الحقل
  const byField = {};
  errors.forEach(e => {
    if (!byField[e.field]) byField[e.field] = [];
    byField[e.field].push(e.message);
  });
  
  // عرض كل خطأ
  Object.entries(byField).forEach(([field, messages]) => {
    const input = formElement.querySelector(`[name="${field}"]`);
    if (input) {
      input.classList.add('is-invalid');
      const div = document.createElement('div');
      div.className = 'db-error text-danger small mt-1';
      div.innerHTML = messages.join('<br>');
      input.parentNode.appendChild(div);
    }
  });
}

/** مسح أخطاء النموذج */
function clearFormErrors(formElement) {
  formElement.querySelectorAll('.db-error').forEach(el => el.remove());
  formElement.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

/** إضافة مستمع تحقق تلقائي للنموذج */
function attachAutoValidation(formElement, tableName, options = {}) {
  const { onSubmit = true, onBlur = true, onChange = false } = options;
  
  if (onSubmit) {
    formElement.addEventListener('submit', async (e) => {
      const formData = new FormData(formElement);
      const data = Object.fromEntries(formData);
      
      const result = await validateForm(tableName, data);
      if (!result.ok) {
        e.preventDefault();
        showFormErrors(formElement, result.errors);
        // تركيز أول حقل بخطأ
        const firstError = formElement.querySelector('.is-invalid');
        if (firstError) firstError.focus();
      }
    });
  }
  
  if (onBlur) {
    formElement.querySelectorAll('input, select, textarea').forEach(input => {
      input.addEventListener('blur', async () => {
        const value = input.type === 'checkbox' ? input.checked : input.value;
        const result = await validateField(tableName, input.name, value);
        if (!result.ok) {
          input.classList.add('is-invalid');
          let errorDiv = input.parentNode.querySelector('.db-error');
          if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'db-error text-danger small mt-1';
            input.parentNode.appendChild(errorDiv);
          }
          errorDiv.innerHTML = result.errors.map(e => e.message).join('<br>');
        } else {
          input.classList.remove('is-invalid');
          const errorDiv = input.parentNode.querySelector('.db-error');
          if (errorDiv) errorDiv.remove();
        }
      });
    });
  }
}

// تصدير للاستخدام العام
window.DBConstraints = {
  fetchConstraints,
  invalidateConstraintsCache,
  validateField,
  validateForm,
  showFormErrors,
  clearFormErrors,
  attachAutoValidation,
};

// Auto-attach to forms with data-db-table attribute
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('form[data-db-table]').forEach(form => {
    const tableName = form.dataset.dbTable;
    const options = {
      onSubmit: form.dataset.dbValidateOnSubmit !== 'false',
      onBlur: form.dataset.dbValidateOnBlur !== 'false',
      onChange: form.dataset.dbValidateOnChange === 'true',
    };
    attachAutoValidation(form, tableName, options);
  });
});

export { fetchConstraints, invalidateConstraintsCache, validateField, validateForm, showFormErrors, clearFormErrors, attachAutoValidation };