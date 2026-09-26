/**
 * paths.js — Centralized, bulletproof path resolver for ALL scripts
 * ════════════════════════════════════════════════════════════════
 *
 * 💡 THE ONLY PLACE YOU NEED TO UPDATE PROJECT-WIDE PATHS.
 *
 * Works from ANY current working directory, because it uses
 * `import.meta.url` (ESM) / `__dirname` (CJS) relative to THIS file
 * (which lives at <root>/scripts/lib/paths.js), NOT relative to
 * process.cwd() which changes when you run:
 *     node scripts/setup.js      (cwd = root, works)
 *     cd scripts && node setup   (cwd = scripts, BREAKS old paths)
 *     node ../setup.js           (cwd = anywhere, BREAKS old paths)
 *
 * 📦 Included in deploy-machine.mjs so it works BEFORE npm install
 * (zero dependencies — uses only Node builtins).
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, isAbsolute, relative, normalize, sep } from 'node:path';
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';
import { platform, homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// scripts/lib → go up twice: <root>/scripts/lib/../../
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const IS_WIN = platform() === 'win32';
const IS_LINUX = platform() === 'linux';
const IS_MAC = platform() === 'darwin';

const PATHS = Object.freeze({
    // ─── Project internals (always under PROJECT_ROOT) ──────────
    ROOT: PROJECT_ROOT,
    BACKEND:        join(PROJECT_ROOT, 'backend'),
    FRONTEND:       join(PROJECT_ROOT, 'frontend'),
    SCRIPTS:        join(PROJECT_ROOT, 'scripts'),
    SCRIPTS_LIB:    join(PROJECT_ROOT, 'scripts', 'lib'),
    DATABASE:       join(PROJECT_ROOT, 'database'),
    DB_MIGRATIONS:  join(PROJECT_ROOT, 'database', 'migrations'),
    DB_SCRIPTS:     join(PROJECT_ROOT, 'database', 'scripts'),
    DB_DATA:        join(PROJECT_ROOT, 'database', 'data'),
    DB_BACKUPS:     join(PROJECT_ROOT, 'database', 'backups'),
    ELECTRON:       join(PROJECT_ROOT, 'electron'),
    BUILD:          join(PROJECT_ROOT, 'build'),
    LOGS:           join(PROJECT_ROOT, 'logs'),
    TESTS:          join(PROJECT_ROOT, 'tests'),
    NODE_MODULES:   join(PROJECT_ROOT, 'node_modules'),

    // ─── Key files ──────────────────────────────────────────────
    ENV_FILE:           join(PROJECT_ROOT, '.env'),
    ENV_EXAMPLE:        join(PROJECT_ROOT, '.env.example'),
    PACKAGE_JSON:       join(PROJECT_ROOT, 'package.json'),
    SERVER_JS:          join(PROJECT_ROOT, 'backend', 'server.js'),
    SHARED_JS:          join(PROJECT_ROOT, 'scripts', 'shared.js'),
    DOTENV_FILE:        join(PROJECT_ROOT, 'database', 'data', '.migrations_applied'),
    SSL_KEY_DEFAULT:    join(PROJECT_ROOT, 'ssl', 'key.pem'),
    SSL_CERT_DEFAULT:   join(PROJECT_ROOT, 'ssl', 'cert.pem'),

    // ─── Cross-machine / platform paths ─────────────────────────
    // Use these for portable locations OUTSIDE the project folder.
    // They follow OS conventions instead of hardcoding C:\Whatever.
    PROGRAMDATA:    IS_WIN ? (process.env.PROGRAMDATA || join('C:', 'ProgramData')) : '/var/lib',
    USER_HOME:      homedir(),
    USER_DESKTOP:   join(homedir(), IS_WIN ? 'Desktop' : 'Desktop'),
    USER_DOCUMENTS: join(homedir(), IS_WIN ? 'Documents' : 'Documents'),

    // Recommended install location when deploying to another machine:
    //   Windows:  %ProgramData%\KarimERP
    //   Linux:    /var/lib/karimerp
    //   macOS:    /Library/Application Support/KarimERP
    SHARED_INSTALL_DIR: IS_WIN
        ? join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'KarimERP')
        : IS_MAC
            ? join('/Library', 'Application Support', 'KarimERP')
            : join('/var', 'lib', 'karimerp'),
});

const COMMON_DIRS = Object.freeze([
    PATHS.LOGS,
    PATHS.DB_BACKUPS,
    join(PATHS.SCRIPTS, '__pycache__'),
    PATHS.DB_DATA,
]);

function toAbsolute(maybeRelative, base = PROJECT_ROOT) {
    if (!maybeRelative) return maybeRelative;
    // Normalize separators first
    const p = normalize(String(maybeRelative).trim().replace(/^["']|["']$/g, ''));
    return isAbsolute(p) ? p : resolve(base, p);
}

function exists(path, mode = 'F_OK') {
    try {
        accessSync(path, constants[mode]);
        return true;
    } catch { return false; }
}

function readable(path) { return exists(path, 'R_OK'); }
function writable(path) { return exists(path, 'W_OK'); }

function ensureDirs(list = COMMON_DIRS) {
    const created = [];
    for (const dir of list) {
        try {
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
                created.push(dir);
            }
        } catch (_) { /* ignore permission errors silently — log above */ }
    }
    return created;
}

function relativeToRoot(path) {
    const abs = toAbsolute(path);
    const rel = relative(PROJECT_ROOT, abs);
    return rel.startsWith('..') ? abs : rel;
}

/**
 * Smart path-rewrite helper for .env values that used to reference
 * an old machine's absolute paths (e.g. C:\Users\OldUser\... — very
 * common mistake when copying .env between machines).
 *
 * Strategy:
 *   • If value is relative or empty → keep as-is (resolve to PROJECT_ROOT).
 *   • If absolute path points to existing location on THIS machine → keep it.
 *   • If absolute path is BROKEN (points to old machine) → try to find
 *     the same FILENAME under PROJECT_ROOT, else rewrite to a sensible
 *     default under PATHS.SHARED_INSTALL_DIR/<filename>/.
 */
function repairLegacyAbsolutePath(rawValue, { category = 'generic', fallbackName = 'data', createFallback = true } = {}) {
    if (!rawValue) return toAbsolute(`./${fallbackName}`);
    const trimmed = String(rawValue).trim().replace(/^["']|["']$/g, '');
    if (!trimmed) return toAbsolute(`./${fallbackName}`);

    // Relative path → resolve against root
    if (!isAbsolute(trimmed)) return toAbsolute(trimmed);

    // Absolute path EXISTS on current machine → great, keep it
    if (existsSync(trimmed)) return trimmed;

    // Absolute path is BROKEN (came from another machine).
    // Attempt 1: find the same basename under PROJECT_ROOT
    const base = trimmed.split(sep).pop() || fallbackName;
    const localGuess = toAbsolute(join('.', category, base));
    if (existsSync(localGuess)) return localGuess;

    // Attempt 2: create a new portable default
    const fallback = join(PATHS.SHARED_INSTALL_DIR, category, base);
    if (createFallback) {
        try { mkdirSync(category === 'files' ? dirname(fallback) : fallback, { recursive: true }); } catch (_) {}
    }
    return fallback;
}

function formatPathForLog(path) {
    return relativeToRoot(path);
}

const CATEGORY = Object.freeze({
    SSL: 'ssl',
    BACKUP: 'backups',
    WHATSAPP: 'whatsapp',
    YARASOFT: 'yarasoft',
    ATTACHMENTS: 'attachments',
    REPORTS: 'reports',
});

export {
    PATHS,
    IS_WIN,
    IS_LINUX,
    IS_MAC,
    COMMON_DIRS,
    CATEGORY,
    toAbsolute,
    exists,
    readable,
    writable,
    ensureDirs,
    relativeToRoot,
    repairLegacyAbsolutePath,
    formatPathForLog,
};

export default { PATHS, IS_WIN, IS_LINUX, IS_MAC };
