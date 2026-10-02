// find-all-del.tmp.cjs — كل تسجيلات DELETE المتعلقة بـ inventory في المشروع.
const fs = require('fs');
const path = require('path');
const out = [];
function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); continue; }
        if (!f.name.endsWith('.js')) {continue;}
        const rel = path.relative('.', p).replace(/\\/g, '/');
        const s = fs.readFileSync(p, 'utf8');
        const lines = s.split('\n');
        lines.forEach((l, i) => {
            if (/\.(delete|post|put)\(\s*[`'"][^`'"]*inventory/i.test(l) || (/delete/i.test(l) && l.includes("inventory/:id"))) {
                out.push(rel + ':' + (i + 1) + ': ' + l.trim().slice(0, 130));
            }
        });
    }
}
walk('backend');
fs.writeFileSync('all-del.tmp.txt', out.join('\n') || 'لا شيء');
console.log('done');
