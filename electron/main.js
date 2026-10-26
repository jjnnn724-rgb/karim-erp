/**
 * 🦅 Electron Main Process — karim ERP v3.1
 * ================================================
 * المطاعم العالمية للشرفة — نظام إدارة المطاعم المتكامل
 * Professional enterprise architecture. Restaurant domain model.
 * 
 * @version 3.1.0
 * @author AlShorfa Engineering
 * @license Proprietary — مطاعم الشرفة العالمي
 * @domain  Restaurant Management (Saudi Arabia / MENA)
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execFileSync } = require('child_process');
const os = require('os');
const http = require('http');

// Load .env — سلسلة البحث (الأول الموجود يفوز، والمتغيرات الخارجية تسبق الجميع):
//   1) بجانب الـ exe (ملف إعدادات الجهاز — يبقى موجودًا بعد أي تحديث)
//   2) %APPDATA%\karim-erp\.env (قابل للكتابة — القالب الأولي يُكتب هنا)
//   3) جذر المشروع (وضع التطوير من المصدر)
// بدون هذا التسلسل التطبيق المثبّت يشتغل بلا إعدادات ويفشل عند قاعدة البيانات.
let KARIM_ENV_FILE = '';
try {
    const dotenv = require('dotenv');
    const exeDir = (() => { try { return path.dirname(app.getPath('exe')); } catch (_) { return null; } })();
    const userData = (() => { try { return app.getPath('userData'); } catch (_) { return null; } })();
    const candidates = [
        exeDir ? path.join(exeDir, '.env') : null,
        userData ? path.join(userData, '.env') : null,
        path.join(app.getAppPath(), '.env'),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            dotenv.config({ path: p });
            KARIM_ENV_FILE = p;
            break;
        }
    }
} catch (_) {
    try { require('dotenv').config(); } catch (_) {}
}

// Auto-update integration (electron-updater)
let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.channel = 'latest';
} catch (e) {
    console.warn('[AutoUpdate] electron-updater not available:', e.message);
}

// Windows Service mode: runs the database and API without opening a GUI window.
const IS_SERVICE_MODE = process.argv.includes('--service') || process.env.ALSHORFA_SERVICE === '1';
const IS_BACKUP_MODE = process.argv.includes('--backup');
const WINDOWS_SERVICE_NAME = 'AlShorfaERP';

// ─── وضع العميل النحيف (v7.1 §5/LAW 05 — عميل موحد، السيرفر مصدر الصلاحيات) ───
// طريقتان لتحويل الجهاز إلى عميل:
//   1) server-target.json (بجانب الـ exe أو في %APPDATA%\karim-erp) — عنوان صريح
//      { "serverUrl": "https://192.168.1.10:5000" } — يدوي وله الأولوية دائمًا.
//   2) client-mode.json (نفس الأماكن) — ملف علامة بلا عنوان: العميل يكتشف
//      السيرفر تلقائيًا من إعلانه على الشبكة (UDP — common/lan-discovery).
// غياب الملفين = السلوك القائم (سيرفر محلي) — توافق كامل (LAW 13).
const CLIENT_MARKER_NAME = 'client-mode.json';
const CLIENT_TARGET_CANDIDATES = [
    () => path.join(path.dirname(app.getPath('exe')), 'server-target.json'),
    () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'karim-erp', 'server-target.json'),
    () => path.join(__dirname, 'server-target.json'),
    () => path.join(__dirname, '..', 'server-target.json'),
];
function readClientTarget() {
    for (const candidate of CLIENT_TARGET_CANDIDATES) {
        try {
            const p = candidate();
            if (!fs.existsSync(p)) {continue;}
            const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
            const url = String(raw.serverUrl || '').trim().replace(/\/+$/, '');
            if (/^https?:\/\/.+/.test(url)) {return { url, source: p };}
        } catch (_) {}
    }
    return null;
}
function clientMarkerCandidates() {
    const exeDir = (() => { try { return path.dirname(app.getPath('exe')); } catch (_) { return null; } })();
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return [
        exeDir ? path.join(exeDir, CLIENT_MARKER_NAME) : null,
        path.join(appData, 'karim-erp', CLIENT_MARKER_NAME),
        path.join(__dirname, CLIENT_MARKER_NAME),
        path.join(__dirname, '..', CLIENT_MARKER_NAME),
    ].filter(Boolean);
}
function readClientMarker() {
    for (const p of clientMarkerCandidates()) {
        try { if (fs.existsSync(p)) {return p;} } catch (_) {}
    }
    return null;
}
const CLIENT_TARGET = readClientTarget();
const CLIENT_MARKER = CLIENT_TARGET ? null : readClientMarker();
const IS_CLIENT_MODE = Boolean(CLIENT_TARGET || CLIENT_MARKER);
if ((IS_SERVICE_MODE || IS_BACKUP_MODE) && process.platform === 'win32') {
    app.disableHardwareAcceleration();
}

function getPersistentDataRoot() {
    if ((IS_SERVICE_MODE || IS_BACKUP_MODE) && process.platform === 'win32') {
        return path.join(process.env.PROGRAMDATA || process.env.ProgramData || 'C:\\ProgramData', 'AlShorfaERP');
    }
    return app.getPath('userData');
}

// ─── Configuration ────────────────────────────────────────
const CONFIG = {
    // Server Configuration
    PORT: process.env.PORT || 5000,
    DB_PORT: process.env.DB_PORT || process.env.PG_PORT || 5432,  // DB_PORT is the documented key (.env.example); PG_PORT kept for backward compat
    HOST: '0.0.0.0',  // LAN access for kitchen displays & attendance devices
    
    // Window Configuration
    WINDOW_WIDTH: 1400,
    WINDOW_HEIGHT: 900,
    MIN_WIDTH: 1024,
    MIN_HEIGHT: 768,
    
    // Paths (resolved at runtime)
    get APP_PATH() { return app.getAppPath(); },
    get RESOURCE_PATH() { 
        // In production: inside asar or extracted
        return process.resourcesPath || this.APP_PATH; 
    },
    get PERSISTENT_PATH() { return getPersistentDataRoot(); },
    get DATA_PATH() { return path.join(this.PERSISTENT_PATH, 'database', 'data'); },
    get BACKUPS_PATH() { return path.join(this.PERSISTENT_PATH, 'database', 'backups'); },
    
    // Timeouts
    DB_STARTUP_TIMEOUT: 60000,      // 60 seconds for PostgreSQL to start
    SERVER_STARTUP_TIMEOUT: 30000,   // 30 seconds for Express to start
    SHUTDOWN_TIMEOUT: 30000,         // 30 seconds force exit
    
    // App Info
    APP_NAME: 'مطاعم الشرفه العالمي',
    TRAY_TOOLTIP: 'مطاعم الشرفه العالمي - نظام إدارة المطاعم',
};

// ─── Global State ─────────────────────────────────────────
let mainWindow = null;
let tray = null;
let pgProcess = null;          // PostgreSQL child process
let serverProcess = null;      // Express server child process
let isShuttingDown = false;
let attachedToWindowsService = false;
let isServerReady = false;
let isDbReady = false;
// Dual-mode DB: null = portable (default); set by trySystemPostgres() when the
// installed PostgreSQL is used. All downstream consumers (migrations, password
// bootstrap, Express env, backups) must go through activeDbPassword()/activePgCtl().
let SYSTEM_DB = null;
function activeDbPassword() {
    if (SYSTEM_DB && SYSTEM_DB.password) {return SYSTEM_DB.password;}
    return getOrCreateDbPassword();
}
function activePgCtl() {
    if (SYSTEM_DB && SYSTEM_DB.pgCtlPath) {return SYSTEM_DB.pgCtlPath;}
    return findPgCtl();
}

// ─── Utility Functions ────────────────────────────────────

/**
 * الحصول على عنوان IP المحلي للشبكة
 */
function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = { local: '127.0.0.1', lan: [] };
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.lan.push({
                    interface: name,
                    address: iface.address
                });
                // Prefer 192.168.x.x for display
                if (!addresses.primary || iface.address.startsWith('192.168.')) {
                    addresses.primary = iface.address;
                }
            }
        }
    }
    
    if (!addresses.primary && addresses.lan.length > 0) {
        addresses.primary = addresses.lan[0].address;
    }
    
    return addresses;
}

/**
 * انتظار لمدة محددة (Promise-based sleep)
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * التحقق من وجود ملف أو مجلد
 */
function existsSync(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

/**
 * إنشاء مجلد بشكل متكرر إذا لم يكن موجوداً
 */
function ensureDir(dirPath) {
    if (!existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ─── PostgreSQL Management ────────────────────────────────
/**
 * إيجاد pg_ctl: المحمولة المدمجة أولًا (database/bin) ثم المثبتة على النظام.
 * (النسخ القديمة كانت تنادي findPgCtl دون تعريفها — المحمولة كانت مكسورة تمامًا.)
 */
function findPgCtl() {
    const bundled = [
        path.join(CONFIG.RESOURCE_PATH, 'database', 'bin', 'pg_ctl.exe'),
        path.join(CONFIG.APP_PATH, 'database', 'bin', 'pg_ctl.exe'),
    ];
    for (const p of bundled) {
        if (existsSync(p)) {return p;}
    }
    return findSystemPgCtl();
}

/**
 * System PostgreSQL only — v3.0
 * All data stored on the system PostgreSQL service (port 5432)
 * No portable database, no bundled binaries.
 */
function findSystemPgCtl() {
    // Search for ANY PostgreSQL 16+ installation — works for any recent version
    // Check common installation locations
    try {
        const pgDirs = sh('dir /b /s /o-d "C:\\Program Files\\PostgreSQL" 2>nul') || '';
        const pgVersions = pgDirs.split('\n').filter(d => {
            const v = d.match(/PostgreSQL[\\/](\d+)/);
            return v && parseInt(v[1]) >= 16;
        });
        for (const dir of pgVersions) {
            const candidate = dir.trim() + '\\bin\\pg_ctl.exe';
            if (existsSync(candidate)) {return candidate;}
        }
    } catch (_) {}
    // Try common paths explicitly
    const versions = ['16', '17', '18', '15', '14'];
    for (const v of versions) {
        for (const p of [
            `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_ctl.exe`,
            `C:\\Program Files (x86)\\PostgreSQL\\${v}\\bin\\pg_ctl.exe`,
        ]) {
            if (existsSync(p)) {return p;}
        }
    }
    // Try system PATH
    try {
        const where = spawnSync('where', ['pg_ctl.exe'], { encoding: 'utf-8', timeout: 5000 });
        if (where.status === 0) {
            const p = where.stdout.trim().split('\n')[0].trim();
            if (p) {return p;}
        }
    } catch (_) {}
    return null;
}

function getPostgresRuntime(pgCtlPath) {
    const binDir = path.dirname(pgCtlPath);
    const rootDir = path.dirname(binDir);
    const runtimeEnv = {
        ...process.env,
        PATH: [binDir, rootDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
        PGROOT: rootDir,
    };
    return { binDir, rootDir, runtimeEnv };
}

/**
 * يجلب كلمة مرور DB الدائمة الخاصة بهذا التثبيت، أو يولّد واحدة جديدة
 * ويحفظها في userData (مرة واحدة فقط لكل تثبيت).
 *
 * ⚠️ SECURITY: هذه الكلمة تُستخدم كـ postgres superuser password، ولازم
 * تُستخدم مع --auth=scram-sha-256 و pg_hba.conf مقصور على 127.0.0.1 فقط.
 * لا تستخدم أبدًا مصادقة بلا كلمة مرور أو استماعًا على كل الواجهات لقاعدة البيانات.
 */
function getOrCreateDbPassword() {
        const secretPath = path.join(CONFIG.PERSISTENT_PATH, 'db-secret.json');
    let secret = { password: '' };
    try {
        if (fs.existsSync(secretPath)) {
            secret = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
        }
    } catch (_) { /* ignore corrupt file, regenerate below */ }
    if (!secret.password || secret.password.length < 24) {
        secret.password = crypto.randomBytes(24).toString('hex');
        try { fs.writeFileSync(secretPath, JSON.stringify(secret, null, 2), { mode: 0o600 }); }
        catch (err) { console.error('[PostgreSQL] Could not persist DB password:', err.message); }
    }
    return secret.password;
}

/**
 * قالب إعدادات أول تشغيل — يُكتب في userData (قابل للكتابة دائمًا) إن لم يوجد
 * أي .env، ليعرف المالك بالضبط أين يضع كلمة مرور قاعدة البيانات.
 */
function writeEnvTemplate() {
    try {
        const target = path.join(CONFIG.PERSISTENT_PATH, '.env');
        if (existsSync(target)) {return target;}
        fs.writeFileSync(target, [
            '# ── إعدادات Karim ERP ──',
            '# املأ DB_PASSWORD بكلمة مرور postgres الخاصة بجهاز السيرفر ثم أعد فتح التطبيق.',
            '# (ملف بجانب التطبيق exe له الأولوية إن رغبت في مكان آخر)',
            '',
            'PORT=5000',
            'DB_PORT=5432',
            'DB_NAME=karim_erp',
            'DB_USER=postgres',
            'DB_PASSWORD=',
            '',
        ].join('\n'), 'utf8');
        return target;
    } catch (_) { return ''; }
}

/**
 * تهيئة قاعدة البيانات إذا لم تكن موجودة
 * ينشئ مجلد البيانات ويشغل initdb
 */
async function initializeDatabase(pgCtlPath, dataDir) {
    const { binDir, rootDir, runtimeEnv } = getPostgresRuntime(pgCtlPath);
    const initdbPath = path.join(binDir, 'initdb.exe');
    const postgresPath = path.join(binDir, 'postgres.exe');
    if (!existsSync(initdbPath) || !existsSync(postgresPath)) {
        throw new Error('ملفات PostgreSQL المحمولة ناقصة: initdb.exe أو postgres.exe غير موجودة. أعد تثبيت النسخة الكاملة.');
    }
    console.log(`[PostgreSQL] Runtime root: ${rootDir}`);
    
    // Check if data directory already has content
    if (existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
        console.log('[PostgreSQL] Data directory already initialized.');
        return true;
    }
    
    console.log('[PostgreSQL] Initializing new database cluster...');
    ensureDir(dataDir);

    // Write the generated password to a temp pwfile for initdb --pwfile.
    // The file is removed immediately after initdb finishes.
    const dbPassword = getOrCreateDbPassword();
    const pwFilePath = path.join(app.getPath('temp'), `karim-pg-pw-${Date.now()}.tmp`);
    fs.writeFileSync(pwFilePath, dbPassword + '\n', { mode: 0o600 });

    return new Promise((resolve, reject) => {
        const initProcess = spawn(initdbPath, [
            '-D', dataDir,
            '-U', 'postgres',
            '-E', 'UTF8',
            '--auth=scram-sha-256',
            `--pwfile=${pwFilePath}`
        ], {
            cwd: binDir,
            env: runtimeEnv,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stderr = '';
        initProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        initProcess.on('close', (code) => {
            try { fs.unlinkSync(pwFilePath); } catch (_) { /* best effort cleanup */ }
            if (code === 0) {
                console.log('[PostgreSQL] Database cluster initialized successfully.');

                // ثبّت المنفذ المطلوب داخل config الكلاستر نفسه — يلزم pg_ctl -w
                // بفحص المنفذ الصحيح ويتفادى تصادم أي PostgreSQL آخر على 5432
                if (Number(CONFIG.DB_PORT) !== 5432) {
                    try {
                        fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nport = ${Number(CONFIG.DB_PORT)}\n`);
                        console.log(`[PostgreSQL] Cluster port pinned to ${CONFIG.DB_PORT}.`);
                    } catch (_) { /* يُعوَّض بخيار -o عند التشغيل */ }
                }

                // Restrict to localhost only — the DATABASE must never be
                // reachable from the network. Only the Express app server
                // (which enforces JWT auth) listens on 0.0.0.0.
                configurePostgresLocalOnly(dataDir);
                resolve(true);
            } else {
                reject(new Error(`initdb failed (code ${code}): ${stderr}`));
            }
        });
        
        initProcess.on('error', (err) => {
            try { fs.unlinkSync(pwFilePath); } catch (_) { /* best effort cleanup */ }
            reject(new Error(`Failed to run initdb: ${err.message}`));
        });
    });
}

/**
 * تكوين PostgreSQL للوصول من هذا الجهاز فقط (127.0.0.1)
 *
 * ⚠️ SECURITY: قاعدة البيانات لا يجب أبدًا أن تكون متاحة على الشبكة.
 * الأجهزة الأخرى (شاشات المطبخ، أجهزة الحضور) تتصل بسيرفر Express على
 * المنفذ 5000 (0.0.0.0) وليس بقاعدة البيانات مباشرة على المنفذ 5432.
 */
function configurePostgresLocalOnly(dataDir) {
    const confPath = path.join(dataDir, 'postgresql.conf');
    const hbaPath = path.join(dataDir, 'pg_hba.conf');
    
    try {
        // Bind only to loopback — never expose Postgres itself to the LAN.
        // Idempotent rewrite (never blind append): strip BOM, normalize
        // newlines, drop stale active keys, then write the tail exactly once.
        if (existsSync(confPath)) {
            let text = fs.readFileSync(confPath, 'utf8').replace(/^\uFEFF/, '');
            text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const kept = text.split('\n').filter(line => {
                const t = line.trim();
                if (t.startsWith('#') || t === '') {return true;}
                if (/^listen_addresses\s*=/.test(t)) {return false;}
                if (/^port\s*=/.test(t)) {return false;}
                if (/^log_statement\s*=/.test(t)) {return false;}
                return true;
            });
            const tail = [
                '# karim ERP — Local-only DB access',
                "listen_addresses = 'localhost'",
                `port = ${CONFIG.DB_PORT}`,
                "log_statement = 'none'",
            ];
            const out = kept.join('\n').replace(/\n+$/, '') + '\n' + tail.join('\n') + '\n';
            const tmp = confPath + '.tmp.' + Date.now();
            fs.writeFileSync(tmp, out.replace(/\n/g, '\r\n'), 'utf8');
            fs.renameSync(tmp, confPath);
        }
        
        // Require password auth even for local connections — loopback only, never network-wide.
        if (existsSync(hbaPath)) {
            fs.appendFileSync(hbaPath, '\n# karim ERP — Local-only, password-required\n');
            fs.appendFileSync(hbaPath, 'host    all             all             127.0.0.1/32            scram-sha-256\n');
            fs.appendFileSync(hbaPath, 'host    all             all             ::1/128                 scram-sha-256\n');
        }
        
        console.log('[PostgreSQL] Configured for local-only, password-protected access.');
    } catch (err) {
        console.error('[PostgreSQL] Warning: Could not configure local-only access:', err.message);
    }
}

/**
 * محاولة استخدام PostgreSQL المثبتة على النظام بدل المحمولة.
 * يرجع true عند نجاح الاتصال وإنشاء القاعدة — فيلغي بدء المحمولة تمامًا.
 * DB_MODE=portable يتخطى الفحص، وDB_MODE=system يفشل بصوت عالٍ عند تعذرها.
 */
async function trySystemPostgres() {
    // When packaged as EXE, default to system PostgreSQL
    const envMode = String(process.env.DB_MODE || '').toLowerCase();
    const mode = envMode || (app.isPackaged ? 'system' : 'auto');
    if (mode === 'portable') {return false;}
    const strict = mode === 'system';
    const fail = (msg) => {
        if (strict) {throw new Error(msg);}
        console.warn(`[PostgreSQL] ${msg} — متابعة بالمحمولة.`);
        return false;
    };
    // 1) إيجاد pg_ctl النظام (يستبعد المدمجة داخل الحزمة)
    const bundledRoots = [CONFIG.RESOURCE_PATH, CONFIG.APP_PATH].map(p => String(p || '').toLowerCase());
    const candidates = [];
    const consider = (p) => {
        if (!p || !existsSync(p)) {return;}
        if (bundledRoots.some(r => r && String(p).toLowerCase().startsWith(r))) {return;}
        if (!candidates.includes(p)) {candidates.push(p);}
    };
    if (process.platform === 'win32') {
        for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
            if (!existsSync(root)) {continue;}
            let vers = [];
            try { vers = fs.readdirSync(root).sort().reverse(); } catch (_) {}
            for (const v of vers) {consider(path.join(root, v, 'bin', 'pg_ctl.exe'));}
        }
    } else if (existsSync('/usr/lib/postgresql')) {
        let vers = [];
        try { vers = fs.readdirSync('/usr/lib/postgresql').sort().reverse(); } catch (_) {}
        for (const v of vers) {consider(path.join('/usr/lib/postgresql', v, 'bin', 'pg_ctl'));}
    }
    if (!candidates.length) {return fail('لا توجد PostgreSQL مثبتة على النظام');}
    const sysCtl = candidates[0];
    const sysBin = path.dirname(sysCtl);
    const sysPsql = path.join(sysBin, process.platform === 'win32' ? 'psql.exe' : 'psql');
    if (!existsSync(sysPsql)) {return fail('ثنائيات النظام ناقصة (psql)');}
    // 2) المنفذ مفتوح؟
    const portOpen = await new Promise((resolve) => {
        const s = require('net').createConnection({ port: Number(CONFIG.DB_PORT), host: '127.0.0.1' });
        s.on('connect', () => { s.end(); resolve(true); });
        s.on('error', () => resolve(false));
        setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(false); }, 2000);
    });
    if (!portOpen) {return fail(`المثبتة لا تستمع على المنفذ ${CONFIG.DB_PORT} (تأكد من خدمتها وأن DB_PORT يطابقها)`);}
    // 3) المصادقة — كلمة مرور النظام من DB_PASSWORD حصرًا (لا تخمين)
    const sysPassword = process.env.DB_PASSWORD || '';
    if (!sysPassword) {
        // أول تشغيل بلا إعدادات: اكتب قالبًا واضحًا وارفض بهدوء بدل فشل غامض
        const tpl = writeEnvTemplate();
        return fail('DB_PASSWORD فارغ — ضع كلمة مرور postgres للنظام في ملف الإعدادات:\n' + (tpl || process.env.KARIM_ENV_FILE || '%APPDATA%\\karim-erp\\.env'));
    }
    const sysEnv = { ...process.env, PGPASSWORD: sysPassword };
    const auth = await executeCommand(`"${sysPsql}" -h 127.0.0.1 -p ${CONFIG.DB_PORT} -U postgres -d postgres -tAc "SELECT 1"`, { timeout: 10000, ignoreError: true, env: sysEnv });
    if (String(auth || '').trim() !== '1') {
        // تمييز الرفض الأمني عن غياب الخدمة
        return fail('تعذر الدخول للمثبتة — راجع DB_PASSWORD (كلمة مرور postgres للنظام)');
    }
    // 4) ليست محمولتنا متنكرة؟ (نفس المنفذ قد يخدم database/data)
    try {
        const dd = await executeCommand(`"${sysPsql}" -h 127.0.0.1 -p ${CONFIG.DB_PORT} -U postgres -d postgres -tAc "SHOW data_directory"`, { timeout: 10000, ignoreError: true, env: sysEnv });
        const norm = (s) => String(s || '').trim().replace(/\//g, '\\').toLowerCase();
        if (norm(dd) && (norm(dd) === norm(CONFIG.DATA_PATH) || norm(dd) === norm(path.join(CONFIG.APP_PATH, 'database', 'data')))) {
            return fail('المستمع على المنفذ هو المحمولة نفسها');
        }
    } catch (_) {}
    // 5) إنشاء القاعدة إن غابت
    const hasDb = await executeCommand(`"${sysPsql}" -h 127.0.0.1 -p ${CONFIG.DB_PORT} -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='karim_erp'"`, { timeout: 10000, ignoreError: true, env: sysEnv });
    if (!String(hasDb || '').trim()) {
        console.log('[PostgreSQL] Creating karim_erp on the system server...');
        await executeCommand(`"${sysPsql}" -h 127.0.0.1 -p ${CONFIG.DB_PORT} -U postgres -d postgres -c "CREATE DATABASE karim_erp"`, { timeout: 30000, env: sysEnv });
    }
    SYSTEM_DB = { pgCtlPath: sysCtl, password: sysPassword };
    console.log(`[PostgreSQL] Using system PostgreSQL (${sysCtl}) on port ${CONFIG.DB_PORT} — portable will not start.`);
    return true;
}

/**
 * تشغيل خادم PostgreSQL
 */
async function startPostgreSQL() {
    // النظام أولاً (يثبت/ينشئ قاعدته) — المحمولة احتياطي فقط
    if (await trySystemPostgres()) {
        isDbReady = true;
        return true;
    }
    const pgCtlPath = findPgCtl();
    
    if (!pgCtlPath) {
        throw new Error(
            'لم يتم العثور على pg_ctl.exe!\n' +
            'تأكد من وجود ملفات PostgreSQL في مجلد database/bin/'
        );
    }
    
    const dataDir = CONFIG.DATA_PATH;
    
    // Initialize database if needed
    await initializeDatabase(pgCtlPath, dataDir);
    
    // Check if already running
    console.log('[PostgreSQL] Checking server status...');
    const statusResult = await executeCommand(
        `"${pgCtlPath}" status -D "${dataDir}"`,
        { timeout: 10000, ignoreError: true }
    );
    
    if (statusResult.includes('server is running')) {
        console.log('[PostgreSQL] Server is already running.');
        isDbReady = true;
        return true;
    }
    
    // Start PostgreSQL server
    console.log('[PostgreSQL] Starting server...');
    const logFile = path.join(dataDir, 'server.log');
    const { binDir, runtimeEnv } = getPostgresRuntime(pgCtlPath);
    
    return new Promise((resolve, reject) => {
        pgProcess = spawn(pgCtlPath, [
            'start',
            '-D', dataDir,
            '-l', logFile,
            '-w',          // Wait for startup to complete
            '-t', '60',    // Timeout in seconds
            // احترام DB_PORT: لو منفذ 5432 مشغول بخادم PostgreSQL آخر على نفس
            // الجهاز، المحمولة تصعد على المنفذ المطلوب بدل فشل التصادم
            ...(Number(CONFIG.DB_PORT) !== 5432 ? ['-o', `-p ${Number(CONFIG.DB_PORT)}`] : []),
        ], {
            cwd: binDir,
            env: runtimeEnv,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        pgProcess.stdout?.on('data', (d) => stdout += d.toString());
        pgProcess.stderr?.on('data', (d) => stderr += d.toString());
        
        pgProcess.on('close', (code) => {
            if (code === 0) {
                console.log('[PostgreSQL] Server started successfully.');
                isDbReady = true;
                resolve(true);
            } else {
                reject(new Error(`pg_ctl start failed (code ${code}): ${stderr || stdout}`));
            }
        });
        
        pgProcess.on('error', (err) => {
            reject(new Error(`Failed to start PostgreSQL: ${err.message}`));
        });
        
        // Timeout handler (cleared on success so the timer does not stay alive)
        const startupTimeout = setTimeout(() => {
            if (!isDbReady) {
                reject(new Error('PostgreSQL startup timed out after 60 seconds.'));
            }
        }, CONFIG.DB_STARTUP_TIMEOUT);
        startupTimeout.unref?.();
        // جاهزية حقيقية: افحص المنفذ بنفسك — pg_ctl -w قد يفحص منفذًا آخر
        // (config قديم) أو يتأخر في الخروج حتى وهو الخادم يعمل فعلًا
        const portPoll = setInterval(() => {
            if (isDbReady) {clearInterval(portPoll); return;}
            const s = require('net').createConnection({ port: Number(CONFIG.DB_PORT), host: '127.0.0.1' });
            s.on('connect', () => { s.end(); clearInterval(portPoll); clearTimeout(startupTimeout); isDbReady = true; console.log('[PostgreSQL] Server accepted connections.'); resolve(true); });
            s.on('error', () => {});
            setTimeout(() => { try { s.destroy(); } catch (_) {} }, 900);
        }, 1000);
        if (portPoll.unref) {portPoll.unref();}
        pgProcess.on('close', (code) => {
            if (code === 0) {
                clearTimeout(startupTimeout);
                console.log('[PostgreSQL] Server started successfully.');
                isDbReady = true;
                resolve(true);
            } else {
                reject(new Error(`pg_ctl start failed (code ${code}): ${stderr || stdout}`));
            }
        });
    });
}

/**
 * إيقاف PostgreSQL بأمان
 */
async function stopPostgreSQL() {
    const pgCtlPath = findPgCtl();
    if (!pgCtlPath || !isDbReady) {
        console.log('[PostgreSQL] Skipping shutdown (not running or pg_ctl not found).');
        return true;
    }
    
    console.log('[PostgreSQL] Stopping server gracefully...');
    
    try {
        await executeCommand(
            `"${pgCtlPath}" stop -D "${CONFIG.DATA_PATH}" -m fast`,
            { timeout: 30000 }
        );
        console.log('[PostgreSQL] Server stopped successfully.');
        isDbReady = false;
        return true;
    } catch (err) {
        console.error('[PostgreSQL] Error stopping:', err.message);
        // Try immediate mode as fallback
        try {
            await executeCommand(
                `"${pgCtlPath}" stop -D "${CONFIG.DATA_PATH}" -m immediate`,
                { timeout: 15000 }
            );
        } catch (e) {
            console.error('[PostgreSQL] Immediate stop also failed:', e.message);
        }
        return false;
    }
}

async function runPsql(psqlPath, args, env, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(psqlPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`psql failed (${code}): ${stderr || stdout}`)));
    });
}

async function runAutomaticMigrations(pgCtlPath) {
    const { binDir, runtimeEnv } = getPostgresRuntime(pgCtlPath);
    const psqlPath = path.join(binDir, 'psql.exe');
    if (!existsSync(psqlPath)) {throw new Error('ملف psql.exe غير موجود داخل PostgreSQL Portable.');}
    const migrationDirs = [
        path.join(CONFIG.RESOURCE_PATH, 'database', 'migrations'),
        path.join(CONFIG.APP_PATH, 'database', 'migrations'),
    ];
    const migrationsDir = migrationDirs.find(existsSync);
    if (!migrationsDir) {throw new Error('مجلد migrations غير موجود داخل حزمة التطبيق.');}

    const migrationDataDir = path.join(CONFIG.PERSISTENT_PATH, 'database');
    ensureDir(migrationDataDir);
    const lockPath = path.join(migrationDataDir, '.migrations_applied.json');
    let applied = [];
    try { if (existsSync(lockPath)) {applied = JSON.parse(fs.readFileSync(lockPath, 'utf8'));} } catch (_) { applied = []; }

    const dbPassword = activeDbPassword();
    const dbEnv = { ...runtimeEnv, PGPASSWORD: dbPassword };
    const common = ['-h', '127.0.0.1', '-p', String(CONFIG.DB_PORT), '-U', 'postgres'];
    await runPsql(psqlPath, [...common, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', "SELECT 1"], dbEnv, binDir);
    const exists = await runPsql(psqlPath, [...common, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='karim_erp'"], dbEnv, binDir);
    if (!exists.stdout.trim()) {
        await runPsql(psqlPath, [...common, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE karim_erp'], dbEnv, binDir);
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
        .filter(f => f !== '006_demo_seed.sql');
    for (const file of files) {
        if (applied.includes(file)) {continue;}
        console.log(`[Migrations] Applying ${file}`);
        await runPsql(psqlPath, [...common, '-d', 'karim_erp', '-v', 'ON_ERROR_STOP=1', '-f', path.join(migrationsDir, file)], dbEnv, binDir);
        applied.push(file);
        fs.writeFileSync(lockPath, JSON.stringify(applied, null, 2), 'utf8');
    }
    console.log(`[Migrations] Ready: ${applied.length} production migrations applied; demo seed excluded.`);
}

async function runPasswordSecurityBootstrap() {
    const scripts = [
        path.join(CONFIG.APP_PATH, 'scripts', 'migrate-plaintext-passwords.js'),
        path.join(CONFIG.RESOURCE_PATH, 'scripts', 'migrate-plaintext-passwords.js'),
    ];
    const scriptPath = scripts.find(existsSync);
    if (!scriptPath) {throw new Error('سكربت تهيئة كلمات المرور غير موجود داخل حزمة التطبيق.');}

    const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DB_HOST: 'localhost',
        DB_PORT: String(CONFIG.DB_PORT),
        DB_NAME: 'karim_erp',
        DB_USER: 'postgres',
        DB_PASSWORD: activeDbPassword(),
        KARIM_BOOTSTRAP_CREDENTIAL_DIR: CONFIG.PERSISTENT_PATH,
        NODE_ENV: 'production',
    };
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], { cwd: CONFIG.APP_PATH, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let errors = '';
        child.stderr.on('data', chunk => { errors += String(chunk); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`فشل تدوير كلمات المرور (${code}): ${errors.trim()}`)));
    });
    console.log('[Security] Password bootstrap and default-password rotation completed.');
}

async function runScheduledBackup() {
    const pgCtlPath = activePgCtl();
    if (!pgCtlPath) {throw new Error('تعذر العثور على PostgreSQL Portable للنسخ الاحتياطي.');}
    const { binDir } = getPostgresRuntime(pgCtlPath);
    const pgDumpPath = path.join(binDir, 'pg_dump.exe');
    if (!existsSync(pgDumpPath)) {throw new Error('ملف pg_dump.exe غير موجود داخل PostgreSQL Portable.');}
    const candidates = [
        path.join(CONFIG.APP_PATH, 'database', 'scripts', 'backup.js'),
        path.join(CONFIG.RESOURCE_PATH, 'database', 'scripts', 'backup.js'),
    ];
    const scriptPath = candidates.find(existsSync);
    if (!scriptPath) {throw new Error('سكربت النسخ الاحتياطي غير موجود داخل حزمة التطبيق.');}

    ensureDir(CONFIG.BACKUPS_PATH);
    const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DB_HOST: 'localhost', DB_PORT: String(CONFIG.DB_PORT), DB_NAME: 'karim_erp', DB_USER: 'postgres',
        DB_PASSWORD: activeDbPassword(),
        KARIM_BACKUP_DIR: CONFIG.BACKUPS_PATH,
        KARIM_BACKUP_RETENTION: '30',
        KARIM_PG_DUMP_PATH: pgDumpPath,
        NODE_ENV: 'production',
    };
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], { cwd: CONFIG.APP_PATH, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let errors = '';
        child.stderr.on('data', chunk => { errors += String(chunk); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`فشل النسخ الاحتياطي المجدول (${code}): ${errors.trim()}`)));
    });
    console.log('[Backup] Daily scheduled backup completed successfully.');
}

// ─── Express Server Management ────────────────────────────

/**
 * تشغيل سيرفر Express Backend
 */
/**
 * بيئة تشغيل العمليات الفرعية (backend/workers):
 * Node الحقيقي أولًا — require(ESM) (baileys وغيره) مدعوم من Node 20.19+/22.12+
 * بينما Electron 44 يوفّر Node 22 عند غياب Node خارجي. حماية التحميل في server.js
 * تبقي الخادم عاملًا إن تعذر تحميل تكامل اختياري.
 */
function findBackendRuntime() {
    try {
        const where = spawnSync('where', ['node.exe'], { encoding: 'utf-8', timeout: 5000 });
        if (where.status === 0) {
            const first = String(where.stdout || '').trim().split(/\r?\n/)[0].trim();
            if (first && existsSync(first)) {
                console.log(`[Runtime] Backend runtime: ${first}`);
                return first;
            }
        }
    } catch (_) {}
    console.log('[Runtime] Backend runtime: Electron-as-Node (node.exe غير موجود على PATH)');
    return process.execPath;
}

async function startExpressServer() {
    const serverJsPath = path.join(CONFIG.APP_PATH, 'backend', 'server.js');
    
    // Also check production path
    if (!existsSync(serverJsPath)) {
        const altPath = path.join(CONFIG.RESOURCE_PATH, 'backend', 'server.js');
        if (existsSync(altPath)) {
            // Use alternative path
        } else {
            throw new Error('backend/server.js not found!');
        }
    }
    
    const nodeExe = findBackendRuntime();  // Node حقيقي إن وُجد — وإلا إلكترون كـ Node
    const actualServerPath = existsSync(serverJsPath) ? serverJsPath : path.join(CONFIG.RESOURCE_PATH, 'backend', 'server.js');
    
    console.log(`[Server] Starting Express on ${CONFIG.HOST}:${CONFIG.PORT}...`);
    
    return new Promise((resolve, reject) => {
        // Set environment variables for the server.
        // JWT_ACCESS_SECRET is REQUIRED in production — generate a stable
        // per-install secret on first launch and persist it in userData so
        // sessions survive restarts. SKIP_BULLMQ=1 disables the optional
        // Redis-backed ZATCA queue (the SQL queue + polling worker still
        // works without Redis).
                const secretPath = path.join(CONFIG.PERSISTENT_PATH, 'jwt-secrets.json');
        let secrets = { access: '', refresh: '' };
        try {
            if (fs.existsSync(secretPath)) {
                secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
            }
        } catch (_) { /* ignore corrupt file */ }
        if (!secrets.access || secrets.access.length < 32) {
            secrets.access  = crypto.randomBytes(48).toString('hex');
            secrets.refresh = crypto.randomBytes(48).toString('hex');
            try { fs.writeFileSync(secretPath, JSON.stringify(secrets, null, 2), { mode: 0o600 }); }
            catch (_) { /* non-critical */ }
        }

        const env = {
            ...process.env,
            PORT: String(CONFIG.PORT),
            HOST: CONFIG.HOST,
            DB_HOST: 'localhost',
            DB_PORT: String(CONFIG.DB_PORT),
            DB_NAME: 'karim_erp',
            DB_USER: 'postgres',
            // Must match the active DB password: system postgres password in
            // system mode, or the generated portable secret otherwise.
            DB_PASSWORD: activeDbPassword(),
            NODE_ENV: 'production',
            JWT_ACCESS_SECRET:  secrets.access,
            JWT_REFRESH_SECRET: secrets.refresh,
            SKIP_BULLMQ: '1',
            // قناة تحديث أجهزة الشبكة: السيرفر يخدم هذا المجلد على /updates
            KARIM_UPDATES_DIR: path.join(CONFIG.PERSISTENT_PATH, 'updates'),
            KARIM_SERVER_NAME: os.hostname(),
            // process.execPath is the packaged Electron exe — without this flag
            // the server child boots a SECOND full Chromium instance instead of
            // plain Node (wasted RAM/CPU, undefined electron-sensitive behavior)
            ELECTRON_RUN_AS_NODE: '1'
        };
        
        serverProcess = spawn(nodeExe, [actualServerPath], {
            cwd: CONFIG.APP_PATH,
            env: env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        serverProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            
            // Log server output (filtered)
            if (output.includes('listening') || output.includes('ready') || output.includes('started')) {
                console.log(`[Server] ${output.trim()}`);
            }
            
            // Detect server readiness
            if ((output.toLowerCase().includes('listening') || 
                 output.toLowerCase().includes('running')) && !isServerReady) {
                isServerReady = true;
                resolve(true);
            }
        });
        
        serverProcess.stderr?.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            
            // Some libraries use stderr for info
            if (!output.includes('Error') && !output.includes('FATAL')) {
                console.log(`[Server] ${output.trim()}`);
            } else {
                console.error(`[Server ERROR] ${output.trim()}`);
            }
        });
        
        serverProcess.on('close', (code) => {
            if (code !== 0 && code !== null && !isShuttingDown) {
                console.error(`[Server] Unexpected exit with code: ${code}`);
            }
            isServerReady = false;
        });
        
        serverProcess.on('error', (err) => {
            console.error(`[Server] Failed to start: ${err.message}`);
            reject(err);
        });
        
        // Wait for server to be ready by polling
        pollServerReady(resolve, reject);
        
        // Timeout
        setTimeout(() => {
            if (!isServerReady) {
                reject(new Error(`Server startup timed out after ${CONFIG.SERVER_STARTUP_TIMEOUT / 1000} seconds.\nOutput: ${stdout}\nErrors: ${stderr}`));
            }
        }, CONFIG.SERVER_STARTUP_TIMEOUT);
    });
}

/**
 * Polling للتحقق من جاهزية السيرفر
 */
async function pollServerReady(resolve, _reject) {
    const maxAttempts = 30;  // 15 seconds total
    const url = `http://127.0.0.1:${CONFIG.PORT}/api/health`;
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const http = require('http');
            const result = await new Promise((res, rej) => {
                const req = http.get(url, { timeout: 2000 }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => res({ status: response.statusCode, data }));
                }).on('error', rej);
                req.setTimeout(2000, () => { req.destroy(); rej(new Error('timeout')); });
            });
            
            if (result.status === 200 || result.status === 503) {  // 503 means server is running but maybe DB not ready
                if (!isServerReady) {
                    console.log('[Server] Health check passed, server is ready!');
                    isServerReady = true;
                    resolve(true);
                }
                return;
            }
        } catch {
            // Not ready yet
        }
        
        await sleep(500);
    }
}

/**
 * إيقاف السيرفر بأمان
 */
async function stopExpressServer() {
    if (!serverProcess || !isServerReady) {
        console.log('[Server] Skipping shutdown (not running).');
        return true;
    }
    
    console.log('[Server] Stopping gracefully...');
    
    return new Promise((resolve) => {
        // Send SIGTERM for graceful shutdown
        let forceTimeout = null;
        
        const onExit = (code) => {
            clearTimeout(forceTimeout);
            console.log(`[Server] Stopped (code: ${code}).`);
            isServerReady = false;
            resolve(true);
        };
        
        serverProcess.once('exit', onExit);
        
        // First try graceful shutdown
        try {
            serverProcess.kill('SIGTERM');
        } catch (_e) {
            // Process might already be dead
            isServerReady = false;
            resolve(true);
            return;
        }
        
        // Force kill after timeout
        forceTimeout = setTimeout(() => {
            console.log('[Server] Force killing...');
            try {
                serverProcess.kill('SIGKILL');
            } catch (_e) { /* already dead */ }
            isServerReady = false;
            resolve(false);
        }, 10000);  // 10 seconds for graceful shutdown
    });
}

// ─── Command Execution Helper ─────────────────────────────

/**
 * تنفيذ أمر خارجي مع Promise
 */
function executeCommand(command, options = {}) {
    const { timeout = 30000, ignoreError = false, env = undefined } = options;

    return new Promise((resolve, reject) => {
        exec(command, {
            encoding: 'utf-8',
            timeout,
            windowsHide: true,
            maxBuffer: 1024 * 512,
            ...(env ? { env } : {}),
        }, (error, stdout, _stderr) => {
            if (error && !ignoreError) {
                reject(error);
            } else {
                resolve(stdout || '');
            }
        });
    });
}

// ─── Window Management ────────────────────────────────────

/**
 * إنشاء النافذة الرئيسية
 */
function createMainWindow() {
    console.log('[Window] Creating main window...');
    
    mainWindow = new BrowserWindow({
        width: CONFIG.WINDOW_WIDTH,
        height: CONFIG.WINDOW_HEIGHT,
        minWidth: CONFIG.MIN_WIDTH,
        minHeight: CONFIG.MIN_HEIGHT,
        title: 'مطاعم الشرفه العالمي - نظام إدارة المطاعم',
        icon: getAppIcon(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true  // Enable web security for production
        },
        show: false,  // Show when ready to prevent flash
        backgroundColor: '#1a1a2e'
    });
    
    // Load the frontend
    const indexPath = `http://127.0.0.1:${CONFIG.PORT}/app/index.html`;
    
    mainWindow.loadURL(indexPath);
    
    // Cold start: the window loads BEFORE startAllServices() finishes booting
    // PostgreSQL + Express + migrations (up to ~3 minutes on FIRST run — initdb
    // + 60+ migrations). 200 × 1.5s = 5 دقائق صبر كافٍ لأول تشغيل حقيقي.
    let loadRetryCount = 0;
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, isMainFrame) => {
        if (!isMainFrame) {return;}
        if (errorCode === -3) {return;} // ERR_ABORTED — intentional navigation, not a failure
        if (loadRetryCount >= 200) {return;}
        loadRetryCount++;
        console.log(`[Window] Backend not ready yet (${errorDescription}) — retry ${loadRetryCount}/200 in 1.5s`);
        setTimeout(() => { try { mainWindow.loadURL(indexPath); } catch (_) {} }, 1500);
    });
    
    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        console.log('[Window] Showing main window.');
        mainWindow.show();
        
        // Focus window
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    });
    
    // Handle navigation (restrict to our server only)
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const allowedOrigin = `http://127.0.0.1:${CONFIG.PORT}`;
        const allowedAlt = `http://localhost:${CONFIG.PORT}`;
        
        if (!url.startsWith(allowedOrigin) && !url.startsWith(allowedAlt)) {
            event.preventDefault();
            
            // Open external links in default browser
            require('electron').shell.openExternal(url).catch(() => {});
        }
    });
    
    // Handle new window creation
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Open external links in default browser
        require('electron').shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
    });
    
    // Handle window close
    mainWindow.on('close', (event) => {
        if (!isShuttingDown && tray) {
            // Minimize to tray instead of closing
            event.preventDefault();
            mainWindow.hide();
            
            // Show notification that app is still running
            if (Notification.isSupported()) {
                new Notification({
                    title: CONFIG.APP_NAME,
                    body: 'التطبيق يعمل في الخلفية. انقر على الأيقونة في شريط المهام لإظهاره.',
                    silent: true
                }).show().catch(() => {});
            }
        }
    });
    
    // Handle closed (after forced close)
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    // DevTools in development
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_ELECTRON) {
        mainWindow.webContents.openDevTools();
    }
    
    return mainWindow;
}

/**
 * الحصول على أيقونة التطبيق
 */
function getAppIcon() {
    const iconPaths = [
        path.join(__dirname, '..', 'build', 'icon.ico'),
        path.join(__dirname, '..', 'build', 'icon.png'),
        path.join(CONFIG.RESOURCE_PATH, 'build', 'icon.ico'),
    ];
    
    for (const iconPath of iconPaths) {
        if (existsSync(iconPath)) {
            return iconPath;
        }
    }
    
    return undefined;  // Use default icon
}

// ─── System Tray ──────────────────────────────────────────

/**
 * إنشاء أيقونة شريط المهام
 */
function createTray() {
    // Create icon (use simple canvas-generated or default)
    let trayIcon = null;
    
    // Try to load icon from file
    const iconPath = getAppIcon();
    if (iconPath) {
        try {
            trayIcon = nativeImage.createFromPath(iconPath);
            if (trayIcon.isEmpty()) {trayIcon = null;}
        } catch (_e) {
            trayIcon = null;
        }
    }
    
    // Fallback: create a simple colored icon
    if (!trayIcon) {
        const size = 16 * (require('electron').screen.getPrimaryDisplay().scaleFactor || 1);
        trayIcon = nativeImage.createFromBuffer(createSimpleIcon(size));
    }
    
    tray = new Tray(trayIcon);
    tray.setToolTip(CONFIG.TRAY_TOOLTIP);
    
    // Context menu
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'إظهار النافذة',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            enabled: false,
            label: `الخادم: ${isServerReady ? 'يعمل ✓' : 'لا يعمل ✗'}`
        },
        {
            label: `قاعدة البيانات: ${isDbReady ? 'تعمل ✓' : 'لا تعمل ✗'}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'فتح في المتصفح',
            click: () => {
                const url = `http://127.0.0.1:${CONFIG.PORT}/app/index.html`;
                require('electron').shell.openExternal(url).catch(() => {});
            }
        },
        {
            label: 'عرض عنوان IP',
            click: () => showIpAddressDialog()
        },
        {
            label: 'نسخ رابط أجهزة الشبكة',
            click: () => {
                const scheme = (process.env.SSL_KEY && process.env.SSL_CERT) ? 'https' : 'http';
                const primary = getLocalIpAddresses().primary || '127.0.0.1';
                const url = `${scheme}://${primary}:${CONFIG.PORT}`;
                try { require('electron').clipboard.writeText(url); } catch (_) {}
                dialog.showMessageBox(mainWindow, {
                    type: 'info', title: 'رابط أجهزة الشبكة',
                    message: `رابط الوصول من أجهزة الشبكة:\n${url}\n\nتم نسخه للحافظة. أجهزة العميل (EXE) تكتشفه تلقائيًا أيضًا.`
                }).catch(() => {});
            }
        },
        {
            label: 'مجلد تحديثات الأجهزة (updates)',
            click: () => {
                const dir = path.join(CONFIG.PERSISTENT_PATH, 'updates');
                ensureDir(dir);
                require('electron').shell.openPath(dir).catch(() => {});
            }
        },
        { type: 'separator' },
        {
            label: 'إعادة تشغيل الخادم',
            click: async () => {
                await restartServer();
            }
        },
        { type: 'separator' },
        {
            label: 'خروج',
            click: () => forceQuitApp()
        }
    ]);
    
    tray.setContextMenu(contextMenu);
    
    // Double-click to show window
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

/**
 * تحديث قائمة Tray بحالة جديدة
 */
function updateTrayMenu() {
    if (!tray) {return;}
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'إظهار النافذة',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: `الخادم: ${isServerReady ? 'يعمل ✓' : 'لا يعمل ✗'}`,
            enabled: false
        },
        {
            label: `PostgreSQL: ${isDbReady ? 'تعمل ✓' : 'لا تعمل ✗'}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'فتح في المتصفح',
            click: () => {
                require('electron').shell.openExternal(`http://127.0.0.1:${CONFIG.PORT}/app/index.html`).catch(() => {});
            }
        },
        {
            label: 'عرض عنوان IP',
            click: () => showIpAddressDialog()
        },
        {
            label: 'نسخ رابط أجهزة الشبكة',
            click: () => {
                const scheme = (process.env.SSL_KEY && process.env.SSL_CERT) ? 'https' : 'http';
                const primary = getLocalIpAddresses().primary || '127.0.0.1';
                const url = `${scheme}://${primary}:${CONFIG.PORT}`;
                try { require('electron').clipboard.writeText(url); } catch (_) {}
                dialog.showMessageBox(mainWindow, {
                    type: 'info', title: 'رابط أجهزة الشبكة',
                    message: `رابط الوصول من أجهزة الشبكة:\n${url}\n\nتم نسخه للحافظة. أجهزة العميل (EXE) تكتشفه تلقائيًا أيضًا.`
                }).catch(() => {});
            }
        },
        {
            label: 'مجلد تحديثات الأجهزة (updates)',
            click: () => {
                const dir = path.join(CONFIG.PERSISTENT_PATH, 'updates');
                ensureDir(dir);
                require('electron').shell.openPath(dir).catch(() => {});
            }
        },
        { type: 'separator' },
        {
            label: 'إعادة تشغيل الخادم',
            click: async () => restartServer()
        },
        { type: 'separator' },
        {
            label: 'خروج',
            click: () => forceQuitApp()
        }
    ]);
    
    tray.setContextMenu(contextMenu);
}

/**
 * عرض عنوان IP في نافذة حوار
 */
function showIpAddressDialog() {
    const addresses = getLocalIpAddresses();
    
    let message = `عناوين IP المتاحة:\n\n`;
    message += `📍 المحلي: http://localhost:${CONFIG.PORT}\n\n`;
    message += `🌐 الشبكة المحلية:\n`;
    
    addresses.lan.forEach(({ interface: iface, address }) => {
        message += `   • ${iface}: http://${address}:${CONFIG.PORT}\n`;
    });
    
    message += `\nاستخدم عنوان الشبكة للوصول من أجهزة أخرى!`;
    
    dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        title: 'عناوين الاتصال - مطاعم الشرفه العالمي',
        message: message,
        detail: `المنفذ المفتوح: ${CONFIG.PORT}\nيمكن لأجهزة الشبكة الوصول عبر HTTP.`,
        buttons: ['نسخ عنوان الشبكة', 'إغلاق'],
        defaultId: 0,
        cancelId: 1
    }).then(({ response }) => {
        if (response === 0 && addresses.primary) {
            require('electron').clipboard.writeText(`http://${addresses.primary}:${CONFIG.PORT}`);
        }
    }).catch(() => {});
}

// ─── Simple Icon Generator (fallback) ─────────────────────

/**
 * إنشاء أيقونة بسيطة (PNG buffer) كـ fallback
 */
function createSimpleIcon(_size = 16) {
    // Simple 16x16 green circle icon (minimal PNG)
    // This is a valid minimal PNG with a green filled circle
    const pngData = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlz' +
        'AAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADCSURBVDi' +
        'NrZMxCsJQEEXfgiKlIWqQVoiUWESsKFwiRsRIVsJQsK1YWIuRGREIkgRgIZbKyAUIrJ+QGcdw9v/fOK' +
        'GC/ZN2HkGEY/IAzjKOII8j4H8K4zxH+Acx7COEcxiCHEcxzAfAcxzCCMcxBnMMwx3C+MYwj2MMMxDHO' +
        'IZxzCMUcxjnMIxRzCOMcxBnMIxxzC+MYwj2MMMxDHOIZxzCMUcxjnMIxRzCOMcxBnMIxxzC+MYwj2MM' +
        'MxDHOIZxzCMUcxjnMIxRzCOMcxBnMIxxzC+MYwj2MMMxDHOIZxzCMUcxjnMIxRzCOMcxBnMIxxzC+MYw' +
        'j2MMMxDHOIZxzCMUcxjnMIxRzCOMcxBnMIxxzC+MYwj2P8BzHcI4RzGEIcxxHMARzngPwDnOIJ5zzCe' +
        'gTUMp6yI2AAAAAElFTkSuQmCC',
        'base64'
    );
    return pngData;
}

// ─── IPC Handlers ─────────────────────────────────────────

/**
 * تسجيل معالجات IPC للتواصل مع Renderer
 */
function registerIpcHandlers() {
    // Get system status
    ipcMain.handle('app:get-status', () => ({
        serverRunning: isServerReady,
        dbRunning: isDbReady,
        port: CONFIG.PORT,
        host: CONFIG.HOST,
        ipAddresses: getLocalIpAddresses()
    }));
    
    // Restart server
    ipcMain.handle('app:restart-server', async () => {
        return restartServer();
    });
    
    // Get app info
    ipcMain.handle('app:get-info', () => ({
        version: app.getVersion(),
        name: CONFIG.APP_NAME,
        platform: process.platform,
        arch: process.arch
    }));
    
    // Open external URL
    ipcMain.handle('app:open-external', async (event, url) => {
        // Only http(s) — a compromised renderer must not open file:// or
        // arbitrary schemes on the host
        try {
            const parsed = new URL(String(url || ''));
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {return;}
            require('electron').shell.openExternal(parsed.toString()).catch(() => {});
        } catch (_) { /* invalid URL — ignore */ }
    });
    
    // Show IP dialog
    ipcMain.handle('app:show-ip-dialog', () => {
        showIpAddressDialog();
    });
}

// ─── Lifecycle Management ─────────────────────────────────

function probeExistingLocalService(timeoutMs = 1800) {
    return new Promise((resolve) => {
        const request = http.get({ host: '127.0.0.1', port: Number(CONFIG.PORT), path: '/api/health', timeout: timeoutMs }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try {
                    const health = JSON.parse(body);
                    resolve(response.statusCode === 200 && health?.status === 'ok');
                } catch (_) {
                    resolve(false);
                }
            });
        });
        request.once('timeout', () => { request.destroy(); resolve(false); });
        request.once('error', () => resolve(false));
    });
}

function isWindowsServiceInstalled() {
    if (process.platform !== 'win32') {return Promise.resolve(false);}
    return new Promise((resolve) => {
        const child = spawn('sc.exe', ['query', WINDOWS_SERVICE_NAME], { windowsHide: true });
        child.once('error', () => resolve(false));
        child.once('close', (code) => resolve(code === 0));
    });
}

async function waitForWindowsServiceHealth(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probeExistingLocalService(1500)) {return true;}
        await sleep(1000);
    }
    return false;
}

/**
 * بدء جميع الخدمات
 */
async function startAllServices() {
    console.log('\n========================================');
    console.log('  🚀 karim ERP 🦅 - Starting Services');
    console.log('========================================\n');
    
    try {
        // Step 1: Start PostgreSQL
        console.log('📦 Step 1/2: Starting PostgreSQL...');
        await startPostgreSQL();
        console.log('✅ PostgreSQL ready!\n');
        
        // Small delay to ensure PostgreSQL accepts connections
        await sleep(1000);
        
        // Step 2: Apply production migrations before starting Express.
        console.log('🧱 Step 2/4: Applying production migrations...');
        await runAutomaticMigrations(activePgCtl());
        console.log('✅ Production migrations ready!\n');

        // Step 3: Rotate insecure bootstrap credentials before any API accepts logins.
        console.log('🔐 Step 3/4: Hardening administrator credentials...');
        await runPasswordSecurityBootstrap();
        console.log('✅ Authentication bootstrap ready!\n');

        // Step 4: Start Express Server
        console.log('⚙️  Step 4/4: Starting Express Server...');
        // Pre-flight: المنفذ مأخوذ؟ (غالبًا نسخة إنتاجية شغالة على نفس الجهاز) —
        // رسالة واضحة أفضل من فشل bind غامض بعد تشغيل الخدمات
        const portBusy = await new Promise((resolve) => {
            const s = require('net').createConnection({ port: Number(CONFIG.PORT), host: '127.0.0.1' });
            s.on('connect', () => { s.end(); resolve(true); });
            s.on('error', () => resolve(false));
            setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(false); }, 1500);
        });
        if (portBusy) {
            throw new Error(
                `المنفذ ${CONFIG.PORT} مستخدم من عملية أخرى على هذا الجهاز (غالبًا نسخة أخرى من النظام لا تزال تعمل).\n\n` +
                `الحل:\n1) أوقف النسخة الأخرى، أو\n2) غيّر PORT في ملف الإعدادات (${KARIM_ENV_FILE || path.join(CONFIG.PERSISTENT_PATH, '.env')}) ثم أعد فتح التطبيق.`);
        }
        await startExpressServer();
        console.log('✅ Express Server ready!\n');
        
            // Update tray menu only for the interactive desktop process.
        if (!IS_SERVICE_MODE) {updateTrayMenu();}
        
        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('services:ready', {
                db: true,
                server: true,
                url: `http://${getLocalIpAddresses().primary || 'localhost'}:${CONFIG.PORT}`
            });
        }
        
        console.log('========================================');
        console.log('  ✅ All services started successfully!');
        console.log('========================================\n');
        
        return true;
    } catch (error) {
        console.error('❌ Failed to start services:', error);
        
        // Show error dialog
        if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showErrorBox(
                'خطأ في بدء التشغيل',
                `تعذر تشغيل أحد الخدمات:\n\n${error.message}\n\nيرجى التحقق من:\n1. وجود ملفات PostgreSQL في database/bin/\n2. عدم وجود عملية أخرى تستخدم المنفذ ${CONFIG.PORT}`
            );
        }
        
        return false;
    }
}

/**
 * إعادة تشغيل السيرفر
 */
async function restartServer() {
    if (attachedToWindowsService) {
        console.warn('[Client] Restart blocked: the Windows service owns the server lifecycle.');
        return false;
    }
    console.log('[System] Restarting server...');
    
    try {
        // Stop current server
        await stopExpressServer();
        await sleep(2000);
        
        // Start again
        await startExpressServer();
        updateTrayMenu();
        
        // Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('server:restarted');
        }
        
        return true;
    } catch (error) {
        console.error('[System] Restart failed:', error);
        dialog.showErrorBox('خطأ في إعادة التشغيل', error.message);
        return false;
    }
}

/**
 * إيقاف جميع الخدمات بأمان (Graceful Shutdown)
 */
async function shutdownAllServices() {
    if (attachedToWindowsService) {
        console.log('[Client] Closing UI only; the Windows service remains running.');
        return { server: true, db: true, attached: true };
    }
    if (isShuttingDown) {return;}
    isShuttingDown = true;
    
    console.log('\n========================================');
    console.log('  🛑  Shutting down services safely...');
    console.log('========================================\n');
    
    const results = { server: false, db: false };
    
    // Step 1: Stop Express Server (with timeout)
    console.log('⚙️  Stopping Express Server...');
    try {
        results.server = await Promise.race([
            stopExpressServer(),
            new Promise(resolve => setTimeout(() => resolve(false), 15000))
        ]);
        console.log(results.server ? '✅ Server stopped.' : '⚠️  Server stop issue.');
    } catch (e) {
        console.error('❌ Server error:', e.message);
    }
    
    // Small delay between services
    await sleep(1000);
    
    // Step 2: Stop PostgreSQL
    console.log('📦 Stopping PostgreSQL...');
    try {
        results.db = await Promise.race([
            stopPostgreSQL(),
            new Promise(resolve => setTimeout(() => resolve(false), 20000))
        ]);
        console.log(results.db ? '✅ PostgreSQL stopped.' : '⚠️  PostgreSQL stop issue.');
    } catch (e) {
        console.error('❌ Database error:', e.message);
    }
    
    console.log('\n========================================');
    console.log('  Shutdown complete.');
    console.log(`  Server: ${results.server ? '✓' : '✗'}`);
    console.log(`  Database: ${results.db ? '✓' : '✗'}`);
    console.log('========================================\n');
    
    return results;
}

/**
 * خروج قسري من التطبيق
 */
async function forceQuitApp() {
    console.log('[System] Force quit requested.');
    if (attachedToWindowsService) {
        app.quit();
        return;
    }
    
    await shutdownAllServices();
    
    // Force cleanup
    try { serverProcess?.kill('SIGKILL'); } catch {}
    try { pgProcess?.kill('SIGKILL'); } catch {}
    
    app.quit();
}

// ─── Auto-Updater Setup ─────────────────────────────────────
/**
 * سياسة التوقيع: prefer (افتراضي) | required | off
 * والبيانات منKARIM_UPDATE_EXPECTED_PUBLISHER (CN المتوقع للمُوقِّع).
 */
const UPDATE_SIGNATURE_MODE = process.env.KARIM_UPDATE_SIGNATURE_MODE || 'prefer';
const UPDATE_EXPECTED_PUBLISHER = process.env.KARIM_UPDATE_EXPECTED_PUBLISHER || '';

/** يستخرج مسار الملف المُنزَّل من حدث electron-updater. */
function downloadedFilePath(info) {
    if (!info) {return '';}
    if (info.downloadedFile) {return String(info.downloadedFile);}
    const files = Array.isArray(info.files) ? info.files : [];
    for (const f of files) {
        if (f && f.path) {return String(f.path);}
    }
    return '';
}

/**
 * يفحص توقيع Authenticode للملف المُنزَّل (ويندوز فقط).
 * نمرّر المسار عبر متغير بيئة بدل插入ه في نص الأمر ⇒ لا حقن أوامر.
 * @returns {{status:string, signerSubject:string}}
 */
function readAuthenticodeSignature(filePath) {
    if (process.platform !== 'win32') {
        return { status: 'Unsupported', signerSubject: '' };
    }
    if (!filePath || !fs.existsSync(filePath)) {
        return { status: 'Unknown', signerSubject: '' };
    }
    const ps = 'Get-AuthenticodeSignature -LiteralPath $env:KARIM_SIGNATURE_TARGET | ' +
        'Select-Object Status,@{n=\'Subject\';e={if($_.SignerCertificate){$_.SignerCertificate.Subject}else{""}}} | ' +
        'ConvertTo-Json -Compress';
    try {
        const out = execFileSync('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
            {
                encoding: 'utf8', timeout: 20000, windowsHide: true,
                env: { ...process.env, KARIM_SIGNATURE_TARGET: filePath },
            });
        const parsed = JSON.parse(String(out || '').trim() || '{}');
        const status = parsed && parsed.Status ? String(parsed.Status) : 'Unknown';
        const subject = parsed && parsed.Subject ? String(parsed.Subject) : '';
        return { status, signerSubject: subject };
    } catch (e) {
        console.warn('[AutoUpdate] signature check failed:', e.message);
        return { status: 'Error', signerSubject: '' };
    }
}

/**
 * البوابة الكاملة: تفحص ثم تقرر (ترجع قرار التثبيت).
 */
function verifyDownloadedUpdate(info) {
    const { decideUpdateInstall } = require('./update-signature-policy');
    const filePath = downloadedFilePath(info);
    if (!filePath) {
        // لا مسار ⇒ لا فحص ممكن (لا نمنع: نفس سلوك اليوم)
        return decideUpdateInstall({ status: 'Unknown', mode: UPDATE_SIGNATURE_MODE });
    }
    const sig = readAuthenticodeSignature(filePath);
    return decideUpdateInstall({
        status: sig.status,
        signerSubject: sig.signerSubject,
        mode: UPDATE_SIGNATURE_MODE,
        expectedPublisher: UPDATE_EXPECTED_PUBLISHER,
    });
}

/**
 * توصيل أحداث التحديث (مشترك بين وضعي السيرفر والعميل)
 */
function wireAutoUpdaterEvents() {
    if (!autoUpdater) {return;}

    autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdate] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdate] Update available:', info.version);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', info);
        }
        // Show notification
        if (Notification.isSupported()) {
            new Notification({
                title: 'تحديث متاح',
                body: `إصدار جديد ${info.version} جاهز للتحميل`,
                silent: false
            }).show();
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('[AutoUpdate] No updates available:', info.version);
    });

    autoUpdater.on('error', (err) => {
        console.error('[AutoUpdate] Error:', err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(1);
        console.log(`[AutoUpdate] Downloading: ${percent}% (${speed} MB/s)`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-download-progress', { percent, speed });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdate] Update downloaded:', info.version);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-downloaded', info);
        }
        // ─── حارس التوقيع: لا تثبيت قبل التحقق ───
        // التحديثات غير موقّعة اليوم ⇒ لا نمنع التحديث (يكسر التحديثات)،
        // لكننا نرفض العبث (HashMismatch/NotTrusted) ونمنعPublisher المزيّف،
        // ونمنع التثبيت الصامت عند الرفض (autoInstallOnAppQuit=false).
        const gate = verifyDownloadedUpdate(info);
        if (!gate.allow) {
            console.error('[AutoUpdate] BLOCKED:', gate.code, '-', gate.reason);
            if (autoUpdater) {autoUpdater.autoInstallOnAppQuit = false;}
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'تعذّر تثبيت التحديث',
                message: `تم رفض تحديث الإصدار ${info.version} لأسباب أمنية.`,
                detail: `${gate.reason}\n\n(رمز: ${gate.code})`,
                buttons: ['حسنًا'],
                defaultId: 0
            }).catch(() => {});
            return;
        }
        if (gate.action === 'warn') {
            console.warn('[AutoUpdate] WARNING:', gate.code, '-', gate.reason);
        }
        // Ask user to restart
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'تم تحميل التحديث',
            message: `تم تحميل الإصدار ${info.version}. هل تريد إعادة التشغيل الآن لتطبيق التحديث؟`,
            buttons: ['إعادة تشغيل الآن', 'لاحقاً'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall(true, true);
            }
        });
    });
}

/**
 * وضع العميل: التحديث من السيرفر نفسه عبر الشبكة (provider: generic)
 * المسار: {SERVER}/updates/latest.yml — السيرفر يخدم مجلد updates الثابت.
 * شهادة mkcert: إن وُجدت شهادة CA مرفقة مع التطبيق تُضاف للثقة عبر
 * NODE_EXTRA_CA_CERTS قبل أول اتصال TLS — وإلا فشل الفحص يُسجل فقط.
 */
function setupClientLanUpdater() {
    if (!autoUpdater) {return;}
    try {
        const caPath = path.join(process.resourcesPath || CONFIG.APP_PATH, 'Karim-Local-CA.crt');
        if (existsSync(caPath)) {
            process.env.NODE_EXTRA_CA_CERTS = caPath;
            console.log('[AutoUpdate] LAN updates — CA trusted:', caPath);
        }
    } catch (_) {}
    wireAutoUpdaterEvents();
    autoUpdater.setFeedURL({
        provider: 'generic',
        url: RESOLVED_SERVER_URL.replace(/\/+$/, '') + '/updates',
        useMultipleRangeRequest: false,
    });
    const check = () => autoUpdater.checkForUpdates().catch((e) => {
        console.warn('[AutoUpdate] LAN check failed (السيرفر بلا latest.yml بعد؟):', e.message);
    });
    setTimeout(check, 20000);
    const timer = setInterval(check, 10 * 60 * 1000);
    if (timer.unref) {timer.unref();}
}

/**
 * تكوين التحديث التلقائي عبر GitHub Releases (وضع السيرفر/المكتبي)
 * يتطلب: electron-updater + electron-log + إصدار موقع
 */
function setupAutoUpdater() {
    if (!autoUpdater) {return;}

    wireAutoUpdaterEvents();
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'karim-erp',
        repo: 'karim-desktop',
        private: false,
        releaseType: 'release'
    });

    // Check for updates on startup (after 30 seconds)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => {
            console.warn('[AutoUpdate] Initial check failed:', err.message);
        });
    }, 30000);

    // Check for updates every 4 hours
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(err => {
            console.warn('[AutoUpdate] Periodic check failed:', err.message);
        });
    }, 4 * 60 * 60 * 1000);
}

// ─── Application Events ───────────────────────────────────

/**
 * عندما يكون التطبيق جاهزاً
 */
// ─── وضع العميل: ثقة مقيدة بشهادة السيرفر المضبوط فقط (العقد §36 — مرحلة انتقالية) ───
// التفضيل الدائم: تثبيت Karim-Local-CA.crt على الجهاز (مسار الرابط /app/Karim-Local-CA.crt).
// هذا المعالج شبكة أمان فقط: يقبل خطأ UNTRUSTED_AUTHORITY لمضيف السيرفر المضبوط حصرًا،
// وأي شهادة/مضيف آخر يُرفض — لا تخفٍّ عام أبدًا. المضيف يُحدَّث بعد الاكتشاف التلقائي.
let RESOLVED_SERVER_URL = CLIENT_TARGET ? CLIENT_TARGET.url : null;
let CLIENT_ALLOWED_HOST = null;
if (IS_CLIENT_MODE) {
    try { CLIENT_ALLOWED_HOST = CLIENT_TARGET ? new URL(CLIENT_TARGET.url).host : null; } catch (_) {}
    app.on('certificate-error', (event, webContents, urlString, error, certificate, callback) => {
        let host = null;
        try { host = new URL(urlString).host; } catch (_) {}
        if (host && host === CLIENT_ALLOWED_HOST && error === 'UNTRUSTED_AUTHORITY'
            && /mkcert|karim|shorfa/i.test(String(certificate.issuerName || ''))) {
            event.preventDefault();
            callback(true);
            return;
        }
        callback(false);
    });
    console.log(`[Client] وضع العميل النحيف — ${CLIENT_TARGET ? 'السيرفر: ' + CLIENT_TARGET.url + ' (المصدر: ' + CLIENT_TARGET.source + ')' : 'اكتشاف تلقائي للسيرفر على الشبكة (UDP)'}`);
}

// ─── اكتشاف السيرفر على الشبكة (وضع client-mode.json) ───
const lanDiscovery = require('../common/lan-discovery');

/** فحص خادم مرشَّح: GET /api/server/info — يقبل فقط إجابة karim-erp حقيقية */
function probeServerInfo(url) {
    return new Promise((resolve) => {
        try {
            const u = new URL(String(url).replace(/\/+$/, '') + '/api/server/info');
            const mod = u.protocol === 'https:' ? require('https') : require('http');
            const req = mod.get({
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname,
                timeout: 2500,
                rejectUnauthorized: false, // التحقق الحقيقي عبر محتوى الإجابة + معالج الشهادات أعلاه
            }, (res) => {
                let body = '';
                res.on('data', (d) => { body += d; if (body.length > 4096) {res.destroy();} });
                res.on('end', () => {
                    try {
                        const info = JSON.parse(body);
                        resolve(info && info.app === 'karim-erp' ? info : null);
                    } catch (_) { resolve(null); }
                });
            });
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.on('error', () => resolve(null));
        } catch (_) { resolve(null); }
    });
}

/** كاش آخر سيرفر مكتشَف — يُستخدم فقط لو فشل البث الحي (إعادة إقلاع أسرع) */
function discoveredCachePath() {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'karim-erp', 'discovered-server.json');
}
function readDiscoveredCache() {
    try {
        const raw = JSON.parse(fs.readFileSync(discoveredCachePath(), 'utf8'));
        const url = String(raw.serverUrl || '').trim().replace(/\/+$/, '');
        return /^https?:\/\/.+/.test(url) ? url : null;
    } catch (_) { return null; }
}

/** جولة اكتشاف: استماع UDP + تحقق HTTP لكل مرشح — يثبت الناجح في الكاش */
async function discoverServerUrlOnce(listenMs = 4000) {
    const candidates = await lanDiscovery.discoverServers({ listenMs });
    for (const c of candidates) {
        const info = await probeServerInfo(c.url);
        if (info) {
            try {
                ensureDir(path.dirname(discoveredCachePath()));
                fs.writeFileSync(discoveredCachePath(), JSON.stringify({
                    serverUrl: c.url, name: info.serverName || c.name,
                    version: info.version, at: new Date().toISOString(),
                }, null, 2));
            } catch (_) {}
            return c.url;
        }
    }
    return null;
}

/** نافذة «جارٍ البحث عن الخادم» — تُستبدل بواجهة السيرفر فور العثور عليه */
function createSearchWindow() {
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>Karim ERP — جارٍ البحث عن الخادم</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#1a1a2e;color:#e6e6f0;font-family:'Segoe UI',Tahoma,sans-serif;text-align:center}
.box{max-width:520px;padding:40px}.logo{font-size:52px;margin-bottom:12px}
h1{font-size:22px;font-weight:600;margin:0 0 10px}p{color:#9a9ab8;font-size:14px;line-height:1.8;margin:0}
.dots::after{content:'';animation:dots 1.2s steps(4) infinite}@keyframes dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
.spin{display:inline-block;width:34px;height:34px;border:3px solid #3d3d5c;border-top-color:#6c5ce7;border-radius:50%;animation:sp 1s linear infinite;margin-bottom:22px}
@keyframes sp{to{transform:rotate(360deg)}}</style></head>
<body><div class="box"><div class="spin"></div><div class="logo">🍽️</div>
<h1>جارٍ البحث عن خادم Karim ERP<span class="dots"></span></h1>
<p>تأكد أن جهاز الخادم يعمل ومتصل بنفس الشبكة.<br>سيتم الاتصال تلقائيًا فور العثور عليه.</p></div></body></html>`;
    const win = new BrowserWindow({
        width: 640, height: 440,
        title: 'Karim ERP — جارٍ البحث عن الخادم',
        icon: getAppIcon(),
        webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true },
        show: false,
        backgroundColor: '#1a1a2e',
    });
    win.setMenuBarVisibility(false);
    win.once('ready-to-show', () => win.show());
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return win;
}

/** نافذة العميل النحيف — تعرض واجهة السيرفر المركزي فقط */
function createClientWindow() {
    mainWindow = new BrowserWindow({
        width: CONFIG.WINDOW_WIDTH,
        height: CONFIG.WINDOW_HEIGHT,
        minWidth: CONFIG.MIN_WIDTH,
        minHeight: CONFIG.MIN_HEIGHT,
        title: 'مطاعم الشرفه العالمي — عميل الشبكة',
        icon: getAppIcon(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
        },
        show: false,
        backgroundColor: '#1a1a2e',
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(RESOLVED_SERVER_URL);
    // السيرفر غير جاهز/غير متاح → إعادة محاولة لطيفة بدل صفحة خطأ ميتة
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {return;}
        mainWindow.__clientRetries = (mainWindow.__clientRetries || 0) + 1;
        if (mainWindow.__clientRetries > 30) {return;}
        console.log(`[Client] السيرفر غير متاح (${errorDescription}) — إعادة ${mainWindow.__clientRetries}/30 بعد 2 ث`);
        setTimeout(() => { try { mainWindow.loadURL(RESOLVED_SERVER_URL); } catch (_) {} }, 2000);
    });
    mainWindow.once('ready-to-show', () => { mainWindow.show(); });
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
    console.log('[App] Electron ready. Initializing...');

    // ── وضع العميل النحيف: واجهة السيرفر المركزي فقط — لا خدمات ولا قاعدة بيانات ──
    if (IS_CLIENT_MODE) {
        // عنوان صريح من server-target.json؟ يستخدم فورًا. وإلا: اكتشاف UDP تلقائي.
        if (!RESOLVED_SERVER_URL) {
            const searchWin = createSearchWindow();
            let found = null;
            // حتى 90 جولة × 4 ثوانٍ = ~6 دقائق؛ بين الجولات يُجرَّب الكاش (إقلاع أسرع)
            for (let attempt = 1; attempt <= 90 && !found; attempt++) {
                found = await discoverServerUrlOnce(4000)
                    || (attempt % 3 === 0 ? await (async () => { const c = readDiscoveredCache(); return (c && await probeServerInfo(c)) ? c : null; })() : null);
            }
            try { if (searchWin && !searchWin.isDestroyed()) {searchWin.close();} } catch (_) {}
            if (!found) {
                dialog.showErrorBox(
                    'تعذر العثور على خادم Karim ERP',
                    'تأكد أن جهاز الخادم يعمل ومتصل بنفس الشبكة، ثم أعد فتح التطبيق.\n\nلتعيين الخادم يدويًا: أنشئ ملف server-target.json بجانب التطبيق:\n{ "serverUrl": "https://عنوان-الخادم:5000" }');
                app.quit();
                return;
            }
            RESOLVED_SERVER_URL = found.replace(/\/+$/, '');
        }
        try { CLIENT_ALLOWED_HOST = new URL(RESOLVED_SERVER_URL).host; } catch (_) {}
        console.log(`[Client] السيرفر: ${RESOLVED_SERVER_URL}`);
        setupClientLanUpdater();
        createClientWindow();
        return;
    }

    if (IS_BACKUP_MODE) {
        try {
            await runScheduledBackup();
            app.exit(0);
        } catch (error) {
            console.error('[Backup] Scheduled backup failed:', error.message);
            app.exit(1);
        }
        return;
    }
    
    // A desktop shortcut may be opened while the Windows service is already
    // running. In that case this Electron process is only a local UI client.
    if (!IS_SERVICE_MODE) {
        const serviceInstalled = await isWindowsServiceInstalled();
        attachedToWindowsService = serviceInstalled
            ? await waitForWindowsServiceHealth()
            : await probeExistingLocalService();
        if (serviceInstalled && !attachedToWindowsService) {
            dialog.showErrorBox('تعذر بدء خدمة مطاعم الشرفه العالمي', 'لم تصبح خدمة الخادم جاهزة خلال 90 ثانية. راجع Windows Services وسجل الخدمة قبل إعادة المحاولة.');
            app.quit();
            return;
        }
        if (attachedToWindowsService) {
            isServerReady = true;
            isDbReady = true;
            console.log('[Client] Attached to the existing Windows service.');
        }
    }

    // Services must remain headless: no tray, browser window, or renderer IPC.
    if (!IS_SERVICE_MODE) {
        createTray();
        createMainWindow();
        registerIpcHandlers();
    }
    
    // Ensure data directories exist
        ensureDir(CONFIG.DATA_PATH);
        ensureDir(CONFIG.BACKUPS_PATH);

        // Initialize auto-updater (desktop mode only)
        if (autoUpdater && !IS_SERVICE_MODE) {
            setupAutoUpdater();
        }

        // Start all services only when they are not already owned by WinSW.
    const servicesStarted = attachedToWindowsService ? true : await startAllServices();
    if (IS_SERVICE_MODE && !servicesStarted) {
        console.error('[Service] Startup failed; exiting with error code.');
        app.exit(1);
        return;
    }
    
    // macOS: recreate window when dock icon is clicked (desktop mode only).
    if (IS_SERVICE_MODE) {return;}
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        } else if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
});

/**
 * عند إغلاق جميع النوافذ
 */
app.on('window-all-closed', () => {
    console.log('[App] All windows closed.');
    
    // A headless service must stay alive without windows; WinSW owns its lifecycle.
    if (IS_SERVICE_MODE) {return;}
    // On macOS, keep app running
    if (process.platform !== 'darwin') {
        // If we have a tray, don't quit
        if (!tray) {
            app.quit();
        }
    }
});

/**
 * قبل إغلاق التطبيق
 */
app.on('before-quit', async (event) => {
    if (attachedToWindowsService) {
        console.log('[Client] UI closed; Windows service continues running.');
        return;
    }
    if (isShuttingDown) {return;}  // Already shutting down
    
    // Prevent default quit to handle cleanup
    event.preventDefault();
    
    console.log('[App] Before quit - performing cleanup...');
    await shutdownAllServices();
    
    // Now really quit
    app.exit(0);
});

/**
 * معالجة إشارات النظام
 */
// SIGTERM (from task manager or process killer)
process.on('SIGTERM', async () => {
    console.log('[System] Received SIGTERM.');
    if (attachedToWindowsService) {
        process.exit(0);
        return;
    }
    await shutdownAllServices();
    process.exit(0);
});

// SIGINT (Ctrl+C in terminal)
process.on('SIGINT', async () => {
    console.log('[System] Received SIGINT.');
    if (attachedToWindowsService) {
        process.exit(0);
        return;
    }
    await shutdownAllServices();
    process.exit(0);
});

// Unhandled exceptions
process.on('uncaughtException', (error) => {
    console.error('[System] Uncaught Exception:', error);
    // Continue running but log the error
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System] Unhandled Rejection at:', promise, 'reason:', reason);
});

// ─── Exports (for testing) ───────────────────────────────

module.exports = {
    CONFIG,
    startPostgreSQL,
    stopPostgreSQL,
    startExpressServer,
    stopExpressServer,
    shutdownAllServices,
    getLocalIpAddresses
};
