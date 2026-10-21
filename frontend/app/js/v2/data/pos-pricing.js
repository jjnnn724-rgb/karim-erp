function parseDiscountValue(value) {
    const normalized = String(value ?? '').trim()
        .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
        .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
        .replace(/[٫]/g, '.')
        .replace(/[٬,\s]/g, '');
    return normalized ? Number(normalized) : NaN;
}

export function calculatePosTotals(cart, discount = { type: '', value: '0' }) {
    const baseItems = cart.map((row) => ({
        id: Number(row.id),
        quantity: Number(row.quantity),
        price: Number(row.price),
        vatRate: Number(row.vatRate),
    }));
    const subtotalBeforeDiscount = Number(baseItems.reduce((sum, row) => sum + row.quantity * row.price, 0).toFixed(2));
    const value = discount.type ? parseDiscountValue(discount.value) : 0;
    const valid = !discount.type
        || (Number.isFinite(value) && value >= 0 && (discount.type !== 'percent' || value <= 100)
            && ['percent', 'fixed'].includes(discount.type));
    const requestedDiscount = !valid ? 0 : discount.type === 'percent'
        ? subtotalBeforeDiscount * value / 100
        : discount.type === 'fixed' ? value : 0;
    const discountTotal = Number(Math.min(subtotalBeforeDiscount, Math.max(0, requestedDiscount)).toFixed(2));
    const eligible = baseItems.filter((row) => row.quantity * row.price > 0);
    const lastEligible = eligible[eligible.length - 1];
    let remainingDiscount = discountTotal;
    const items = baseItems.map((row) => {
        const lineSubtotal = Number((row.quantity * row.price).toFixed(2));
        let lineDiscount = 0;
        if (lineSubtotal > 0 && discountTotal > 0) {
            lineDiscount = row === lastEligible
                ? remainingDiscount
                : Number((lineSubtotal / subtotalBeforeDiscount * discountTotal).toFixed(2));
            lineDiscount = Math.min(lineSubtotal, remainingDiscount, lineDiscount);
            remainingDiscount = Number((remainingDiscount - lineDiscount).toFixed(2));
        }
        const net = Number((lineSubtotal - lineDiscount).toFixed(2));
        const tax = Number((net * row.vatRate / 100).toFixed(2));
        return {
            ...row,
            discount: lineDiscount,
            subtotal: net,
            tax,
        };
    });
    const subtotal = Number(items.reduce((sum, row) => sum + row.subtotal, 0).toFixed(2));
    const tax = Number(items.reduce((sum, row) => sum + row.tax, 0).toFixed(2));

    return {
        valid,
        subtotalBeforeDiscount,
        discount: discountTotal,
        subtotal,
        tax,
        total: Number((subtotal + tax).toFixed(2)),
        items,
    };
}

export function buildPosSaleItems(cart, discount) {
    const totals = calculatePosTotals(cart, discount);
    if (!totals.valid) {throw new Error('قيمة الخصم غير صالحة');}
    return totals.items.map((row) => ({
        product_id: row.id,
        quantity: row.quantity,
        unit_price: row.price,
        discount: row.discount,
    }));
}
