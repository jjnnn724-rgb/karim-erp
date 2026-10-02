#!/usr/bin/env node
// security-route-audit.js — مصفوفة أمنية آلية: كل مسارات الكتابة × حمايتها.
// يفحص تسجيلات المسارات في backend ويصنف: محمي بـ requireRole / محمي بـ jwtAuth
// فقط / بلا حماية ظاهرة (للمراجعة). القياس: node scripts/security-route-audit.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p, out); continue; }
        if (!f.name.endsWith('.js')) {continue;}
        out.push(p);
    }
    return out;
}

const methods = ['post', 'put', 'delete', 'patch'];
const routes = [];
for (const file of walk(path.join(ROOT, 'backend'))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    const re = /\b(app|router)\.(post|put|delete|patch)\(\s*[`'"]([^`'"]+)[`'"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        // نافذة الفحص: من بداية التسجيل حتى بداية المعالج الفعلي
        const window = src.slice(m.index, m.index + 600);
        const hasJwt = /jwtAuth|requireAuth|authenticate/.test(window);
        const hasRoles = /requireRole|requireRoleOrPerm|writeGuard|permForEntity|PAYMENT_WRITE|PAYMENT_DELETE|SUPPLIER_WRITE|AUDIT_WRITE|PR_CREATE|createRoles|deleteRoles|openWriteRoles/.test(window);
        const handlerAt = window.search(/async\s*\(|\(\s*req\s*,/);
        routes.push({
            file: rel, method: m[2].toUpperCase(), path: m[3],
            hasJwt, hasRoles,
            protected: hasJwt && hasRoles,
        });
    }
}

const unauthWrite = routes.filter((r) => !r.hasJwt);
const jwtOnly = routes.filter((r) => r.hasJwt && !r.hasRoles);
console.log(`إجمالي مسارات الكتابة المفحوصة: ${routes.length}`);
console.log(`بدون jwtAuth إطلاقًا (للمراجعة — بعضها webhooks/token داخلي): ${unauthWrite.length}`);
for (const r of unauthWrite) {console.log(`   ⚠ NO-AUTH  ${r.method} ${r.path}  (${r.file})`);}
console.log(`jwtAuth فقط بلا دور ظاهر (الحد الأدنى مقبول — راجع يدويًا): ${jwtOnly.length}`);
for (const r of jwtOnly) {console.log(`   • JWT-ONLY  ${r.method} ${r.path}  (${r.file})`);}
const protectedCount = routes.filter((r) => r.protected).length;
console.log(`\nمحمية بدور صريح: ${protectedCount}/${routes.length}`);
