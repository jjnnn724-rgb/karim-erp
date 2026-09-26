#!/usr/bin/env node
const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, getEnv } = lib;
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');

const { pool } = require('../backend/shared-pool');

(async () => {
    try {
        const r = await pool.query('SELECT id, username, password, active, must_change_password FROM users WHERE username = $1', ['admin']);
        if (r.rows.length === 0) {
            log.error('No admin user found');
            process.exit(1);
        }
        const user = r.rows[0];
        console.log('User:', JSON.stringify({ id: user.id, username: user.username, active: user.active, must_change_password: user.must_change_password }, null, 2));
        console.log('Password hash (first 20 chars):', (user.password || '').substring(0, 20));

        const testPasswords = ['Karim2026Demo', '1234', 'admin', 'password'];
        for (const pw of testPasswords) {
            const ok = await bcrypt.compare(pw, user.password);
            console.log(`  bcrypt.compare('${pw}') =>`, ok);
        }

        await pool.end();
    } catch (e) {
        log.error(`Error: ${e.message}`);
        console.error(e.stack);
        process.exit(1);
    }
})();
