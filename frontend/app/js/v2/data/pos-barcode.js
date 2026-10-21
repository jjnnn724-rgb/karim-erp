function normalizeBarcode(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
        .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
        .replace(/\s/g, '');
}

export function matchPosBarcode(products, value) {
    const barcode = normalizeBarcode(value);
    if (!barcode) {return { status: 'empty', product: null };}

    const matches = (Array.isArray(products) ? products : [])
        .filter((product) => product && normalizeBarcode(product.barcode) === barcode);
    if (matches.length === 1) {return { status: 'matched', product: matches[0] };}
    return { status: matches.length ? 'ambiguous' : 'not-found', product: null };
}
