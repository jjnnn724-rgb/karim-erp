const bcrypt = require('bcryptjs');
const pass = 'Admin#2026#Karim';
bcrypt.hash(pass, 12).then(h => {
    console.log('New hash:', h);
    const fs = require('fs');
    const sql = "UPDATE users SET password = '" + h + "' WHERE username = 'admin';";
    fs.writeFileSync('C:/KarimData/db-backups/update_admin.sql', sql);
    console.log('SQL written to file');
}).catch(e => console.error('Error:', e.message));