const fs = require('fs');
const f = fs.readFileSync('backend/server.js', 'utf8');
const lines = f.split('\n');
let fixed = '';
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '});' && i > 0) {
        const prev = lines[i-1].trim();
        if (prev === 'next();') {
            fixed += '    }\n';
            continue;
        }
    }
    fixed += line + '\n';
}
fs.writeFileSync('backend/server.js', fixed);
console.log('Fixed');