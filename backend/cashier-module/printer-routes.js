/**
 * printer-routes.js — Task 36 (التسليم): إدارة الطابعات الحرارية + الاكتشاف.
 * ────────────────────────────────────────────────────────────────────────────
 * المسارات (كلها خلف jwtAuth):
 *   GET    /api/pos/printers          قائمة الطابعات (كل الأدوار الداخلية)
 *   POST   /api/pos/printers          تسجيل طابعة (admin/manager)
 *   PUT    /api/pos/printers/:id      تعديل (admin/manager)
 *   DELETE /api/pos/printers/:id      حذف (admin/manager)
 *   POST   /api/pos/printers/probe    فحص اتصال طابعة + تحديث is_online (admin/manager)
 *   POST   /api/pos/printers/scan     اكتشاف طابعات الشبكة على /24 (admin/manager)
 *
 * الاكتشاف: الطابعات الحرارية الشبكية تستمع على TCP 9100 (raw ESC/POS) —
 * الفحص اتصال TCP صامت سريع بلا إرسال بيانات.
 *
 * ملاحظة أمنية: probe/scan يحددان عناوين داخلية عمدًا (شبكة المطعم المحلية)،
 * محصورة بدور admin/manager وبمهل قصيرة، ولا تُرسل أي payload.
 */

const express = require('express');
const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { logger } = require('../logger');
const {
    resolvePrinterId,
    validatePrinterAddress,
    printerRegistrationSchema,
    printerUpdateSchema,
    buildSubnetHosts,
    detectLanIp,
    subnetBaseFromIp,
} = require('./printer-logic');

// نسخة الإنتاج لا تُصدِّر normalizeLocalPrinterName؛ نستخدم واجهتها الموحّدة.
const normalizeLocalPrinterName = (name) => validatePrinterAddress('windows_local', name);

const router = express.Router();

const READ_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef', 'dept_head',
'warehouse', 'accountant', 'auditor'];
const WRITE_ROLES = ['admin', 'manager'];
const PROBE_TIMEOUT_MS = 2500;
const SCAN_PORT_DEFAULT = 9100;
const SCAN_TIMEOUT_DEFAULT = 400;
const SCAN_TIMEOUT_MAX = 1500;
const SCAN_CONCURRENCY = 60;
const SCAN_MAX_HOSTS = 254;

/** فحص TCP واحد — {reachable, latency_ms, error} */
function tcpProbe(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = new net.Socket();
        let settled = false;
        const done = (reachable, error) => {
            if (settled) {return;}
            settled = true;
            socket.destroy();
            resolve({ reachable, latency_ms: reachable ? Date.now() - started : null, error: error || null });
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true, null));
        socket.once('timeout', () => done(false, 'timeout'));
        socket.once('error', (err) => done(false, err.code || err.message));
        try {
            socket.connect(port, host);
        } catch (err) {
            done(false, err.code || err.message);
        }
    });
}

const execFileAsync = promisify(execFile);
const LOCAL_PROBE_TIMEOUT_MS = 6000;

/** هل يمكن سؤال ويندوز عن طوابير الطباعة على هذه الأجهزة؟ */
function localQueueSupported() {
    return process.platform === 'win32';
}

function powershellQuote(value) {
    return String(value).replace(/'/g, "''");
}

async function runPowerShell(script, timeout = LOCAL_PROBE_TIMEOUT_MS) {
    const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    );
    return String(stdout || '').trim();
}

function statusText(value) {
    if (typeof value === 'number') {
        return value === 0 ? 'ready' : `status_${String(value)}`;
    }
    return String(value || '').trim() || 'unknown';
}

function looksLikeReceiptPrinter(printer) {
    const haystack = `${printer.name} ${printer.driver}`.toLowerCase();
    return /(pos|receipt|thermal|epson|tm-|xp-|xprinter|rongta|gprinter|bil|nice|black copper|sunmi)/.test(haystack);
}

/**
 * طوابير الطباعة المثبتة على ويندوز — مصدر الاكتشاف المحلي.
 * كل طابور يُقترح كـ windows_local لأن الإرسال RAW عبر winspool لا يحتاج مشاركة.
 */
async function listLocalPrintQueues() {
    if (!localQueueSupported()) {
        return [];
    }
    const script = [
        "$ErrorActionPreference='Stop';",
        "$def=(Get-CimInstance -ClassName Win32_Printer -Filter \"Default=True\" -ErrorAction SilentlyContinue | Select-Object -First 1).Name;",
        '$list=@(Get-Printer | Select-Object Name,DriverName,PortName,Shared,ShareName,PrinterStatus);',
        '[pscustomobject]@{ default=$def; printers=$list } | ConvertTo-Json -Depth 5 -Compress',
    ].join(' ');
    const raw = await runPowerShell(script);
    if (!raw) {
        return [];
    }
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.printers) ? parsed.printers : parsed?.printers ? [parsed.printers] : [];
    const defaultName = parsed?.default ? String(parsed.default) : '';
    return rows
        .filter((row) => row && row.Name)
        .map((row) => {
            const name = String(row.Name);
            const shared = row.Shared === true;
            return {
                name,
                driver: String(row.DriverName || ''),
                port: String(row.PortName || ''),
                shared,
                share_name: row.ShareName ? String(row.ShareName) : '',
                status: statusText(row.PrinterStatus),
                is_default: name === defaultName,
                thermal: looksLikeReceiptPrinter({ name, driver: String(row.DriverName || '') }),
            };
        });
}

/** فحص طابور محلي: هل الاسم موجود فعلًا في ويندوز؟ */
async function probeLocalQueue(printerName) {
    const normalized = normalizeLocalPrinterName(printerName);
    if (!normalized) {
        return { reachable: false, latency_ms: null, error: 'BAD_PRINTER_NAME' };
    }
    if (!localQueueSupported()) {
        return { reachable: false, latency_ms: null, error: 'WINDOWS_ONLY' };
    }
    const started = Date.now();
    try {
        const script =
            `$ErrorActionPreference='SilentlyContinue';` +
            `$p=Get-Printer -Name '${powershellQuote(normalized.name)}' -ErrorAction SilentlyContinue;` +
            `if ($p) { 'FOUND' } else { 'MISSING' }`;
        const out = await runPowerShell(script);
        if (out.includes('FOUND')) {
            return { reachable: true, latency_ms: Date.now() - started, error: null };
        }
        return { reachable: false, latency_ms: null, error: 'QUEUE_NOT_FOUND' };
    } catch (err) {
        return { reachable: false, latency_ms: null, error: err.code || err.message };
    }
}

/** فحص موحّد لأي نوع اتصال مدعوم — يُستخدم في probe والاكتشاف التلقائي. */
async function probePrinter(connectionType, address, timeoutMs = PROBE_TIMEOUT_MS) {
    const normalized = validatePrinterAddress(connectionType, address);
    if (!normalized) {
        return { reachable: false, latency_ms: null, error: 'BAD_ADDRESS' };
    }
    if (connectionType === 'network') {
        return tcpProbe(normalized.host, normalized.port, timeoutMs);
    }
    if (connectionType === 'windows_local') {
        return probeLocalQueue(normalized.name);
    }
    // windows_share: وجود المشاركة يُثبت عند الإرسال؛ لا فحص صامت آمن لها.
    return { reachable: true, latency_ms: null, error: null };
}

/** تحديث حالة الاتصال المخزنة للطابعة */
async function setOnlineState(printerId, isOnline) {
    await pool.query(
        `UPDATE pos_printers SET is_online = $2,
            last_seen_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_seen_at END
          WHERE id = $1;`,
        [printerId, isOnline]
    );
}

router.get('/', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, kind, department_id, connection_type, address,
                    paper_width_mm, charset, is_online, last_seen_at, created_at
               FROM pos_printers ORDER BY kind, id;`
        );
        return res.json({ printers: result.rows });
    } catch (err) {
        logger.error('[printers] list failed:', err.message);
        return res.status(500).json({ error: 'PRINTERS_LIST_FAILED', message: 'فشل جلب قائمة الطابعات' });
    }
});

router.post('/', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const parsed = printerRegistrationSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(422).json({
            error: 'PRINTER_VALIDATION',
            message: parsed.error.issues[0]?.message || 'بيانات الطابعة غير صالحة',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
    }
    const data = parsed.data;
    let printerId = data.id || null;
    const departmentId = data.department_id != null ? Number(data.department_id) : null;

    if (!printerId) {
        const resolved = resolvePrinterId(data.kind, departmentId);
        if (!resolved.ok) {
            return res.status(422).json({ error: 'PRINTER_ID_DERIVE', message: 'لا يمكن اشتقاق معرف الطابعة — تأكد من رقم القسم' });
        }
        printerId = resolved.id;
    }

    const address = validatePrinterAddress(data.connection_type, data.address);
    if (!address) {
        return res.status(422).json({ error: 'PRINTER_ADDRESS', message: 'عنوان الطابعة لا يطابق صيغة نوع الاتصال' });
    }

    try {
        if (departmentId != null) {
            const dept = await pool.query(`SELECT 1 FROM pos_departments WHERE id = $1;`, [departmentId]);
            if (dept.rowCount === 0) {
                return res.status(422).json({ error: 'DEPARTMENT_NOT_FOUND', message: 'القسم المحدد غير موجود' });
            }
        }
        const exists = await pool.query(`SELECT 1 FROM pos_printers WHERE id = $1;`, [printerId]);
        if (exists.rowCount > 0) {
            return res.status(409).json({ error: 'PRINTER_EXISTS', message: `الطابعة ${printerId} مسجلة بالفعل — استخدم التعديل` });
        }
        await pool.query(
            `INSERT INTO pos_printers (id, name, kind, department_id, connection_type, address,
                                        paper_width_mm, charset, is_online)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING *;`,
            [printerId, data.name || null, data.kind, departmentId, data.connection_type,
             data.address, data.paper_width_mm, data.charset]
        );
        // فحص ذاتي فوري عند التسجيل (شبكة أو طابور ويندوز محلي): الطابعة تُعرف
        // حالة اتصالها من لحظة تسجيلها — لا مهام تفشل لأن الافتراضي كان false
        let probeInfo = null;
        if (data.connection_type === 'network' || data.connection_type === 'windows_local') {
            const probe = await probePrinter(data.connection_type, data.address, 2000);
            await pool.query(
                `UPDATE pos_printers SET is_online = $2,
                    last_seen_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_seen_at END
                  WHERE id = $1;`,
                [printerId, probe.reachable]
            );
            probeInfo = { reachable: probe.reachable, latency_ms: probe.latency_ms, error: probe.error };
            logger.info(`[printers] auto-probe ${printerId}: reachable=${probe.reachable}`);
        }
        const finalRow = await pool.query(`SELECT * FROM pos_printers WHERE id = $1;`, [printerId]);
        logger.info(`[printers] registered ${printerId} (${data.connection_type} ${data.address}) by ${req.user?.username}`);
        return res.status(201).json({ printer: finalRow.rows[0], normalized_address: address, probe: probeInfo });
    } catch (err) {
        logger.error('[printers] register failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_REGISTER_FAILED', message: 'فشل تسجيل الطابعة' });
    }
});

router.put('/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const printerId = String(req.params.id || '').toLowerCase();
    const parsed = printerUpdateSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(422).json({
            error: 'PRINTER_VALIDATION',
            message: parsed.error.issues[0]?.message || 'بيانات التعديل غير صالحة',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
    }
    try {
        const current = await pool.query(`SELECT * FROM pos_printers WHERE id = $1;`, [printerId]);
        if (current.rowCount === 0) {
            return res.status(404).json({ error: 'PRINTER_NOT_FOUND', message: 'الطابعة غير موجودة' });
        }
        const row = current.rows[0];
        const connType = parsed.data.connection_type || row.connection_type;
        const address = parsed.data.address || row.address;
        if (parsed.data.address || parsed.data.connection_type) {
            if (!validatePrinterAddress(connType, address)) {
                return res.status(422).json({ error: 'PRINTER_ADDRESS', message: 'العنوان لا يطابق صيغة نوع الاتصال' });
            }
        }
        const updated = await pool.query(
            `UPDATE pos_printers SET
                name            = COALESCE($2, name),
                connection_type = COALESCE($3, connection_type),
                address         = COALESCE($4, address),
                paper_width_mm  = COALESCE($5, paper_width_mm),
                charset         = COALESCE($6, charset),
                is_online       = COALESCE($7, is_online)
              WHERE id = $1 RETURNING *;`,
            [printerId, parsed.data.name ?? null, parsed.data.connection_type ?? null,
             parsed.data.address ?? null, parsed.data.paper_width_mm ?? null,
             parsed.data.charset ?? null, parsed.data.is_online ?? null]
        );
        logger.info(`[printers] updated ${printerId} by ${req.user?.username}`);
        return res.json({ printer: updated.rows[0] });
    } catch (err) {
        logger.error('[printers] update failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_UPDATE_FAILED', message: 'فشل تعديل الطابعة' });
    }
});

router.delete('/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const printerId = String(req.params.id || '').toLowerCase();
    try {
        const deleted = await pool.query(`DELETE FROM pos_printers WHERE id = $1 RETURNING id;`, [printerId]);
        if (deleted.rowCount === 0) {
            return res.status(404).json({ error: 'PRINTER_NOT_FOUND', message: 'الطابعة غير موجودة' });
        }
        logger.info(`[printers] deleted ${printerId} by ${req.user?.username}`);
        return res.json({ deleted: printerId });
    } catch (err) {
        logger.error('[printers] delete failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_DELETE_FAILED', message: 'فشل حذف الطابعة' });
    }
});

router.post('/probe', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const body = req.body || {};
    const printerId = body.id ? String(body.id).toLowerCase() : null;
    try {
        let connType = body.connection_type;
        let address = body.address;
        if (printerId) {
            const rowRes = await pool.query(`SELECT * FROM pos_printers WHERE id = $1;`, [printerId]);
            if (rowRes.rowCount === 0) {
                return res.status(404).json({ error: 'PRINTER_NOT_FOUND', message: 'الطابعة غير موجودة' });
            }
            connType = connType || rowRes.rows[0].connection_type;
            address = address || rowRes.rows[0].address;
        }
        if (connType !== 'network' && connType !== 'windows_local') {
            return res.status(422).json({
                error: 'PROBE_UNSUPPORTED',
                message: 'الفحص المباشر مدعوم لطابعات network وwindows_local فقط',
            });
        }
        const normalized = validatePrinterAddress(connType, address);
        if (!normalized) {
            return res.status(422).json({
                error: 'PRINTER_ADDRESS',
                message: connType === 'network' ? 'عنوان الشبكة المتوقع host:port' : 'اسم طابعة ويندوز مطلوب',
            });
        }
        const result = await probePrinter(connType, address);
        if (printerId) {await setOnlineState(printerId, result.reachable);}
        return res.json({
            printer_id: printerId,
            host: normalized.host || normalized.name || null,
            port: normalized.port || null,
            connection_type: connType,
            reachable: result.reachable,
            latency_ms: result.latency_ms,
            error: result.error,
        });
    } catch (err) {
        logger.error('[printers] probe failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_PROBE_FAILED', message: 'فشل فحص الطابعة' });
    }
});

router.post('/scan', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const body = req.body || {};
    const port = Number(body.port) > 0 ? Math.min(Number(body.port), 65535) : SCAN_PORT_DEFAULT;
    const timeoutMs = Math.max(100, Math.min(Number(body.timeout_ms) || SCAN_TIMEOUT_DEFAULT, SCAN_TIMEOUT_MAX));
    try {
        let base = body.subnet ? subnetBaseFromIp(String(body.subnet)) : null;
        if (body.subnet && !base) {
            return res.status(422).json({ error: 'BAD_SUBNET', message: 'صيغة الشبكة المتوقعة مثل: 192.168.1.0' });
        }
        if (!base) {
            const lanIp = detectLanIp(os.networkInterfaces());
            base = lanIp ? subnetBaseFromIp(lanIp) : null;
        }
        if (!base) {
            return res.status(422).json({ error: 'NO_LAN', message: 'لا توجد شبكة محلية قابلة للفحص — مرر subnet يدويًا' });
        }
        const hosts = buildSubnetHosts(base).slice(0, SCAN_MAX_HOSTS);
        const started = Date.now();
        const reachable = [];
        let cursor = 0;
        async function worker() {
            while (cursor < hosts.length) {
                const ip = hosts[cursor];
                cursor += 1;
                const probe = await tcpProbe(ip, port, timeoutMs);
                if (probe.reachable) {reachable.push({ ip, port, latency_ms: probe.latency_ms });}
            }
        }
        await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker));
        reachable.sort((a, b) => a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
        return res.json({
            subnet: `${base}/24`,
            port,
            scanned: hosts.length,
            duration_ms: Date.now() - started,
            reachable,
        });
    } catch (err) {
        logger.error('[printers] scan failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_SCAN_FAILED', message: 'فشل فحص الشبكة' });
    }
});

/**
 * GET /discover — الاكتشاف التلقائي: طوابير ويندوز المحلية + طابعات الشبكة على
 * 9100 + الطابعات المسجلة. لا يسجّل شيئًا: الشاشة تعرض والمدير يختار.
 * ?scan=0 يتخطى مسح الشبكة (فتح سريع على جهاز واحد).
 */
router.get('/discover', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const doScan = String(req.query.scan ?? '1') !== '0';
    try {
        const registered = (await pool.query(`SELECT * FROM pos_printers ORDER BY kind, id;`)).rows;

        let local = [];
        let localError = null;
        try {
            local = await listLocalPrintQueues();
        } catch (err) {
            localError = err.code || err.message;
            logger.warn('[printers] local queue discovery failed:', localError);
        }

        const network = [];
        let subnet = null;
        if (doScan) {
            const lanIp = detectLanIp(os.networkInterfaces());
            const base = lanIp ? subnetBaseFromIp(lanIp) : null;
            if (base) {
                subnet = `${base}/24`;
                const hosts = buildSubnetHosts(base).slice(0, SCAN_MAX_HOSTS);
                let cursor = 0;
                async function worker() {
                    while (cursor < hosts.length) {
                        const ip = hosts[cursor];
                        cursor += 1;
                        const probe = await tcpProbe(ip, SCAN_PORT_DEFAULT, 320);
                        if (probe.reachable) {
                            network.push({ ip, port: SCAN_PORT_DEFAULT, latency_ms: probe.latency_ms,
                                connection_type: 'network', address: `${ip}:${SCAN_PORT_DEFAULT}` });
                        }
                    }
                }
                await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker));
                network.sort((a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]));
            }
        }

        return res.json({
            platform: process.platform,
            local_queue_supported: localQueueSupported(),
            local_error: localError,
            local,
            network,
            subnet,
            registered,
            scanned_at: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('[printers] discover failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_DISCOVER_FAILED', message: 'فشل اكتشاف الطابعات' });
    }
});

/**
 * POST /auto — ربط تلقائي بضغطة واحدة:
 *   - بعنوان صريح: يُسجَّل/يُحدَّث كما هو بعد التحقق والفحص.
 *   - بلا عنوان: يختار أفضل طابعة إيصالات/مطبخ (طابور ويندوز حراري، ثم الافتراضي،
 *     ثم طابعة شبكة متاحة) ويسجّلها بالمعرف القياسي pos-<قسم> / kot-<قسم>.
 */
router.post('/auto', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const body = req.body || {};
    const kind = body.kind === 'kot' ? 'kot' : 'receipt';
    const departmentId = body.department_id != null && body.department_id !== '' ? Number(body.department_id) : null;
    if (departmentId != null && (!Number.isInteger(departmentId) || departmentId <= 0)) {
        return res.status(422).json({ error: 'BAD_DEPARTMENT', message: 'رقم القسم غير صالح' });
    }

    let connectionType = String(body.connection_type || '').trim();
    let address = String(body.address || '').trim();
    let printerName = String(body.name || '').trim();
    let source = 'manual';

    if (address) {
        if (!connectionType) {
            connectionType = /^[^/\\]+\/[^/\\]+$/.test(address) ? 'windows_share' : 'network';
        }
        if (!validatePrinterAddress(connectionType, address)) {
            return res.status(422).json({ error: 'PRINTER_ADDRESS', message: 'عنوان الطابعة لا يطابق نوع الاتصال' });
        }
        if (!printerName) {
            printerName = connectionType === 'windows_local' ? address : `طابعة ${kind === 'kot' ? 'المطبخ' : 'الإيصالات'}`;
        }
    } else {
        source = 'discovery';
        let local = [];
        try {
            local = await listLocalPrintQueues();
        } catch (err) {
            logger.warn('[printers] auto detect local queues failed:', err.code || err.message);
        }
        const thermal = local.filter((p) => p.thermal);
        const preferred =
            thermal.find((p) => p.is_default) || thermal[0] || local.find((p) => p.is_default) || local[0] || null;
        if (preferred) {
            connectionType = 'windows_local';
            address = preferred.name;
            printerName = preferred.name;
        } else {
            const lanIp = detectLanIp(os.networkInterfaces());
            const base = lanIp ? subnetBaseFromIp(lanIp) : null;
            let found = null;
            if (base) {
                const hosts = buildSubnetHosts(base).slice(0, SCAN_MAX_HOSTS);
                let cursor = 0;
                async function worker() {
                    while (cursor < hosts.length && !found) {
                        const ip = hosts[cursor];
                        cursor += 1;
                        const probe = await tcpProbe(ip, SCAN_PORT_DEFAULT, 320);
                        if (probe.reachable && !found) {
                            found = { ip, port: SCAN_PORT_DEFAULT };
                        }
                    }
                }
                await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker));
            }
            if (!found) {
                return res.status(404).json({
                    error: 'NO_PRINTER_FOUND',
                    message:
                        'لم يُعثر على طابعة حرارية. وصّل الطابعة USB وثبّت سائقها في ويندوز، أو أدخل عنوان طابعة الشبكة يدويًا.',
                });
            }
            connectionType = 'network';
            address = `${found.ip}:${String(found.port)}`;
            printerName = `شبكة ${found.ip}`;
        }
    }

    const resolved = departmentId != null
        ? resolvePrinterId(kind, departmentId)
        : { ok: true, id: `${kind === 'kot' ? 'kot' : 'pos'}-auto` };
    if (!resolved.ok) {
        return res.status(422).json({ error: 'PRINTER_ID_DERIVE', message: 'لا يمكن اشتقاق معرف الطابعة' });
    }

    try {
        const probe = await probePrinter(connectionType, address, 2500);
        const saved = await pool.query(
            `INSERT INTO pos_printers (id, name, kind, department_id, connection_type, address,
                                       paper_width_mm, charset, is_online, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, 80, 'utf8', $7,
                     CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END)
             ON CONFLICT (id) DO UPDATE SET
                name            = COALESCE(EXCLUDED.name, pos_printers.name),
                kind            = EXCLUDED.kind,
                department_id   = COALESCE(EXCLUDED.department_id, pos_printers.department_id),
                connection_type = EXCLUDED.connection_type,
                address         = EXCLUDED.address,
                is_online       = EXCLUDED.is_online,
                last_seen_at    = CASE WHEN EXCLUDED.is_online THEN CURRENT_TIMESTAMP ELSE pos_printers.last_seen_at END
             RETURNING *;`,
            [resolved.id, printerName || null, kind, departmentId, connectionType, address, probe.reachable]
        );
        logger.info(
            `[printers] auto-linked ${resolved.id} → ${connectionType} ${address} ` +
            `(reachable=${String(probe.reachable)}, source=${source}) by ${req.user?.username}`
        );
        return res.json({
            printer: saved.rows[0],
            probe,
            source,
            note: probe.reachable
                ? 'الطابعة متصلة وجاهزة لاستقبال مهام الطباعة.'
                : 'حُفظت الطابعة لكنها غير متاحة الآن؛ سيعيد عامل الطباعة المحاولة تلقائيًا عند توفرها.',
        });
    } catch (err) {
        logger.error('[printers] auto link failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_AUTO_FAILED', message: 'فشل الربط التلقائي بالطابعة' });
    }
});

module.exports = { router, tcpProbe, listLocalPrintQueues /**, internal: probePrinter */ };
