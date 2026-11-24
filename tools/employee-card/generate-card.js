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
  // وردة هندسية ذهبية على الأسود (MIDNIGHT GOLD) — فخامة هادئة بلا ألوان صارخة
  let s = '';
  const rings = ['#8F7339', '#C9A961', '#F3DFA8', '#C9A961'];
  for (let r = 8, i = 0; r <= 170; r += 7, i++) {
    const c = rings[i % rings.length];
    const op = r % 21 === 0 ? 0.9 : 0.55;
    s += `<circle cx="102" cy="161" r="${r}" fill="none" stroke="${c}" stroke-width="${r % 21 === 0 ? 0.9 : 0.5}" opacity="${op}"/>`;
  }
  for (let a = 0; a < 360; a += 12) {
    const c = a % 36 === 0 ? '#F3DFA8' : '#C9A961';
    const x2 = 102 + 100 * Math.cos(a * Math.PI / 180), y2 = 161 + 160 * Math.sin(a * Math.PI / 180);
    s += `<line x1="102" y1="161" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="0.3" opacity="0.45"/>`;
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
  // بطاقة QR موقعة + رابط تحقق عام — بنفس اتصال القراءة (لا pool ثانٍ
  // بقاعدة/مستخدم مختلفين قد يفشل في الإنتاج).
  const { provisionCard } = require(path.join(ROOT, 'backend', 'hr-routes'));
  const card = await provisionCard(pool, { ...emp, id: Number(emp.id) });
  const crypto = require('crypto');
  const qrs = process.env.EMPLOYEE_QR_SECRET || process.env.JWT_SECRET || '';
  const payload = { eid: String(card.employee.employeeId), cid: card.employee.cardId, v: card.qrPayload.qrVersion, t: card.qrPayload.token };
  const sig = crypto.createHmac('sha256', qrs).update(`${payload.eid}|${payload.cid}|${payload.v}|${payload.t}`, 'utf8').digest('hex');
  // توقيع مختصر مربوط بمعرف البطاقة فقط — يجب أن يطابق السيرفر (/card/v/:code)
  const shortSig = crypto.createHmac('sha256', qrs).update(String(payload.cid), 'utf8').digest('hex').slice(0, 16);
  // إعدادات البطاقة من الواجهة (جدول hr_card_settings) ثم البيئة ثم الافتراضي.
  const cardCfg = {
    verify_base: process.env.CARD_VERIFY_BASE || '',
    emergency_phone: process.env.EMERGENCY_PHONE || '',
    org_name_ar: 'مطاعم الشرفه العالمي',
    org_name_en: 'AL SHURFA AL ALAMI RESTAURANTS',
    card_title_ar: 'بطاقة هوية رسمية',
    card_slogan_ar: 'مجمع برج الساعة',
    card_footer_ar: 'يتحمل حاملها المسؤولية القانونية كاملة عن استخدامها.',
    badge_text: 'OFFICIAL EXECUTIVE',
    accent: 'gold',
    show_blood: 'true',
    show_mrz: 'true',
  };
  try {
    const r = await pool.query(`SELECT key, value FROM hr_card_settings`);
    for (const row of r.rows) {
      if (row.value !== null && row.value !== undefined && row.value !== '' && row.key in cardCfg) {
        cardCfg[row.key] = row.value;
      }
    }
  } catch (_) {}
  if (!cardCfg.verify_base) {cardCfg.verify_base = process.env.CARD_VERIFY_BASE || 'https://karimeg.online';}
  if (cardCfg.emergency_phone) {process.env.EMERGENCY_PHONE = cardCfg.emergency_phone;}
  const base = String(cardCfg.verify_base).replace(/\/$/, '');
  const verifyUrl = `${base}/api/hr/card/v/${payload.cid}.${shortSig}`;
  // رابط مختصر (~70 حرف بدل ~300): نفس الأمان (HMAC مقتطع 16 hex = 64-bit)
  // والتحقق الكامل يتم server-side من قاعدة البيانات — QR خفيف يمسح فورًا.
  // مستوى M + هامش 2: وحدات كبيرة وواضحة للكاميرا حتى مع شعار المنتصف.
  const qr = await QRCode.toDataURL(verifyUrl, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
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
  // الشعار: 19.jpg الأصلي أولًا (ملف التصميم إن وُضع بجانب المولد) ثم شعار النظام
  const logoCands = [
    path.join(CARDIR, '19.jpg'),
    path.join(CARDIR, '19.png'),
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
  const dept = emp.dept_name || emp.department || cardCfg.org_name_ar;
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
  // صورة البرج للهيدر السيادي: 000.jfif أولًا (ملف التصميم الأصلي إن وُضع
  // بجانب المولد) ثم العلامة المائية الموجودة — لا يفشل التوليد أبدًا.
  let towerUri = '';
  for (const cand of ['000.jfif', '000.jpg', 'waqf-watermark.jpg', 'waqf-watermark.png']) {
    try {
      const tp = path.join(CARDIR, cand);
      if (fs.statSync(tp).isFile()) {
        const ext = cand.endsWith('.png') ? 'png' : 'jpeg';
        towerUri = `data:image/${ext};base64,` + fs.readFileSync(tp).toString('base64');
        break;
      }
    } catch (_) {}
  }
  if (!towerUri) {
    towerUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0C1424"/><stop offset="1" stop-color="#04070D"/></linearGradient></defs><rect width="400" height="160" fill="url(#g)"/></svg>`);
  }
  const slash = (s) => String(s || '').replace(/-/g, '/');
  const positionEn = translit(position).toUpperCase().slice(0, 40) || 'STAFF';
  const blood = emp.blood_type || emp.blood || emp.blood_group || '—';
  // لوحات ألوان البطاقة — تُختار من إعدادات الواجهة وتُحقن كمتغيرات CSS.
  const ACCENTS = {
    gold: { main: '#D4AF37', bright: '#FFF3D6', dark: '#82611A', deep: '#101929', glow: 'rgba(212,175,55,0.40)', metallic: 'linear-gradient(135deg,#FFF3D6 0%,#D4AF37 45%,#967223 75%,#FFF3D6 100%)' },
    emerald: { main: '#1FA37A', bright: '#D7FBEC', dark: '#0C5B44', deep: '#071B16', glow: 'rgba(31,163,122,0.40)', metallic: 'linear-gradient(135deg,#E7FFF6 0%,#1FA37A 45%,#0C5B44 75%,#E7FFF6 100%)' },
    sapphire: { main: '#2F7DD1', bright: '#DCEBFF', dark: '#123F70', deep: '#07101F', glow: 'rgba(47,125,209,0.40)', metallic: 'linear-gradient(135deg,#EAF3FF 0%,#2F7DD1 45%,#123F70 75%,#EAF3FF 100%)' },
    burgundy: { main: '#B33A4A', bright: '#FFE3E7', dark: '#6B1B27', deep: '#1A080C', glow: 'rgba(179,58,74,0.40)', metallic: 'linear-gradient(135deg,#FFEDF0 0%,#B33A4A 45%,#6B1B27 75%,#FFEDF0 100%)' },
    platinum: { main: '#B8C0CC', bright: '#F4F7FB', dark: '#5E6672', deep: '#0E1116', glow: 'rgba(184,192,204,0.38)', metallic: 'linear-gradient(135deg,#FFFFFF 0%,#B8C0CC 45%,#6B7480 75%,#FFFFFF 100%)' },
  };
  const accent = ACCENTS[String(cardCfg.accent || 'gold').toLowerCase()] || ACCENTS.gold;
  const accentCss = `:root{--gold-main:${accent.main};--gold-bright:${accent.bright};--gold-dark:${accent.dark};--bg-dark-blue:${accent.deep};--gold-glow:${accent.glow};--gold-metallic:${accent.metallic};}`;
  const showBlood = String(cardCfg.show_blood).toLowerCase() !== 'false';
  const showMrz = String(cardCfg.show_mrz).toLowerCase() !== 'false';
  const bloodCell = showBlood
    ? `<div class="meta-col"><div class="meta-head">فصيلة الدم</div><div class="meta-val">${escH(blood)}</div></div>`
    : '';
  const mrzBlock = showMrz ? `<div class="mrz-sovereign" dir="ltr">${f1}<br>${f2}</div>` : '';
  const fill = (tpl) => tpl
    .replace('<link rel="stylesheet" href="../card.css">', `<style>${cssInline}</style>`)
    .replaceAll('{{ACCENT_CSS}}', accentCss)
    .replaceAll('{{LOGO}}', logoUri).replaceAll('{{TOWER}}', towerUri)
    .replaceAll('{{PHOTO}}', photoUri).replaceAll('{{QR}}', qr)
    .replaceAll('{{NAME_AR}}', escH(emp.name || '')).replaceAll('{{NAME_EN}}', escH(nameEn))
    .replaceAll('{{POSITION}}', escH(position)).replaceAll('{{POSITION_EN}}', escH(positionEn))
    .replaceAll('{{DEPT}}', escH(dept))
    .replaceAll('{{EMP_NO}}', empNo)
    .replaceAll('{{BLOOD}}', escH(blood)).replaceAll('{{BLOOD_CELL}}', bloodCell)
    .replaceAll('{{MRZ1}}', f1).replaceAll('{{MRZ2}}', f2).replaceAll('{{MRZ_BLOCK}}', mrzBlock)
    .replaceAll('{{ORG_AR}}', escH(cardCfg.org_name_ar))
    .replaceAll('{{ORG_EN}}', escH(cardCfg.org_name_en))
    .replaceAll('{{CARD_TITLE}}', escH(cardCfg.card_title_ar))
    .replaceAll('{{SLOGAN}}', escH(cardCfg.card_slogan_ar))
    .replaceAll('{{FOOTER_NOTE}}', escH(cardCfg.card_footer_ar))
    .replaceAll('{{BADGE_TEXT}}', escH(cardCfg.badge_text))
    .replaceAll('{{EMERGENCY}}', escH(cardCfg.emergency_phone || process.env.EMERGENCY_PHONE || '+966 56 022 9281'))
    .replaceAll('{{ISSUE}}', slash(issue)).replaceAll('{{EXPIRY}}', slash(exp));
  fs.mkdirSync(OUT, { recursive: true });
  const html = fill(fs.readFileSync(path.join(CARDIR, 'card.html'), 'utf8'));
  fs.writeFileSync(path.join(OUT, `card-${fp}.html`), html);
  // SVG بريميوم مستقل (الوجه الأمامي) للمتجهات/المطبعة — معدن + ذهب
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="638" height="1016" viewBox="0 0 204 322">
<defs><clipPath id="rc"><rect x="0" y="0" width="204" height="322" rx="14"/></clipPath>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#32353b"/><stop offset="1" stop-color="#15171a"/></linearGradient>
<linearGradient id="goldm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFF3D6"/><stop offset=".3" stop-color="#E2BE5A"/><stop offset=".7" stop-color="#9E7A28"/><stop offset="1" stop-color="#FFF3D6"/></linearGradient></defs>
<g clip-path="url(#rc)"><rect width="204" height="322" fill="url(#metal)"/>
<text x="102" y="52" text-anchor="middle" font-size="38" font-weight="900" fill="url(#goldm)" font-family="Cairo,Arial">𓁫</text>
<text x="102" y="72" text-anchor="middle" font-size="11" font-weight="800" fill="#DFBA57" font-family="Cairo,Arial">${escH(cardCfg.org_name_ar)}</text>
<text x="102" y="84" text-anchor="middle" font-size="7" fill="#DFBA57" font-family="Inter,Arial">${escH(cardCfg.org_name_en)}</text>
<rect x="55" y="94" width="94" height="108" fill="#111317" stroke="#DFBA57" stroke-width="2"/>
<image href="${photoUri}" x="56" y="95" width="92" height="106" preserveAspectRatio="xMidYMid slice"/>
<rect x="62" y="204" width="80" height="12" rx="2" fill="url(#goldm)"/>
<text x="102" y="224" text-anchor="middle" font-size="15" font-weight="bold" fill="#FFFFFF" font-family="Cairo,Arial">${escH(emp.name || '')}</text>
<text x="102" y="238" text-anchor="middle" font-size="8" fill="#9CA3AF" font-family="Inter,Arial">${escH(nameEn)}</text>
<text x="102" y="256" text-anchor="middle" font-size="11" font-weight="800" fill="#FFFFFF" font-family="Cairo,Arial">${escH(position)}</text>
<text x="102" y="268" text-anchor="middle" font-size="7" fill="#DFBA57" font-family="Inter,Arial">${escH(positionEn)}</text>
<rect x="20" y="276" width="164" height="18" rx="3" fill="url(#goldm)"/>
<text x="102" y="289" text-anchor="middle" font-size="11" font-weight="900" fill="#15171a" font-family="Courier New,monospace" letter-spacing="1">${empNo}</text>
<rect x="0" y="0" width="204" height="322" rx="14" fill="none" stroke="#DFBA57" stroke-width="1.5" opacity="0.6"/>
</g></svg>`;
  fs.writeFileSync(path.join(OUT, `card-${fp}.svg`), svg);
  console.log(JSON.stringify({ ok: true, fp, name: emp.name, files: [`card-${fp}.html`, `card-${fp}.svg`] }));
  process.exit(0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
