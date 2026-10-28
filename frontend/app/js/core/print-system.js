/**
 * js/core/print-system.js — طبقة الطباعة الموحدة لكل مستندات النظام (2026-10-28)
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY
 *   ~25 مولّد مستند يكتب كلٌّ منها CSS خاصًا به داخل iframe العارض: خطوط
 *   مختلفة، ترويسات مكررة، ألوان تختفي في الطباعة، أرقام عربية/لاتينية
 *   مختلطة، ولا كسر صفحات ولا تذييل. بدل إعادة كتابة كل مولّد، تُحقن هنا
 *   طبقة واحدة (css/print-doc.css) بعد اكتمال تحميل المستند، فتصبح كل
 *   المستندات بهوية واحدة: ترويسة الشركة، جدول برأس أخضر متكرر، وألوان
 *   مثبتة على الورق.
 *
 * CONTRACT
 *   • لا يلمس المستندات ذات @page بمقاس مخصص (بطاقة الموظف 85.6×54مم) ولا
 *     يغيّر @page لمستندات A4 landscape (كشوف الرواتب الأفقية).
 *   • لا يضيف ترويسة إذا كان المستند يحمل شعارًا أو اسم الشركة أصلًا.
 *   • تطبيق متكرر آمن: كل عنصر مُحقن يحمل data-erp-*.
 *   • الدوال تعمل على document عارض المستند (iframe)، لا على صفحة التطبيق.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';
const FALLBACK_LOGO = 'assets/al-shurfa-logo.png';
const FALLBACK_NAME = 'مطاعم الشرفه العالمي';

/* بلا ?v=: الخادم يخدم CSS بسياسة no-cache (إعادة تحقق) — نسخة الطباعة
   تتغير مع كل تعديل ولا يجوز أن تعلق في كاش سنة immutable. */
const CSS_URL = (() => {
    try {
        return new URL('../../css/print-doc.css', import.meta.url).href;
    } catch (_) {
        return '';
    }
})();

/* نسخة مصغّرة تعمل بلا شبكة — الجوهر فقط، ثم تُستبدل بالملف الكامل. */
const FALLBACK_CSS = `
html.erp-print-doc body{font-family:"Segoe UI","Noto Naskh Arabic",Tahoma,Arial,sans-serif !important;color:#1f2d27;background:#fff}
html.erp-print-doc body *:not(svg):not(svg *){font-family:inherit}
html.erp-print-doc body>.controls{display:none !important}
html.erp-print-doc th{background:#17352b !important;color:#f6f1e2 !important}
html.erp-print-doc th,html.erp-print-doc td{border:1px solid #ded7c6 !important;padding:5px 7px !important}
html.erp-print-doc table{border-collapse:collapse;width:100%}
html.erp-print-doc thead{display:table-header-group}
html.erp-print-doc tr{break-inside:avoid}
html.erp-print-doc .erp-doc-brand{display:flex;align-items:center;gap:12px;border-bottom:2.5pt solid #b8912f;padding-bottom:8px;margin-bottom:12px}
html.erp-print-doc .erp-doc-brand img{width:16mm;height:16mm;object-fit:contain}
html.erp-print-doc .erp-doc-brand__name{font-size:15pt;font-weight:700;color:#17352b}
html.erp-print-doc .erp-doc-brand__en{font-size:7.5pt;letter-spacing:.14em;color:#8a7c5c}
html.erp-print-doc .erp-runner{display:none}
@media print{
  html.erp-print-doc *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  html.erp-print-doc body{margin:0;padding:0;max-width:none}
  html.erp-print-doc thead{display:table-header-group}
  html.erp-print-doc tfoot{display:table-row-group}
  html.erp-print-doc .erp-runner{display:flex;justify-content:space-between;margin-top:14px;padding-top:4px;border-top:1px solid #e4dfd1;font-size:7.5pt;color:#8a8577}
}`;

let cssPromise = null;

function loadStylesheet() {
    if (!cssPromise) {
        cssPromise = (CSS_URL
            ? fetch(CSS_URL, { credentials: 'same-origin' }).then((response) => (
                response.ok ? response.text() : Promise.reject(new Error('print-doc.css'))
            )).catch(() => FALLBACK_CSS)
            : Promise.resolve(FALLBACK_CSS));
    }
    return cssPromise;
}

function settings() {
    return (typeof window !== 'undefined' && window.STATE && window.STATE.settings) || {};
}

function companyName() {
    const name = String(settings().name || '').trim();
    return name || FALLBACK_NAME;
}

function logoSource() {
    /* V2 يحمّل الشعار المرفوع في وحدة print-branding الخاصة به ويعلنه على
       window.KARIM_V2_PRINT_LOGO — نقرأه هنا كي يظهر الشعار نفسه في الطباعة. */
    const v2Logo = typeof window !== 'undefined' ? String(window.KARIM_V2_PRINT_LOGO || '') : '';
    const configured = String(settings().logoB64 || v2Logo || '');
    if (/^data:image\//i.test(configured)) {return configured;}
    if (/^(https?:)?\/\//i.test(configured)) {return configured;}
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(configured)) {return `data:image/png;base64,${configured}`;}
    try {
        if (configured) {return new URL(configured, window.location.href).href;}
        return new URL(FALLBACK_LOGO, window.location.href).href;
    } catch (_) {
        return '';
    }
}

/**
 * يقرأ كل @page في أنماط المستند ويحدد نوع الورق.
 * @returns {'a4'|'landscape'|'custom'}
 */
function paperMode(doc) {
    let custom = false;
    let landscape = false;
    doc.querySelectorAll('style').forEach((style) => {
        const text = style.textContent || '';
        const blocks = text.match(/@page\s*\{[^}]*\}/g) || [];
        for (const block of blocks) {
            const size = block.match(/size\s*:\s*([^;}\n]+)/i);
            if (!size) {continue;}
            const value = size[1].trim().toLowerCase();
            if (/landscape/.test(value)) {landscape = true;}
            else if (!/^a4(\s+portrait)?$/.test(value)) {custom = true;}
        }
    });
    if (custom) {return 'custom';}
    return landscape ? 'landscape' : 'a4';
}

function hasOwnBrand(doc) {
    return !!doc.querySelector([
        '[data-erp-print-brand]',
        '[data-company-print-logo]',
        '[data-v2-print-brand]',
        'img[src*="logo" i]',
        'img[alt*="شعار"]',
        '.doc-logo',
        'header img',
    ].join(','));
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/* مقارنة اسم الشركة تتجاهل فروق الإملاء الشائعة (ة/ه، أ/ا، ى/ي) كي لا
   تُحقن ترويسة ثانية لمجرد أن أحد المولّدات كتب «الشرفة» وآخر «الشرفه». */
function foldArabic(value) {
    return normalizeText(value)
        .replace(/\u0640/gu, '')
        .replace(/\p{M}/gu, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه');
}

function injectBrand(doc, name) {
    const brand = doc.createElement('header');
    brand.className = 'erp-doc-brand';
    brand.setAttribute('data-erp-print-brand', '');

    const image = doc.createElement('img');
    image.src = logoSource();
    image.alt = `شعار ${name}`;

    const text = doc.createElement('div');
    text.className = 'erp-doc-brand__text';
    const arabic = doc.createElement('strong');
    arabic.className = 'erp-doc-brand__name';
    arabic.textContent = name;
    const english = doc.createElement('span');
    english.className = 'erp-doc-brand__en';
    english.textContent = 'AL SHURFA AL ALAMI RESTAURANTS';
    text.append(arabic, english);

    brand.append(image, text);
    const host = doc.querySelector('main.sheet') || doc.querySelector('.sheet') || doc.body;
    host.insertBefore(brand, host.firstChild);
}

function stampNow() {
    const now = new Date();
    const date = now.toLocaleDateString('en-GB');
    const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
}

function injectRunner(doc, title) {
    const runner = doc.createElement('div');
    runner.className = 'erp-runner';
    runner.setAttribute('data-erp-print-runner', '');

    const name = doc.createElement('span');
    name.textContent = companyName();
    const docTitle = doc.createElement('span');
    docTitle.textContent = normalizeText(title || doc.title || '');
    const stamp = doc.createElement('span');
    stamp.textContent = `طُبع ${stampNow()}`;

    runner.append(name, docTitle, stamp);
    doc.body.appendChild(runner);
}

function toLatinDigits(doc) {
    const windowRef = doc.defaultView;
    const NodeFilterRef = (windowRef && windowRef.NodeFilter) || null;
    if (!NodeFilterRef) {return;}
    const walker = doc.createTreeWalker(doc.body, NodeFilterRef.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) {return NodeFilterRef.FILTER_REJECT;}
            if (/^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION)$/.test(parent.tagName)) {
                return NodeFilterRef.FILTER_REJECT;
            }
            return /[٠-٩۰-۹]/.test(node.nodeValue || '')
                ? NodeFilterRef.FILTER_ACCEPT
                : NodeFilterRef.FILTER_REJECT;
        },
    });
    const nodes = [];
    while (walker.nextNode()) {nodes.push(walker.currentNode);}
    for (const node of nodes) {
        node.nodeValue = stripBidiMarks(node.nodeValue.replace(/[٠-٩۰-۹]/g, (digit) => {
            const arabic = ARABIC_INDIC.indexOf(digit);
            if (arabic >= 0) {return String(arabic);}
            const extended = EXTENDED_ARABIC_INDIC.indexOf(digit);
            return extended >= 0 ? String(extended) : digit;
        }));
    }
}

/* toLocaleString('ar-EG') يحيط التواريخ بعلامات RLM فتُطبع «2026/10/28»
   مقلوبة داخل سياق عربي. بعد تحويل الأرقام للاتينية نحذف العلامة الملاصقة
   لرقم أو فاصل فقط، فيُقرأ التاريخ 28/10/2026 كما هو. */
function stripBidiMarks(text) {
    return text.replace(/[\u200e\u200f]/g, (mark, offset, whole) => {
        const prev = whole[offset - 1] || '';
        const next = whole[offset + 1] || '';
        return /[0-9/]/.test(prev) || /[0-9/]/.test(next) ? '' : mark;
    });
}

/**
 * يطبّق الهوية الموحدة على مستند داخل عارض المستندات.
 * @param {Document} doc مستند الـiframe
 * @param {{title?: string}} [options]
 * @returns {Promise<boolean>} false للمستندات ذات المقاس المخصص
 */
export async function applyPrintSystem(doc, options = {}) {
    if (!doc || !doc.documentElement || !doc.body) {return false;}

    const mode = paperMode(doc);
    doc.documentElement.classList.add('erp-print-doc');
    if (mode === 'custom') {
        doc.documentElement.classList.add('erp-print-custom');
        return false;
    }

    const css = await loadStylesheet();
    if (!doc.querySelector('style[data-erp-print-style]')) {
        const style = doc.createElement('style');
        style.setAttribute('data-erp-print-style', '');
        style.textContent = css;
        doc.head.appendChild(style);
    }

    /* هوامش الورق الموحدة — تتخطى landscape كي لا يتحول الكشف الأفقي لرأسي. */
    if (mode === 'a4' && !doc.querySelector('style[data-erp-print-page]')) {
        const page = doc.createElement('style');
        page.setAttribute('data-erp-print-page', '');
        page.textContent = '@page{size:A4 portrait;margin:12mm 10mm 18mm;}';
        doc.head.appendChild(page);
    }

    const name = companyName();
    if (!hasOwnBrand(doc) && !foldArabic(doc.body.textContent).includes(foldArabic(name))) {
        injectBrand(doc, name);
    }

    /* التذييل مرة واحدة في آخر المستند. إن كان للمولّد تذييله الخاص (.foot)
       فلا نضيف ثانيًا — والعارض نفسه يحمل عنوان المستند في شريطه. */
    if (!doc.querySelector('[data-erp-print-runner], .foot, footer')) {
        injectRunner(doc, options.title);
    }

    toLatinDigits(doc);
    return true;
}

export { CSS_URL as printDocCssUrl };
