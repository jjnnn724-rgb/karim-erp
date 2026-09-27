/**
 * load-test.js — اختبار ضغط للسيرفر (بدون تأثير على البيانات الحقيقية)
 * 
 * يعمل requests متزامنة لـ endpoints مختلفة ويقيس:
 * - عدد الطلبات في الثانية (RPS)
 * - متوسط وقت الاستجابة (latency)
 * - معدل النجاح والفشل
 * - أعلى وأدنى وقت استجابة
 */

const https = require('https');
const { performance } = require('perf_hooks');

// إعدادات الاختبار
const CONFIG = {
    host: 'localhost',
    port: 5001,
    endpoints: [
        { path: '/api/health', method: 'GET' },
        { path: '/api/auth/login', method: 'POST', body: { username: 'admin', password: 'Admin@2026' } },
    ],
    // عدد الطلبات الكلي
    totalRequests: 50,
    // عدد الطلبات المتزامنة في كل دفعة
    concurrency: 5,
    // تأخير بين الدفعات (مللي ثانية)
    batchDelay: 100,
};

// مساعدة للطلب HTTPS
function httpsRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                    time: 0, // يحدد لاحقًا
                });
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// إرسال طلب واحد외품endpoint
async function sendRequest(endpoint, startTime) {
    const options = {
        hostname: CONFIG.host,
        port: CONFIG.port,
        path: endpoint.path,
        method: endpoint.method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        rejectUnauthorized: false,
    };

    try {
        const start = performance.now();
        const res = await httpsRequest(options, endpoint.body || null);
        res.time = performance.now() - start;
        res.success = res.status >= 200 && res.status < 400;
        return res;
    } catch (err) {
        return {
            success: false,
            error: err.message,
            time: performance.now() - startTime,
            status: 0,
        };
    }
}

// تشغيل الاختبار على endpoint واحد
async function testEndpoint(endpoint, totalReqs, concurrency) {
    console.log(`\n🔥 اختبار endpoint: ${endpoint.method} ${endpoint.path}`);
    console.log(`   إجمالي الطلبات: ${totalReqs} | التزامن: ${concurrency}`);

    const results = [];
    const errors = [];
    let completed = 0;
    let startedAt = performance.now();

    function sendBatch() {
        const batchSize = Math.min(concurrency, totalReqs - completed);
        if (batchSize <= 0) return;

        const batchPromises = [];
        for (let i = 0; i < batchSize; i++) {
            batchPromises.push(
                sendRequest(endpoint, startedAt).then(res => {
                    results.push(res);
                    if (!res.success) errors.push(res);
                    completed++;
                })
            );
        }

        return Promise.all(batchPromises).then(() => {
            if (completed < totalReqs) {
                return new Promise(r => setTimeout(r, CONFIG.batchDelay)).then(sendBatch);
            }
        });
    }

    await sendBatch();
    const totalTime = performance.now() - startedAt;

    // تحليل النتائج
    const times = results.map(r => r.time).sort((a, b) => a - b);
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const medianIndex = Math.floor(times.length / 2);
    const medianTime = times.length > 0 ? times[medianIndex] : 0;
    const p95Index = Math.floor(times.length * 0.95);
    const p95Time = times.length > 0 ? times[p95Index] : 0;

    const rps = completed / (totalTime / 1000);

    console.log(`\n📊 النتائج:`);
    console.log(`   إجمالي الوقت: ${(totalTime / 1000).toFixed(2)} ثانية`);
    console.log(`   الطلبات/natore: ${completed}`);
    console.log(`   الطلبات الناجحة: ${successful.length} (${(successful.length / completed * 100).toFixed(1)}%)`);
    console.log(`   الطلبات الفاشلة: ${failed.length} (${(failed.length / completed * 100).toFixed(1)}%)`);
    console.log(`   🚀 الطلبات في الثانية (RPS): ${rps.toFixed(2)}`);
    console.log(`   ⏱️  متوسط الوقت: ${avgTime.toFixed(2)} ميلي ثانية`);
    console.log(`   ⏱️  والوسيط (median): ${medianTime.toFixed(2)} ميلي ثانية`);
    console.log(`   ⏱️  P95 (95% أقل من): ${p95Time.toFixed(2)} ميلي ثانية`);
    console.log(`   ⏱️  أقل وقت: ${times[0]?.toFixed(2) || 0} ميلي ثانية`);
    console.log(`   ⏱️  أعلى وقت: ${times[times.length - 1]?.toFixed(2) || 0} ميلي ثانية`);

    if (failed.length > 0) {
        console.log(`\n❌ أمثلة على الطلبات الفاشلة:`);
        failed.slice(0, 5).forEach((f, i) => {
            console.log(`   ${i + 1}. ${f.error || `HTTP ${f.status}`}`);
        });
    }

    return { successful, failed, rps, avgTime, medianTime, p95Time, totalTime };
}

// ─── تشغيل الاختبارات ────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║     اختبار ضغط السيرفر — Load Test              ║');
    console.log('║     servidor: https://localhost:5001              ║');
    console.log('╚══════════════════════════════════════════════════╝');

    // التحقق من أن السيرفر يعمل
    console.log('\n🔍 التحقق من أن السيرفر يعمل...');
    try {
        const health = await httpsRequest({
            hostname: CONFIG.host,
            port: CONFIG.port,
            path: '/api/health',
            rejectUnauthorized: false,
        });
        if (health.status === 200) {
            console.log('✅ السيرفر يعمل (HTTP 200)');
        } else {
            console.log(`⚠️  السيرفر يستجيب بـ HTTP ${health.status}`);
        }
    } catch (err) {
        console.log(`❌ السيرفر غير متاح: ${err.message}`);
        console.log('💡 تأكد من تشغيل السيرفر أولاً: PORT=5001 node backend/server.js');
        process.exit(1);
    }

    // تشغيل الاختبارات
    const summary = [];
    for (const endpoint of CONFIG.endpoints) {
        const result = await testEndpoint(endpoint, CONFIG.totalRequests, CONFIG.concurrency);
        summary.push({ endpoint: `${endpoint.method} ${endpoint.path}`, ...result });
    }

    // ملخص نهائي
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║     الملخص النهائي — Summary                      ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
    console.log('endpoint                            | RPS   | Avg(ms) | Median | Result');
    console.log('-------------------------------------|-------|---------|--------|---------------------------');
    for (const s of summary) {
        const status = s.failed.length === 0 ? '✅ PASS' : '❌ FAIL';
        console.log(
            `${s.endpoint.padEnd(35)} | ${s.rps.toFixed(1).padStart(5)} | ${s.avgTime.toFixed(1).padStart(7)} | ${s.medianTime.toFixed(1).padStart(6)} | ${status}`
        );
    }

    process.exit(0);
}

main().catch(err => {
    console.error('❌ خطأ في الاختبار:', err);
    process.exit(1);
});
