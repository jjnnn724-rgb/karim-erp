// fix-dup-logger.tmp.cjs — إزالة سطر logger المكرر في complete-sale.js.
const fs = require('fs');
const f = 'backend/cashier-module/complete-sale.js';
const lines = fs.readFileSync(f, 'utf8').split('\n');
const idxs = lines.map((l, i) => [i, l]).filter(([i, l]) => l.includes('const { logger } = require'));
console.log('logger lines at:', idxs.map(([i]) => i + 1).join(','));
if (idxs.length >= 2) {
    const [a] = idxs.map(([i]) => i);
    lines.splice(a, 1);
    fs.writeFileSync(f, lines.join('\n'));
    console.log('duplicate removed (first occurrence)');
} else {
    console.log('no duplicate — nothing to do');
}
