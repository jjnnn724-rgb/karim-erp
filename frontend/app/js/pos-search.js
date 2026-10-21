(function (root, factory) {
    const search = factory();
    if (typeof module === 'object' && module.exports) {module.exports = search;}
    if (root) {root.POSSearch = search;}
}(typeof window !== 'undefined' ? window : globalThis, function () {
    function key(value) {
        return String(value ?? '').toLocaleLowerCase()
            .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
            .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
            .replace(/[\u064B-\u065F\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئی]/g, 'ي').replace(/ؤ/g, 'و').replace(/ک/g, 'ك')
            .replace(/[ذز]/g, 'ز').replace(/[ضص]/g, 'ص').replace(/[ظط]/g, 'ط').replace(/[شس]/g, 'س')
            .replace(/[ثت]/g, 'ت').replace(/[خج]/g, 'ح').replace(/[قف]/g, 'ف').replace(/[غع]/g, 'ع')
            .replace(/\s+/g, ' ').trim();
    }

    return Object.freeze({
        key,
        includes(value, query) {
            const normalizedQuery = key(query);
            return normalizedQuery.length > 0 && key(value).includes(normalizedQuery);
        },
    });
}));
