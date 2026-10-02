const fs = require('fs');
let s = fs.readFileSync('scripts/quality-gate.js', 'utf8');
// احذف كتلة الاستعلام القديمة كاملة (const poll الأولى مع db.query)
const oldBlock = s.match(/    const poll = \(await db\.query\(`SELECT COUNT[\s\S]*?active=\$\{poll\}`\);\n/);
if (oldBlock) { s = s.replace(oldBlock[0], ''); fs.writeFileSync('scripts/quality-gate.js', s); console.log('old block removed'); }
else { throw new Error('old block not found'); }
