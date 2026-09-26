const bcrypt = require('bcryptjs');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * reset-preview-admin.js — resets the local PREVIEW admin password.
 *
 * ⚠ SAFETY: the old version wrote a hardcoded, repo-public password to
 * whatever database .env pointed at (including production) and cleared the
 * rotation flag — one accidental run defeated the whole password-hardening
 * pipeline. It is now hard-gated and generates a RANDOM password.
 */
const username = 'admin';

async function main() {
  // Gate 1: never outside a non-production, explicitly-local preview run
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run: NODE_ENV=production. This script is for local preview only.');
  }
  // Gate 2: explicit opt-in on every run
  if (process.env.RESET_PREVIEW_ADMIN !== 'yes') {
    throw new Error('Refusing to run: set RESET_PREVIEW_ADMIN=yes to confirm you are resetting a LOCAL preview database.');
  }
  // Gate 3: refuse when pointed at a non-local host
  const host = process.env.DB_HOST || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run: DB_HOST=${host} is not a local database.`);
  }

  const password = crypto.randomBytes(12).toString('base64url'); // random per run
  const client = new Client({
    host,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'karim_erp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
  await client.connect();
  const hash = await bcrypt.hash(password, 12);
  const result = await client.query(
    `UPDATE users SET password = $1, must_change_password = FALSE, password_migrated_at = CURRENT_TIMESTAMP WHERE username = $2 RETURNING username, role, active`,
    [hash, username]
  );
  if (!result.rowCount) { await client.end(); throw new Error('admin user not found'); }
  await client.end();
  console.log(JSON.stringify({ username, password, ...result.rows[0] }));
}
main().catch(async (error) => { console.error(error.message); process.exit(1); });
