/**
 * whatsapp-engine/session-backup.js — Automatic session backup on CONNECTED
 * ────────────────────────────────────────────────────────────────────────────
 * Losing creds.json = re-pairing every device. On every CONNECTED state we
 * snapshot creds.json to WHATSAPP_BACKUP_DIR and prune old copies (keep 10).
 * Fire-and-forget: never throws into the connection flow.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function stampName(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `creds-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`;
}

/** Pure-ish: backup creds file; returns backup path or null. Testable with tmp dirs. */
function backupSession(sessionDir, backupDir, keep = 10) {
    try {
        const src = path.join(sessionDir, 'creds.json');
        if (!fs.existsSync(src)) {return null;}
        fs.mkdirSync(backupDir, { recursive: true });
        const dest = path.join(backupDir, stampName());
        fs.copyFileSync(src, dest);
        const files = fs.readdirSync(backupDir)
            .filter((f) => /^creds-\d{8}-\d{6}\.json$/.test(f))
            .sort();
        while (files.length > Math.max(1, keep)) {
            const old = files.shift();
            try { fs.unlinkSync(path.join(backupDir, old)); } catch (_) {}
        }
        return dest;
    } catch (_) {
        return null;
    }
}

/** Newest backup path or null */
function latestBackup(backupDir) {
    try {
        const files = fs.readdirSync(backupDir)
            .filter((f) => /^creds-\d{8}-\d{6}\.json$/.test(f))
            .sort();
        return files.length ? path.join(backupDir, files[files.length - 1]) : null;
    } catch (_) {
        return null;
    }
}

/** Restore newest backup into sessionDir/creds.json — returns path or throws NO_BACKUP */
function restoreLatest(backupDir, sessionDir) {
    const src = latestBackup(backupDir);
    if (!src) {throw Object.assign(new Error('لا توجد نسخة احتياطية'), { code: 'NO_BACKUP' });}
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.copyFileSync(src, path.join(sessionDir, 'creds.json'));
    return src;
}

module.exports = { backupSession, stampName, latestBackup, restoreLatest };
