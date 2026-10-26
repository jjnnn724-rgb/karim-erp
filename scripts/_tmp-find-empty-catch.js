'use strict';
// مؤقت: اعرض أسطر كتل catch الفارغة في الملفات الجديدة فقط
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'backend');
const files = [
    'hr-routes.js', 'system-routes.js', 'warehouse-routes.js',
    'veg-requests-routes.js', 'menu-board-routes.js', 'logger.js',
    path.join('yarasoft', 'mirror.js'), 'attendance-engine.js',
];
for (const f of files) {
    const p = path.join(root, f);
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    console.log('===== ' + f + ' =====');
    lines.forEach((l, i) => {
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(l)) {
            console.log(`${i + 1}: ${l.trim().slice(0, 150)}`);
        }
    });
}
