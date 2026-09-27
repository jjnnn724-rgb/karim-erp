const bcrypt = require('bcryptjs');
const hash = '$2a$12$GKbgpU5vo7FCnEwilz2FwegSotakoe38DTqI.o/.ix5mZC3VjldMy';
const pass = 'Admin#2026#Karim';
console.log('Hash length:', hash.length);
console.log('Hash:', hash);
console.log('Pass:', pass);
bcrypt.compare(pass, hash).then(r => console.log('Result:', r)).catch(e => console.error('Error:', e.message, e.stack));