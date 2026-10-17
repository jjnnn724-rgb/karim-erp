/**
 * v2-warehouse-import.test.js — استيراد Excel وكتالوج الأصناف في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/warehouse.js:2326-2391 (كتالوج) و:2394-2565 (مخزون).
 * المُثبَّت هنا ما لا يُرى بالعين:
 *   • قواعد التحليل منسوخة حرفيًا: رأس اختياري، «عام»/«قطعة»/5، أرقام عربية
 *     وفواصل، وفلتر qty>0 عند الإرسال (وليس عند المعاينة).
 *   • النموذجان بنفس الصفوف والورقة واسم الملف.
 *   • المكتبة تُطلب عند الحاجة وحدها، والقراءة بالـAPIs الحديثة.
 *   • النصوص (التنبيه، التقدم، الفشل الجزئي، رسالة النجاح) كما في القديم.
 *   • القديم نفسه لم يُمس.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const REPO = path.join(APP, 'js', 'v2', 'data', 'inventory-repo.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'warehouse.js');
const LEGACY = path.join(APP, 'js', 'features', 'warehouse.js');

const IMPORTS = ['importCell', 'importNumber', 'inventoryImportRowsFromSheet',
    'inventoryImportPayload', 'catalogRowsFromSheet', 'catalogItemPayload',
    'createInventoryItem', 'duplicateNameError'];

function loadRepo(apiFetch = jest.fn(async () => ({}))) {
    const stripped = fs.readFileSync(REPO, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math,
        Promise, Set, Map, Intl, URLSearchParams, apiFetch,
        formatMoney: (v) => ({ amount: String(v), unit: '', hasUnit: false }),
    };
    vm.createContext(context);
    vm.runInContext(`${stripped}\n;Object.assign(globalThis, {${IMPORTS.join(', ')}});`,
        context, { filename: REPO });
    return context;
}

const screen = () => fs.readFileSync(SCREEN, 'utf8');
const legacy = () => fs.readFileSync(LEGACY, 'utf8');

describe('تحليل خلايا الملف — parseInventoryImportCell/Number حرفيًا', () => {
    const repo = loadRepo();

    test('BOM يُزال والفراغ يُقص', () => {
        expect(repo.importCell('\uFEFF اسم الصنف ')).toBe('اسم الصنف');
        expect(repo.importCell(null)).toBe('');
        expect(repo.importCell(undefined)).toBe('');
        expect(repo.importCell(12)).toBe('12');
    });

    test('أرقام عربية وفواصل ومسافات، والاحتياط عند العجز', () => {
        expect(repo.importNumber('١٢٣', 0)).toBe(123);
        expect(repo.importNumber('1,250.5', 0)).toBe(1250.5);
        expect(repo.importNumber(' 7 ', 5)).toBe(7);
        expect(repo.importNumber('', 5)).toBe(5);
        // القديم نفسه: النص بلا أرقام يصبح '' ثم Number('')=0 — لا يرجع للاحتياط.
        expect(repo.importNumber('غير رقم', 5)).toBe(0);
        expect(repo.importNumber(-3, 0)).toBe(-3);
    });

    test('صفوف المخزون: الرأس اختياري والافتراضات «عام»/فارغ/5', () => {
        const withHeader = repo.inventoryImportRowsFromSheet([
            ['اسم الصنف', 'الفئة', 'الوحدة', 'الكمية', 'سعر الشراء', 'الحد الأدنى'],
            ['دجاج', 'لحوم', 'كجم', 50, 25, 10],
        ]);
        expect(withHeader).toHaveLength(1);
        expect(withHeader[0]).toEqual({ name: 'دجاج', category: 'لحوم', unit: 'كجم',
            qty: 50, price: 25, minQty: 10 });

        const noHeader = repo.inventoryImportRowsFromSheet([['أرز', '', '', '3', '4.5', '']]);
        expect(noHeader).toHaveLength(1);                         // لا يُحذف أول صف بلا رأس
        expect(noHeader[0].category).toBe('عام');
        expect(noHeader[0].unit).toBe('');
        expect(noHeader[0].minQty).toBe(5);

        const english = repo.inventoryImportRowsFromSheet([['Item', 'Category'], ['زيت']]);
        expect(english).toHaveLength(1);
        expect(english[0].name).toBe('زيت');
    });

    test('فلتر المعاينة: الاسم مطلوب، والسالب غير مقبول', () => {
        const rows = repo.inventoryImportRowsFromSheet([
            ['', 'فئة', 'كجم', 5, 2, 1],
            ['ملح', 'بقالة', 'كجم', -1, 2, 1],
            ['سكر', 'بقالة', 'كجم', 5, -2, 1],
            ['شاي', 'بقالة', 'كجم', 0, 0, 1],
        ]);
        expect(rows.map((r) => r.name)).toEqual(['شاي']);
    });

    test('الحمولة: qty>0 وحدها تُرسل، والافتراضات تُملأ', () => {
        const items = repo.inventoryImportPayload([
            { name: ' أرز ', category: '', unit: '', qty: '4', price: '2', minQty: '' },
            { name: 'صفر', qty: 0, price: 2 },
            { name: '', qty: 3, price: 1 },
        ]);
        expect(items).toEqual([{ name: 'أرز', category: 'عام', unit: 'قطعة',
            qty: 4, price: 2, minQty: 5 }]);
    });
});

describe('كتالوج الأصناف — من الصف الثاني، وحمولة الخادم المسموحة', () => {
    const repo = loadRepo();

    test('الصف الأول رأس دائمًا، والاسم شرط، والحد الأدنى الموجب فقط', () => {
        const rows = repo.catalogRowsFromSheet([
            ['اسم الصنف', 'الفئة', 'الوحدة', 'الحد الأدنى'],
            ['دجاج', '', '', '0'],
            ['', 'لحوم', 'كجم', 4],
            ['أرز', 'حبوب', 'كيس', '10'],
        ]);
        expect(rows).toEqual([
            { name: 'دجاج', category: 'عام', unit: 'قطعة', minQty: 5 },
            { name: 'أرز', category: 'حبوب', unit: 'كيس', minQty: 10 },
        ]);
    });

    test('حمولة الإنشاء بحقول الخادم وحدها — رصيد وتكلفة صفر', () => {
        expect(repo.catalogItemPayload({ name: ' دجاج ', category: '', unit: '', minQty: 0 }))
            .toEqual({ name: 'دجاج', category: 'عام', unit: 'قطعة', qty: 0,
                avgCost: 0, minQty: 5, weight: 0, shelfId: null });
    });

    test('POST /inventory — البوابة العامة، والجسم هو الحمولة نفسها', async () => {
        const apiFetch = jest.fn(async () => ({ id: 1 }));
        const r = loadRepo(apiFetch);
        await r.createInventoryItem({ name: 'سكر', minQty: 2 });
        expect(apiFetch).toHaveBeenCalledTimes(1);
        const [p, opts] = apiFetch.mock.calls[0];
        expect(p).toBe('/inventory');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ name: 'سكر', category: 'عام',
            unit: 'قطعة', qty: 0, avgCost: 0, minQty: 2, weight: 0, shelfId: null });
    });

    test('المكرر يُعرف من code أو من نص الخادم (server.js:1657 يرسل error)', () => {
        expect(repo.duplicateNameError({ code: 'DUPLICATE_ITEM_NAME' })).toBe(true);
        expect(repo.duplicateNameError({ message: 'الصنف «أرز» موجود في المخزن بالفعل — لا يُنشأ مكرر' })).toBe(true);
        expect(repo.duplicateNameError({ message: 'UNIT_MISMATCH' })).toBe(false);
        expect(repo.duplicateNameError(null)).toBe(false);
    });
});

describe('الشاشة — زرّان، نماذج القديم، وتحميل المكتبة عند الطلب', () => {
    test('زرّا الاستيراد داخل بوابة can.write مرة واحدة', () => {
        const s = screen();
        expect((s.match(/data-v2-new="excel"/g) || []).length).toBe(1);
        expect((s.match(/data-v2-new="catalog"/g) || []).length).toBe(1);
        expect(s).toContain("if (kind === 'excel') {setPanel(excelImportHtml()); return;}");
        expect(s).toContain("if (kind === 'catalog') {setPanel(catalogImportHtml()); return;}");
        expect(s).toContain("else if (panelKind === 'excel') {submitExcel();}");
        expect(s).toContain("else if (panelKind === 'catalog') {submitCatalog();}");
    });

    test('نموذج المخزون: نفس الصفوف والورقة والاسم', () => {
        const s = screen();
        for (const text of ['اسم الصنف', 'الفئة', 'الوحدة', 'الكمية', 'سعر الشراء', 'الحد الأدنى']) {
            expect(s).toContain(`'${text}'`);
        }
        expect(s).toContain("['دجاج', 'لحوم', 'كجم', 50, 25, 10]");
        expect(s).toContain("['أرز', 'حبوب', 'كيس', 100, 3.5, 20]");
        expect(s).toContain("['زيت نخيل', 'زيوت', 'لتر', 30, 8, 5]");
        expect(s).toContain("isCatalog ? 'الأصناف' : 'المخزون'");
        expect(s).toContain("'نموذج_استيراد_المخزون.xlsx'");
        expect(s).toContain("'نموذج_قائمة_الأصناف.xlsx'");
        // نفس الصفوف موجودة في القديم — التكافؤ لا الذاكرة.
        const old = legacy();
        expect(old).toContain("['دجاج','لحوم','كجم',50,25,10]");
        expect(old).toContain("'نموذج_استيراد_المخزون.xlsx'");
        expect(old).toContain("'نموذج_قائمة_الأصناف.xlsx'");
    });

    test('نصوص القديم: الصيغة، التنبيه، اختيار الملف، التقدم، والفشل الجزئي', () => {
        const s = screen();
        expect(s).toContain('الأعمدة: اسم الصنف، الفئة، الوحدة، الكمية، سعر الشراء، الحد الأدنى');
        expect(s).toContain('الأعمدة: اسم الصنف، الفئة، الوحدة، الحد الأدنى');
        expect(s).toContain('إذا كان الصنف موجودًا مسبقًا، سيتم تحديث كميته وسعره فقط.');
        expect(s).toContain('اختر ملف Excel أو CSV');
        expect(s).toContain('تحميل نموذج Excel');
        expect(s).toContain('جارٍ استيراد ${formatInt(items.length)} صنف في ${formatInt(chunks.length)} دفعة — لا تغلق اللوحة');
        expect(s).toContain('صحّح الخطأ في ملف Excel (غالبًا تعارض وحدة مع صنف موجود) وأعد رفع الملف');
        expect(s).toContain('تم الاستيراد: ${formatInt(added)} صنف جديد، ${formatInt(updated)} صنف محدَّث');
        expect(s).toContain('اختر ملف Excel أولاً');
        expect(s).toContain('لا توجد صفوف صالحة للاستيراد');
        expect(s).toContain('تم استيراد ${formatInt(added)} صنف جديد');
        expect(s).toContain('مكرر تم تجاهله');
        expect(s).toContain('لا توجد بيانات');
        expect(s).toContain('خطأ في معالجة الملف');
    });

    test('الدفعات 20 والكتالوج يحسب المكرر من الخادم', () => {
        const s = screen();
        expect(s).toContain('for (let i = 0; i < items.length; i += BULK_CHUNK) {chunks.push(items.slice(i, i + BULK_CHUNK));}');
        expect(s).toContain('await bulkReceiveInventory(chunks[ci]);');
        expect(s).toContain('duplicateNameError(err)');
        expect(s).toContain('await createInventoryItem(row);');
    });

    test('المكتبة لا تُطلب قبل الحاجة، والقراءة حديثة', () => {
        const s = screen();
        expect(s).toMatch(/import \{ ensureXlsx \} from '\.\.\/vendor\.js\?v=\d+\.\d+\.\d+';/);
        const readAt = s.indexOf('async function readSheetRows(file)');
        expect(readAt).toBeGreaterThan(-1);
        expect(s.indexOf('await ensureXlsx()')).toBeGreaterThan(readAt);
        expect(s.indexOf('window.XLSX')).toBeGreaterThan(readAt);
        expect(s).toContain("reader.readAsArrayBuffer(file);");
        expect(s).toContain("reader.readAsText(file, 'UTF-8');");
        expect(s).toContain('new Uint8Array(result)');
    });

    test('لا معالجات inline ولا alert — CSP', () => {
        const s = screen();
        expect(s).not.toMatch(/\balert\s*\(/);
        expect(s).not.toMatch(/\bonclick\s*=/);
    });

    test('القديم لم يُمس: دوال الاستيراد وقراءته القديمة باقية', () => {
        const old = legacy();
        for (const fn of ['showImportItemsCatalogModal', 'downloadItemsCatalogTemplate',
            'previewCatalogFile', 'importItemsCatalog', 'showBulkInventoryImportModal',
            'downloadInventoryTemplate', 'readInventoryImportRows', 'importBulkInventory']) {
            expect(old).toContain(`function ${fn}`);
        }
        expect(old).toContain("reader.readAsBinaryString(file);");
    });
});
