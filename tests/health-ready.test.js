/**
 * health-ready.test.js — TASK 8: /live always 200; /ready 503 on
 * database/outbox/websocket fail, 200 otherwise. Real HTTP, no DB.
 */

const express = require('express');
const http = require('http');
const { createHealthRouter, registerCheck } = require('../backend/middleware/health');

function serve(router) {
    const app = express();
    app.use(router);
    const srv = app.listen(0);
    const port = srv.address().port;
    const get = (p) => new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: p }, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
        }).on('error', reject);
    });
    return { srv, get };
}

describe('health endpoints (TASK 8)', () => {
    test('/live always 200', async () => {
        const { srv, get } = serve(createHealthRouter({ pool: null, redis: null }));
        try {
            const r = await get('/live');
            expect(r.status).toBe(200);
            expect(r.body.status).toBe('ok');
        } finally { srv.close(); }
    });

    test('/ready 200 when checks ok', async () => {
        registerCheck(() => ({ component: 't8_ok_probe', status: 'ok' }));
        const { srv, get } = serve(createHealthRouter({ pool: null, redis: null }));
        try {
            const r = await get('/ready');
            expect(r.status).toBe(200);
            expect(['ok', 'warn']).toContain(r.body.status);
        } finally { srv.close(); }
    });

    test('/ready 503 when outbox fails', async () => {
        registerCheck(() => ({ component: 'outbox', status: 'fail', details: { lagSec: 999 } }));
        const { srv, get } = serve(createHealthRouter({ pool: null, redis: null }));
        try {
            const r = await get('/ready');
            expect(r.status).toBe(503);
            expect(r.body.status).toBe('fail');
        } finally { srv.close(); }
    });

    test('/ready 503 when websocket down', async () => {
        registerCheck(() => ({ component: 'websocket', status: 'fail' }));
        const { srv, get } = serve(createHealthRouter({ pool: null, redis: null }));
        try {
            const r = await get('/ready');
            expect(r.status).toBe(503);
        } finally { srv.close(); }
    });
});
