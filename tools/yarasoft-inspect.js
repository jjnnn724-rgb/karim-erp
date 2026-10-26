#!/usr/bin/env node
/**
 * tools/yarasoft-inspect.js — أداة تشخيص صيغة فواتير Yarasoft (Phase 2)
 * ════════════════════════════════════════════════════════════════════════════
 * تُشغَّل على جهاز ويندوز داخل شبكة العميل (لأن بيئة التطوير لا تصل إلى
 * \\server\Yarasoft\pos) — تفتح المشاركة للقراءة فقط ولا تعدّل أي ملف.
 *
 * الاستخدام (من مجلد المشروع على جهاز العميل):
 *   node tools/yarasoft-inspect.js --share "\\server\Yarasoft\pos"
 *   node tools/yarasoft-inspect.js --share "\\server\Yarasoft\pos" --sample 5
 *   node tools/yarasoft-inspect.js --dir "C:\Yarasoft\pos"            (مسار محلي)
 *
 * المخرجات:
 *   yarasoft-format-report.json  — تقرير تقني كامل (يُرفق للمطور)
 *   yarasoft-format-report.txt   — تقرير مفهوم للقراءة
 *
 * ماذا تفحص؟ (حرفيًا من قائمة المواصفة Phase 2):
 * الامتدادات، أنماط التسمية، الطوابع الزمنية، الترميز، المحدد، تنسيق التاريخ
 * والأرقام، رقم الفاتورة، تمثيل الباركود/الكمية/السعر/الخصم/الضريبة،
 * الإرجاع/المرتجعات، فاتورة لكل ملف أم ملف متعدد، وعينات من الأسطر الأولى.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── واجهة الأوامر ───
const args = process.argv.slice(2);
function argValue(name) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
}
const SHARE = argValue('--share') || argValue('--dir') || '\\\\server\\Yarasoft\\pos';
const SAMPLE_COUNT = Number(argValue('--sample')) || 5;
const INVOICES_DIR = argValue('--invoices') || 'Invoices';
const DEPTH = Number(argValue('--depth')) || 2;

const report = {
    generatedAt: new Date().toISOString(),
    share: SHARE,
    reachable: false,
    tree: [],
    invoices: {
        path: null,
        reachable: false,
        fileCount: 0,
        extensions: {},
        namingPatterns: [],
        oldest: null,
        newest: null,
        samples: [],
    },
    formatAnalysis: {
        detectedKind: null,
        delimiter: null,
        encoding: null,
        headerRow: null,
        columnsDetected: [],
        dateFormat: null,
        decimalFormat: null,
        invoiceNumberFormat: null,
        invoicePerFile: null,
        creditNotes: null,
    },
    suggestedProfile: null,
    errors: [],
};

function safe(fn, fallback) {
    try { return fn(); } catch (e) { report.errors.push(e.message); return fallback; }
}

function detectEncoding(buf) {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8 (BOM)';
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le (BOM)';
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be (BOM)';
    const s = buf.subarray(0, 512);
    let zOdd = 0, zEven = 0;
    for (let i = 0; i < s.length; i++) { if (s[i] === 0) { if (i % 2) zOdd++; else zEven++; } }
    if (s.length >= 8 && zOdd > s.length * 0.3) return 'utf-16le (بدون BOM)';
    if (s.length >= 8 && zEven > s.length * 0.3) return 'utf-16be (بدون BOM)';
    const nonAscii = [...s].filter(b => b > 127).length;
    if (nonAscii === 0) return 'ascii';
    // محاولة قراءة UTF-8 صارمة
    try { new TextDecoder('utf-8', { fatal: true }).decode(s); return 'utf-8 (بدون BOM، قابل للتحقق)'; } catch { /* لا شيء */ }
    return 'ansi/windows-1256 محتمل (افحص العربية في العينة أدناه)';
}

function decodeText(buf) {
    const enc = detectEncoding(buf);
    if (enc.startsWith('utf-16le')) { const b = Buffer.from(buf); b.swap16(); return { enc, text: b.toString('utf16le').replace(/^\uFEFF/, '') }; }
    if (enc.startsWith('utf-16be')) { const b = Buffer.from(buf); b.swap16(); return { enc, text: b.toString('utf16le').replace(/^\uFEFF/, '') }; }
    return { enc, text: buf.toString('utf8').replace(/^\uFEFF/, '') };
}

function sniffDelimiter(lines) {
    const cands = [';', ',', '\t', '|', ':'];
    let best = null, bestScore = 0;
    for (const d of cands) {
        const counts = lines.map(l => l.split(d).length - 1);
        const total = counts.reduce((a, b) => a + b, 0);
        if (!total) continue;
        const avg = total / counts.length;
        const variance = counts.reduce((s, c) => s + (c - avg) ** 2, 0) / counts.length;
        const score = total * (1 / (1 + variance));
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
}

function describeNumberSample(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!/\d/.test(s)) return null;
    const hasComma = s.includes(','), hasDot = s.includes('.');
    if (hasComma && hasDot) return s.lastIndexOf(',') > s.lastIndexOf('.') ? '1.234,56 (فاصلة عشرية أوروبية)' : '1,234.56 (نقطة عشرية أمريكية)';
    if (hasComma) return /,\d{1,2}$/.test(s) ? '1234,56 (فاصلة عشرية)' : '1,234 (فاصل آلاف)';
    if (hasDot) return /\.\d{1,2}$/.test(s) ? '1234.56 (نقطة عشرية)' : '1.234 (فاصل آلاف)';
    return 'عدد صحيح';
}

const DATE_PATTERNS = [
    [/^\d{4}-\d{2}-\d{2}/, 'YYYY-MM-DD'],
    [/^\d{4}\/\d{2}\/\d{2}/, 'YYYY/MM/DD'],
    [/^\d{2}\/\d{2}\/\d{4}/, 'DD/MM/YYYY أو MM/DD/YYYY (افحص عينة > 12)'],
    [/^\d{2}-\d{2}-\d{4}/, 'DD-MM-YYYY'],
    [/^\d{8}\b/, 'YYYYMMDD أو DDMMYYYY'],
    [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'ISO 8601 مع وقت'],
    [/\d{2}\/\d{2}\/\d{2}\b/, 'DD/MM/YY'],
];

function walk(dir, depth, prefix) {
    if (depth > DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { report.errors.push(`تعذر فهرسة ${dir}: ${e.message}`); return; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        report.tree.push(`${prefix}${e.isDirectory() ? '[مجلد] ' : ''}${e.name}`);
        if (e.isDirectory()) walk(full, depth + 1, prefix + '  ');
    }
}

// ═══════════════════ 1) توفر المشاركة وشجرة المجلدات ═══════════════════
console.log(`\n🔍 فحص المشاركة: ${SHARE}\n`);
try {
    const st = fs.statSync(SHARE);
    report.reachable = st.isDirectory();
    console.log(report.reachable ? '✅ المشاركة متاحة للقراءة' : '⚠️ المسار موجود لكنه ليس مجلدًا');
} catch (e) {
    report.reachable = false;
    console.log(`❌ المشاركة غير متاحة: ${e.message}`);
    console.log('   تحقق من: الشبكة / صلاحيات المستخدم / اسم الخادم (server) ثم أعد المحاولة.');
}

if (report.reachable) {
    walk(SHARE, 1, '  ');
    console.log(`\n📁 شجرة المجلدات (حتى عمق ${DEPTH}):\n${report.tree.slice(0, 80).join('\n')}${report.tree.length > 80 ? `\n  … و${report.tree.length - 80} عنصرًا آخر` : ''}`);

    // ═══════════════════ 2) مجلد Invoices ═══════════════════
    const invDir = path.join(SHARE, INVOICES_DIR);
    report.invoices.path = invDir;
    try {
        const files = fs.readdirSync(invDir, { withFileTypes: true }).filter(f => f.isFile() && !f.name.startsWith('~$') && !f.name.startsWith('.'));
        report.invoices.reachable = true;
        report.invoices.fileCount = files.length;
        console.log(`\n✅ ${INVOICES_DIR} يحتوي ${files.length} ملفًا`);

        let oldest = null, newest = null;
        const nameSamples = [];
        for (const f of files) {
            const full = path.join(invDir, f.name);
            const st = safe(() => fs.statSync(full), null);
            if (st) {
                if (!oldest || st.mtime < oldest.mtime) oldest = { name: f.name, mtime: st.mtime };
                if (!newest || st.mtime > newest.mtime) newest = { name: f.name, mtime: st.mtime };
            }
            const ext = path.extname(f.name).toLowerCase() || '(بلا امتداد)';
            report.invoices.extensions[ext] = (report.invoices.extensions[ext] || 0) + 1;
            nameSamples.push(f.name);
        }
        report.invoices.oldest = oldest; report.invoices.newest = newest;
        console.log(`   الامتدادات: ${JSON.stringify(report.invoices.extensions)}`);
        if (oldest) console.log(`   الأقدم: ${oldest.name} (${oldest.mtime.toISOString()})`);
        if (newest) console.log(`   الأحدث: ${newest.name} (${newest.mtime.toISOString()})`);

        // أنماط التسمية: البادئة المشتركة + أطوال الأسماء
        const prefixes = {};
        for (const n of nameSamples) {
            const m = n.match(/^([A-Za-z\u0600-\u06FF_]+)[\s_-]?\d/);
            if (m) prefixes[m[1]] = (prefixes[m[1]] || 0) + 1;
        }
        report.invoices.namingPatterns = Object.entries(prefixes).map(([p, c]) => `${p}* (${c} ملفًا)`);
        if (report.invoices.namingPatterns.length) console.log(`   أنماط التسمية: ${report.invoices.namingPatterns.join('، ')}`);

        // ═══════════════════ 3) عينات الملفات ═══════════════════
        const sampleFiles = files.slice(0, SAMPLE_COUNT);
        console.log(`\n🧪 عينة ${sampleFiles.length} ملف (القراءة فقط):\n`);
        for (const f of sampleFiles) {
            const full = path.join(invDir, f.name);
            const buf = safe(() => fs.readFileSync(full), null);
            if (!buf) { report.invoices.samples.push({ file: f.name, error: 'تعذر القراءة' }); continue; }
            const { enc, text } = decodeText(buf.subarray(0, 512 * 1024));
            const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
            const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
            const sample = {
                file: f.name,
                sizeBytes: buf.length,
                encoding: enc,
                lineCount: lines.length,
                sha256,
                firstLines: lines.slice(0, 12),
                lastLines: lines.slice(-3),
            };
            // تحليل الصيغة من العينة
            if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
                sample.kind = 'json';
                try { JSON.parse(text); sample.jsonValid = true; } catch { sample.jsonValid = false; }
            } else if (/^\s*<\?xml|^<invoice|^<POSLog/i.test(text)) {
                sample.kind = 'xml';
            } else {
                const delim = sniffDelimiter(lines.slice(0, 30));
                sample.kind = delim ? 'delimited' : 'fixed-width?';
                sample.delimiter = delim ? (delim === '\t' ? '\\t (تاب)' : delim) : null;
                if (delim) {
                    const cells = lines.slice(0, 30).map(l => l.split(delim).length);
                    sample.columnCounts = [...new Set(cells)];
                    sample.hasHeaderRow = /name|desc|qty|total|code|invoice|date|اسم|صنف|كمية|سعر|تاريخ/i.test(lines[0] || '');
                    if (sample.hasHeaderRow) sample.columnsDetected = lines[0].split(delim).map(c => c.trim());
                }
                // اكتشاف التاريخ/الأرقام من البيانات
                for (const line of lines.slice(1, 20)) {
                    const m = line.match(/\d{2,4}[-\/]\d{1,2}[-\/]\d{2,4}|\d{8}/);
                    if (m && !report.formatAnalysis.dateFormat) {
                        const dp = DATE_PATTERNS.find(([re]) => re.test(m[0]));
                        report.formatAnalysis.dateFormat = dp ? dp[1] : 'غير معروف';
                    }
                    const nums = line.match(/-?\d+(?:[.,]\d+)?/g) || [];
                    for (const nRaw of nums) {
                        const desc = describeNumberSample(nRaw);
                        if (desc && desc.includes('عشرية') && !report.formatAnalysis.decimalFormat) {
                            report.formatAnalysis.decimalFormat = desc;
                        }
                    }
                    // شكل رقم الفاتورة: RX-000123 مثلًا
                    const inv = line.match(/\b[A-Za-z]{0,4}[-\/]?\d{4,}\b/);
                    if (inv && !report.formatAnalysis.invoiceNumberFormat) {
                        report.formatAnalysis.invoiceNumberFormat = inv[0].replace(/\d/g, '#');
                    }
                }
            }
            report.invoices.samples.push(sample);
            console.log(`📄 ${f.name} — ${buf.length} بايت — ${enc} — ${lines.length} سطر`);
            console.log(`   الصيغة المرشحة: ${sample.kind}${sample.delimiter ? ` — المحدد: ${sample.delimiter}` : ''}${sample.hasHeaderRow ? ' — ترويسة: نعم' : ''}`);
            if (sample.columnsDetected?.length) console.log(`   الأعمدة: ${sample.columnsDetected.join(' | ')}`);
            console.log(`   أول سطرين:\n${lines.slice(0, 2).map(l => '     ' + JSON.stringify(l.slice(0, 300))).join('\n')}`);
        }

        // فاتورة لكل ملف أم عدة فواتير؟ (عدد أرقام الفواتير المميزة في العينات)
        const invNums = new Set();
        for (const s of report.invoices.samples) {
            for (const line of (s.firstLines || [])) {
                const m = line.match(/\b[A-Za-z]{0,4}[-\/]?\d{4,}\b/);
                if (m) invNums.add(m[0]);
            }
        }
        report.formatAnalysis.invoicePerFile = report.invoices.samples.length > 1 && invNums.size > report.invoices.samples.length
            ? 'متعدد الفواتير محتمل — يلزم فحص أشمل'
            : 'فاتورة واحدة لكل ملف (الأرجح من العينة)';

        // المرتجعات: هل يوجد مجلد CrdtNote؟
        report.formatAnalysis.creditNotes = fs.existsSync(path.join(SHARE, 'CrdtNote'))
            ? 'يوجد مجلد CrdtNote منفصل للإشعارات الدائنة — تُعالج فحصًا لاحقًا منفصلًا'
            : 'لا يوجد مجلد إشعارات دائنة ظاهر في الجذر';

        report.suggestedProfile = buildSuggestedProfile(report);
    } catch (e) {
        report.errors.push(`${INVOICES_DIR}: ${e.message}`);
        console.log(`❌ ${INVOICES_DIR} غير قابل للقراءة: ${e.message}`);
    }
}

function buildSuggestedProfile(rep) {
    const first = rep.invoices.samples.find(s => s.kind === 'delimited' && s.delimiter);
    if (!first) return rep.invoices.samples.find(s => s.kind === 'json') ? { kind: 'json' } : null;
    const colMap = {};
    const cols = first.columnsDetected || [];
    const aliases = {
        invoiceNumber: ['invoice', 'invoiceno', 'invoice_no', 'receipt', 'رقم', 'فاتورة'],
        date: ['date', 'تاريخ'],
        time: ['time', 'وقت'],
        itemCode: ['code', 'plu', 'sku', 'كود'],
        barcode: ['barcode', 'ean', 'باركود'],
        itemName: ['name', 'desc', 'description', 'صنف', 'اسم'],
        quantity: ['qty', 'quantity', 'كمية'],
        unitPrice: ['price', 'rate', 'سعر'],
        discount: ['disc', 'discount', 'خصم'],
        tax: ['vat', 'tax', 'ضريبة'],
        total: ['total', 'amount', 'إجمالي'],
        paymentMethod: ['pay', 'tender', 'دفع'],
        customer: ['customer', 'client', 'عميل'],
    };
    for (const [field, aliasesList] of Object.entries(aliases)) {
        const hit = cols.find(c => aliasesList.some(a => c.toLowerCase().includes(a)));
        if (hit) colMap[field] = hit;
    }
    return {
        kind: 'delimited',
        delimiter: first.delimiter === '\\t (تاب)' ? '\t' : first.delimiter,
        headerRow: first.hasHeaderRow,
        columns: colMap,
        _sourceFile: first.file,
    };
}

// ═══════════════════ 4) حفظ التقرير ═══════════════════
const outJson = path.join(process.cwd(), 'yarasoft-format-report.json');
const outTxt = path.join(process.cwd(), 'yarasoft-format-report.txt');
fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');

const L = [];
L.push('════════ تقرير تشخيص صيغة فواتير Yarasoft ════════');
L.push(`التاريخ: ${report.generatedAt}`);
L.push(`المشاركة: ${report.share} — ${report.reachable ? 'متاحة' : 'غير متاحة'}`);
L.push('');
L.push(`ملفات ${INVOICES_DIR}: ${report.invoices.fileCount}`);
L.push(`الامتدادات: ${JSON.stringify(report.invoices.extensions)}`);
L.push(`أنماط التسمية: ${report.invoices.namingPatterns.join('، ') || '—'}`);
L.push('');
L.push('── العينات ──');
for (const s of report.invoices.samples) {
    L.push(`\n[${s.file}] ${s.sizeBytes}B — ${s.encoding} — ${s.lineCount} سطر — ${s.kind || '?'}`);
    for (const line of (s.firstLines || []).slice(0, 8)) L.push('   ' + JSON.stringify(line.slice(0, 250)));
}
L.push('');
L.push('── تحليل الصيغة ──');
L.push(JSON.stringify(report.formatAnalysis, null, 2));
L.push('');
L.push('── ملف التعريف المقترح (انسخه إلى backend/yarasoft/format-profile.json) ──');
L.push(JSON.stringify(report.suggestedProfile, null, 2));
L.push('');
L.push(`أخطاء: ${report.errors.length ? report.errors.join(' | ') : 'لا يوجد'}`);
fs.writeFileSync(outTxt, L.join('\n'), 'utf8');

console.log(`\n✅ حُفظ التقرير:\n   ${outJson}\n   ${outTxt}\n`);
console.log('الخطوة التالية: أرسل الملفين للمطور أو انسخ "الملف التعريفي المقترح"');
console.log('إلى backend/yarasoft/format-profile.json ثم فعّل YARASOFT_ENABLED=true بعد التحقق بـ DRY_RUN.\n');
