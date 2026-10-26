const LOGO_PATH = 'assets/al-shurfa-logo.png';

const BRAND_STYLE = `
.erp-print-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin: 0 auto 18px;
    padding: 0 0 14px;
    border-bottom: 1px solid #d7c99f;
    color: #18352b;
    direction: rtl;
    font-family: Tahoma, Arial, sans-serif;
}
.erp-print-brand img { width: 72px; height: 72px; object-fit: contain; }
.erp-print-brand__text { display: flex; flex-direction: column; gap: 3px; }
.erp-print-brand__text strong { font-size: 17px; }
.erp-print-brand__text span { color: #756d5a; font-size: 11px; letter-spacing: .4px; }
@media print {
    .erp-print-brand { break-inside: avoid; page-break-inside: avoid; }
    .erp-print-brand img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}`;

export function addCompanyPrintLogo(doc) {
    if (!doc || !doc.head || !doc.body) {return false;}
    if (doc.querySelector('[data-company-print-logo], img[src*="logo" i], img[alt*="logo" i], img[alt*="شعار"]')) {
        return false;
    }

    const style = doc.createElement('style');
    style.setAttribute('data-company-print-style', '');
    style.textContent = BRAND_STYLE;

    const brand = doc.createElement('header');
    brand.className = 'erp-print-brand';
    brand.setAttribute('data-company-print-logo', '');
    const image = doc.createElement('img');
    image.src = new URL(LOGO_PATH, window.location.href).href;
    image.alt = 'شعار مطاعم الشرفة العالمي';
    const text = doc.createElement('div');
    text.className = 'erp-print-brand__text';
    const name = doc.createElement('strong');
    name.textContent = 'مطاعم الشرفة العالمي';
    const englishName = doc.createElement('span');
    englishName.textContent = 'AL SHURFA AL ALAMI RESTAURANTS';
    text.append(name, englishName);
    brand.append(image, text);

    doc.head.appendChild(style);
    doc.body.insertBefore(brand, doc.body.firstChild);
    return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('beforeprint', () => addCompanyPrintLogo(document));
}
