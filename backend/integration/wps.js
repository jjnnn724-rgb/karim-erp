'use strict';

/**
 * integration/wps.js — متطلبات مدد/حماية الأجور والتأمينات (GATE 06)
 * ────────────────────────────────────────────────────────────────────────────
 * دوال نقية بلا قاعدة ولا شبكة: تحقق IBAN السعودي (ISO 13616/mod-97)،
 * تقييم جاهزية كشف الأجور، بناء كشف CSV للمراجعة البشرية، نسب التأمينات
 * كمجموعات صريحة غير موثّقة.
 *
 * قواعد ثابتة:
 *  - مدد يبقى BLOCKED: لا نداء خارجي ولا رفع تلقائي ولا وسم «مقبول».
 *  - الكشف الناتج «كشف أجور للمراجعة» وليس ملف SIF — قالب SIF يخص البنك.
 *  - النسب لا تُطبَّق تلقائيًا على أي حساب أو قيد؛ تُختار صراحة وتُراجع.
 */

const crypto = require('crypto');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SA_IBAN_RE = /^SA\d{22}$/;
const ID_RE = /^[12]\d{9}$/;
const ISO2_RE = /^[A-Z]{2}$/;
const GOSI_NUMBER_RE = /^[0-9]{6,12}$/;

function normalizeIban(value) {
  return String(value ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/** تحقق فعلي: 24 حرفًا + بادئة SA + مجموع تحقق mod-97 = 1. */
function isValidSaudIban(value) {
  const iban = normalizeIban(value);
  if (!SA_IBAN_RE.test(iban)) {
    return false;
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function maskIban(value) {
  const iban = normalizeIban(value);
  if (!iban) {
    return null;
  }
  if (iban.length <= 8) {
    return '*'.repeat(iban.length);
  }
  return `${iban.slice(0, 4)}${'*'.repeat(iban.length - 8)}${iban.slice(-4)}`;
}

function maskIdNumber(value) {
  const id = String(value ?? '').trim();
  if (!id) {
    return null;
  }
  if (id.length <= 4) {
    return '*'.repeat(id.length);
  }
  return `${'*'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

function isValidIdNumber(value) {
  return ID_RE.test(String(value ?? '').trim());
}

function normalizeNationality(value) {
  const code = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!code) {
    return null;
  }
  return ISO2_RE.test(code) ? code : null;
}

/** التصنيف التأميني: سعودي / وافد / غير معروف — لا تخمين. */
function nationalityCategory(value) {
  const code = normalizeNationality(value);
  if (!code) {
    return 'unknown';
  }
  return code === 'SA' ? 'saudi' : 'expat';
}

/**
 * مجموعات نسب التأمينات. كلها غير موثّقة داخل المستودع: النسب تتغير بحسب
 * تاريخ التسجيل وتتطلب تثبيت المحاسب قبل أي استخدام رسمي.
 * القيم basis points (1% = 100bp) لتجنّب كسور الفاصلة العائمة.
 */
const GOSI_RATE_SETS = Object.freeze({
  legacy_before_2024_07: Object.freeze({
    id: 'legacy_before_2024_07',
    label_ar: 'مسجّل قبل 2024-07-03',
    verified: false,
    saudi: Object.freeze({ employee_bp: 975, employer_bp: 1175 }),
    expat: Object.freeze({ employee_bp: 0, employer_bp: 200 }),
    note: '9.75% موظف + 11.75% صاحب عمل للسعودي (9% معاش + 0.75% ساند + 2% أخطار)؛ الوافد 2% أخطار مهنية على صاحب العمل.',
    source: 'نسب شائعة منشورة عن التأمينات الاجتماعية — تحتاج تثبيت المحاسب',
  }),
  new_registrant_2026: Object.freeze({
    id: 'new_registrant_2026',
    label_ar: 'مسجّل بعد 2024-07-03 — 2026 (تصاعدي)',
    verified: false,
    saudi: Object.freeze({ employee_bp: 1025, employer_bp: 1225 }),
    expat: Object.freeze({ employee_bp: 0, employer_bp: 200 }),
    note: 'النسب التصاعدية للمسجّلين الجدد ترتفع سنويًا حتى 2028؛ لا تفترض رقم 2026 بلا تثبيت.',
    source: 'مصادر مهنية متعددة متعارضة في رقم 2026 — غير موثّقة رسميًا داخل المستودع',
  }),
});

function resolveRateSet(id) {
  return GOSI_RATE_SETS[String(id ?? '')] || null;
}

function rateSetList() {
  return Object.values(GOSI_RATE_SETS).map(set => ({
    id: set.id,
    label_ar: set.label_ar,
    verified: set.verified,
    saudi: { employee_bp: set.saudi.employee_bp, employer_bp: set.saudi.employer_bp },
    expat: { employee_bp: set.expat.employee_bp, employer_bp: set.expat.employer_bp },
    note: set.note,
  }));
}

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100);
}

/** حسبة عرض فقط — لا تُكتب في الأستاذ ولا تغيّر أي معادلة رواتب قائمة. */
function gosiAmounts(wage, category, rateSet) {
  if (!rateSet || !['saudi', 'expat'].includes(category)) {
    return null;
  }
  const cents = toCents(wage);
  if (cents === null) {
    return null;
  }
  const rates = rateSet[category];
  const employee = Math.round((cents * rates.employee_bp) / 10000);
  const employer = Math.round((cents * rates.employer_bp) / 10000);
  return {
    employee: employee / 100,
    employer: employer / 100,
    total: (employee + employer) / 100,
    employee_bp: rates.employee_bp,
    employer_bp: rates.employer_bp,
  };
}

/** حدود الاشتراك (أجر أدنى/أعلى) غير مطبقة هنا عمدًا؛ تُبلَّغ للمحاسب. */
const GOSI_MIN_CONTRIBUTORY_WAGE = 1500;

const WPS_REQUIREMENTS = Object.freeze([
  {
    id: 'mudad_registration',
    title_ar: 'تسجيل المنشأة في مدد',
    requirement: 'حساب منشأة مفعّل في منصة مدد مرتبط بالحساب البنكي.',
    status: 'BLOCKED',
    source: 'مدد — بوابة حماية الأجور؛ لا واجهة برمجية عامة موثّقة (ADR-008)',
  },
  {
    id: 'employer_identifier',
    title_ar: 'هوية المنشأة (السجل التجاري)',
    requirement: 'رقم سجل تجاري صحيح يُكتب في ترويسة ملف الأجور.',
    status: 'TODO',
    source: 'متطلب ملف WPS — يُقرأ من zatca_settings.crn',
  },
  {
    id: 'employee_id',
    title_ar: 'هوية/إقامة كل موظف',
    requirement: 'رقم هوية وطنية أو إقامة من 10 أرقام لكل موظف مستحق.',
    status: 'TODO',
    source: 'متطلب ملف WPS',
  },
  {
    id: 'employee_iban',
    title_ar: 'IBAN سعودي لكل موظف',
    requirement: 'IBAN صحيح 24 حرفًا يبدأ بـSA ويخص الموظف نفسه.',
    status: 'TODO',
    source: 'متطلب ملف WPS — هجرة 147 تضيف العمود، والتحقق mod-97 في الكود',
  },
  {
    id: 'posted_payroll',
    title_ar: 'مسير رواتب مُقفل للشهر',
    requirement: 'لا يُصدَّر كشف من مسودة؛ يلزم شهر بحالة posted.',
    status: 'TODO',
    source: 'ADR-008',
  },
  {
    id: 'nationality',
    title_ar: 'جنسية الموظف',
    requirement: 'سعودي/غير سعودي — أساس تصنيف اشتراك التأمينات.',
    status: 'TODO',
    source: 'متطلب GOSI',
  },
  {
    id: 'gosi_number',
    title_ar: 'رقم المشترك في التأمينات',
    requirement: 'رقم GOSI الفعلي لكل موظف؛ لا يُخترع.',
    status: 'TODO',
    source: 'متطلب GOSI',
  },
  {
    id: 'sif_template',
    title_ar: 'قالب SIF الخاص بالبنك',
    requirement: 'ملف SIF يختلف بين البنوك؛ لم يُبنَ بعد ولا يجوز تخمين حقوله.',
    status: 'MISSING',
    source: 'متطلب بنكي — يلزم قالب البنك الرسمي',
  },
  {
    id: 'upload_automation',
    title_ar: 'رفع تلقائي إلى مدد',
    requirement: 'يتطلب واجهة رسمية موثّقة وبيئة اختبار ورد قبول — غير متاح.',
    status: 'BLOCKED',
    source: 'ADR-008',
  },
]);

function requirementStatus(id, patch) {
  const base = WPS_REQUIREMENTS.find(r => r.id === id);
  return { ...base, ...patch };
}

function csvCell(value) {
  let text = String(value ?? '');
  // منع حقن الصيغ في Excel دون تغيير القيمة المرئية
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const WPS_CSV_HEADERS = Object.freeze([
  'الشهر',
  'السجل التجاري',
  'رقم الهوية/الإقامة',
  'الاسم',
  'الجنسية',
  'IBAN',
  'الأساسي',
  'البدلات',
  'الخصومات',
  'الصافي',
]);

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/**
 * كشف أجور للمراجعة البشرية — ليس SIF. البادئة BOM لفتح العربية في Excel،
 * والبصمة تُحسب على النص النهائي نفسه الذي يُعاد للعميل.
 */
function buildWpsCsv({ month, employerId, rows }) {
  const lines = [WPS_CSV_HEADERS.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        month,
        employerId,
        r.id_number,
        r.name,
        r.nationality,
        r.iban,
        money(r.basic),
        money(r.allowances),
        money(r.deductions),
        money(r.net),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  return { csv, sha256: crypto.createHash('sha256').update(csv, 'utf8').digest('hex') };
}

/**
 * تقييم جاهزية شهر: يمر على الموظفين النشطين ومقارنتهم ببنود الرواتب.
 * employees: {id,name,iqama,salary,iban,nationality}
 * payrollById: Map(id → {basic,allowances,deductions,net})
 */
function evaluateWpsReadiness({ employees, payrollById, month, posted, employerId }) {
  const rows = employees.map(e => {
    const line = payrollById ? payrollById.get(String(e.id)) || null : null;
    const issues = [];
    if (!isValidIdNumber(e.iqama)) {
      issues.push('ID_MISSING');
    }
    if (!(Number(e.salary) > 0)) {
      issues.push('SALARY_MISSING');
    }
    if (!isValidSaudIban(e.iban)) {
      issues.push('IBAN_MISSING');
    }
    if (nationalityCategory(e.nationality) === 'unknown') {
      issues.push('NATIONALITY_UNKNOWN');
    }
    if (posted && !line) {
      issues.push('PAYROLL_LINE_MISSING');
    }
    return {
      employee_id: e.id,
      name: e.name,
      id_number_masked: maskIdNumber(e.iqama),
      iban_masked: maskIban(e.iban),
      nationality: normalizeNationality(e.nationality),
      salary: Number(e.salary) || 0,
      has_line: Boolean(line),
      issues,
      ready: issues.length === 0,
    };
  });

  const countIssue = code => rows.filter(r => r.issues.includes(code)).length;
  const summary = {
    month,
    employees: rows.length,
    ready: rows.filter(r => r.ready).length,
    missing_id: countIssue('ID_MISSING'),
    missing_salary: countIssue('SALARY_MISSING'),
    missing_iban: countIssue('IBAN_MISSING'),
    unknown_nationality: countIssue('NATIONALITY_UNKNOWN'),
    missing_payroll_line: countIssue('PAYROLL_LINE_MISSING'),
    posted: Boolean(posted),
    employer_identifier: Boolean(employerId),
  };

  const blockers = [];
  if (!employerId) {
    blockers.push('EMPLOYER_ID_MISSING');
  }
  if (!posted) {
    blockers.push('PAYROLL_MONTH_NOT_POSTED');
  }
  if (summary.missing_id) {
    blockers.push('EMPLOYEES_MISSING_ID');
  }
  if (summary.missing_salary) {
    blockers.push('EMPLOYEES_MISSING_SALARY');
  }
  if (summary.missing_iban) {
    blockers.push('EMPLOYEES_MISSING_IBAN');
  }
  if (summary.unknown_nationality) {
    blockers.push('EMPLOYEES_NATIONALITY_UNKNOWN');
  }
  if (summary.missing_payroll_line) {
    blockers.push('PAYROLL_LINES_MISSING');
  }

  return { summary, rows, blockers, export_ready: blockers.length === 0 };
}

function isValidGosiNumber(value) {
  return value == null || value === '' || GOSI_NUMBER_RE.test(String(value));
}

/** صفوف التأمينات: أساس الرواتب = وعاء المسير إن وُجد، وإلا الراتب الأساسي (تقديري). */
function buildGosiPreview({ employees, payrollById, rateSet }) {
  const lines = [];
  const unknowns = [];
  for (const e of employees) {
    const category = nationalityCategory(e.nationality);
    if (category === 'unknown') {
      unknowns.push({ employee_id: e.id, name: e.name, reason: 'NATIONALITY_UNKNOWN' });
      continue;
    }
    const line = payrollById ? payrollById.get(String(e.id)) || null : null;
    const wage = Number(line?.basic ?? e.salary);
    if (!(wage > 0)) {
      unknowns.push({ employee_id: e.id, name: e.name, reason: 'WAGE_MISSING' });
      continue;
    }
    const amounts = gosiAmounts(wage, category, rateSet);
    if (!amounts) {
      unknowns.push({ employee_id: e.id, name: e.name, reason: 'RATE_UNAVAILABLE' });
      continue;
    }
    lines.push({
      employee_id: e.id,
      name: e.name,
      category,
      wage,
      basis: line ? 'payroll' : 'employee_salary',
      employee: amounts.employee,
      employer: amounts.employer,
      total: amounts.total,
      below_minimum: wage < GOSI_MIN_CONTRIBUTORY_WAGE,
    });
  }
  const totals = lines.reduce(
    (acc, l) => ({
      employee: acc.employee + l.employee,
      employer: acc.employer + l.employer,
      total: acc.total + l.total,
    }),
    { employee: 0, employer: 0, total: 0 }
  );
  const round = n => Math.round(n * 100) / 100;
  return {
    lines,
    unknowns,
    totals: { employee: round(totals.employee), employer: round(totals.employer), total: round(totals.total) },
  };
}

module.exports = {
  MONTH_RE,
  SA_IBAN_RE,
  ID_RE,
  GOSI_NUMBER_RE,
  normalizeIban,
  isValidSaudIban,
  maskIban,
  maskIdNumber,
  isValidIdNumber,
  normalizeNationality,
  nationalityCategory,
  isValidGosiNumber,
  GOSI_RATE_SETS,
  GOSI_MIN_CONTRIBUTORY_WAGE,
  resolveRateSet,
  rateSetList,
  gosiAmounts,
  WPS_REQUIREMENTS,
  requirementStatus,
  WPS_CSV_HEADERS,
  buildWpsCsv,
  evaluateWpsReadiness,
  buildGosiPreview,
};
