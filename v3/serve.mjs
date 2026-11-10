import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('apps/web/dist');
const PORT = 5200;
const UPSTREAM = { host: '127.0.0.1', port: 5100 };

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
    '.txt': 'text/plain; charset=utf-8',
};

function proxy(req, res) {
    const headers = { ...req.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` };
    const up = https.request(
        {
            host: UPSTREAM.host,
            port: UPSTREAM.port,
            path: req.url,
            method: req.method,
            headers,
            rejectUnauthorized: false,
        },
        (upRes) => {
            res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            upRes.pipe(res);
        },
    );
    up.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`proxy error: ${err.message}`);
    });
    req.pipe(up);
}

http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    // API والوسائط وأصول النظام القديم يخدمها الخادم الخلفي، كما في الإنتاج.
    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/uploads/') ||
        url.pathname.startsWith('/app/assets/')
    ) {
        proxy(req, res);
        return;
    }
    if (url.pathname === '/v3') {
        res.writeHead(302, { Location: '/v3/' });
        res.end();
        return;
    }
    if (!url.pathname.startsWith('/v3/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
    }
    let rel = decodeURIComponent(url.pathname.slice(3));
    if (rel === '/' || rel === '') rel = '/index.html';
    let file = path.resolve(DIST, `.${rel}`);
    if (!file.startsWith(DIST)) {
        res.writeHead(403);
        res.end();
        return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(DIST, 'index.html');
    }
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
    console.log(`v3 review harness on http://127.0.0.1:${PORT}/v3/ -> api https://${UPSTREAM.host}:${UPSTREAM.port}`);
});
