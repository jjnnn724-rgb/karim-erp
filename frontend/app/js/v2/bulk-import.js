/**
 * V2 — معالج الاستيراد الجماعي: الحساب الخالص (26د)
 * ═══════════════════════════════════════════════════════════════════════
 * مرآة `features/bulk-import.js` في: التطبيع اللاتيني، صيغ اسم المستخدم
 * الأربعة، تخصيص أرقام البصمة مع تخطي المستخدم، القراءة من النص/الملف،
 * التصدير CSV/JSON/Excel، ونص النسخ والطباعة. لا DOM ولا شبكة هنا.
 *
 * انحرافان معلنان، كلاهما لأن الخادم يرفض القديم حرفيًّا:
 *   • كلمة المرور: القديم يولّد 6 أرقام، والخادم يرفضها
 *     (`PASSWORD_TOO_WEAK`: 8 أحرف على الأقل مع حرف ورقم). نولّد 8 خانات:
 *     حرفان لاتينيان + 6 أرقام، فتبقى سهلة الحفظ وتُقبل من أول مرة.
 *   • الدور الافتراضي: القديم يفتح على أول مفتاح في ROLES (admin)، وهو
 *     أخطر افتراضي ممكن لاستيراد جماعي. الافتراضي هنا `employee`، والقائمة
 *     نفسها تضم كل أدوار ROLES كما القديم.
 * رئيس القسم يحتاج `dept_code` (server.js:1132-1143)، والقديم لا يرسله
 * فيفشل كل صف؛ المعالج يعرض اختيار القسم ويضمّه للحمولة.
 */

export const BULK_PASSWORD_LENGTH = 8;
export const BULK_DEFAULT_ROLE = 'employee';

const AR_TO_LATIN = {
    'أ': 'a', 'ا': 'a', 'إ': 'e', 'آ': 'aa', 'ب': 'b', 'ت': 't', 'ث': 'th',
    'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z',
    'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
    'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'a', 'ء': 'a', 'ئ': 'y',
    'ؤ': 'w', ' ': ' ', '_': '_', '-': '-',
};

/** تطبيع الاسم إلى حروف لاتينية — خريطة القديم حرفًا بحرف. */
export function transliterateName(name) {
    return String(name ?? '')
        .split('')
        .map((c) => (Object.prototype.hasOwnProperty.call(AR_TO_LATIN, c) ? AR_TO_LATIN[c] : c))
        .join('')
        .toLowerCase()
        .replace(/[^a-z0-9\s._-]/g, '')
        .trim();
}

/** سطور النص المكتوب: تاب → مسافة، وتجاهل السطر الذي طوله ≤ 1. */
export function parseBulkNames(text) {
    return String(text ?? '')
        .split('\n')
        .map((line) => line.replace(/\t/g, ' ').trim())
        .filter((line) => line.length > 1);
}

/** ملف CSV/TXT: القديم يقسم على سطر أو فاصلة أو فاصلة منقوطة. */
export function parseBulkFileText(text) {
    return String(text ?? '')
        .split(/[\n,;]/)
        .map((line) => line.trim())
        .filter((line) => line.length > 1);
}

function pick(chars, random) {
    const value = Math.min(Math.max(Number(random()) || 0, 0), 0.999999);
    return chars[Math.floor(value * chars.length)];
}

/**
 * كلمة مرور مقبولة من الخادم: 8 خانات، حرفان لاتينيان + 6 أرقام.
 * @param {() => number} [random] injectable for tests
 */
export function generateBulkPassword(random = Math.random) {
    const letters = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '0123456789';
    let out = pick(letters, random) + pick(letters, random);
    for (let i = 0; i < 6; i += 1) {out += pick(digits, random);}
    return out;
}

/**
 * صيغ القديم الأربعة + لاحقة 2,3… عند التكرار + سقف 30 حرفًا.
 * @param {Set<string>} usedUsernames mutated like the legacy set
 */
export function generateUsername(name, index, format, prefix, usedUsernames) {
    const en = transliterateName(name);
    const parts = en.split(' ').filter(Boolean);
    const first = parts[0] || 'user';
    const num = String(index + 1).padStart(3, '0');
    let base = '';
    if (format === 'first_num') {base = first + (index + 1);}
    else if (format === 'full_dot') {base = parts.join('.') || ('user' + (index + 1));}
    else if (format === 'initials_num') {base = (first[0] || 'u') + num;}
    else if (format === 'emp_num') {base = 'emp' + num;}
    const uname = (String(prefix ?? '') + base).replace(/[^a-z0-9._-]/g, '').slice(0, 30)
        || ('user' + (index + 1));
    let attempt = uname;
    let suffix = 2;
    while (usedUsernames.has(attempt)) {
        attempt = uname + suffix;
        suffix += 1;
    }
    usedUsernames.add(attempt);
    return attempt;
}

/** صور الرقم المختلفة لمنع تعارض 7 مع 007 — مرآة bulkFpForms. */
export function fingerprintForms(value) {
    const s = String(value ?? '').trim();
    if (!s) {return [];}
    const forms = [s];
    if (/^\d+$/.test(s)) {
        const n = String(Number(s));
        if (!forms.includes(n)) {forms.push(n);}
        const p = s.padStart(3, '0');
        if (!forms.includes(p)) {forms.push(p);}
    }
    return forms;
}

/** بصمات وأرقام وظيفية مستخدمة في الدليل الحالي. */
export function usedFingerprintSet(employees = []) {
    const used = new Set();
    for (const employee of employees || []) {
        fingerprintForms(employee && employee.deviceUserId).forEach((form) => used.add(form));
        const employeeId = employee && employee.employeeId;
        if (/^\d+$/.test(String(employeeId ?? '').trim())) {
            fingerprintForms(employeeId).forEach((form) => used.add(form));
        }
    }
    return used;
}

/** أرقام متتالية من نقطة البداية، مع تخطي المستخدم وتسجيل المخصص. */
export function allocateFingerprints(start, count, used = new Set()) {
    const usedSet = used instanceof Set ? used : new Set(used || []);
    const out = [];
    let n = Math.max(1, Math.floor(Number(start) || 1));
    while (out.length < Number(count || 0) && n < 1000000) {
        const key = String(n);
        if (!usedSet.has(key)) {
            out.push(key);
            fingerprintForms(key).forEach((form) => usedSet.add(form));
        }
        n += 1;
    }
    return out;
}

function passwordFactoryOf(options) {
    return typeof options.passwordFactory === 'function'
        ? options.passwordFactory
        : generateBulkPassword;
}

/**
 * خطوة 2 → 3: أسماء + خيارات → صفوف المعاينة.
 * @param {string[]} names
 * @param {{format?:string, prefix?:string, role?:string, deptCode?:string,
 *          fpStart?:number|string, usedUsernames?:Set<string>|string[],
 *          usedFingerprints?:Set<string>|string[],
 *          passwordFactory?:() => string}} [options]
 */
export function buildBulkRows(names = [], options = {}) {
    const usedUsernames = options.usedUsernames instanceof Set
        ? options.usedUsernames : new Set(options.usedUsernames || []);
    const usedFingerprints = options.usedFingerprints instanceof Set
        ? options.usedFingerprints : new Set(options.usedFingerprints || []);
    const fps = allocateFingerprints(options.fpStart, names.length, usedFingerprints);
    const password = passwordFactoryOf(options);
    const role = options.role || BULK_DEFAULT_ROLE;
    const deptCode = role === 'dept_head' ? String(options.deptCode || '').trim() : '';
    return names.map((name, index) => ({
        name: String(name).trim(),
        username: generateUsername(name, index, options.format || 'first_num', options.prefix, usedUsernames),
        password: String(password()),
        role,
        dept_code: deptCode,
        fp: fps[index] || String(Math.max(1, Math.floor(Number(options.fpStart) || 1)) + index),
    }));
}

/** أرقام صندوق الإحصاءات — القديم: الإجمالي، الأدوار، طول السر، الفريد. */
export function bulkPreviewStats(rows = []) {
    const roles = new Set();
    const usernames = new Set();
    for (const row of rows) {
        roles.add(row.role);
        usernames.add(row.username);
    }
    return {
        total: rows.length,
        roles: roles.size,
        passwordLength: BULK_PASSWORD_LENGTH,
        uniqueUsernames: usernames.size,
    };
}

function roleLabelOf(roleNames, role) {
    return (roleNames && roleNames[role]) || role || '';
}

/** قائمة البيانات المنسوخة — سطر لكل حساب كما القديم. */
export function bulkToCopyText(rows = []) {
    return rows.map((row, index) => `${index + 1}. ${row.name} | ${row.username} | ${row.password}`).join('\n');
}

/** CSV بترميز UTF-8 + BOM عند التنزيل؛ القيم تُقتبس وتُضاعف علاماتها. */
export function bulkToCsv(rows = [], roleNames = {}) {
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = ['#,الاسم,اسم المستخدم,كلمة المرور,رقم البصمة,الدور'];
    rows.forEach((row, index) => {
        lines.push([
            index + 1,
            cell(row.name),
            cell(row.username),
            cell(row.password),
            cell(row.fp || ''),
            cell(roleLabelOf(roleNames, row.role)),
        ].join(','));
    });
    return lines.join('\n');
}

/** JSON بنفس مفتاح القديم: index/name/username/password/fingerprintId/role. */
export function bulkToJson(rows = [], roleNames = {}) {
    return rows.map((row, index) => ({
        index: index + 1,
        name: row.name,
        username: row.username,
        password: row.password,
        fingerprintId: row.fp || null,
        role: row.role,
        roleName: roleLabelOf(roleNames, row.role),
    }));
}

/** مصفوفة ورقة Excel: نفس الأعمدة والترتيب (الدور بالاسم لا بالمفتاح). */
export function bulkToExcelAoa(rows = [], roleNames = {}) {
    const data = [['#', 'الاسم', 'اسم المستخدم', 'كلمة المرور', 'رقم البصمة', 'الدور']];
    rows.forEach((row, index) => {
        data.push([
            index + 1, row.name, row.username, row.password, row.fp || '',
            roleLabelOf(roleNames, row.role),
        ]);
    });
    return data;
}

function escHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** جدول الطباعة A4 — أزرار الطباعة في عارض V2 لا في المستند (لا onclick). */
export function bulkPrintTableHtml({ rows = [], roleNames = {}, orgName = '', logoUrl = '', createdAt = '' } = {}) {
    const body = rows.map((row, index) => `<tr>
<td>${index + 1}</td>
<td>${escHtml(row.name)}</td>
<td style="direction:ltr">${escHtml(row.username)}</td>
<td class="pass">${escHtml(row.password)}</td>
<td style="font-weight:900">${escHtml(row.fp || '—')}</td>
<td>${escHtml(roleLabelOf(roleNames, row.role))}</td>
</tr>`).join('');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>بيانات المستخدمين</title>
<style>
body{font-family:'Cairo',Tahoma,Arial,sans-serif;padding:20px;direction:rtl;color:#1a1a1a}
.brand{text-align:center;margin-bottom:10px}
.brand img{width:64px;height:64px;object-fit:contain;background:#fff;border:2px solid #d4a843;border-radius:12px;padding:5px}
h1{text-align:center;color:#b45309;margin:10px 0}
.meta{text-align:center;color:#666;margin-bottom:18px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
th,td{border:1px solid #333;padding:8px;text-align:center}
th{background:#b45309;color:#fff;font-weight:900}
.pass{font-family:monospace;font-size:16px;font-weight:900;letter-spacing:3px;color:#055f3a}
@media print{body{padding:0}@page{size:A4;margin:12mm}}
</style></head><body>
<div class="brand"><img src="${escHtml(logoUrl)}" alt="الشعار"></div>
<h1>بيانات دخول المستخدمين</h1>
<div class="meta">${escHtml(orgName)} | تم الإنشاء: ${escHtml(createdAt)}</div>
<table><thead><tr><th>#</th><th>الاسم</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>رقم البصمة</th><th>الدور</th></tr></thead>
<tbody>${body}</tbody></table>
</body></html>`;
}

/** قصاصات فردية: بطاقتان في الصف، لكل حساب اسمه ودخوله وبصمته. */
export function bulkPrintSlipsHtml({ rows = [], roleNames = {}, orgName = '', logoUrl = '', createdAt = '' } = {}) {
    const slips = rows.map((row) => `
<div class="slip">
<div class="slip-head"><img src="${escHtml(logoUrl)}" alt=""><div><b>${escHtml(orgName)}</b><small>بيانات الدخول الخاصة بك — سرية</small></div></div>
<div class="slip-name">${escHtml(row.name)}</div>
<div class="slip-row"><span>اسم المستخدم</span><b class="ltr">${escHtml(row.username)}</b></div>
<div class="slip-row"><span>كلمة المرور</span><b class="pass ltr">${escHtml(row.password)}</b></div>
<div class="slip-row"><span>رقم البصمة</span><b class="ltr">${escHtml(row.fp || '—')}</b></div>
<div class="slip-row"><span>الدور</span><b>${escHtml(roleLabelOf(roleNames, row.role))}</b></div>
<div class="slip-foot">سجّل هذا الرقم على جهاز البصمة بنفس رقم البصمة أعلاه</div>
</div>`).join('');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>قصاصات دخول الموظفين</title>
<style>
body{font-family:'Cairo',Tahoma,Arial,sans-serif;padding:16px;direction:rtl;color:#222;margin:0}
.meta{text-align:center;color:#777;font-size:11px;margin-bottom:10px}
.slips{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.slip{border:2px dashed #999;border-radius:10px;padding:12px 14px;page-break-inside:avoid}
.slip-head{display:flex;align-items:center;gap:10px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:8px}
.slip-head img{width:40px;height:40px;object-fit:contain}
.slip-head b{display:block;font-size:14px}
.slip-head small{color:#777;font-size:11px}
.slip-name{font-size:18px;font-weight:900;text-align:center;margin:4px 0 8px}
.slip-row{display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-top:1px dotted #ddd;font-size:13px}
.slip-row b{font-size:14px}
.slip-row .pass{font-family:monospace;font-size:18px;letter-spacing:3px;color:#055f3a}
.ltr{direction:ltr;unicode-bidi:embed}
.slip-foot{margin-top:8px;font-size:11px;color:#777;text-align:center}
@media print{body{padding:0}.slips{gap:10px}}
</style></head><body>
<div class="meta">طُبعت في ${escHtml(createdAt)}</div>
<div class="slips">${slips}</div>
</body></html>`;
}
