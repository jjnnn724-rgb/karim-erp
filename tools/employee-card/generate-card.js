#!/usr/bin/env node
/**
 * tools/employee-card/generate-card.js — توليد بطاقة موظف فاخرة من بيانات النظام
 * ────────────────────────────────────────────────────────────────────────────
 * الاستخدام:
 *   node tools/employee-card/generate-card.js --fp 61 [--photo C:\path\img.jpg]
 * المخرجات في tools/employee-card/out/ : card-<fp>.html (طباعة) + card-<fp>.svg
 * قراءة فقط من قاعدة هورس المحلية — لا يعدّل أي شيء.
 */
'use strict';
process.chdir(require('path').join(__dirname, '..', '..'));
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CARDIR = path.join(ROOT, 'tools', 'employee-card');
const OUT = path.join(CARDIR, 'out');

function arg(n, d) { const i = process.argv.indexOf('--' + n); if (i < 0) return d; const v = process.argv[i + 1]; return (v === undefined || v.startsWith('--')) ? d : v; }

// مبسّط للاتينية (MRZ/EN)
const AR2LAT = { 'ا': 'A', 'أ': 'A', 'إ': 'A', 'آ': 'A', 'ب': 'B', 'ت': 'T', 'ث': 'TH', 'ج': 'G', 'ح': 'H', 'خ': 'KH', 'د': 'D', 'ذ': 'D', 'ر': 'R', 'ز': 'Z', 'س': 'S', 'ش': 'SH', 'ص': 'S', 'ض': 'D', 'ط': 'T', 'ظ': 'Z', 'ع': 'A', 'غ': 'GH', 'ف': 'F', 'ق': 'Q', 'ك': 'K', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ه': 'H', 'ة': 'A', 'و': 'OU', 'ى': 'I', 'ي': 'I', 'ئ': 'I', 'ؤ': 'OU', 'ء': '' };
const NAME_DICT = { 'محمد': 'MOHAMED', 'احمد': 'AHMED', 'أحمد': 'AHMED', 'كريم': 'KARIM', 'عبد': 'ABDUL', 'الله': 'ALLAH', 'عبدالله': 'ABDULLAH', 'مصطفى': 'MOSTAFA', 'ابراهيم': 'IBRAHIM', 'إبراهيم': 'IBRAHIM', 'خالد': 'KHALED', 'سعيد': 'SAEED', 'علي': 'ALI', 'حسن': 'HASSAN', 'حسين': 'HUSSEIN', 'عمر': 'OMAR', 'يوسف': 'YOUSSEF', 'فاطمة': 'FATMA', 'نورة': 'NOURA', 'سارة': 'SARA' };
const translitWord = (w) => NAME_DICT[w] || String(w || '').split('').map(c => AR2LAT[c] !== undefined ? AR2LAT[c] : /[A-Za-z0-9]/.test(c) ? c.toUpperCase() : '').join('');
const translit = (s) => String(s || '').split(/\s+/).map(translitWord).filter(Boolean).join(' ');
// رقم تدقيق ICAO 9303 (7-3-1)
const MRZV = Object.fromEntries('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => [c, i < 10 ? i : i]));
function mrzCheck(s) { const w = [7, 3, 1]; let t = 0; for (let i = 0; i < s.length; i++) t += (MRZV[s[i]] ?? 0) * w[i % 3]; return String(t % 10); }
function mrzPad(s, n) { return (s + '<'.repeat(n)).slice(0, n); }
// Code128-B حقيقي (الأرقام/الحروف)
const C128 = ['11011001100', '11001101100', '11001100110', '10010011000', '10010001100', '10001100100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010', '11001011100', '11001001110', '11011100100', '11001110100', '11101101110', '11101001100', '11100101100', '11100100110', '10110011100', '10011011100', '10011001110', '10111001100', '10011101100', '10011100110', '11001110010'];
function code128bars(text) {
  const START_B = '11010010000', STOP = '1100011101011';
  let seq = START_B, sum = 104;
  [...text].forEach((ch, i) => { const v = ch.charCodeAt(0) - 32; seq += C128[v]; sum += v * (i + 1); });
  seq += C128[sum % 103] + STOP;
  let x = 0, out = '';
  let run = seq[0], len = 0;
  const flush = (black) => { if (len > 0 && black) out += `<i style="width:${len * 0.55}mm"></i>`; else if (len > 0) out += `<i style="width:${len * 0.55}mm;background:#fff"></i>`; };
  for (const b of seq) { if (b === run) len++; else { flush(run === '1'); run = b; len = 1; } }
  flush(run === '1');
  return out;
}
function guilloche() {
  // وردة هندسية نابضة الألوان (كحلي/ذهبي/تركواز/بنفسجي/مرجاني) لاتجاه طولي (204×322)
  let s = '';
  const rings = ['#0A2540', '#C9A961', '#0FB5A6', '#7C3AED', '#FF6B4A'];
  for (let r = 8, i = 0; r <= 170; r += 7, i++) {
    const c = rings[i % rings.length];
    s += `<circle cx="102" cy="161" r="${r}" fill="none" stroke="${c}" stroke-width="0.7"/>`;
  }
  for (let a = 0; a < 360; a += 15) {
    const c = a % 45 === 0 ? '#C9A961' : (a % 30 === 0 ? '#0FB5A6' : '#7C3AED');
    const x2 = 102 + 100 * Math.cos(a * Math.PI / 180), y2 = 161 + 160 * Math.sin(a * Math.PI / 180);
    s += `<line x1="102" y1="161" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="0.4" opacity="0.6"/>`;
  }
  return s;
}

async function main() {
  const fp = String(arg('fp', '')).trim();
  if (!fp) { console.error('حدد البصمة: --fp 61'); process.exit(1); }
  const { pool } = require(path.join(ROOT, 'backend', 'shared-pool'));
  const emp = (await pool.query(`SELECT e.*, h.name AS dept_name FROM employees e LEFT JOIN "hrDepartments" h ON h.code=e.department WHERE e."deviceUserId"=$1 OR e."employeeId"=$1 LIMIT 1`, [fp])).rows[0];
  if (!emp) { console.error('لا يوجد موظف برقم البصمة ' + fp); process.exit(1); }
  const QRCode = require(path.join(ROOT, 'node_modules', 'qrcode'));
  const empNo = String(emp.employeeId || emp.deviceUserId || fp).padStart(6, '0');
  const nameEn = translit(emp.name);
  // تجهيز بطاقة QR موقعة + رابط تحقق عام (أعلى معايير الجودة)
  const { provisionCard } = require(path.join(ROOT, 'backend', 'hr-routes'));
  const pgc = await new (require(path.join(ROOT, 'node_modules', 'pg')).Pool)({
    user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'karim_erp', password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT || 5432),
  }).connect();
  let card;
  try { card = await provisionCard(pgc, { ...emp, id: Number(emp.id) }); }
  finally { try { pgc.release(); } catch (_) {} }
  const crypto = require('crypto');
  const qrs = process.env.EMPLOYEE_QR_SECRET || process.env.JWT_SECRET || '';
  const payload = { eid: String(card.employee.employeeId), cid: card.employee.cardId, v: card.qrPayload.qrVersion, t: card.qrPayload.token };
  const sig = crypto.createHmac('sha256', qrs).update(`${payload.eid}|${payload.cid}|${payload.v}|${payload.t}`, 'utf8').digest('hex');
  // رابط التحقق: جدول الإعدادات أولًا (تحكم الواجهة) ثم البيئة ثم الافتراضي
  let base = process.env.CARD_VERIFY_BASE || '';
  try {
    const r = await pool.query(`SELECT key, value FROM hr_card_settings WHERE key IN ('verify_base','emergency_phone')`);
    for (const row of r.rows) {
      if (row.key === 'verify_base' && row.value) base = row.value;
      if (row.key === 'emergency_phone' && row.value) process.env.EMERGENCY_PHONE = row.value;
    }
  } catch (_) {}
  if (!base) base = 'https://192.168.1.165:5000';
  base = base.replace(/\/$/, '');
  const verifyUrl = `${base}/api/hr/card/verify?d=${Buffer.from(JSON.stringify(payload)).toString('base64url')}&s=${sig}`;
  const qr = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1 });
  let photo = arg('photo', '');
  if (!photo && emp.photo) {
    if (emp.photo.startsWith('data:')) photo = emp.photo;
    else {
      const cand = [emp.photo, path.join(ROOT, emp.photo.replace(/^\//, ''))];
      photo = cand.find(f => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }) || '';
    }
  }
  const photoUri = photo && photo.startsWith('data:') ? photo
    : (photo ? 'data:image/jpeg;base64,' + fs.readFileSync(photo).toString('base64')
      : 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120"><rect width="100" height="120" fill="#dfe5ee"/><text x="50" y="70" font-size="36" text-anchor="middle" fill="#0A2540">${(emp.name || '?').trim()[0] || '?'}</text></svg>`));
  // الشعار: karim-logo.png أولًا ثم بدائل المشروع ثم عنصر SVG — لا يفشل التوليد أبدًا لنقص ملف
  const logoCands = [
    path.join(ROOT, 'frontend', 'app', 'assets', 'karim-logo.png'),
    path.join(ROOT, 'frontend', 'app', 'assets', 'karim-logo.png'),
    path.join(ROOT, 'frontend', 'app', 'assets', 'icon-512.png'),
  ];
  const logoAbs = logoCands.find((f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } });
  const logoUri = logoAbs
    ? 'data:image/png;base64,' + fs.readFileSync(logoAbs).toString('base64')
    : 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="56" fill="#0A2540"/><circle cx="60" cy="60" r="50" fill="none" stroke="#C9A961" stroke-width="3"/><text x="60" y="74" font-size="34" text-anchor="middle" fill="#C9A961">ش</text></svg>`);
  // شعار الوقف (اختياري): ضع ملف waqf-logo.png بجانب المولد وسيظهر تلقائيًا
  let waqfUri = '';
  for (const cand of [path.join(CARDIR, 'waqf-logo.png'), path.join(CARDIR, 'waqf-logo.jpg'), path.join(CARDIR, 'waqf-logo.svg')]) {
    try { if (fs.statSync(cand).isFile()) { const ext = cand.endsWith('.svg') ? 'svg+xml' : cand.endsWith('.jpg') ? 'jpeg' : 'png'; waqfUri = `data:image/${ext};base64,` + fs.readFileSync(cand).toString('base64'); break; } } catch (_) {}
  }
  const issue = new Date().toISOString().slice(0, 10);
  const exp = new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10);
  const escH = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Yara HR كاحتياطي للمسمى الوظيفي (قراءة فقط)
  let yaraJob = '';
  try {
    const oracledb = require(path.join(ROOT, 'node_modules', 'oracledb'));
    if (!process.env.NLS_LANG) process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';
    try { oracledb.initOracleClient({ libDir: process.env.YARASOFT_ORACLE_IC_PATH || 'C:/oracle/instantclient_23_26' }); } catch (_) {}
    const oc = await oracledb.getConnection({ user: process.env.YARASOFT_ORACLE_USER || 'acc2026', password: process.env.YARASOFT_ORACLE_PASSWORD || 'acc123', connectString: '192.168.1.188:1521/ORACLE' });
    const yq = process.env.YARA_JOBS_MAP;
    let jobMap = null;
    if (yq) { try { jobMap = JSON.parse(yq); } catch (_) {} }
    if (!jobMap) {
      const yr = await oc.execute(`SELECT PER_NO, JOBNM FROM PER_SYS`);
      jobMap = {};
      for (const r of yr.rows || []) jobMap[String(r[0]).trim().replace(/^0+/, '') || '0'] = (r[1] ? String(r[1]).trim() : '');
    }
    yaraJob = jobMap[String(fp).replace(/^0+/, '') || fp] || '';
    await oc.close();
  } catch (_) {}
  const position = emp.position || yaraJob || 'موظف';
  const dept = emp.dept_name || emp.department || 'مطاعم الشرفه العالمي';
  const docNo = 'E' + empNo;
  // MRZ-TD1 (3×30) بأرقام تدقيق صحيحة
  const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '<');
  const f1 = mrzPad('I<SAU' + mrzPad(docNo.toUpperCase(), 9) + mrzCheck(mrzPad(docNo.toUpperCase(), 9)), 30);
  const parts = nameEn.split(' ').filter(Boolean);
  const f2 = mrzPad(clean(parts.slice(-1)[0] || 'X').slice(0, 12) + '<<' + clean(parts.slice(0, -1).join('<')).slice(0, 14), 30);
  const f3 = mrzPad('SAU' + mrzPad(empNo, 9) + mrzCheck(mrzPad(empNo, 9)), 30);
  // إزالة سطر @import إن وُجد — نمط مقيّد بالسطر كاملًا فقط، لأن ذكر الكلمة داخل تعليق
  // أو وجود «;» داخل رابط الخطوط مع نمط فضفاض كان يبتلع قواعد CSS سليمة ويكسر البطاقة
  const cssInline = fs.readFileSync(path.join(CARDIR, 'card.css'), 'utf8').replace(/^@import\s+url\([^\n]*\)\s*;\s*$/gm, '');
  // علامة مائية لبرج الوقف (خلفية الوجه الخلفي)
  let waqfWm = '';
  try {
    for (const cand of ['waqf-watermark.jpg', 'waqf-watermark.png']) {
      const wmp = path.join(CARDIR, cand);
      if (fs.statSync(wmp).isFile()) {
        const ext = cand.endsWith('.jpg') ? 'jpeg' : 'png';
        waqfWm = `<div class="waqfwm" style="background-image:url('data:image/${ext};base64,${fs.readFileSync(wmp).toString('base64')}')"></div>`;
        break;
      }
    }
  } catch (_) {}
  const fill = (tpl) => tpl
    .replace('<link rel="stylesheet" href="../card.css">', `<style>${cssInline}</style>`)
    .replaceAll('{{GUILLOCHE}}', guilloche())
    .replaceAll('{{LOGO}}', logoUri).replaceAll('{{PHOTO}}', photoUri).replaceAll('{{QR}}', qr)
    .replaceAll('{{WAQF_WM}}', waqfWm)
    .replaceAll('{{WAQF_LOGO}}', waqfUri ? `<img class="logo waqf" src="${waqfUri}" alt="waqf">` : '')
    .replaceAll('{{NAME_AR}}', escH(emp.name || '')).replaceAll('{{NAME_EN}}', escH(nameEn))
    .replaceAll('{{POSITION}}', escH(position)).replaceAll('{{DEPT}}', escH(dept))
    .replaceAll('{{EMP_NO}}', empNo)
    .replaceAll('{{MICROTEXT}}', 'AL SHORFA RESTAURANTS • KARIM ERP • ' + docNo + ' • ')
    .replaceAll('{{MRZ1}}', f1).replaceAll('{{MRZ2}}', f2).replaceAll('{{MRZ3}}', f3)
    .replaceAll('{{BARS}}', code128bars(empNo))
    .replaceAll('{{TERMS}}', 'هذه البطاقة ملك لمطاعم الشرفه العالمي — يمنع إساءة استخدامها — عند الفقد الاتصال بالإدارة فورًا.')
    .replaceAll('{{EMERGENCY}}', process.env.EMERGENCY_PHONE || '+966-5X-XXX-XXXX')
    .replaceAll('{{ISSUE}}', issue).replaceAll('{{EXPIRY}}', exp);
  fs.mkdirSync(OUT, { recursive: true });
  const html = fill(fs.readFileSync(path.join(CARDIR, 'card.html'), 'utf8'));
  fs.writeFileSync(path.join(OUT, `card-${fp}.html`), html);
  // SVG مستقل (الوجه الأمامي) للمتجهات/المطبعة
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="638" height="1016" viewBox="0 0 204 322">
<defs><clipPath id="rc"><rect x="0" y="0" width="204" height="322" rx="12"/></clipPath>
<linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#061627"/><stop offset=".34" stop-color="#0A2540"/><stop offset=".68" stop-color="#16307E"/><stop offset="1" stop-color="#4338CA"/></linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C9A961"/><stop offset=".5" stop-color="#0FB5A6"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs>
<g clip-path="url(#rc)"><rect width="204" height="322" fill="#FDFCF9"/>
<g opacity="0.12">${guilloche()}</g>
<rect width="204" height="62" fill="url(#band)"/>
<circle cx="30" cy="6" r="26" fill="#0FB5A6" opacity=".38"/><circle cx="176" cy="34" r="16" fill="#FFB020" opacity=".45"/><circle cx="120" cy="2" r="11" fill="#C9A961" opacity=".5"/>
<text x="12" y="26" fill="#fff" font-size="13" font-weight="bold" font-family="Cairo,Arial">مطاعم الشرفه العالمي</text>
<text x="12" y="40" fill="#E8D5A3" font-size="8" font-family="Inter,Arial">AL SHORFA RESTAURANTS</text>
<rect x="0" y="0" width="11" height="322" fill="url(#accent)" opacity="0.9"/>
<text x="192" y="120" text-anchor="end" font-size="15" font-weight="bold" fill="#0A2540" font-family="Cairo,Arial">${escH(emp.name || '')}</text>
<text x="192" y="138" text-anchor="end" font-size="9" fill="#475569" font-family="Inter,Arial">${escH(nameEn)}</text>
<text x="192" y="154" text-anchor="end" font-size="9" fill="#1a1a1a" font-family="Cairo,Arial">${escH(position)} • ${escH(dept)}</text>
<text x="192" y="174" text-anchor="end" font-size="11" font-weight="bold" fill="#fff" font-family="Courier New,monospace" letter-spacing="2"><tspan fill="#fff">${empNo}</tspan></text>
<rect x="120" y="162" width="76" height="12" rx="6" fill="#16307E"/>
<rect x="55" y="182" width="94" height="64" fill="#e8e8e8" stroke="url(#accent)" stroke-width="2"/>
<image href="${photoUri}" x="55" y="182" width="94" height="64" preserveAspectRatio="xMidYMid slice"/>
<image href="${qr}" x="74" y="252" width="56" height="56"/>
<rect x="74" y="252" width="56" height="56" fill="none" stroke="url(#accent)" stroke-width="1.5"/>
<rect x="0" y="0" width="204" height="322" rx="12" fill="none" stroke="#C9A961" stroke-width="1.2" opacity="0.65"/>
<rect x="0" y="306" width="204" height="16" fill="url(#band)"/>
<text x="102" y="316" text-anchor="middle" font-size="4.5" letter-spacing="1.5" fill="#ffffffcc" font-family="Inter,Arial">AL SHORFA RESTAURANTS • KARIM ERP • ${docNo} •</text>
</g></svg>`;
  fs.writeFileSync(path.join(OUT, `card-${fp}.svg`), svg);
  console.log(JSON.stringify({ ok: true, fp, name: emp.name, files: [`card-${fp}.html`, `card-${fp}.svg`] }));
  process.exit(0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
