const FALLBACK_LOGO = 'assets/al-shurfa-logo.png';

let configuredLogo = '';
let installed = false;

const PRINT_STYLE = `
@page { margin: 14mm 12mm; }
body { color: #17231f; font-family: Tahoma, Arial, sans-serif; }
/* الرموز تصل من الشاشة كوسوم svg بلا عرضٍ ولا ارتفاع (icons.js)؛ بلا هذه
   القاعدة يتمدّد كلٌّ منها إلى عرض الصفحة (~1200px) فيصير رمزًا عملاقًا. */
svg { max-width: 100%; }
svg.ji { width: 1em; height: 1em; flex: none; vertical-align: -0.125em; }
.erp-v2-print-brand {
    display: none; align-items: center; justify-content: center; gap: 14px;
    margin: 0 auto 18px; padding: 0 0 12px; border-bottom: 2px solid #d7c99f;
    color: #18352b; direction: rtl; text-align: center;
    font-family: Tahoma, Arial, sans-serif;
}
.erp-v2-print-brand img { width: 68px; height: 68px; object-fit: contain; }
.erp-v2-print-brand__text { display: flex; flex-direction: column; gap: 4px; }
.erp-v2-print-brand__text strong { font-size: 18px; }
.erp-v2-print-brand__text span { color: #756d5a; font-size: 11px; letter-spacing: .4px; }
@media print {
    .erp-v2-print-brand { display: flex; break-inside: avoid; page-break-inside: avoid; }
    .erp-v2-print-brand img, table, th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    table { max-width: 100%; }
    tr { break-inside: avoid; page-break-inside: avoid; }
}`;

export function setV2PrintLogo(value) {
    configuredLogo = typeof value === 'string' ? value.trim() : '';
    const image = typeof document !== 'undefined' ? document.querySelector('[data-v2-shell-logo]') : null;
    const fallback = typeof document !== 'undefined' ? document.querySelector('[data-v2-shell-logo-fallback]') : null;
    if (image) {
        image.hidden = false;
        image.removeAttribute('src');
        image.onerror = () => {
            image.hidden = true;
            if (fallback) {fallback.hidden = false;}
        };
        image.src = logoSource();
    }
    if (fallback) {fallback.hidden = true;}
}

function logoSource() {
    const value = configuredLogo
        || (typeof window !== 'undefined' && typeof window.KARIM_V2_PRINT_LOGO === 'string'
            ? window.KARIM_V2_PRINT_LOGO.trim() : '');
    if (!value) {return new URL(FALLBACK_LOGO, window.location.href).href;}
    if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) {return value;}
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {return `data:image/png;base64,${value}`;}
    return new URL(value, window.location.href).href;
}

export function addV2PrintBranding(doc) {
    if (!doc || !doc.head || !doc.body) {return false;}
    if (doc.querySelector('[data-v2-print-brand]')) {return false;}

    if (!doc.querySelector('[data-v2-print-style]')) {
        const style = doc.createElement('style');
        style.setAttribute('data-v2-print-style', '');
        style.textContent = PRINT_STYLE;
        doc.head.appendChild(style);
    }

    const brand = doc.createElement('header');
    brand.className = 'erp-v2-print-brand';
    brand.setAttribute('data-v2-print-brand', '');
    const image = doc.createElement('img');
    image.src = logoSource();
    image.alt = 'شعار مطاعم الشرفة العالمي';
    const text = doc.createElement('div');
    text.className = 'erp-v2-print-brand__text';
    const name = doc.createElement('strong');
    name.textContent = 'مطاعم الشرفة العالمي';
    const englishName = doc.createElement('span');
    englishName.textContent = 'AL SHURFA AL ALAMI RESTAURANTS';
    text.append(name, englishName);
    brand.append(image, text);
    doc.body.insertBefore(brand, doc.body.firstChild);
    return true;
}

export function installV2PrintBranding() {
    if (installed || typeof window === 'undefined' || typeof document === 'undefined') {return;}
    installed = true;
    window.addEventListener('beforeprint', () => addV2PrintBranding(document));
}
