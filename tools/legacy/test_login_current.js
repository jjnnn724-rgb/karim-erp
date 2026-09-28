const bcrypt = require('bcryptjs');
const hash = '$2a$12$JoM5Dw0tN8U8FyOGcKHubuHWpjRSFUINoZh1fHoe45bE0qpun1q1a';
const pass = 'Admin#2026#Karim';
console.log('Testing bcrypt...');
console.log('Hash:', hash);
console.log('Pass:', pass);
bcrypt.compare(pass, hash).then(r => console.log('Result:', r)).catch(e => console.error('Error:', e.message, e.stack));