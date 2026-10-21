/**
 * security.js — Production-Grade HTTP Security Headers
 * ────────────────────────────────────────────────────────────────────────────
 * Replaces the "helmet" dependency with a small, auditable, zero-dep
 * implementation tailored exactly to Karim ERP. Same goals:
 *
 *   • X-Content-Type-Options: nosniff
 *   • X-Frame-Options: SAMEORIGIN (clickjacking)
 *   • Referrer-Policy: strict-origin-when-cross-origin
 *   • Permissions-Policy: disable unused browser APIs (camera, mic, geolocation…)
 *   • Cross-Origin-Opener-Policy / Embedding policy
 *   • Strict-Transport-Security (HTTPS-only) when behind HTTPS
 *   • Content-Security-Policy with nonce for inline scripts (Electron + web)
 *   • X-XSS-Protection: 0 (deprecated, rely on CSP instead)
 *
 * Also adds a small "mime sniffing" block on responses, and basic
 * HTTP Parameter Pollution (HPP) protection.
 */

'use strict';

const crypto = require('crypto');

// ─── Default hardening (conservative — Electron + LAN mode) ─
const DEFAULTS = {
    contentSecurityPolicy: true,
    frameguard: 'sameorigin',
    hidePoweredBy: true,
    hsts: false, // only set when behind TLS/SSL
    ieNoOpen: true,
    noSniff: true,
    permittedCrossDomainPolicies: 'none',
    referrerPolicy: 'strict-origin-when-cross-origin',
    xssFilter: false, // deprecated header, rely on CSP
    permissionsPolicy: {
        // البصمة الذاتية تحتاج الكاميرا والميكروفون والـ GPS من نفس النطاق —
        // القيمة () تحجبهم على الجميع بما فيهم self، فتُكسر بصمة الوجه وتحديد الموقع.
        // (self) = مسموح للنطاق الأصلي فقط (karimeg.online أو السيرفر المحلي).
        camera:       '(self)',
        microphone:   '(self)',
        geolocation:  '(self)',
        payment:      '()',          // غير مستخدم — يبقى محظورًا
        gyroscope:    '()',
        accelerometer:'()',
        magnetometer: '()',
        usb:          '()',
        // NOTE: ambient-light-sensor/battery removed — Chrome dropped them and
        // logs "Unrecognized feature" console errors for each page load.
    },
    crossOriginEmbedderPolicy: 'credentialless',
    crossOriginOpenerPolicy:   'same-origin',
    crossOriginResourcePolicy: 'same-site',
};

/**
 * Generate a base64 nonce (32 bytes) and attach it to req for use in templates:
 *   <script nonce="<%= req.cspNonce %>">...</script>
 */
function generateNonce() {
    return crypto.randomBytes(32).toString('base64');
}

/**
 * Build the CSP header string. Nonces are auto-injected per request.
 */
function buildCspDirectives(opts, nonce) {
    const self = "'self'";
    const unsafeInline = "'unsafe-inline'";
    const unsafeEval   = process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : '';
    const dataImg      = 'data:';
    const blobMedia    = 'blob:';

    const directives = {
        'default-src': [self],
        'script-src': [
            self,
            nonce ? `'nonce-${nonce}'` : '',
            // Cloudflare Web Analytics injects beacon.min.js automatically when
            // enabled in their dashboard — allow it explicitly so it neither
            // breaks nor spams CSP violations. (Disable it in Cloudflare
            // dashboard → Speed → Observability if you don't want it at all.)
            'https://static.cloudflareinsights.com',
            // The app uses inline handlers on the login page and several browser
            // widgets rely on inline JavaScript. Keep the per-request nonce but
            // allow the inline fallback necessary for the current frontend.
            // NOTE: inline event handlers such as onclick="..." are rejected unless
            // 'unsafe-hashes' is present in script-src.
            "'unsafe-hashes'",
            unsafeInline,
            process.env.NODE_ENV === 'development' ? unsafeEval : '',
            unsafeEval,
        ].filter(Boolean),
        // The current UI generates many data-bound onclick handlers for menus
        // and modal controls. Scope the exception to event attributes only;
        // nonce protection remains active for inline script blocks.
        'script-src-attr': [unsafeInline],
        'style-src': [
            self,
            "'unsafe-inline'",   // CSS-in-JS / dynamic styles in POS view
            'https://fonts.googleapis.com',
        ],
        'img-src': [
            self,
            dataImg,
            blobMedia,
            'https:', // for QR code CDN / external logos
        ],
        'font-src': [
            self,
            dataImg,
            'https://fonts.gstatic.com',
        ],
        'connect-src': [
            self,
            'ws:', 'wss:',   // Socket.io WebSockets
            'http:', 'https:', // ZATCA / Cloudflare tunnel fallback
        ],
        'frame-src': [
            self,
        ],
        'frame-ancestors': [
            "'none'",
        ],
        'form-action': [self],
        'base-uri': [self],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : undefined,
    };

    if (opts?.reportOnly && process.env.CSP_REPORT_URI) {
        directives['report-uri'] = [process.env.CSP_REPORT_URI];
    }

    return Object.entries(directives)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => `${k} ${v.filter(Boolean).join(' ')}`)
        .join('; ');
}

/**
 * V2 has no inline application scripts or event handlers. Keep its document
 * stricter than the legacy shell without changing the legacy CSP contract.
 */
function buildV2Csp() {
    return [
        "default-src 'self'",
        "script-src 'self'",
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
    ].join('; ');
}

/**
 * سياسة legacy **صارمة** — للقياس قبل الفرض.
 *
 * الواجهة القديمة فيها ~1100 معالج سطري (onclick="...") وسكربتات inline،
 * فلا يمكن فرض script-src 'self' دفعة واحدة دون كسر الواجهة. الطريق
 * الصحيح: تُرسل هذه السياسة كـReport-Only فيُبلّغ المتصفح عن كل مخالفة
 * **دون منعها**، فنعرف بالضبط ما الذي يكسر قبل أن نفرض.
 *
 * ما تختلفه عن سياسة legacy الحالية:
 *   · script-src بلا 'unsafe-inline' (يبقى الـnonce و'unsafe-hashes' فقط)
 *   · script-src-attr 'none'      ← الإجراء الذي يمنع حقن HTML
 *   · object-src 'none' + base-uri 'self' + form-action 'self'
 */
function buildStrictCsp(opts = {}) {
    const nonce = opts.nonce ? `'nonce-${opts.nonce}'` : '';
    const reportUri = opts.reportUri ? `report-uri ${opts.reportUri}` : '';
    return [
        "default-src 'self'",
        // 'unsafe-hashes' يسمح بالمعالجات السطرية الموقّعة، لكن لا 'unsafe-inline'
        // (وهو ما يسمح بحقن HTML). والـnonce يُستبدل بقيمة حقيقية per-request —
        // placeholder فارغ يجعل المتصفح يتجاهل المصدر بالكامل.
        `script-src 'self' 'unsafe-hashes' ${nonce}`.trim(),
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' ws: wss: http: https:",
        "frame-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        reportUri,
    ].filter(Boolean).join('; ');
}

/**
 * جامع تقارير CSP — يعدّ المخالفات بدل تخزينها (لا بيانات شخصية).
 * يُستخدم مع Content-Security-Policy-Report-Only أثناء مرحلة القياس.
 */
function createCspReportCollector(options = {}) {
    // المفتاح: التوجيه + ما حُجب + المستند. القيمة: العدد + مواضع المصدر.
    const counters = new Map();
    // حدّ أقصى للمفاتيح: نقطة الاستقبال مفتوحة للإنترنت ⇒ لولا الحدّ لأمكن
    // ضخّ مفاتيح لا نهائية والتضخيم الذاكرة (Memory DoS). excesses تُحصر.
    const MAX_KEYS = Number(options.maxKeys) > 0 ? Number(options.maxKeys) : 500;
    // مصرف دائم اختياري (ملف) — العدّاد في الذاكرة يُفقد عند إعادة تشغيل الخدمة.
    let sink = typeof options.sink === 'function' ? options.sink : null;
    let overflowCount = 0;
    return {
        /** يقرأ تقريرًا واحدًا (من المتصفح) ويحدّث العدادات. */
        record(report) {
            // المتصفح يرسل { 'csp-report': {...} } — نقبل الصيغتين
            const src = report && typeof report === 'object' && report['csp-report'] && typeof report['csp-report'] === 'object'
                ? report['csp-report']
                : (report && typeof report === 'object' ? report : {});
            const doc = String(src.documenturi || src['document-uri'] || '').slice(0, 200);
            const directive = String(src['violated-directive'] || src.violatedDirective || 'unknown');
            const blocked = String(src['blocked-uri'] || src.blockedURI || '').slice(0, 200);
            const file = String(src['source-file'] || src.sourceFile || '').slice(0, 200);
            const line = parseInt(String(src['line-number'] || src.lineNumber || '0'), 10) || 0;
            const key = `${directive}|${blocked.split('?')[0]}|${doc}`;
            let entry = counters.get(key);
            if (!entry) {
                if (counters.size >= MAX_KEYS) {
                    // تجاوز الحدّ: نعدّ فقط ولا نخزّن مفتاحًا جديدًا
                    overflowCount += 1;
                    if (sink) {
                        try {sink({ directive, blocked, document: doc, source: file ? `${file}:${line}` : '' });} catch (_) {}
                    }
                    return { directive, blocked, document: doc, overflow: true };
                }
                entry = { count: 0, sources: [] };
                counters.set(key, entry);
            }
            entry.count += 1;
            if (file && entry.sources.length < 12) {
                const where = `${file}${line ? `:${line}` : ''}`;
                if (!entry.sources.includes(where)) {entry.sources.push(where);}
            }
            if (sink) {
                try {sink({ directive, blocked, document: doc, source: file ? `${file}:${line}` : '' });} catch (_) {}
            }
            return { directive, blocked, document: doc };
        },
        /** لقطة العدادات (للفحص الدوري). */
        snapshot() {
            const out = {};
            for (const [k, v] of counters) {
                out[k] = { count: v.count, sources: v.sources };
            }
            if (overflowCount) {out['__overflow__'] = { count: overflowCount, sources: [] };}
            return out;
        },
        /** عدد المخالفات الكلي. */
        total() {
            let n = overflowCount;
            for (const v of counters.values()) {n += v.count;}
            return n;
        },
        reset() {counters.clear(); overflowCount = 0;},
        /** يبدّل المصرف الدائم (يُستدعى بعد الإنشاء). */
        setSink(fn) {sink = typeof fn === 'function' ? fn : null;},
    };
}


/**
 * Build the Permissions-Policy header string from the key-val map.
 */
function buildPermissionsPolicy(map) {
    return Object.entries(map || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
}

/**
 * The middleware.
 */
function securityHeaders(options = {}) {
    const cfg = { ...DEFAULTS, ...options, permissionsPolicy: { ...DEFAULTS.permissionsPolicy, ...(options.permissionsPolicy || {}) } };

    return function securityHeadersMiddleware(req, res, next) {
        // ─── Remove server fingerprint ──────────────────
        if (cfg.hidePoweredBy) {
            res.removeHeader('X-Powered-By');
            res.setHeader('Server', 'KarimERP');
        }

        // ─── MIME sniffing block ────────────────────────
        if (cfg.noSniff) {
            res.setHeader('X-Content-Type-Options', 'nosniff');
        }

        // ─── Clickjacking ────────────────────────────────
        if (cfg.frameguard) {
            const value = typeof cfg.frameguard === 'string'
                ? cfg.frameguard
                : 'SAMEORIGIN';
            res.setHeader('X-Frame-Options', value.toUpperCase());
        }

        // ─── IE8+ file download safety ──────────────────
        if (cfg.ieNoOpen) {
            res.setHeader('X-Download-Options', 'noopen');
        }

        // ─── Flash / PDF cross-domain ───────────────────
        if (cfg.permittedCrossDomainPolicies) {
            res.setHeader('X-Permitted-Cross-Domain-Policies', cfg.permittedCrossDomainPolicies);
        }

        // ─── Referrer leaking ───────────────────────────
        if (cfg.referrerPolicy) {
            res.setHeader('Referrer-Policy', cfg.referrerPolicy);
        }

        // ─── Deprecated XSS header (only if explicitly enabled) ─
        if (cfg.xssFilter) {
            res.setHeader('X-XSS-Protection', '1; mode=block');
        }

        // ─── Permissions-Policy ─────────────────────────
        res.setHeader('Permissions-Policy', buildPermissionsPolicy(cfg.permissionsPolicy));

        // ─── Cross-origin isolation (COOP/COEP/CORP) ────
        if (cfg.crossOriginOpenerPolicy) {
            res.setHeader('Cross-Origin-Opener-Policy', cfg.crossOriginOpenerPolicy);
        }
        if (cfg.crossOriginEmbedderPolicy) {
            res.setHeader('Cross-Origin-Embedder-Policy', cfg.crossOriginEmbedderPolicy);
        }
        if (cfg.crossOriginResourcePolicy) {
            res.setHeader('Cross-Origin-Resource-Policy', cfg.crossOriginResourcePolicy);
        }

        // ─── HSTS — ONLY when the request is HTTPS ──────
        // (Never set HSTS over pure HTTP — breaks local LAN installs.)
        if (cfg.hsts || req.secure ||
            (req.headers['x-forwarded-proto'] === 'https') ||
            process.env.SSL_CERT) {
            const maxAge = cfg.hsts?.maxAgeSeconds || 15_552_000; // ~6 months
            const directives = [
                `max-age=${maxAge}`,
                cfg.hsts?.includeSubDomains !== false ? 'includeSubDomains' : '',
                cfg.hsts?.preload ? 'preload' : '',
            ].filter(Boolean).join('; ');
            res.setHeader('Strict-Transport-Security', directives);
        }

        // ─── CSP with per-request nonce ─────────────────
        if (cfg.contentSecurityPolicy) {
            const nonce = generateNonce();
            req.cspNonce = nonce;
            const cspString = buildCspDirectives(cfg.contentSecurityPolicy, nonce);
            const header = (cfg.contentSecurityPolicy?.reportOnly)
                ? 'Content-Security-Policy-Report-Only'
                : 'Content-Security-Policy';
            res.setHeader(header, cspString);
        }

        next();
    };
}

/**
 * Minimal HTTP Parameter Pollution guard.
 * Express exposes arrays when a key is repeated (e.g. ?id=1&id=2).
 * Attackers use this to bypass validation. We enforce a whitelist:
 * any query/body key that's NOT declared as array gets flattened to its FIRST value.
 *
 *   app.use(hppGuard({ arrayKeys: ['tags', 'ids'] }));
 */
function hppGuard(options = {}) {
    const arrayKeys = new Set(options.arrayKeys || []);
    return function hppGuardMiddleware(req, res, next) {
        ['query', 'body'].forEach((src) => {
            const obj = req[src];
            if (!obj || typeof obj !== 'object') {return;}
            for (const k of Object.keys(obj)) {
                const v = obj[k];
                if (Array.isArray(v) && !arrayKeys.has(k)) {
                    obj[k] = v[0];
                }
            }
        });
        next();
    };
}

/**
 * Attach CSRF token to session-free requests (double-submit cookie pattern).
 * Simple, zero-session: cookie + header must match.
 * Mounted on state-changing routes only.
 */
function csrfDoubleSubmit(options = {}) {
    const cookieName = options.cookieName || 'XSRF-TOKEN';
    const headerName = options.headerName || 'X-XSRF-TOKEN';
    const cookieOpts = {
        httpOnly: false,           // must be readable by JS
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 8,  // 8h
        ...(options.cookie || {}),
    };

    return function csrfDoubleSubmitMiddleware(req, res, next) {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            // Issue token
            const token = req.cookies?.[cookieName] || generateNonce();
            res.cookie(cookieName, token, cookieOpts);
            req.csrfToken = () => token;
            return next();
        }
        // Verify: cookie value === header value
        const cookieVal = req.cookies?.[cookieName];
        const headerVal = req.headers[headerName.toLowerCase()];
        if (!cookieVal || !headerVal || cookieVal !== headerVal) {
            const { ForbiddenError } = require('../errors/app-error');
            return next(new ForbiddenError('التحقق من صحة الطلب (CSRF). يرجى تحديث الصفحة.'));
        }
        next();
    };
}

module.exports = {
    securityHeaders,
    buildCspDirectives,
    buildV2Csp,
    buildStrictCsp,
    createCspReportCollector,
    hppGuard,
    csrfDoubleSubmit,
    generateNonce,
};
