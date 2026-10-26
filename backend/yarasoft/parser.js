/**
 * yarasoft/parser.js — محلل فواتير Yarasoft (بلا افتراضات)
 * ────────────────────────────────────────────────────────────────────────────
 * القاعدة الذهبية من المواصفة: DO NOT ASSUME HOW YARASOFT STORES INVOICES.
 *
 * لذلك يعمل المحلل بطبقتين:
 *  1) ملف تعريف صيغة (format-profile.json) — يُملأ من تقرير أداة التشخيص
 *     tools/yarasoft-inspect.js بعد فحص الملفات الحقيقية على جهاز العميل.
 *  2) شمّام تلقائي (auto-sniffer) — يكتشف الترميز/المحدد/تنسيق التاريخ/الأعمدة
 *     من الملف نفسه ويُنتج تعيينًا مقترحًا، مع أسباب رفض واضحة عند الفشل.
 *
 * لا يخترع أسماء حقول: كل عمود يُقرأ من الفهرس/الاسم في الملف الفعلي.
 */

'use strict';

// ─── أدوات مساعدة ────────────────────────────────────────────────────────────

function splitDelimited(line, delimiter) {
    // يدعم الاقتباس "..." مع مضاعفة "" داخل الاقتباس (CSV القياسي)
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else {inQuotes = false;}
            } else {cur += ch;}
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            out.push(cur);
            cur = '';
        } else {cur += ch;}
    }
    out.push(cur);
    return out.map(s => s.trim());
}

/** اكتشاف المحدد من عينة أسطر (؛ | \t , :) */
function sniffDelimiter(lines) {
    const candidates = [';', ',', '\t', '|', ':'];
    let best = null;
    let bestScore = 0;
    for (const d of candidates) {
        const counts = lines.map(l => l.split(d).length - 1);
        const total = counts.reduce((a, b) => a + b, 0);
        if (total === 0) {continue;}
        const avg = total / counts.length;
        // ثبات عدد الأعمدة بين الأسطر مؤشر قوي
        const variance = counts.reduce((s, c) => s + ((c - avg) ** 2), 0) / counts.length;
        const consistency = avg > 0 ? 1 / (1 + variance) : 0;
        const score = total * consistency;
        if (score > bestScore) { bestScore = score; best = d; }
    }
    return best ? { delimiter: best, score: bestScore } : { delimiter: null, score: 0 };
}

function isFixedWidth(lines) {
    if (lines.length < 3) {return false;}
    const noSpace = lines.filter(l => l.trim() && !/^[\s=+-]+$/.test(l));
    if (noSpace.length < 3) {return false;}
    const lengths = noSpace.map(l => l.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (maxLen - minLen > 5) {return false;}
    // عمودان متجاوران بفراغات متعددة في معظم الأسطر = عروض ثابتة
    const multiSpace = noSpace.filter(l => /\s{2,}/.test(l)).length;
    return multiSpace >= noSpace.length * 0.8;
}

function parseNumber(raw) {
    if (raw === null || raw === undefined) {return null;}
    let s = String(raw).trim();
    if (!s) {return null;}
    s = s.replace(/[\u066B]/g, '.').replace(/[\u060C\u066C\s]/g, ''); // فواصل عربية
    s = s.replace(/[^0-9.,-]/g, '');
    if (!s || !/\d/.test(s)) {return null;}
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
        // الفاصلة العشرية عربية/أوروبية: 1.234,56
        s = s.replace(/\./g, '').replace(',', '.');
    } else {
        s = s.replace(/,/g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

const DATE_FORMATS = [
    { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, order: ['y', 'm', 'd'] },                 // 2025-01-31
    { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/, order: ['d', 'm', 'y'] },       // 31/01/2025
    { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/, order: ['m', 'd', 'y'] },       // 01/31/2025 (لو فشلت الأولى)
    { re: /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/, order: ['d', 'm', 'y2'] },     // 31/01/25
    { re: /^(\d{4})(\d{2})(\d{2})$/, order: ['y', 'm', 'd'] },                      // 20250131
    { re: /^(\d{2})(\d{2})(\d{4})$/, order: ['d', 'm', 'y'] },                      // 31012025
];

function parseDateRaw(raw) {
    if (!raw) {return null;}
    const s = String(raw).trim();
    if (!s) {return null;}
    // استخرج التاريخ من بداية سلسلة قد تحتوي وقتًا
    const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const time = timeMatch ? { h: +timeMatch[1], m: +timeMatch[2], s: +(timeMatch[3] || 0) } : null;
    for (const fmt of DATE_FORMATS) {
        const m = s.match(fmt.re);
        if (!m) {continue;}
        const parts = {};
        fmt.order.forEach((key, i) => {
            const v = Number(m[i + 1]);
            if (key === 'y2') {parts.y = 2000 + v;} else {parts[key] = v;}
        });
        const y = parts.y, mo = parts.m, d = parts.d;
        if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) {continue;}
        // رفض الغموض: 13+ لا يمكن أن يكون شهرًا → يحدد الترتيب تلقائيًا
        const date = new Date(Date.UTC(y, mo - 1, d, time ? time.h : 0, time ? time.m : 0, time ? time.s : 0));
        if (Number.isNaN(date.getTime())) {continue;}
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {continue;}
        return { iso: date.toISOString(), format: fmt.order.join('/'), ambiguous: false };
    }
    return null;
}

function detectFormatKind(text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {return 'json';}
    if (/^<\?xml|^<invoices?\b|^<POSLog/i.test(trimmed)) {return 'xml';}
    return 'delimited';
}

// ─── محلل JSON ────────────────────────────────────────────────────────────────

function parseJsonInvoice(text, profile) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : [data];
    const map = profile && profile.jsonKeys ? profile.jsonKeys : {};
    const pick = (obj, keys) => { for (const k of keys) {if (obj[k] !== undefined && obj[k] !== null) {return obj[k];}} return null; };
    return arr.map(doc => ({
        invoiceNumber: String(pick(doc, [map.invoiceNumber, 'invoiceNumber', 'InvoiceNumber', 'invoice_no', 'InvoiceNo', 'no', 'id'].filter(Boolean)) ?? '').trim() || null,
        date: parseDateRaw(pick(doc, [map.date, 'date', 'Date', 'dateTime', 'timestamp'].filter(Boolean))?.toString?.().slice(0, 19) || null)?.iso || null,
        customer: pick(doc, [map.customer, 'customer', 'customerName', 'client'].filter(Boolean))?.toString?.() || null,
        paymentMethod: pick(doc, [map.paymentMethod, 'paymentMethod', 'payment', 'payType'].filter(Boolean))?.toString?.() || null,
        items: (pick(doc, ['items', 'lines', 'details', 'Items']) || []).map(it => ({
            externalCode: String(pick(it, ['code', 'sku', 'itemCode', 'barcode', 'plu'])).trim() || null,
            barcode: String(pick(it, ['barcode', 'ean', 'upc'])).trim() || null,
            name: String(pick(it, ['name', 'description', 'itemName', 'desc'])).trim() || null,
            quantity: parseNumber(pick(it, ['qty', 'quantity', 'Qty'])),
            unitPrice: parseNumber(pick(it, ['price', 'unitPrice', 'rate'])),
            discount: parseNumber(pick(it, ['discount', 'disc'])) || 0,
            tax: parseNumber(pick(it, ['tax', 'vat'])) || 0,
            total: parseNumber(pick(it, ['total', 'lineTotal', 'amount'])),
        })),
        totals: {
            subtotal: parseNumber(pick(doc, ['subtotal', 'subTotal'])),
            discount: parseNumber(pick(doc, ['discount', 'disc'])) || 0,
            tax: parseNumber(pick(doc, ['tax', 'vat'])) || 0,
            total: parseNumber(pick(doc, ['total', 'grandTotal', 'amount'])),
        },
    }));
}

// ─── محلل XML (مبسّط صارم: يستخرج وسوم الفاتورة والأسطر) ─────────────────────

function tagValue(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

function parseXmlInvoice(text) {
    const invoices = [];
    const blocks = text.match(/<invoice[\s>][\s\S]*?<\/invoice>/gi)
        || text.match(/<transaction[\s>][\s\S]*?<\/transaction>/gi)
        || [text];
    for (const block of blocks) {
        const itemBlocks = block.match(/<(?:item|line|lineItem|detail)[\s>][\s\S]*?<\/(?:item|line|lineItem|detail)>/gi) || [];
        invoices.push({
            invoiceNumber: tagValue(block, 'invoiceNumber') || tagValue(block, 'InvoiceNo') || tagValue(block, 'number'),
            date: parseDateRaw(tagValue(block, 'date') || tagValue(block, 'dateTime') || tagValue(block, 'timestamp'))?.iso || null,
            customer: tagValue(block, 'customer') || tagValue(block, 'customerName'),
            paymentMethod: tagValue(block, 'paymentMethod') || tagValue(block, 'payment'),
            items: itemBlocks.map(ib => ({
                externalCode: tagValue(ib, 'code') || tagValue(ib, 'sku') || tagValue(ib, 'itemCode'),
                barcode: tagValue(ib, 'barcode') || tagValue(ib, 'ean'),
                name: tagValue(ib, 'name') || tagValue(ib, 'description'),
                quantity: parseNumber(tagValue(ib, 'qty') || tagValue(ib, 'quantity')),
                unitPrice: parseNumber(tagValue(ib, 'price') || tagValue(ib, 'unitPrice')),
                discount: parseNumber(tagValue(ib, 'discount')) || 0,
                tax: parseNumber(tagValue(ib, 'tax') || tagValue(ib, 'vat')) || 0,
                total: parseNumber(tagValue(ib, 'total') || tagValue(ib, 'lineTotal')),
            })),
            totals: {
                subtotal: parseNumber(tagValue(block, 'subtotal')),
                discount: parseNumber(tagValue(block, 'discount')) || 0,
                tax: parseNumber(tagValue(block, 'tax') || tagValue(block, 'vat')) || 0,
                total: parseNumber(tagValue(block, 'total') || tagValue(block, 'grandTotal')),
            },
        });
    }
    return invoices;
}

// ─── محلل النصوص المحددة / العرض الثابت ──────────────────────────────────────

/**
 * profile.delimited (من تقرير التشخيص) مثال:
 * {
 *   "delimiter": ";",
 *   "headerRow": true,
 *   "columns": { "invoiceNumber": "InvoiceNo", "date": "Date", "itemCode": "PLU",
 *                "barcode": "Barcode", "itemName": "Description", "quantity": "Qty",
 *                "unitPrice": "Price", "discount": "Disc", "tax": "VAT", "total": "Total",
 *                "paymentMethod": "PayType", "customer": "Customer" },
 *   "columnIndexes": { "invoiceNumber": 0, "date": 1, ... },   // بلا ترويسة
 *   "invoiceGrouping": "single"        // single = ملف لفاتورة واحدة
 * }
 */
function parseDelimited(text, profile) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const rawLines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (!rawLines.length) {throw new ParseError('الملف فارغ');}
    const delimiter = (profile && profile.delimiter) || sniffDelimiter(rawLines.slice(0, 30)).delimiter;
    if (!delimiter) {throw new ParseError('تعذر اكتشاف محدد الأعمدة — حدّد delimiter في ملف تعريف الصيغة');}

    // ── اكتشاف أسطر الترويسة: قد تكون مستويين (فاتورة ثم أصناف) أو متكررة ──
    // ندمج كل أسطر الترويسة المكتشفة في خريطة أعمدة واحدة.
    const lines5 = rawLines.slice(0, 5).map(l => splitDelimited(l, delimiter));
    const scores = lines5.map(cells => scoreHeaderLine(cells));
    const explicitIdx = profile && profile.columnIndexes && Object.keys(profile.columnIndexes).length;
    let headerLineIdxs = [];
    let col = (profile && profile.columns) || null;
    const headerCells = [];
    const noHeader = profile && profile.headerRow === false;
    if (explicitIdx) {
        // أعمدة صريحة بأرقامها — لا اكتشاف إطلاقًا
    } else if (!noHeader) {
        // تلقائي (وأيضًا headerRow:true): ادمج كل أسطر الترويسة المكتشفة
        headerLineIdxs = scores.map((s, i) => (s >= 2 ? i : -1)).filter(i => i >= 0);
    }
    for (const i of headerLineIdxs) {
        for (const c of splitDelimited(rawLines[i], delimiter)) {headerCells.push(c.toLowerCase().trim());}
    }
    if (headerLineIdxs.length && !col) {
        col = {};
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
            const hit = headerCells.find(c => aliases.includes(c));
            if (hit) {col[field] = hit;}
        }
    }
    // خريطة: كل حقل → فهرسه داخل سطر الترويسة الذي يحتويه فعلاً
    // (ترويسات مستويين: حقول الفاتورة من سطرها، حقول الأصناف من سطرها)
    // التفضيل عند التكرار: السطر الأغنى بأعمدة معروفة (سطر الأصناف عادةً)
    const fieldIdx = {};
    if (!explicitIdx && headerLineIdxs.length) {
        const byScore = [...headerLineIdxs].sort((a, b) => scores[b] - scores[a]);
        const fieldsToResolve = col
            ? Object.keys(col)
            : Object.keys(HEADER_ALIASES);
        for (const field of fieldsToResolve) {
            const aliases = HEADER_ALIASES[field] || [String(col[field]).toLowerCase()];
            for (const li of byScore) {
                const cells = splitDelimited(rawLines[li], delimiter).map(c => c.toLowerCase().trim());
                const hit = col && col[field]
                    ? cells.indexOf(String(col[field]).toLowerCase().trim())
                    : cells.findIndex(c => aliases.includes(c));
                if (hit >= 0) { fieldIdx[field] = hit; break; }
            }
        }
    }
    const cols = {
        invoiceNumber: fieldIdx.invoiceNumber ?? -1,
        date: fieldIdx.date ?? -1,
        time: fieldIdx.time ?? -1,
        customer: fieldIdx.customer ?? -1,
        paymentMethod: fieldIdx.paymentMethod ?? -1,
        itemCode: fieldIdx.itemCode ?? -1,
        barcode: fieldIdx.barcode ?? -1,
        itemName: fieldIdx.itemName ?? -1,
        quantity: fieldIdx.quantity ?? -1,
        unitPrice: fieldIdx.unitPrice ?? -1,
        discount: fieldIdx.discount ?? -1,
        tax: fieldIdx.tax ?? -1,
        total: fieldIdx.total ?? -1,
    };

    const dataLines = rawLines.filter((l, _i) => {
        if (explicitIdx || noHeader) {return true;} // بلا ترويسة: كل الأسطر بيانات
        const s = scoreHeaderLine(splitDelimited(l, delimiter));
        if (s >= 2) {return false;} // سطر ترويسة (حتى المتكرر بعدة فواتير)
        return true;
    });
    // الأسطر التفصيلية فقط: الأسطر التي فيها كود صنف/كمية/سعر
    const itemStart = cols.itemCode >= 0 || cols.quantity >= 0 ? 0 : -1;
    const rows = dataLines.map(l => splitDelimited(l, delimiter));

    // إن كانت الفاتورة الواحدة في الملف: سطر/أسطر الأصناف + سطر إجمالي إن وُجد
    const items = [];
    const headerInfo = { invoiceNumber: null, date: null, customer: null, paymentMethod: null, totals: {} };
    const rowLooksLikeItem = (cells) => {
        // صنف حقيقي: كمية قابلة للقراءة مع سعر أو إجمالي — أو باركود رقمي طويل.
        // (سطر ترويسة بيانات الفاتورة مثل Y-1;2025-01-31;عميل;كاش لا يمر بهذا)
        const q = cols.quantity >= 0 ? parseNumber(cells[cols.quantity]) : null;
        const p = cols.unitPrice >= 0 ? parseNumber(cells[cols.unitPrice]) : null;
        const bc = cols.barcode >= 0 ? String(cells[cols.barcode] || '').trim() : '';
        if (q !== null && p !== null) {return true;}
        if (q !== null && cols.total >= 0 && parseNumber(cells[cols.total]) !== null) {return true;}
        if (bc && /^\d{8,}$/.test(bc)) {return true;}
        return false;
    };

    for (const cells of rows) {
        if (rowLooksLikeItem(cells)) {
            items.push({
                externalCode: cols.itemCode >= 0 ? (cells[cols.itemCode] || null) : null,
                barcode: cols.barcode >= 0 ? (cells[cols.barcode] || null) : null,
                name: cols.itemName >= 0 ? (cells[cols.itemName] || null) : null,
                quantity: cols.quantity >= 0 ? parseNumber(cells[cols.quantity]) : null,
                unitPrice: cols.unitPrice >= 0 ? parseNumber(cells[cols.unitPrice]) : null,
                discount: cols.discount >= 0 ? (parseNumber(cells[cols.discount]) || 0) : 0,
                tax: cols.tax >= 0 ? (parseNumber(cells[cols.tax]) || 0) : 0,
                total: cols.total >= 0 ? parseNumber(cells[cols.total]) : null,
                _invoiceKey: cols.invoiceNumber >= 0 ? String(cells[cols.invoiceNumber] || '').trim() : '',
                _dateCell: cols.date >= 0 ? String(cells[cols.date] || '').trim() : '',
                _customerCell: cols.customer >= 0 ? String(cells[cols.customer] || '').trim() : '',
                _payCell: cols.paymentMethod >= 0 ? String(cells[cols.paymentMethod] || '').trim() : '',
            });
        } else {
            // سطر ترويسة/إجماليات: اجمع ما يمكن منه
            if (headerInfo.invoiceNumber === null && cols.invoiceNumber >= 0 && cells[cols.invoiceNumber]) {
                headerInfo.invoiceNumber = cells[cols.invoiceNumber].trim();
            }
            if (headerInfo.date === null && cols.date >= 0 && cells[cols.date]) {
                headerInfo.date = parseDateRaw(cells[cols.date])?.iso || null;
            }
            if (!headerInfo.customer && cols.customer >= 0 && cells[cols.customer]) {headerInfo.customer = cells[cols.customer].trim();}
            if (!headerInfo.paymentMethod && cols.paymentMethod >= 0 && cells[cols.paymentMethod]) {headerInfo.paymentMethod = cells[cols.paymentMethod].trim();}
            if (cols.total >= 0) {
                const t = parseNumber(cells[cols.total]);
                if (t !== null && (headerInfo.totals.total === undefined || headerInfo.totals.total < t)) {headerInfo.totals.total = t;}
            }
        }
    }

    if (!items.length) {throw new ParseError('لم يُعثر على أسطر أصناف في الملف — راجع تعيين الأعمدة في ملف تعريف الصيغة');}
    // تجميع الملف المسطح: أسطر أصناف متعددة الفواتير تُقسَّم حسب رقم الفاتورة،
    // وحقول الترويسة (الرقم/التاريخ/العميل/الدفع) تُؤخذ من سطر الصنف نفسه عند غياب سطر ترويسة مستقل
    // حارس انزياح الأعمدة (ملف بقسمين: ترويسة فاتورة ثم جدول أصناف): عمود الكود
    // يقع غالبًا في موضع رقم الفاتورة، فلا يصح اعتباره مفتاح تجميع — إن وُجدت
    // ترويسة فاتورة واحدة معلومة ولم يحمل أي بند رقمها فالملف كله فاتورة واحدة.
    const headerKey = String(headerInfo.invoiceNumber || '').trim();
    const itemKeys = new Set(items.map(it => String(it._invoiceKey || '').trim()).filter(Boolean));
    const singleInvoiceFile = Boolean(headerKey) && !itemKeys.has(headerKey);
    const groups = new Map();
    const order = [];
    for (const it of items) {
        const key = singleInvoiceFile ? headerKey : (it._invoiceKey || '');
        if (!groups.has(key)) {
            groups.set(key, {
                invoiceNumber: headerInfo.invoiceNumber,
                date: headerInfo.date,
                customer: headerInfo.customer,
                paymentMethod: headerInfo.paymentMethod,
                totals: { ...headerInfo.totals },
                items: [],
            });
            order.push(key);
        }
        const g = groups.get(key);
        if (g.invoiceNumber == null && it._invoiceKey) {g.invoiceNumber = it._invoiceKey;}
        if (g.date == null && it._dateCell) {g.date = parseDateRaw(it._dateCell)?.iso || null;}
        if (!g.customer && it._customerCell) {g.customer = it._customerCell;}
        if (!g.paymentMethod && it._payCell) {g.paymentMethod = it._payCell;}
        const clean = { ...it };
        delete clean._invoiceKey;
        delete clean._dateCell;
        delete clean._customerCell;
        delete clean._payCell;
        g.items.push(clean);
        // ملاحظة: إجماليات أسطر الأصناف لا تدخل totals.total — الإجمالي المعتمد
        // إما من سطر ملخص مستقل أو المجموع المحسوب computed (وإلا نقص إجمالي الفواتير متعددة الأسطر)
    }
    // اصطلاح قياسي: عند وجود إجمالي السطر فالخصم محسوب داخله — لا نخصمه مرتين
    const lineSum = (it) => (it.total !== null && it.total !== undefined)
        ? it.total
        : ((it.quantity || 0) * (it.unitPrice || 0)) - (it.discount || 0);
    return order.map(key => {
        const g = groups.get(key);
        const validItems = g.items.filter(it => it.quantity !== null || it.total !== null);
        const computedTotal = validItems.reduce((s, it) => s + lineSum(it), 0);
        return {
            invoiceNumber: g.invoiceNumber,
            date: g.date,
            customer: g.customer,
            paymentMethod: g.paymentMethod,
            items: validItems,
            totals: { ...g.totals, computed: Number(computedTotal.toFixed(2)) },
            _meta: { delimiter, headerLines: headerLineIdxs.length, itemStart },
        };
    }).filter(inv => inv.items.length);
}

class ParseError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'ParseError';
        this.code = 'PARSE_FAILED';
        this.details = details;
    }
}

// أسماء مستعارة معروفة لاكتشاف الترويسة تلقائيًا (عربي/إنجليزي — بلا افتراض صيغة واحد)
const HEADER_ALIASES = {
    invoiceNumber: ['invoicenumber', 'invoiceno', 'invoice_no', 'invoicenum', 'receiptno', 'receipt_no', 'billno', 'bill_no', 'رقم الفاتورة', 'رقم فاتورة', 'الفاتورة'],
    date: ['date', 'invdate', 'تاريخ', 'التاريخ'],
    time: ['time', 'الوقت', 'وقت'],
    customer: ['customer', 'customername', 'client', 'العميل', 'عميل'],
    paymentMethod: ['paymentmethod', 'payment', 'paytype', 'pay_type', 'tender', 'طريقة الدفع', 'الدفع'],
    itemCode: ['itemcode', 'item_code', 'code', 'sku', 'plu', 'item', 'كود الصنف', 'كود'],
    barcode: ['barcode', 'ean', 'upc', 'باركود'],
    itemName: ['itemname', 'item_name', 'name', 'description', 'desc', 'product', 'productname', 'اسم الصنف', 'الصنف', 'اسم'],
    quantity: ['quantity', 'qty', 'الكمية', 'كمية'],
    unitPrice: ['unitprice', 'unit_price', 'price', 'rate', 'السعر', 'سعر'],
    discount: ['discount', 'disc', 'الخصم', 'خصم'],
    tax: ['tax', 'vat', 'الضريبة', 'ضريبة'],
    total: ['total', 'linetotal', 'line_total', 'amount', 'netamount', 'الإجمالي', 'اجمالي', 'إجمالي'],
};

function scoreHeaderLine(cells) {
    const lower = cells.map(c => String(c).toLowerCase().trim());
    let score = 0;
    for (const aliases of Object.values(HEADER_ALIASES)) {
        if (aliases.some(a => lower.includes(a))) {score++;}
    }
    return score;
}

// ─── الواجهة العامة ───────────────────────────────────────────────────────────

/**
 * parseInvoiceFile(text, profile) → { kind, invoices:[...] }
 * يحترم ملف التعريف إن وُجد، وإلا يشمّ الصيغة تلقائيًا.
 */
function parseInvoiceFile(text, profile) {
    const kind = (profile && profile.kind) || detectFormatKind(text);
    if (kind === 'json') {
        const invoices = parseJsonInvoice(text, profile || {});
        if (!invoices.length) {throw new ParseError('JSON بلا فواتير');}
        return { kind, invoices };
    }
    if (kind === 'xml') {
        const invoices = parseXmlInvoice(text);
        if (!invoices.length || invoices.every(i => !i.items.length)) {throw new ParseError('XML بلا أصناف قابلة للقراءة');}
        return { kind, invoices };
    }
    if (kind === 'delimited' || kind === 'fixed') {
        const invoices = parseDelimited(text, profile || {});
        return { kind: isFixedWidth(text.split(/\r?\n/).filter(Boolean).slice(0, 20)) ? 'fixed' : 'delimited', invoices };
    }
    throw new ParseError(`صيغة غير مدعومة: ${kind}`);
}

/** تعيين مقترح من عينة ملف — تُستخدم في تقرير التشخيص وشاشة الإعداد */
function suggestProfile(sampleText) {
    const lines = sampleText.split(/\r?\n/).filter(l => l.trim()).slice(0, 50);
    const kind = detectFormatKind(sampleText);
    const profile = { kind, suggested: true };
    if (kind === 'delimited' || kind === 'fixed') {
        const { delimiter } = sniffDelimiter(lines);
        profile.delimiter = delimiter;
        profile.headerRow = true;
        profile.encodingNotes = 'انظر حقل encoding في التقرير';
        if (isFixedWidth(lines)) {profile.kind = 'fixed';}
    }
    return profile;
}

module.exports = {
    ParseError,
    parseInvoiceFile,
    suggestProfile,
    // مُصدَّرة للاختبارات وأداة التشخيص:
    sniffDelimiter, isFixedWidth, parseNumber, parseDateRaw,
    splitDelimited, detectFormatKind,
};
