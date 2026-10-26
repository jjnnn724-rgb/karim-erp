// pw-worker.js — خيط عامل: bcryptjs يُنفَّذ هنا بعيدًا عن الخيط الرئيسي
// (ROOT FIX 2026-10-02: bcryptjs نسخة JS خالصة كانت تسد event-loop كاملًا —
// عاصفة دخول واحدة تُجمّد النظام كله 8-15 ثانية — القياسات في تقرير الضغط).
const bcrypt = require('bcryptjs');
const { parentPort } = require('worker_threads');
parentPort.on('message', async (job) => {
    try {
        const out = job.op === 'hash'
            ? await bcrypt.hash(job.pw, job.cost || 12)
            : await bcrypt.compare(job.pw, job.hash);
        parentPort.postMessage({ id: job.id, ok: true, out });
    } catch (e) {
        parentPort.postMessage({ id: job.id, ok: false, err: e.message });
    }
});
