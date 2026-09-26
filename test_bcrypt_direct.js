const bcrypt = require('bcryptjs');
const hash = '$2a$12$dPVFoQ0ZMncXpIq0QpUE5utIOocoQaPHXFFq8NLka6ry8Ct94d9Jm';
const pass = 'Admin#2026#Karim';
console.log('Hash length:', hash.length);
console.log('Hash:', hash);
console.log('Pass:', pass);
bcrypt.compare(pass, hash).then(r => console.log('bcrypt test Result:', r)).catch(e => console.error('Error:', e.message, e.stack));