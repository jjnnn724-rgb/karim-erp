#!/usr/bin/env node
'use strict';
/**
 * import-employee-documents.js — استيراد تواريخ انتهاء وثائق الموظفين من Excel
 * ─────────────────────────────────────────────────────────────────────────────
 * المصادر: تاريخ انتهاء الاقامات كريم.xlsx (ميلادي — مصدر الحقيقة)
 *          الشهادات الصحية كريم.xlsx (هجري للشهادة والتثقيف)
 * الحقول المستهدفة (موجودة — لا حقول جديدة): employees.iqamaExpiry /
 *          healthCertExpiry / healthEduExpiry — عقد التطبيق: تخزين ميلادي ISO
 *          والعرض هجري بأم القرى (hijriDateField).
 * القواعد: مطابقة برقم الإقامة فقط، لا إنشاء موظفين، لا كتابة صامتة للتعارض،
 *          Idempotent (تشغيل متكرر = UNCHANGED)، معاملة واحدة، تدقيق كامل.
 * التشغيل: npm run import:employee-documents [-- --dry-run]
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { pool } = require('../backend/shared-pool');
const { logger } = require('../backend/logger');

const IQAMA_XLSX = process.env.IQAMA_XLSX || 'C:/Users/RemoteHome/Downloads/تاريخ انتهاء الاقامات كريم.xlsx';
const HEALTH_XLSX = process.env.HEALTH_XLSX || 'C:/Users/RemoteHome/Downloads/الشهادات الصحية كريم.xlsx';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = new Date().toISOString();

// ─── هجري أم القرى → ميلادي ISO (نسخة مطابقة لخوارزمية الواجهة hijriToGregorian) ──
const _umalqura = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' });
function _hijriPartsOf(dateMs) {
    const g = {};
    _umalqura.formatToParts(new Date(dateMs)).forEach((p) => { g[p.type] = p.value; });
    return [parseInt(String(g.year || '').replace(/[^0-9]/g, ''), 10), parseInt(g.month, 10), parseInt(g.day, 10)];
}
function hijriToGregorianISO(hy, hm, hd) {
    hy = Number(hy); hm = Number(hm); hd = Number(hd);
    if (!hy || !hm || !hd || hm < 1 || hm > 12 || hd < 1 || hd > 30) {return null;}
    const target = [hy, hm, hd].join('-');
    let lo = Date.UTC(2020, 0, 1), hi = Date.UTC(2042, 11, 31);
    for (let i = 0; i < 40 && lo <= hi; i++) {
        const mid = Math.floor((lo + hi) / 2 / 86400000) * 86400000;
        const cur = _hijriPartsOf(mid).join('-');
        if (cur === target) {
            const d = new Date(mid);
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
        }
        const [cy, cm, cd] = cur.split('-').map(Number);
        if (cy < hy || (cy === hy && (cm < hm || (cm === hm && cd < hd)))) {lo = mid + 86400000;}
        else {hi = mid - 86400000;}
    }
    return null;
}

// ─── أدوات قراءة وتنظيف ──────────────────────────────────────────────────────
function normIqama(v) {
    if (v === null || v === undefined) {return '';}
    if (typeof v === 'number' && Number.isFinite(v)) {return String(Math.round(v));}
    return String(v).replace(/\D/g, '');
}
const P2 = (n) => String(n).padStart(2, '0');
function excelDateToISO(v) {
    if (v === null || v === undefined || v === '') {return null;}
    if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 60000) {
        // تسلسلي Excel الخام — SSF يطبق نظام 1900 بدقة على تاريخ الحائط
        return String(XLSX.SSF.format('yyyy-mm-dd', v));
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        return `${v.getUTCFullYear()}-${P2(v.getUTCMonth() + 1)}-${P2(v.getUTCDate())}`;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {return `${m[1]}-${P2(m[2])}-${P2(m[3])}`;}
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {return `${m[3]}-${P2(m[2])}-${P2(m[1])}`;}
    return null;
}
const HIJRI_RE = /^(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})$/;
function parseHijri(v) {
    const s = String(v ?? '').trim();
    const m = s.match(HIJRI_RE);
    if (!m) {return null;}
    const hy = Number(m[1]), hm = Number(m[2]), hd = Number(m[3]);
    if (hy < 1300 || hy > 1500) {return null;}
    return { hy, hm, hd, raw: `${hy}/${P2(hm)}/${P2(hd)}` };
}
function isHijriEncoded(v) {
    const m = String(v ?? '').trim().match(HIJRI_RE);
    return !!(m && Number(m[1]) >= 1300 && Number(m[1]) <= 1500);
}
function normName(s) {
    return String(s || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/\s+/g, ' ').trim();
}
function findCol(headers, candidates) {
    for (const c of candidates) {
        const idx = headers.findIndex((h) => String(h || '').replace(/\s+/g, '').includes(c));
        if (idx !== -1) {return idx;}
    }
    return -1;
}

// ─── قراءة الملفات ───────────────────────────────────────────────────────────
function readSheet(file) {
    // بلا cellDates: تحويل التسلسلي عبر SSF أدق — بناء Date في SheetJS منحرف
    // بقيمة ~51 ثانية (تعويض نظام 1900) يقلب التاريخ يومًا عند قراءة UTC/محلي.
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    return rows;
}

/** ملف الإقامات → [{iqama, name, gregISO, row}] */
function readIqama(file) {
    const rows = readSheet(file);
    const headers = rows[0].map((h) => String(h ?? ''));
    const cIq = findCol(headers, ['رقمالإقامة', 'الإقامة', 'اقامة']);
    const cName = findCol(headers, ['الاسم', 'الاسم', 'اسم']);
    const cDate = findCol(headers, ['تاريخانتهاءالإقامة', 'انتهاءالإقامة', 'تاريخالانتهاء']);
    if (cIq === -1 || cDate === -1) {throw new Error('أعمدة ملف الإقامات غير معروفة: ' + headers.join(' | '));}
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[cIq] || String(normIqama(r[cIq])) === '') {continue;}
        out.push({ file: path.basename(file), row: i + 1, iqama: normIqama(r[cIq]), name: cName > -1 ? String(r[cName] ?? '').trim() : '', gregISO: excelDateToISO(r[cDate]) });
    }
    return out;
}

/** ملف الشهادات → [{iqama, name, certHijri, eduHijri, row}] */
function readHealth(file) {
    const rows = readSheet(file);
    const headers = rows[0].map((h) => String(h ?? ''));
    const cIq = findCol(headers, ['رقمالإقامة', 'الإقامة', 'اقامة']);
    const cName = findCol(headers, ['الاسم', 'الاسم']);
    const cCert = findCol(headers, ['انتهاءالشهاداتالصحية', 'الشهاداتالصحية', 'شهادات']);
    const cEdu = findCol(headers, ['تاريخنهايةالتثقيف', 'التثقيف', 'تثقيف']);
    if (cIq === -1 || cCert === -1) {throw new Error('أعمدة ملف الشهادات غير معروفة: ' + headers.join(' | '));}
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[cIq] || String(normIqama(r[cIq])) === '') {continue;}
        out.push({
            file: path.basename(file), row: i + 1, iqama: normIqama(r[cIq]),
            name: cName > -1 ? String(r[cName] ?? '').trim() : '',
            certHijri: parseHijri(r[cCert]), eduHijri: cEdu > -1 ? parseHijri(r[cEdu]) : null,
        });
    }
    return out;
}

/** كشف ازدواج داخل الملف: مطابق → دمج؛ مختلف → تعارض */
function dedupe(rows, keyOf, sameOf) {
    const byKey = new Map();
    const dupes = [];
    for (const r of rows) {
        const k = r.iqama;
        if (!byKey.has(k)) {byKey.set(k, [r]); continue;}
        const list = byKey.get(k);
        if (sameOf(list[0], r)) {list.push(r); dupes.push({ ...r, kind: 'identical' });}
        else {dupes.push({ ...r, kind: 'conflict' });}
    }
    return { unique: [...byKey.values()].map((l) => l[0]), dupes };
}

// ─── الحكم على قيمة قديمة → عملية ────────────────────────────────────────────
// يرجع {op, next} حيث op ∈ UPDATED|UNCHANGED|REENCODED|CONFLICT|FILL
function decide({ oldVal, nextISO, oldHijriRawIncoming, oldWasHijri }) {
    const old = String(oldVal ?? '').trim();
    if (!old) {return { op: 'FILL', next: nextISO };}
    if (old === nextISO) {return { op: 'UNCHANGED', next: nextISO };}
    if (oldWasHijri) {
        // القيمة القديمة مخزنة بنص هجري بعكس عقد الحقل — أعد ترميزها لنفس التاريخ المنطقي
        const m = old.match(HIJRI_RE);
        const oldGreg = hijriToGregorianISO(Number(m[1]), Number(m[2]), Number(m[3]));
        if (oldGreg && oldGreg === nextISO) {return { op: 'REENCODED', next: nextISO, oldLogicalGreg: oldGreg };}
        return { op: 'CONFLICT', next: nextISO, oldLogicalGreg: oldGreg };
    }
    return { op: 'CONFLICT', next: nextISO };
}

// ─── بناء خطة التغييرات ──────────────────────────────────────────────────────
async function buildPlan() {
    const iqRows = readIqama(IQAMA_XLSX);
    const hlRows = readHealth(HEALTH_XLSX);
    const iqD = dedupe(iqRows, (r) => r.iqama, (a, b) => a.gregISO === b.gregISO);
    const hlD = dedupe(hlRows, (r) => r.iqama, (a, b) => String(a.certHijri?.raw || '') === String(b.certHijri?.raw || '') && String(a.eduHijri?.raw || '') === String(b.eduHijri?.raw || ''));

    const allIqamas = [...new Set([...iqD.unique, ...hlD.unique].map((r) => r.iqama))];
    const { rows: empRows } = await pool.query(
        `SELECT id, name, "iqamaNumber", "iqamaExpiry", "healthCertExpiry", "healthEduExpiry"
           FROM employees WHERE "iqamaNumber" = ANY($1)`, [allIqamas]);
    const empByIqama = new Map(empRows.map((e) => [String(e.iqamaNumber).trim(), e]));

    const plan = { updates: [], notFound: [], conflicts: [], invalid: [], nameMismatches: [], dupes: [...iqD.dupes, ...hlD.dupes] };
    const matched = new Set();

    const pushField = (srcRow, emp, field, nextISO, oldHijriRawIncoming, oldWasHijri) => {
        const d = decide({ oldVal: emp[field], nextISO, oldHijriRawIncoming, oldWasHijri });
        const entry = {
            employeeId: emp.id, iqama: emp.iqamaNumber, employeeName: emp.name,
            excelName: srcRow.name, sourceFile: srcRow.file, excelRow: srcRow.row,
            field, oldValue: emp[field] || null, newValue: nextISO, op: d.op,
            oldLogicalGreg: d.oldLogicalGreg || null,
        };
        if (normName(srcRow.name) && normName(emp.name) && normName(srcRow.name) !== normName(emp.name)) {
            plan.nameMismatches.push({ iqama: emp.iqamaNumber, erp: emp.name, excel: srcRow.name });
        }
        if (d.op === 'CONFLICT') {plan.conflicts.push(entry); return;}
        if (d.op === 'UNCHANGED') {plan.updates.push({ ...entry, op: 'UNCHANGED' }); return;}
        plan.updates.push(entry);
    };

    // الإقامات (ميلادي — مصدر الحقيقة)
    for (const r of iqD.unique) {
        const emp = empByIqama.get(r.iqama);
        if (!emp) {plan.notFound.push({ ...r, file: 'iqama' }); continue;}
        matched.add(r.iqama);
        if (!r.gregISO) {plan.invalid.push({ ...r, reason: 'تاريخ إقامة غير صالح' }); continue;}
        pushField(r, emp, 'iqamaExpiry', r.gregISO, null, false);
    }
    // الشهادة الصحية + التثقيف (هجري مصدرًا → ميلادي ISO تخزينًا)
    for (const r of hlD.unique) {
        const emp = empByIqama.get(r.iqama);
        if (!emp) {plan.notFound.push({ ...r, file: 'health' }); continue;}
        matched.add(r.iqama);
        for (const [hijri, field] of [[r.certHijri, 'healthCertExpiry'], [r.eduHijri, 'healthEduExpiry']]) {
            if (!hijri) {continue;} // ناقص في الإكسل — لا يُمسّ الحقل
            const nextISO = hijriToGregorianISO(hijri.hy, hijri.hm, hijri.hd);
            if (!nextISO) {plan.invalid.push({ ...r, reason: `تاريخ هجري غير صالح ${hijri.raw}` }); continue;}
            pushField(r, emp, field, nextISO, hijri.raw, isHijriEncoded(emp[field]));
        }
    }
    plan.matchedCount = matched.size;
    return plan;
}

// ─── التنفيذ ─────────────────────────────────────────────────────────────────
function summarize(plan) {
    const ops = { FILL: 0, UPDATED: 0, UNCHANGED: 0, REENCODED: 0 };
    const byField = {};
    for (const u of plan.updates) {
        ops[u.op] = (ops[u.op] || 0) + 1;
        byField[u.field] = byField[u.field] || { FILL: 0, UNCHANGED: 0, REENCODED: 0 };
        byField[u.field][u.op] = (byField[u.field][u.op] || 0) + 1;
    }
    return { ops, byField };
}

async function main() {
    logger.info(`[doc-import] batch=${BATCH} dryRun=${DRY_RUN}`);
    const plan = await buildPlan();
    const sum = summarize(plan);

    console.log('\n════════ تقرير الاستيراد ' + (DRY_RUN ? '(تجربة جافة — لا تعديل)' : '(تنفيذ فعلي)') + ' ════════');
    console.log(`صفوف إكسل: إقامات=${plan.updates.filter((u) => u.field === 'iqamaExpiry').length + plan.notFound.filter((n) => n.file === 'iqama').length + plan.conflicts.filter((c) => c.field === 'iqamaExpiry').length}` +
        ` | شهادات+تثقيف=${plan.updates.filter((u) => u.field !== 'iqamaExpiry').length + plan.notFound.filter((n) => n.file === 'health').length}`);
    console.log(`موظفون مطابقون برقم الإقامة: ${plan.matchedCount}`);
    console.log(`عمليات: FILL=${sum.ops.FILL || 0}  UNCHANGED=${sum.ops.UNCHANGED || 0}  REENCODED=${sum.ops.REENCODED || 0}`);
    console.log(`بالحقل: ${JSON.stringify(sum.byField)}`);
    console.log(`غير موجودين في ERP (لن يُنشأوا): ${plan.notFound.length}`);
    console.log(`تعارضات (تتطلب مراجعة — لن تُكتب): ${plan.conflicts.length}`);
    console.log(`صفوف غير صالحة: ${plan.invalid.length}`);
    console.log(`ازدواج داخل الإكسل: ${plan.dupes.length} (مطابق=${plan.dupes.filter((d) => d.kind === 'identical').length} متعارض=${plan.dupes.filter((d) => d.kind === 'conflict').length})`);
    console.log(`اختلاف اسم (الإقامة هي المعتمد): ${plan.nameMismatches.length}`);

    const show = (arr, n) => arr.slice(0, n).forEach((x) => console.log('   • ' + JSON.stringify(x).slice(0, 190)));
    if (plan.notFound.length) {console.log('\n— غير موجودين —'); show(plan.notFound, 15);}
    if (plan.conflicts.length) {console.log('\n— تعارضات —'); show(plan.conflicts, 15);}
    if (plan.invalid.length) {console.log('\n— غير صالح —'); show(plan.invalid, 15);}
    if (plan.dupes.filter((d) => d.kind === 'conflict').length) {console.log('\n— ازدواج متعارض —'); show(plan.dupes.filter((d) => d.kind === 'conflict'), 15);}

    // التدقيق: ملف كامل بكل تفاصيل الصفوف
    const auditPath = path.join(__dirname, '..', 'logs', `import-employee-documents-${BATCH.replace(/[:.]/g, '-')}${DRY_RUN ? '-dryrun' : ''}.json`);
    fs.writeFileSync(auditPath, JSON.stringify({ batch: BATCH, dryRun: DRY_RUN, sources: { iqama: IQAMA_XLSX, health: HEALTH_XLSX }, summary: sum, ...plan }, null, 2), 'utf8');
    console.log(`\nتدقيق كامل: ${auditPath}`);

    const toWrite = plan.updates.filter((u) => u.op !== 'UNCHANGED');
    if (DRY_RUN) {
        console.log(`\n[DRY-RUN] كان سيُكتب ${toWrite.length} صف — لا تعديل في القاعدة.`);
        process.exit(0);
    }
    if (!toWrite.length) {console.log('\nلا شيء للكتابة — القاعدة محدثة بالفعل (Idempotent ✓)'); process.exit(0);}

    const client = await pool.connect();
    let written = 0;
    try {
        await client.query('BEGIN');
        for (const u of toWrite) {
            const r = await client.query(
                `UPDATE employees SET "${u.field}" = $2 WHERE id = $1 AND COALESCE("${u.field}",'') IS DISTINCT FROM $2`,
                [u.employeeId, u.newValue]);
            written += r.rowCount;
        }
        await client.query('COMMIT');
        console.log(`\n✅ تم كتابة ${written} صف في معاملة واحدة —ROLLBACK تلقائي عند أي خطأ.`);
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('[doc-import] فشل — تم التراجع كاملًا:', e.message);
        console.error('❌ فشل الاستيراد — تم التراجع (ROLLBACK):', e.message);
        process.exit(1);
    } finally {
        client.release();
    }
    process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
