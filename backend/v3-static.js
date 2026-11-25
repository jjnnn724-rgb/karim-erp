'use strict';
/**
 * الواجهة الثالثة (React) — تُخدَم من بُنية `frontend/v3` المبنية مسبقًا
 * تحت المسار `/v3` على نفس الأصل (ADR-02: داخل Express، لا على أصلٍ آخر).
 *
 * ثلاث مسؤوليات:
 *  1. **الخدمة**: أصول Vite المبصوصة بـhash تُخزَّن immutable سنة، و`index.html`
 *     بلا كاش — فاسم الملف نفسه هو مفتاح الإبطال.
 *  2. **قلب الشاشات (G8)**: `screens.json` يسرد كل مفاتيح V3، ويُحقن الفعّال
 *     منها في `<meta name="v3-screens">` عند كل خدمة. `V3_DISABLED_SCREENS`
 *     تُخفى من القشرة ويُحوَّل رابطها المباشر إلى V2 قبل تحميل التطبيق،
 *     لكن لا شاشة معطّلة افتراضيًا: `pnl` فُعّلت بعد مطابقة عقدها الحقيقي
 *     2026-11-10 (اختبار `apps/web/src/lib/pnl.test.ts`).
 *  3. **CSP**: نفس سياسة V2 — لا سكربتات سطرية في بُنية Vite، فـ`script-src 'self'`
 *     كافٍ، و`style-src 'unsafe-inline'` لأن مكتبة الواجهة تستخدم سمات style.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const rollout = require('./rollout');

const V3_DIR = path.join(__dirname, '..', 'frontend', 'v3');
const INDEX_FILE = path.join(V3_DIR, 'index.html');
const SCREENS_FILE = path.join(V3_DIR, 'screens.json');
const PREVIEW_DIR = path.join(V3_DIR, 'preview');
const PREVIEW_FILE = path.join(PREVIEW_DIR, 'index.html');
const LEGACY_URL = '/app/v2.html?live=1';

function readScreens() {
    try {
        const list = JSON.parse(fs.readFileSync(SCREENS_FILE, 'utf8'));
        return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && name) : [];
    } catch (_) {
        return [];
    }
}

function disabledScreens() {
    return new Set(
        String(process.env.V3_DISABLED_SCREENS ?? '')
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean),
    );
}

/**
 * HTML الدخول كما يُقدَّم — يُقرأ مرة عند الإقلاع (مع إعادة قراءة إن تغيّر
 * ملفه، فإعادة النشر لا تحتاج إعادة تشغيل الخادم).
 */
function createIndexServer() {
    let cachedKey = '';
    let cachedHtml = '';
    return function indexHtml() {
        const stat = fs.statSync(INDEX_FILE);
        // الحالة جزء من مفتاح الكاش: ساعة القلب تغيّر `v3-primary` بلا تغيّر الملف.
        const primary = rollout.v3Primary() ? '1' : '0';
        const key = `${stat.mtimeMs}:${primary}`;
        if (key !== cachedKey) {
            const screens = readScreens();
            const meta = [`    <meta name="v3-primary" content="${primary}" />`];
            if (screens.length) {
                const disabled = disabledScreens();
                const enabled = screens.filter((name) => !disabled.has(name));
                // بدون الوسم تعتبر V3 كل الشاشات مفعّلة — فالوسم شرط القلب.
                meta.push(`    <meta name="v3-screens" content="${enabled.join(',')}" />`);
            }
            cachedHtml = fs
                .readFileSync(INDEX_FILE, 'utf8')
                .replace('</head>', `${meta.join('\n')}\n    </head>`);
            cachedKey = key;
        }
        return cachedHtml;
    };
}

function register(app, opts = {}) {
    const buildCsp = opts.buildCsp;
    if (!fs.existsSync(INDEX_FILE)) {
        throw new Error(`بُنية V3 غير موجودة: ${INDEX_FILE}`);
    }
    const disabled = disabledScreens();
    const indexHtml = createIndexServer();

    app.use((req, res, next) => {
        if (req.path === '/v3' || req.path.startsWith('/v3/') || req.path.startsWith('/v3-preview')) {
            res.setHeader('Content-Security-Policy', buildCsp());
        }
        next();
    });

    // شاشة معطّلة في V3 = رابطها يعود إلى V2 مباشرة (دفاع الخادم قبل الواجهة).
    app.use('/v3', (req, res, next) => {
        const key = req.path.split('/').filter(Boolean)[0];
        if (key && disabled.has(key)) {
            res.redirect(302, LEGACY_URL);
            return;
        }
        next();
    });

    const sendIndex = (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate, proxy-revalidate');
        res.type('html').send(indexHtml());
    };
    app.get(['/v3', '/v3/', '/v3/index.html'], sendIndex);

    app.use(
        '/v3',
        express.static(V3_DIR, {
            index: false,
            etag: true,
            lastModified: true,
            setHeaders: (res, filePath) => {
                const rel = path.relative(V3_DIR, filePath).split(path.sep).join('/');
                res.setHeader(
                    'Cache-Control',
                    rel.startsWith('assets/')
                        ? 'public, max-age=31536000, immutable'
                        : 'no-cache, must-revalidate, proxy-revalidate',
                );
                res.setHeader('Vary', 'Accept-Encoding');
            },
        }),
    );

    // مسارات SPA: أي رابط بلا امتداد ملف يعود index.html؛ غيره 404 حقيقي.
    app.get('/v3/*', (req, res, next) => {
        if (path.extname(req.path)) {
            next();
            return;
        }
        sendIndex(req, res);
    });

    // ─── صفحة إعلان الانتقال /v3-preview ─────────────────────────────────
    // صفحة مستقلة عن التطبيق: تُفتح من زر «V3 · معاينة» في V2 ومن أي رسالة
    // خارجية، ولا تحتاج جلسة. غيابها لا يكسر شيئًا: تُحوَّل إلى V3 نفسه.
    if (fs.existsSync(PREVIEW_FILE)) {
        app.get(['/v3-preview', '/v3-preview/'], (req, res) => {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate, proxy-revalidate');
            res.sendFile(PREVIEW_FILE);
        });
        app.use(
            '/v3-preview',
            express.static(PREVIEW_DIR, {
                index: false,
                etag: true,
                lastModified: true,
                setHeaders: (res) => {
                    res.setHeader('Cache-Control', 'no-cache, must-revalidate, proxy-revalidate');
                },
            }),
        );
    } else {
        app.get(['/v3-preview', '/v3-preview/'], (req, res) => {
            res.redirect(302, '/v3/');
        });
    }
}

module.exports = { register, V3_DIR };
