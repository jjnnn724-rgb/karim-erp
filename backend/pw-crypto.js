// pw-crypto.js — مجمع خيوط لتشفير/مطابقة كلمات المرور
// ROOT FIX 2026-10-02: نفس bcryptjs وهاشات نفسها، لكن التنفيذ في خيوط عاملة
// (SIZE = min(4, الأنوية−1)) — الخيط الرئيسي يبقى حيًا تحت أي عاصفة دخول.
'use strict';
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const bcryptjs = require('bcryptjs');

const SIZE = Math.max(2, Math.min(4, (os.cpus().length || 4) - 1));
const workers = new Array(SIZE).fill(null);
const pending = new Map();
let next = 0;
let jobId = 0;

function getWorker(i) {
    if (!workers[i] || workers[i] === null) {
        const w = new Worker(path.join(__dirname, 'pw-worker.js'));
        w.unref ? null : null;
        w.on('message', (msg) => {
            const p = pending.get(msg.id);
            if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg.out) : p.reject(new Error(msg.err)); }
        });
        w.on('error', (err) => {
            workers[i] = null;
            for (const [k, p] of pending) { p.reject(err); pending.delete(k); }
        });
        workers[i] = w;
    }
    return workers[i];
}
function dispatch(job) {
    const id = ++jobId;
    const w = getWorker(next);
    next = (next + 1) % SIZE;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, ...job }); });
}
async function hash(pw, cost = 12) {
    if (!pw) {throw new Error('empty password');}
    try { return await dispatch({ op: 'hash', pw, cost }); }
    catch (e) { if (String(e.message).includes('worker')) {return bcryptjs.hash(pw, cost);} throw e; }
}
async function compare(pw, storedHash) {
    try { return await dispatch({ op: 'compare', pw, hash: storedHash }); }
    catch (e) { if (String(e.message).includes('worker')) {return bcryptjs.compare(pw, storedHash);} throw e; }
}
const hashSync = (pw, cost = 12) => bcryptjs.hashSync(pw, cost);
module.exports = { hash, compare, hashSync, SIZE };
