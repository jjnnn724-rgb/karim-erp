'use strict';

/**
 * webauthn-store.js — مفاتيح المرور (WebAuthn) والتحدّيات قصيرة العمر.
 * ────────────────────────────────────────────────────────────────────────────
 * يخزّن المفتاح العام فقط؛ لا سر ولا بصمة. التحدّي صفٌّ واحد لكل مستخدم/غرض
 * يُستهلك بحذفه، فإعادة إرسال نفس التحدّي تفشل بدل أن تُقبل مرتين.
 *
 * الجدولان يُنشآن عند أول استعمال (نمط mfa-store) كي لا يتعطل الدخول على
 * قاعدة لم تُطبَّق عليها الترحيلات بعد.
 */

const { pool } = require('./db-pool');
const { logger } = require('../logger');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CREDENTIALS_PER_USER = 8;

let _schemaReady = false;
async function ensureWebauthnSchema() {
    if (_schemaReady) {return;}
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
            id            BIGSERIAL PRIMARY KEY,
            user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id TEXT NOT NULL UNIQUE,
            public_key    BYTEA NOT NULL,
            counter       BIGINT NOT NULL DEFAULT 0,
            transports    TEXT[] NOT NULL DEFAULT '{}',
            device_label  TEXT,
            backed_up     BOOLEAN NOT NULL DEFAULT FALSE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at  TIMESTAMPTZ
        );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_user_webauthn_user ON user_webauthn_credentials (user_id);');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS webauthn_challenges (
            id         BIGSERIAL PRIMARY KEY,
            user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
            challenge  TEXT NOT NULL,
            origin     TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup ON webauthn_challenges (user_id, purpose, challenge);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges (expires_at);');
    _schemaReady = true;
}

async function countCredentials(userId) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        'SELECT COUNT(*)::int AS n FROM user_webauthn_credentials WHERE user_id = $1;',
        [userId]
    );
    return r.rows[0].n;
}

async function listCredentials(userId) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        `SELECT id, device_label, backed_up, created_at, last_used_at
           FROM user_webauthn_credentials
          WHERE user_id = $1
          ORDER BY created_at DESC;`,
        [userId]
    );
    return r.rows;
}

async function listForAllowCredentials(userId) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        `SELECT credential_id, transports
           FROM user_webauthn_credentials
          WHERE user_id = $1
          ORDER BY created_at DESC;`,
        [userId]
    );
    return r.rows;
}

async function getCredentialForAuth(userId, credentialId) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        `SELECT credential_id, public_key, counter, transports
           FROM user_webauthn_credentials
          WHERE user_id = $1 AND credential_id = $2
          LIMIT 1;`,
        [userId, credentialId]
    );
    return r.rows[0] || null;
}

/**
 * يضيف مفتاحًا. يعيد {ok:false, reason:'DUPLICATE'|'LIMIT'} بدل رمي خطأ
 * قيدٍ — المتصفح قد يعيد تسجيل نفس الجهاز، والرسالة يجب أن تُقال بالعربية.
 */
async function addCredential({
    userId,
    credentialId,
    publicKey,
    counter = 0,
    transports = [],
    backedUp = false,
    deviceLabel = null,
}) {
    await ensureWebauthnSchema();
    const count = await countCredentials(userId);
    if (count >= MAX_CREDENTIALS_PER_USER) {return { ok: false, reason: 'LIMIT' };}
    try {
        const r = await pool.query(
            `INSERT INTO user_webauthn_credentials
                (user_id, credential_id, public_key, counter, transports, backed_up, device_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id;`,
            [userId, credentialId, publicKey, counter, transports, backedUp, deviceLabel]
        );
        return { ok: true, id: Number(r.rows[0].id) };
    } catch (err) {
        if (err.code === '23505') {return { ok: false, reason: 'DUPLICATE' };}
        throw err;
    }
}

/** يرفع العدّاد ولا يخفضه أبدًا: قيمة أقل قد تكون إعادة تشغيل قديمة. */
async function touchCredential(userId, credentialId, counter) {
    await ensureWebauthnSchema();
    await pool.query(
        `UPDATE user_webauthn_credentials
            SET counter = GREATEST(counter, $3),
                last_used_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND credential_id = $2;`,
        [userId, credentialId, Number(counter) || 0]
    );
}

async function removeCredential(userId, id) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        'DELETE FROM user_webauthn_credentials WHERE user_id = $1 AND id = $2 RETURNING credential_id;',
        [userId, id]
    );
    return r.rowCount === 1;
}

/** يبدأ تحديًا جديدًا ويُبطل أي تحدي سابق لنفس المستخدم/الغرض. */
async function saveChallenge({ userId, purpose, challenge, origin, ttlMs = CHALLENGE_TTL_MS }) {
    await ensureWebauthnSchema();
    await pool.query('DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP;');
    await pool.query('DELETE FROM webauthn_challenges WHERE user_id = $1 AND purpose = $2;', [userId, purpose]);
    await pool.query(
        `INSERT INTO webauthn_challenges (user_id, purpose, challenge, origin, expires_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5::bigint * INTERVAL '1 millisecond'));`,
        [userId, purpose, challenge, origin, ttlMs]
    );
}

/**
 * يستهلك التحدّي ذريًّا: حذف بشرط أن يكون حيًّا. المنافس الثاني في نفس
 * اللحظة يرى rowCount = 0، فلا يُقبل توقيعان بتحدٍّ واحد.
 */
async function takeChallenge({ userId, purpose, challenge }) {
    await ensureWebauthnSchema();
    const r = await pool.query(
        `DELETE FROM webauthn_challenges
          WHERE id = (
              SELECT id FROM webauthn_challenges
               WHERE user_id = $1
                 AND purpose = $2
                 AND challenge = $3
                 AND expires_at > CURRENT_TIMESTAMP
               ORDER BY id DESC
               LIMIT 1)
         RETURNING challenge, origin;`,
        [userId, purpose, challenge]
    );
    return r.rows[0] || null;
}

async function pruneExpired() {
    await ensureWebauthnSchema();
    const r = await pool.query('DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP;');
    if (r.rowCount) {logger.info(`[webauthn] pruned ${r.rowCount} expired challenge(s)`);}
    return r.rowCount;
}

module.exports = {
    CHALLENGE_TTL_MS,
    MAX_CREDENTIALS_PER_USER,
    ensureWebauthnSchema,
    countCredentials,
    listCredentials,
    listForAllowCredentials,
    getCredentialForAuth,
    addCredential,
    touchCredential,
    removeCredential,
    saveChallenge,
    takeChallenge,
    pruneExpired,
};
