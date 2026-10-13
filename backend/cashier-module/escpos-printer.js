/**
 * escpos-printer.js — ESC/POS 80mm thermal receipt generator with QR code.
 * Mirrors the Epson TM-T20III / TM-m30 command set.
 */

const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ESC = 0x1B, GS = 0x1D, LF = 0x0A;
const CMD = {
    INIT:         Buffer.from([ESC, 0x40]),
    ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
    ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
    ALIGN_RIGHT:  Buffer.from([ESC, 0x61, 0x02]),
    BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
    BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
    DOUBLE_WIDTH: Buffer.from([GS, 0x21, 0x10]),
    NORMAL_SIZE:  Buffer.from([GS, 0x21, 0x00]),
    CUT_PAPER:    Buffer.from([GS, 0x56, 0x42, 0x00]),
    FEED:         (n) => Buffer.from([ESC, 0x64, n]),
};
const PAPER_WIDTH = 48;

function pad(str, len, align = 'left') {
    str = String(str);
    if (str.length >= len) {return str.slice(0, len);}
    const sp = ' '.repeat(len - str.length);
    if (align === 'right') {return sp + str;}
    if (align === 'center') { const l = Math.floor(sp.length / 2); return sp.slice(0, l) + str + sp.slice(l); }
    return str + sp;
}
function fmtMoney(n) { return Number(n).toFixed(2) + ' SAR'; }
function textLine(t, _) { return Buffer.from(t + '\n', 'utf8'); }
function divider(c = '-') { return Buffer.from(c.repeat(PAPER_WIDTH) + '\n', 'ascii'); }
function blankLine() { return Buffer.from('\n', 'ascii'); }

function buildRasterLogo(width = 128) {
    try {
        const logoPath = path.join(__dirname, '../../frontend/app/assets/karim-logo.png');
        if (!fs.existsSync(logoPath)) {return null;}
        const source = PNG.sync.read(fs.readFileSync(logoPath));
        const height = Math.max(1, Math.round(source.height * (width / source.width)));
        const bytesPerRow = Math.ceil(width / 8);
        const raster = Buffer.alloc(bytesPerRow * height, 0);
        for (let y = 0; y < height; y += 1) {
            const sy = Math.min(source.height - 1, Math.floor(y * source.height / height));
            for (let x = 0; x < width; x += 1) {
                const sx = Math.min(source.width - 1, Math.floor(x * source.width / width));
                const idx = (sy * source.width + sx) * 4;
                const alpha = source.data[idx + 3];
                const luminance = (source.data[idx] + source.data[idx + 1] + source.data[idx + 2]) / 3;
                if (alpha > 40 && luminance < 185) {raster[y * bytesPerRow + Math.floor(x / 8)] |= (0x80 >> (x % 8));}
            }
        }
        const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
        const yL = height & 0xff, yH = (height >> 8) & 0xff;
        return Buffer.concat([Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]), raster, blankLine()]);
    } catch (_) {
        return null;
    }
}
function twoColumn(left, right) {
    left = String(left); right = String(right);
    const space = PAPER_WIDTH - left.length - right.length;
    if (space < 1) {left = left.slice(0, PAPER_WIDTH - right.length - 1) + '…';}
    const line = left + ' '.repeat(Math.max(1, PAPER_WIDTH - left.length - right.length)) + right;
    return Buffer.from(line + '\n', 'utf8');
}

async function buildQrCommand(base64TlvPayload) {
    const data = Buffer.from(base64TlvPayload, 'base64');
    const setModel  = Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    const setModule = Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]);
    const setErr    = Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]);
    const pL = (data.length + 3) & 0xFF, pH = ((data.length + 3) >> 8) & 0xFF;
    const storeData = Buffer.concat([
        Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]), data,
    ]);
    const print = Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
    return Buffer.concat([setModel, setModule, setErr, storeData, print]);
}

// ─── Buffet persons section ─────────────────────────────────────────────────────
// The open buffet sells PEOPLE, not menu items: the receipt replaces the
// Item/Total table with guest-tier rows (N فرد × price) and a prominent
// total persons count, plus the family/occasion name stored in order.notes.
function buildBuffetPersonsSection(chunks, items, order) {
    chunks.push(CMD.ALIGN_CENTER);
    chunks.push(CMD.BOLD_ON);
    chunks.push(CMD.DOUBLE_WIDTH);
    chunks.push(textLine('بوفيه مفتوح'));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(textLine('Open Buffet — الأجرة بالفرد'));
    chunks.push(CMD.BOLD_OFF);
    chunks.push(CMD.ALIGN_LEFT);
    chunks.push(divider('='));
    if (order.notes) {
        chunks.push(twoColumn('العائلة/المناسبة:', String(order.notes)));
        chunks.push(divider());
    }
    chunks.push(CMD.BOLD_ON);
    chunks.push(twoColumn('الفئة', 'المبلغ'));
    chunks.push(CMD.BOLD_OFF);
    chunks.push(divider());
    let personsTotal = 0;
    for (const it of items) {
        const persons = Number(it.quantity) || 0;
        personsTotal += persons;
        chunks.push(textLine(String(it.product_name || '—')));
        // Zero-priced tier = hospitality (ضيافة) — never print a fake 0.00 charge
        const priceText = Number(it.unit_price) > 0 ? Number(it.unit_price).toFixed(2) : 'مجاناً (ضيافة)';
        chunks.push(twoColumn(`  ${persons} فرد × ${priceText}`, Number(it.line_total).toFixed(2)));
        if (Number(it.discount) > 0) {chunks.push(twoColumn('    Discount', `-${Number(it.discount).toFixed(2)}`));}
    }
    chunks.push(divider());
    chunks.push(CMD.BOLD_ON);
    chunks.push(CMD.DOUBLE_WIDTH);
    chunks.push(textLine(`عدد الأشخاص: ${personsTotal}`));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(CMD.BOLD_OFF);
    chunks.push(divider('='));
}

async function buildEscPosReceipt({ order, items, payments, qrPayload, department, cashier, paid, change, buffet = false }) {
    const chunks = [];
    chunks.push(CMD.INIT);
    chunks.push(CMD.ALIGN_CENTER);
    chunks.push(CMD.BOLD_ON);
    const logo = buildRasterLogo();
    if (logo) {chunks.push(logo);}
    chunks.push(CMD.DOUBLE_WIDTH);
    chunks.push(textLine(department.name_ar || 'مطاعم الشرفه العالمي'));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(CMD.BOLD_OFF);
    if (department.vat_number) {chunks.push(textLine(`الرقم الضريبي: ${department.vat_number}`));}
    chunks.push(textLine('AST ' + new Date(order.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })));
    chunks.push(divider('='));

    chunks.push(CMD.ALIGN_LEFT);
    chunks.push(twoColumn('Invoice #:', String(order.invoice_counter)));
    chunks.push(twoColumn('UUID:', String(order.invoice_uuid).slice(0, 36)));
    chunks.push(twoColumn('Cashier:', cashier.name || ''));
    chunks.push(twoColumn('Session:', String(order.session_id)));
    chunks.push(divider());

    if (buffet) {
        // Buffet receipt: guest tiers + persons count — no menu-item table
        buildBuffetPersonsSection(chunks, items, order);
    } else {
        chunks.push(CMD.BOLD_ON);
        chunks.push(twoColumn('Item', 'Total'));
        chunks.push(CMD.BOLD_OFF);
        chunks.push(divider());
        for (const it of items) {
            chunks.push(textLine(`${it.product_name}`));
            chunks.push(twoColumn(`  ${it.quantity} × ${Number(it.unit_price).toFixed(2)}`, Number(it.line_total).toFixed(2)));
            if (Number(it.discount) > 0) {chunks.push(twoColumn(`    Discount`, `-${Number(it.discount).toFixed(2)}`));}
        }
        chunks.push(divider());
    }
    chunks.push(twoColumn('Subtotal:',    Number(order.subtotal).toFixed(2)));
    if (Number(order.discount_total) > 0) {chunks.push(twoColumn('Discount:', `-${Number(order.discount_total).toFixed(2)}`));}
    chunks.push(twoColumn('VAT (15%):',   Number(order.tax_total).toFixed(2)));
    chunks.push(divider());
    chunks.push(CMD.BOLD_ON);
    chunks.push(CMD.DOUBLE_WIDTH);
    chunks.push(CMD.ALIGN_RIGHT);
    chunks.push(textLine(fmtMoney(order.total_amount)));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(CMD.BOLD_OFF);
    chunks.push(CMD.ALIGN_LEFT);
    chunks.push(divider());

    chunks.push(CMD.BOLD_ON);
    chunks.push(textLine('Payment'));
    chunks.push(CMD.BOLD_OFF);
    for (const p of payments) {
        chunks.push(twoColumn(`  ${p.method.toUpperCase()}`, Number(p.amount).toFixed(2)));
        if (p.reference) {chunks.push(textLine(`    ref: ${p.reference}`));}
    }
    chunks.push(twoColumn('Total Paid:', Number(paid).toFixed(2)));
    if (change > 0) {
        chunks.push(CMD.BOLD_ON);
        chunks.push(twoColumn('Change:', fmtMoney(change)));
        chunks.push(CMD.BOLD_OFF);
    }
    chunks.push(divider());

    chunks.push(CMD.ALIGN_CENTER);
    chunks.push(textLine('ZATCA Phase-2 QR'));
    chunks.push(await buildQrCommand(qrPayload));
    chunks.push(blankLine());
    chunks.push(textLine('شكراً لزيارتكم'));
    chunks.push(CMD.FEED(3));
    chunks.push(CMD.CUT_PAPER);
    // ── درج النقدية (سؤال المالك 2026-10-06: «هل الكاشير يعمل بالدرج الفلوس؟») ──
    // أي دفع كاش في الفاتورة → نبضة فتح الدرج بعد القطع (ESC p 0 = نبضة ~100ms
    // على دبوس الدرج — قياسية في طابعات الحرارة). المدفوعات الشبكية لا تفتح الدرج.
    const hasCashPayment = (Array.isArray(payments) ? payments : [])
        .some((p) => /cash|نقد|كاش/i.test(String((p && p.method) ?? '')));
    if (hasCashPayment) {chunks.push(Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]));}
    return Buffer.concat(chunks);
}

module.exports = { buildEscPosReceipt, buildQrCommand };
