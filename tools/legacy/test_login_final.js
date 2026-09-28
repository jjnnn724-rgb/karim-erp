const bcrypt = require('bcryptjs');
const hash = '$2a$12$c6wnN.MuJSnTlSJJNGiK0esWd/azs85.DVHxb7mAXBdrrOwiznXIe';
const pass = 'Admin#2026#Karim';
console.log('Testing bcrypt...');
console.log('Hash length:', hash.length);
console.log('Hash:', hash);
console.log('Pass:', pass);
bcrypt.compare(pass, hash).then(r => console.log('Result:', r)).catch(e => console.error('Error:', e.message, e.stack));