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
        // فحص ذاتي فوري عند التسجيل (network فقط): الطابعة تُعرف حالة اتصالها
        // من لحظة تسجيلها — لا مهام تفشل لأن الحالة الافتراضية كانت false
        let probeInfo = null;
        if (data.connection_type === 'network') {
            const probe = await tcpProbe(address.host, address.port, 2000);
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
        if (connType !== 'network') {
            return res.status(422).json({ error: 'PROBE_UNSUPPORTED', message: 'الفحص الشبكي مدعوم لطابعات network فقط' });
        }
        const normalized = validatePrinterAddress('network', address);
        if (!normalized) {
            return res.status(422).json({ error: 'PRINTER_ADDRESS', message: 'عنوان الشبكة المتوقع host:port' });
        }
        const result = await tcpProbe(normalized.host, normalized.port);
        if (printerId) {await setOnlineState(printerId, result.reachable);}
        return res.json({
            printer_id: printerId,
            host: normalized.host,
            port: normalized.port,
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

/** اكتشاف موحَّد للواجهة: طابعات مسجّلة + مرشّحين network على /24.
 *  عقد الواجهة (`printerDiscoverySchema`) يتوقّع كل الحقول أدناه. */
router.get('/discover', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const doScan = String(req.query.scan ?? '1') !== '0';
        const lanIp = detectLanIp(os.networkInterfaces());
        const base = lanIp ? subnetBaseFromIp(lanIp) : null;
        const subnet = base ? `${base}/24` : '';
        const network = [];
        if (doScan && base) {
            const hosts = buildSubnetHosts(base).slice(0, SCAN_MAX_HOSTS);
            let cursor = 0;
            async function worker() {
                while (cursor < hosts.length) {
                    const ip = hosts[cursor];
                    cursor += 1;
                    const probe = await tcpProbe(ip, SCAN_PORT_DEFAULT, SCAN_TIMEOUT_DEFAULT);
                    if (probe.reachable) {
                        network.push({
                            ip, port: SCAN_PORT_DEFAULT, latency_ms: probe.latency_ms,
                            address: `${ip}:${SCAN_PORT_DEFAULT}`, connection_type: 'network',
                        });
                    }
                }
            }
            await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker));
            network.sort((a, b) => a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
        }
        const registered = (await pool.query(
            `SELECT id, name, kind, department_id, connection_type, address,
                    paper_width_mm, charset, is_online, last_seen_at
               FROM pos_printers ORDER BY kind, id;`
        )).rows;
        return res.json({
            platform: process.platform,
            local_queue_supported: process.platform === 'win32',
            local_error: process.platform === 'win32' ? null : 'قوائم الطباعة المحلية تُقرأ من أجهزة ويندوز فقط',
            local: [],
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

/** ربط طابعة بضغطة واحدة: مسجّلة متصلة ← عنوان مُعطى ← أول مرشّح network. */
router.post('/auto', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const body = req.body || {};
    const kind = body.kind === 'kot' ? 'kot' : 'receipt';
    const departmentId = Number(body.department_id) > 0 ? Number(body.department_id) : null;
    const wantedName = String(body.name || '').trim().slice(0, 120) || null;
    try {
        let row = null;
        let source = 'registered';
        if (departmentId) {
            row = (await pool.query(
                `SELECT * FROM pos_printers WHERE kind=$1 AND department_id=$2 AND is_online=TRUE ORDER BY id LIMIT 1`,
                [kind, departmentId]
            )).rows[0] || null;
        }
        if (!row) {
            row = (await pool.query(
                `SELECT * FROM pos_printers WHERE kind=$1 AND is_online=TRUE ORDER BY id LIMIT 1`, [kind]
            )).rows[0] || null;
        }
        if (row) {
            return res.json({ printer: row, probe: null, source, note: 'استُخدمت طابعة مسجّلة ومتصلة' });
        }

        let address = String(body.address || '').trim();
        let connectionType = body.connection_type === 'windows_share' ? 'windows_share' : 'network';
        if (!address) {
            const lanIp = detectLanIp(os.networkInterfaces());
            const base = lanIp ? subnetBaseFromIp(lanIp) : null;
            if (!base) {
                return res.status(422).json({ error: 'NO_LAN', message: 'لا توجد شبكة محلية — أدخل عنوان الطابعة يدويًا' });
            }
            const hosts = buildSubnetHosts(base).slice(0, SCAN_MAX_HOSTS);
            let cursor = 0;
            let found = null;
            async function worker() {
                while (cursor < hosts.length && !found) {
                    const ip = hosts[cursor];
                    cursor += 1;
                    const probe = await tcpProbe(ip, SCAN_PORT_DEFAULT, SCAN_TIMEOUT_DEFAULT);
                    if (probe.reachable) {found = { ip, probe };}
                }
            }
            await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker));
            if (!found) {
                return res.status(409).json({ error: 'NO_PRINTER_FOUND', message: 'لم يُعثر على طابعة متاحة — سجّل الطابعة يدويًا' });
            }
            address = `${found.ip}:${SCAN_PORT_DEFAULT}`;
            source = 'discovered';
        } else {
            source = 'provided';
        }
        const normalized = validatePrinterAddress(connectionType, address);
        if (!normalized) {
            return res.status(422).json({ error: 'PRINTER_ADDRESS', message: 'عنوان الطابعة غير صالح' });
        }
        const resolved = resolvePrinterId(kind, departmentId);
        if (!resolved.ok) {
            return res.status(422).json({ error: 'PRINTER_ID_DERIVE', message: 'حدّد القسم أو المعرّف' });
        }
        const existing = (await pool.query(`SELECT 1 FROM pos_printers WHERE id=$1`, [resolved.id])).rowCount > 0;
        const name = wantedName || `${kind === 'kot' ? 'طابعة مطبخ' : 'طابعة فاتورة'} ${resolved.id}`;
        if (existing) {
            await pool.query(
                `UPDATE pos_printers SET name=$2, connection_type=$3, address=$4, kind=$5, department_id=$6 WHERE id=$1`,
                [resolved.id, name, connectionType, address, kind, departmentId]
            );
        } else {
            await pool.query(
                `INSERT INTO pos_printers (id, name, kind, department_id, connection_type, address, paper_width_mm, charset, is_online)
                 VALUES ($1,$2,$3,$4,$5,$6,80,'UTF-8',false)`,
                [resolved.id, name, kind, departmentId, connectionType, address]
            );
        }
        let probe = null;
        if (connectionType === 'network') {
            const check = await tcpProbe(normalized.host, normalized.port, 2000);
            await pool.query(
                `UPDATE pos_printers SET is_online=$2,
                    last_seen_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_seen_at END WHERE id=$1`,
                [resolved.id, check.reachable]
            );
            probe = { reachable: check.reachable, latency_ms: check.latency_ms, error: check.error };
        }
        const finalRow = (await pool.query(`SELECT * FROM pos_printers WHERE id=$1`, [resolved.id])).rows[0];
        logger.info(`[printers] auto-linked ${resolved.id} (${source}) by ${req.user?.username}`);
        return res.status(201).json({ printer: finalRow, probe, source, note: 'تم ربط الطابعة تلقائيًا' });
    } catch (err) {
        logger.error('[printers] auto-link failed:', err.message);
        return res.status(500).json({ error: 'PRINTER_AUTO_FAILED', message: 'فشل الربط التلقائي للطابعة' });
    }
});

module.exports = { router, tcpProbe };
