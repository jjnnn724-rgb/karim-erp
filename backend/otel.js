/**
 * backend/otel.js — تهيئة OpenTelemetry للـ Traces/Metrics التلقائية.
 * يُحمَّل من قمة server.js (بعد dotenv مباشرة) — معطّل تمامًا ما لم
 * تكون OTEL_ENABLED=true، فلا أي أثر على التشغيل العادي.
 *
 * يصدر إلى أي جامع OTLP محلي (Jaeger/Tempo/Grafana Alloy) على
 * OTEL_EXPORTER_OTLP_ENDPOINT — بلا جامع تُهْدَر التصدير بصمت.
 * ملاحظة: يُحمَّل قبل express/pg حتى تنجح auto-instrumentation عليهما.
 */
const path = require('path');

if (global.__karimOtelStarted) {return;}

// .env قد يكون مُحمَّلًا بالفعل (require من server.js) — تأمين للطريقين.
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true }); } catch (_) {}

if (process.env.OTEL_ENABLED === 'true') {
    global.__karimOtelStarted = true;
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

    const sdk = new NodeSDK({
        serviceName: process.env.OTEL_SERVICE_NAME || 'karim-erp',
        traceExporter: new OTLPTraceExporter(),
        instrumentations: [getNodeAutoInstrumentations({
            //fs/dns صاخب بلا قيمة تشغيلية هنا — والإبقاء على http/pg/express أهم
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-dns': { enabled: false },
            '@opentelemetry/instrumentation-net': { enabled: false },
        })],
    });

    sdk.start();
    process.on('exit', () => { sdk.shutdown().catch(() => {}); });
    // إشعار صامت على stderr حتى لا يخلط مع مخرجات pino JSON
    process.stderr.write(`[otel] karim-erp tracing enabled (OTLP -> ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces'})\n`);
}
