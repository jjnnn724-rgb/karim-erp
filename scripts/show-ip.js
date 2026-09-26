const os = require('os');
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) { /* dotenv optional — fallback to process.env */ }

const PORT = process.env.PORT || 5000;
const nets = os.networkInterfaces();
const results = {};

console.log('\n=======================================');
console.log('📡 اكتشاف عناوين الشبكة المتاحة للخادم');
console.log('=======================================\n');

let fileContent = `=== معلومات شبكة Karim ERP ===\n`;
fileContent += `تاريخ التشغيل: ${new Date().toLocaleString('ar-SA')}\n\n`;
fileContent += `روابط الاتصال المتاحة:\n`;

for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
            const url = `http://${net.address}:${PORT}/app/index.html`;
            console.log(` - ${name}: \x1b[36m${url}\x1b[0m`);
            fileContent += `- ${name}: ${url}\n`;
            if (!results[name]) {results[name] = [];}
            results[name].push(net.address);
        }
    }
}

fileContent += `\nملاحظة: إذا لم تتمكن الأجهزة العميلة من الاتصال، يرجى التأكد من فتح المنفذ ${PORT} في جدار الحماية (Firewall).\n`;

const outputPath = path.join(__dirname, '..', 'network-info.txt');
fs.writeFileSync(outputPath, fileContent, 'utf8');

console.log(`\n✅ تم حفظ هذه المعلومات في ملف: ${outputPath}\n`);
