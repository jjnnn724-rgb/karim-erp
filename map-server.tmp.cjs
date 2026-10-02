// map-server.tmp.cjs — خريطة server.js: الدوال المعرفة + حدود كتلة CRUD + الاعتماديات.
const fs = require('fs');
const src = fs.readFileSync('backend/server.js', 'utf8');
const lines = src.split('\n');
const out = [];
// 1) الدوال المعرفة top-level
lines.forEach((l, i) => {
    const m = l.match(/^(?:async )?function\s+([A-Za-z_$][\w$]*)/);
    if (m) out.push('FN ' + (i + 1) + ' ' + m[1]);
});
// 2) بداية ونهاية حلقة الكيانات (generic CRUD)
lines.forEach((l, i) => {
    if (/for\s*\(const entity of/.test(l)) {out.push('LOOP-START ' + (i + 1) + ': ' + l.trim().slice(0, 80));}
});
// 3) استيرادات server.js
lines.forEach((l, i) => {
    if (/^const .*require\(/.test(l) && i < 120) {out.push('REQ ' + (i + 1) + ': ' + l.trim().slice(0, 100));}
});
out.push('TOTAL LINES: ' + lines.length);
fs.writeFileSync('server-map.tmp.txt', out.join('\n'));
console.log('done, lines=' + lines.length);
