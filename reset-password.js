const { pool } = require('./backend/shared-pool.js');
const bcrypt = require('bcryptjs');

async function main() {
    // New password - easy to remember
    const newPassword = 'Admin@2026';
    const hash = await bcrypt.hash(newPassword, 12);

    console.log('🔐 New password:', newPassword);

    // Check users table columns
    const cols = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns 
         WHERE table_name = 'users' ORDER BY ordinal_position`
    );
    console.log('\n📋 users table columns:');
    for (const c of cols.rows) {
        console.log(`   ${c.column_name} (${c.data_type})`);
    }

    // Find admin user
    const findUser = await pool.query(
        `SELECT id, username, email, password FROM users 
         WHERE LOWER(username) = 'admin' OR LOWER(email) = 'admin' 
         LIMIT 1`
    );

    if (findUser.rows.length === 0) {
        console.log('\n❌ No admin user found');
        const allUsers = await pool.query('SELECT id, username, email, password FROM users LIMIT 10');
        console.log('\n📋 All users:');
        allUsers.rows.forEach(u => console.log(`   id=${u.id} | ${u.username} / ${u.email}`));
        pool.end();
        process.exit(1);
    }

    const userId = findUser.rows[0].id;
    const username = findUser.rows[0].username;

    // Build UPDATE query with only existing columns
    const hasUpdatedAt = cols.rows.some(c => c.column_name === 'updated_at');
    const hasLastLogin = cols.rows.some(c => c.column_name === 'last_login');

    let updateQuery = 'UPDATE users SET password = $1';
    let params = [hash];
    let paramIndex = 2;

    if (hasUpdatedAt) {
        updateQuery += `, updated_at = NOW()`;
    }
    if (hasLastLogin) {
        updateQuery += `, last_login = NULL`;
    }
    updateQuery += ` WHERE id = $${paramIndex}`;
    params.push(userId);

    await pool.query(updateQuery, params);

    console.log(`\n✅ Updated password for user "${username}" (id=${userId})`);
    console.log(`   Old hash: ${findUser.rows[0].password}`);
    console.log(`   New hash: ${hash}`);
    console.log(`\n🔑 Login credentials:`);
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${newPassword}`);

    pool.end();
    process.exit(0);
}

main().catch(e => {
    console.error('❌ Error:', e.message);
    pool.end();
    process.exit(1);
});
