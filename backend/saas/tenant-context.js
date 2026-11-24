'use strict';
/**
 * backend/saas/tenant-context.js — سياق المستأجر (مرحلة SaaS)
 * ─────────────────────────────────────────────────────────────────────────────
 * مطفأ افتراضياً (SAAS_TENANT_ENABLED=false) ⇒ no-op تام بلا أي أثر على الطلب.
 *
 * عند التفعيل:
 *   1) يُحلّ المستأجر من subdomain يملكه الخادم (Host / X-Forwarded-Host أول تسمية).
 *   2) إن وُجد توكن وصول مُتحقَّق منه، يُقارَن claim `tid` بالنتيجة ⇒ أي تعارض = 403.
 *   3) fail-closed: لا مستأجر ⇒ 403 TENANT_REQUIRED.
 *   4) يُكتب المعرّف في نفس AsyncLocalStorage الخاص بالـcorrelation (لا ALS جديد).
 *
 * الخريطة مؤقتة من البيئة بصيغة `slug:uuid,slug2:uuid2` إلى أن يُطبَّق ترحيل
 * `tenants` وتنتقل Resolve إلى DB بكاش قصير. لا استعلام قاعدة في هذا الإصدار.
 */

const { updateTenantContext } = require('../middleware/correlation');
const { createTenantResolver } = require('./tenant-resolver');
const { record } = require('./saas-metrics');

const FALSEY = new Set(['false', '0', 'off', 'no', '']);

/** @param {unknown} value */
function isEnabled(value) {
    if (value === undefined || value === null) {return false;}
    if (typeof value === 'boolean') {return value;}
    return !FALSEY.has(String(value).trim().toLowerCase());
}

/** @param {string|undefined} raw */
function parseTenantMap(raw) {
    const map = new Map();
    for (const pair of String(raw || '').split(',')) {
        const entry = pair.trim();
        if (!entry) {continue;}
        const sep = entry.indexOf(':');
        if (sep === -1) {continue;}
        const slug = entry.slice(0, sep).trim().toLowerCase();
        const id = entry.slice(sep + 1).trim();
        // uuid صارم: لا مسافات ولا محارف تحكم، ومنع إدخال مستأجر من المستخدم
        if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(slug) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            map.set(slug, id);
        }
    }
    return map;
}

/** @param {string|undefined} host */
function slugFromHost(host) {
    const raw = String(host || '').split(':')[0].split(',')[0].trim().toLowerCase();
    if (!raw || raw === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(raw)) {return null;}
    const first = raw.split('.')[0];
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(first)) {return null;}
    // النطاق الجذري نفسه ليس مستأجراً
    if (first === 'app' || first === 'www' || first === 'api' || first === 'erp') {return null;}
    return first;
}

/**
 * @param {{headers?:any, subdomains?:string[]}} req
 * @param {Map<string,string>} map
 */
function resolveTenant(req, map) {
    // X-Forwarded-Host قابل للتزوير من العميل؛ Host الحقيقي يضبطه الـreverse proxy.
    const host = req.headers?.host;
    const slug = slugFromHost(host) || (Array.isArray(req.subdomains) ? req.subdomains[0] : null);
    if (!slug) {return null;}
    const id = map.get(slug.toLowerCase());
    return id ? { id, slug: slug.toLowerCase(), source: 'subdomain' } : null;
}

/** مسارات عامة لا تحتاج سياق مستأجر (تبقى متاحة قبل الدخول). */
const PUBLIC_PREFIXES = [
    '/api/health',
    '/health',
    // i18n/config ليس عاماً بلا مستأجر: لغة/عملة/ضريبة تخصّ كل عميل.
    // يُحلّ المستأجر من subdomain دون مصادقة، فيبقى متاحاً قبل الدخول.
    '/api/security/csp-report',
    '/api/rt/version',
    // التسجيل الذاتي يسبق وجود جلسة/مستأجر؛ يُغلق بعلم SAAS_SIGNUP_ENABLED وحده.
    '/api/saas/signup',
];

/**
 * حارس إقلاع fail-closed: تفعيل SaaS قبل اكتمال عزل الاستعلامات يعني أن كل
 * المسارات عدا إتمام البيع سترى بيانات كل المستأجرين (RLS متساهل عند غياب GUC).
 * لا يُسمح بالتشغيل في هذه الحالة — الخطأ يمنع الإقلاع بدل تسريب بيانات.
 * يُرفع هذا الحارس فقط بعد تنفيذ runWithTenant على كل مسارات الكتابة واختبار
 * عزل سلبي بين مستأجرين، وتحديث ADR-SaaS-Tenancy من PROPOSED إلى ACCEPTED.
 */
function assertTenantIsolationReady() {
    if (!isEnabled(process.env.SAAS_TENANT_ENABLED)) {return;}
    throw new Error(
        'SAAS_TENANT_ISOLATION_INCOMPLETE: عزل الاستعلامات غير مكتمل — ' +
        'لا يُسمح بتشغيل SAAS_TENANT_ENABLED=true قبل تعميم app.tenant_id على كل المسارات واختبار العزل.',
    );
}

/** @param {{enabled?:boolean, map?:Map<string,string>, resolver?:any, verifyToken?:(t:string)=>any}} [options] */
function tenantContext(options = {}) {
    const enabled = options.enabled !== undefined
        ? Boolean(options.enabled)
        : isEnabled(process.env.SAAS_TENANT_ENABLED);
    const map = options.map || parseTenantMap(process.env.SAAS_TENANT_MAP);
    // الإنتاج: حل من DB. الاختبارات التي تمرّر map تبقى متزامنة بالكامل.
    // تحميل pool/logger كسول حتى يبقى الاستيراد بلا اتصال قاعدة.
    let resolver = options.resolver || null;
    if (!resolver && !options.map) {
        resolver = createTenantResolver({
            pool: require('../shared-pool').pool,
            envMap: map,
            logger: require('../logger').logger,
        });
    }

    return async function tenantContextMiddleware(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) {
        try {
            if (!enabled) {return next();}

            const path = String(req.path || req.originalUrl || '');
            if (PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) {
                return next();
            }

            // حل المستأجر: من DB (عبر resolver) إن وُجد، وإلا من الخريطة المتزامنة.
            let tenant = null;
            if (resolver) {
                // X-Forwarded-Host قابل للتزوير من العميل؛ Host الحقيقي يضبطه الـreverse proxy.
    const host = req.headers?.host;
                const slug = slugFromHost(host);
                if (slug) {tenant = await resolver.resolve(slug);}
            } else {
                tenant = resolveTenant(req, map);
            }
            if (!tenant) {
                record('tenant_required');
                return res.status(403).json({ error: 'TENANT_REQUIRED', message: 'تعذّر تحديد المستأجر' });
            }

            // فحص تقاطعي مع التوكن: منع تزوير subdomain لعميل مسجّل دخوله لدى آخر
            const auth = String(req.headers?.authorization || '');
            if (auth.startsWith('Bearer ')) {
                try {
                    const verify = options.verifyToken || require('../cashier-module/jwt-middleware').verifyAccessToken;
                    const payload = verify(auth.slice(7));
                    if (payload && payload.tid && payload.tid !== tenant.id) {
                        record('tenant_mismatch', tenant.id);
                        return res.status(403).json({ error: 'TENANT_MISMATCH', message: 'التوكن لا يطابق المستأجر' });
                    }
                } catch (_) {
                    // توكن غير صالح يُترك لتدفق المصادقة العادي (jwtAuth) أن يرفضه.
                }
            }

            req.tenant = tenant;
            updateTenantContext({ id: tenant.id, slug: tenant.slug });
            return next();
        } catch (_err) {
            // أي فشل في حل المستأجر = fail-closed، لا يمرّ الطلب بلا سياق.
            record('resolver_unavailable');
            return res.status(503).json({ error: 'TENANT_RESOLVER_UNAVAILABLE', message: 'تعذّر حل هوية المستأجر' });
        }
    };
}

module.exports = {
    tenantContext,
    isEnabled,
    parseTenantMap,
    slugFromHost,
    resolveTenant,
    PUBLIC_PREFIXES,
    assertTenantIsolationReady,
};
