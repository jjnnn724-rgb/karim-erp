/**
 * printer-logic.js — دوال نقية لإدارة الطابعات الحرارية (Task 36 — التسليم).
 * ────────────────────────────────────────────────────────────────────────────
 * كل ما في هذا الملف بلا آثار جانبية ويُختبر مباشرة في jest.
 *
 * القواعد الأساسية:
 *   - معرف طابعة الإيصالات القياسي: pos-<department_id>
 *   - معرف طابعة المطبخ القياسي:   kot-<department_id>
 *   - kind مشتق من البادئة للصفوف القديمة، ومخزّن بعمود kind بعد مهاجرة 036
 *   - أنواع الاتصال المدعومة فعليًا في الإرسال: network + windows_share
 *     (usb يتطلب escpos-usb ولا يُقبل تسجيله لتفادي مهام مستحيلة)
 */

const { z } = require('zod');

const KINDS = ['receipt', 'kot'];
const CONNECTION_TYPES = ['network', 'windows_share', 'usb'];
const PAPER_WIDTHS = [58, 80];
const CHARSETS = ['utf8', 'cp864'];
const PRINTER_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_PORT = 9100;

/** kind من معرف المهمة/الطابعة: kot-* → kot، غير ذلك receipt */
function kindOfPrinterId(printerId) {
    return String(printerId || '').startsWith('kot-') ? 'kot' : 'receipt';
}

/** المعرف القياسي من النوع + رقم القسم */
function resolvePrinterId(kind, departmentId) {
    if (!KINDS.includes(kind)) {return { ok: false, code: 'BAD_KIND' };}
    const id = Number(departmentId);
    if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
        return { ok: false, code: 'BAD_DEPARTMENT' };
    }
    return { ok: true, id: `${kind === 'kot' ? 'kot' : 'pos'}-${id}` };
}

/** network: host[:port] — المنفذ الافتراضي 9100 */
function normalizeNetworkAddress(address) {
    if (typeof address !== 'string') {return null;}
    const m = address.trim().match(/^([a-zA-Z0-9._-]+)(?::(\d{1,5}))?$/);
    if (!m) {return null;}
    const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
    if (port < 1 || port > 65535) {return null;}
    return { host: m[1], port };
}

/** windows_share: server/share */
function normalizeShareAddress(address) {
    if (typeof address !== 'string') {return null;}
    const m = address.trim().match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
    return m ? { server: m[1], share: m[2] } : null;
}

/** تحقق موحد لنوع الاتصال — يعيد كائنًا مقننًا أو null */
function validatePrinterAddress(connectionType, address) {
    if (connectionType === 'network') {return normalizeNetworkAddress(address);}
    if (connectionType === 'windows_share') {return normalizeShareAddress(address);}
    return null; // usb غير مدعوم عمدًا
}

/**
 * اختيار الطابعة لمهمة طباعة (قلب "الأوتوماتيك بلا غلطة"):
 *   1) الطابعة المطلوبة بالمعرف إن كانت متصلة
 *   2) وإلا أول طابعة متصلة من نفس kind (تراجع ذكي — لا فشل لمجرد غياب
 *      طابعة قسم بعينه)
 *   3) وإلا null (المهمة تفشل برسالة عربية واضحة وتدخل backoff)
 */
function pickPrinterForJob(printers, wantedId) {
    const kind = kindOfPrinterId(wantedId);
    const online = (Array.isArray(printers) ? printers : []).filter((p) => p && p.is_online);
    const exact = online.find((p) => p.id === wantedId);
    if (exact) {return { printer: exact, fallback: false };}
    const sameKind = online.find((p) => (p.kind || kindOfPrinterId(p.id)) === kind);
    if (sameKind) {return { printer: sameKind, fallback: true };}
    return null;
}

/** مخطط تسجيل طابعة (zod) — العنوان يُتحقق حسب نوع الاتصال */
const printerRegistrationSchema = z
    .object({
        id: z.string().regex(PRINTER_ID_RE, 'معرف غير صالح (أحرف صغيرة/أرقام/شرطة)').optional(),
        kind: z.enum(['receipt', 'kot']).default('receipt'),
        department_id: z
            .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
            .optional(),
        name: z.string().trim().max(80).optional(),
        connection_type: z.enum(['network', 'windows_share']),
        address: z.string().trim().min(3).max(120),
        paper_width_mm: z.union([z.literal(58), z.literal(80)]).default(80),
        charset: z.enum(['utf8', 'cp864']).default('utf8'),
    })
    .superRefine((val, ctx) => {
        if (!validatePrinterAddress(val.connection_type, val.address)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['address'],
                message:
                    val.connection_type === 'network'
                        ? 'عنوان الشبكة المتوقع host:port — مثال: 192.168.1.50 أو 192.168.1.50:9100'
                        : 'صيغة المشاركة المتوقعة server/share — مثال: POSPC/POS58',
            });
        }
        if (!val.id && !val.department_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['department_id'],
                message: 'مطلوب معرف صريح أو department_id لاشتقاق المعرف القياسي',
            });
        }
    });

/** مخطط التحديث الجزئي */
const printerUpdateSchema = z
    .object({
        name: z.string().trim().max(80).optional(),
        connection_type: z.enum(['network', 'windows_share']).optional(),
        address: z.string().trim().min(3).max(120).optional(),
        paper_width_mm: z.union([z.literal(58), z.literal(80)]).optional(),
        charset: z.enum(['utf8', 'cp864']).optional(),
        is_online: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
        if (val.connection_type && val.address) {
            if (!validatePrinterAddress(val.connection_type, val.address)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['address'],
                    message: 'العنوان لا يطابق صيغة نوع الاتصال',
                });
            }
        }
    });

/** بناء قائمة مضيفي شبكة /24 للفحص — 254 مضيفًا من a.b.c.1 إلى a.b.c.254 */
function buildSubnetHosts(baseIp) {
    const m = String(baseIp || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) {return [];}
    const oct = m.slice(1).map(Number);
    if (oct.some((n) => n < 0 || n > 255)) {return [];}
    const hosts = [];
    for (let i = 1; i <= 254; i += 1) {hosts.push(`${oct[0]}.${oct[1]}.${oct[2]}.${i}`);}
    return hosts;
}

/** استخراج عنوان IPv4 الحقيقي الأول من os.networkInterfaces() */
function detectLanIp(interfaces) {
    for (const list of Object.values(interfaces || {})) {
        for (const net of list || []) {
            if (net && net.family === 'IPv4' && !net.internal && net.address) {return net.address;}
        }
    }
    return null;
}

/** 192.168.1.57 → 192.168.1.0 (أساس شبكة /24) */
function subnetBaseFromIp(ip) {
    const parts = String(ip || '').split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) {return null;}
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

module.exports = {
    KINDS,
    CONNECTION_TYPES,
    PAPER_WIDTHS,
    CHARSETS,
    PRINTER_ID_RE,
    DEFAULT_PORT,
    kindOfPrinterId,
    resolvePrinterId,
    normalizeNetworkAddress,
    normalizeShareAddress,
    validatePrinterAddress,
    pickPrinterForJob,
    printerRegistrationSchema,
    printerUpdateSchema,
    buildSubnetHosts,
    detectLanIp,
    subnetBaseFromIp,
};
