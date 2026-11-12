import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * خادم الاختبار العام — يخدم `dist` تحت `/v3/` بنفس دلالات `backend/v3-static.js`:
 * أصول مبصومة `immutable`، و`index.html` بـ`no-cache`، وسقوط SPA إلى الصفحة.
 *
 * لا API هنا عمدًا: الحزمة العامة تختبر ما لا يحتاج جلسة (بوابة الدخول،
 * الاتجاه، التجاوب، الوصول). كل `/api/*` يردّ 404 فورًا بدل تعليق الطلب.
 */

const DIST = resolve(fileURLToPath(new URL('../../dist', import.meta.url)));
const PORT = Number(process.env.V3_E2E_PORT ?? 5320);
const BASE = '/v3';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
};

const HAS_HASH = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

function send(res, status, headers, body) {
    res.writeHead(status, headers);
    if (body !== undefined) res.end(body);
}

function serveFile(res, file, immutable) {
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
        send(
            res,
            404,
            { 'Content-Type': 'application/json; charset=utf-8' },
            JSON.stringify({
                error: 'NO_API_IN_PUBLIC_SUITE',
                message: 'الحزمة العامة لا تستخدم API',
            }),
        );
        return;
    }
    if (pathname === BASE) {
        send(res, 302, { Location: `${BASE}/` });
        return;
    }
    if (!pathname.startsWith(`${BASE}/`)) {
        send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
        return;
    }

    const relative = normalize(pathname.slice(BASE.length + 1)).replace(/\\/g, '/');
    const candidate = join(DIST, relative);
    if (!candidate.startsWith(DIST)) {
        send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'forbidden');
        return;
    }

    const isFile = existsSync(candidate) && statSync(candidate).isFile();
    if (isFile && relative !== '') {
        serveFile(res, candidate, HAS_HASH.test(candidate));
        return;
    }
    // مسار بلا امتداد = مسار تطبيق (TanStack Router) → الصفحة الواحدة.
    if (!extname(relative)) {
        serveFile(res, join(DIST, 'index.html'), false);
        return;
    }
    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`static harness on http://127.0.0.1:${PORT}${BASE}/\n`);
});
