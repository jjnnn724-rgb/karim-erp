'use strict';

/**
 * attendance-push/schema.js — idempotent schema for the push channel.
 * Called lazily at boot (non-fatal) AND covered by migration 078.
 */

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const fs = require('fs');
const path = require('path');

let ensured = null;

function ensureAttendancePushSchema() {
    if (!ensured) {
        ensured = (async () => {
            const file = path.join(__dirname, '..', '..', 'database', 'migrations', '078_attendance_push.sql');
            if (fs.existsSync(file)) {
                await pool.query(fs.readFileSync(file, 'utf-8'));
            } else {
                // Minimal inline fallback (same objects, IF NOT EXISTS).
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS attendance_device_tokens (
                        id BIGSERIAL PRIMARY KEY,
                        "deviceId" BIGINT REFERENCES attendance_devices(id) ON DELETE CASCADE,
                        token_hash VARCHAR(64) NOT NULL,
                        name VARCHAR(100), revoked BOOLEAN NOT NULL DEFAULT FALSE,
                        expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT uq_device_token_hash UNIQUE (token_hash));
                    CREATE TABLE IF NOT EXISTS attendance_push_queue (
                        id BIGSERIAL PRIMARY KEY, dedup_key VARCHAR(128) NOT NULL,
                        "deviceId" BIGINT REFERENCES attendance_devices(id) ON DELETE SET NULL,
                        device_user_id VARCHAR(64), employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
                        punch_time TIMESTAMPTZ NOT NULL, verify_type SMALLINT NOT NULL DEFAULT 2,
                        punch_state SMALLINT NOT NULL DEFAULT 0, raw_payload JSONB,
                        status VARCHAR(20) NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
                        last_error TEXT, queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
                        CONSTRAINT uq_push_queue_dedup UNIQUE (dedup_key));`);
                await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS raw_payload JSONB`);
                await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(128)`);
            }
            logger.info('[ATTENDANCE_PUSH_SCHEMA] push channel ready (tokens / queue / log columns)');
        })().catch((e) => { ensured = null; throw e; });
    }
    return ensured;
}

module.exports = { ensureAttendancePushSchema };
