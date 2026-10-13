const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = process.env.KARIM_DATA_DIR || path.join(__dirname, '..', 'database', 'data');
const MEDIA_ROOT = path.join(DATA_ROOT, 'uploads');
const MENU_IMAGE_ROOT = path.join(MEDIA_ROOT, 'menu');

function ensureMediaDirs() {
    fs.mkdirSync(MENU_IMAGE_ROOT, { recursive: true });
}

function safeProductImageName(productId, extension) {
    // FIX 2026-10-11: sanitize extension — was interpolated unsanitized → path traversal
    const safeExt = String(extension || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    const suffix = crypto.randomBytes(8).toString('hex');
    return `product-${Number(productId)}-${Date.now()}-${suffix}.${safeExt}`;
}

function removeMenuImageByUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {return;}
    const prefix = '/uploads/menu/';
    if (!imageUrl.startsWith(prefix)) {return;}
    const name = path.basename(imageUrl.slice(prefix.length));
    if (!/^product-\d+-\d+-[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/i.test(name)) {return;}
    try { fs.unlinkSync(path.join(MENU_IMAGE_ROOT, name)); } catch (_) {}
}

module.exports = { DATA_ROOT, MEDIA_ROOT, MENU_IMAGE_ROOT, ensureMediaDirs, safeProductImageName, removeMenuImageByUrl };
