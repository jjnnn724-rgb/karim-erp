'use strict';
/**
 * backup-mirror.js — نسخ ملفات النسخ الاحتياطي إلى هاردات خارجية (D/E)
 * ────────────────────────────────────────────────────────────────────────────
 * يُستدعى بعد أي نسخة ناجحة. best-effort: فشل المرايا لا يُفشل النسخة.
 * Returns: { ok, mirrored: [paths], errors: [msgs] }
 */
const fs = require('fs');
const path = require('path');

const MIRROR_ROOTS = [
    process.env.KARIM_MIRROR_D || 'D:/KarimBackups',
    process.env.KARIM_MIRROR_E || 'E:/KarimBackups',
];

function mirrorFile(srcFile, subdir) {
    const out = { ok: true, mirrored: [], errors: [] };
    let stat;
    try { stat = fs.statSync(srcFile); } catch (e) { out.ok = false; out.errors.push('src-missing:' + e.message); return out; }
    if (!stat.size) { out.ok = false; out.errors.push('src-empty'); return out; }
    for (const root of MIRROR_ROOTS) {
        try {
            const dir = subdir ? path.join(root, subdir) : root;
            fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, path.basename(srcFile));
            // انسخ فقط لو غير موجود أو أقدم/أصغر (توفير وقت وكتابة)
            let skip = false;
            try {
                const ds = fs.statSync(dest);
                if (ds.size === stat.size && ds.mtimeMs >= stat.mtimeMs - 1000) skip = true;
            } catch (_) {}
            if (!skip) fs.copyFileSync(srcFile, dest);
            out.mirrored.push(dest);
        } catch (e) {
            out.errors.push(root + ':' + String(e.message).slice(0, 80));
        }
    }
    if (!out.mirrored.length) out.ok = false;
    return out;
}

module.exports = { mirrorFile, MIRROR_ROOTS };
