/**
 * face-engine-v2.js — ArcFace R100 server-side face embeddings (Apache-2.0 model)
 * ────────────────────────────────────────────────────────────────────────────
 * UPGRADE 2026-10-01: بديل محرك face-api (128-d على العميل) بمحرك 512-d يعمل
 * على السيرفر — إزالة تباين كاميرا/إضاءة العميل الذي سبب «سجّل الوجه ولا يقبل».
 *
 * الموديل: face-recognition-resnet100-arcface-onnx (Apache-2.0، OpenVINO OMZ /
 * onnx/models) — backend/face-models-v2/arcface-r100.onnx — LFW 99.68%.
 * الإدخال: 1x3x112x112 RGB مع تطبيع (x-127.5)/127.5. الخرج: fc1 × 512.
 *
 * القص موضع العميل (face-api كاشف موجود أصلًا يرسل قصاصة الوجه 112-160px)،
 * والسيرفر يطبّع وينتج المتجه. المتجهات تُطبع L2 فتكون مسافة الإقليدية مكافئة
 * للتشابه الكوسيني (cos = 1 - d²/2).
 */
'use strict';

const path = require('path');
const fs = require('fs');
let ort = null;      // تحميل كسول — الفشل لا يوقع السيرفر
let sharpLib = null;
let sessionPromise = null;

const MODEL_PATH = path.join(__dirname, 'face-models-v2', 'arcface-r100.onnx');
const DETECTOR_PATH = path.join(__dirname, 'face-models-v2', 'version-RFB-320.onnx'); // UltraFace — MIT
const EMB_DIM = 512;

function lazyDeps() {
    // الوحدة الأصلية قد لا تكون مثبَّتة (بيئة CI مثلاً) ⇒ لا نُسقط الخادم:
    // محرّك البصمة يعود معطّلًا برسالة واضحة بدل crash.
    if (!ort) {try {ort = require('onnxruntime-node');} catch (e) {ort = null; logger.warn('[FACE] onnxruntime غير متاح — محرّك البصمة معطّل:', e.message);}}
    if (!sharpLib) {sharpLib = require('sharp');}
    return { ort, sharp: sharpLib };
}

function modelAvailable() {
    return fs.existsSync(MODEL_PATH) && fs.existsSync(DETECTOR_PATH);
}

function getSession() {
    if (!sessionPromise) {
        const { ort } = lazyDeps();
        sessionPromise = ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['cpu'] });
    }
    return sessionPromise;
}

let detSessionPromise = null;
function getDetector() {
    if (!detSessionPromise) {
        const { ort } = lazyDeps();
        detSessionPromise = ort.InferenceSession.create(DETECTOR_PATH, { executionProviders: ['cpu'] });
    }
    return detSessionPromise;
}

/**
 * كشف وجه على السيرفر (UltraFace RFB-320 — MIT).
 * يمنع تمرير صور غير وجوه إلى محرك التعمية (ثغرة الإدخال خارج النطاق:
 * ArcFace ينتج متجهات متشابهة لأي محتوى غير وجه).
 * @returns {Promise<{score:number, rel:{x,y,w,h}}|null>} box نسبةً لأبعاد الصورة
 */
async function detectFace(imageBuffer) {
    const { ort, sharp } = lazyDeps();
    const session = await getDetector();
    const { data } = await sharp(imageBuffer).removeAlpha().resize(320, 240, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const chw = new Float32Array(3 * 240 * 320);
    const plane = 240 * 320;
    for (let i = 0; i < plane; i++) {
        chw[i] = (data[i * 3] - 127) / 128;
        chw[plane + i] = (data[i * 3 + 1] - 127) / 128;
        chw[2 * plane + i] = (data[i * 3 + 2] - 127) / 128;
    }
    const out = await session.run({ input: new ort.Tensor('float32', chw, [1, 3, 240, 320]) });
    // تحديد المخارج بالشكل لا بالموضع: scores [1,N,2] و boxes [1,N,4]
    let scores = null, boxes = null;
    for (const name of Object.keys(out)) {
        const d = out[name].dims;
        if (d.length === 3 && d[2] === 2) {scores = out[name].data;}
        else if (d.length === 3 && d[2] === 4) {boxes = out[name].data;}
    }
    if (!scores || !boxes) {return null;}
    const n = scores.length / 2;
    let best = -1, bestScore = 0;
    for (let i = 0; i < n; i++) {
        if (scores[i * 2 + 1] > bestScore) {bestScore = scores[i * 2 + 1]; best = i;}
    }
    if (bestScore < 0.5) {return null;}
    const b = Array.from(boxes.slice(best * 4, best * 4 + 4));
    // FIX: صندوق الموديل مُطبَّع (0-1) أصلاً — القسمة على أبعاد المدخل كانت
    // تُنتج صناديق بحجم صفر فتفشل كل عمليات التسجيل/المطابقة
    return {
        score: bestScore,
        rel: { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] },
    };
}

/** L2 normalization — يجعل المقارنة كوسينية نظيفة */
function l2normalize(vec) {
    let sum = 0;
    for (const v of vec) {sum += v * v;}
    const n = Math.sqrt(sum) || 1;
    return vec.map((v) => v / n);
}

/** cosine similarity لمتجهين مفترضيهما L2-normalized */
function cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {dot += a[i] * b[i];}
    return dot;
}

/**
 * ينتج متجه الوجه 512-d من صورة لقطة وجه.
 * 1) كشف وجه إلزامي على السيرفر — الصور بلا وجه تُرفض (إغلاق ثغرة الإدخال).
 * 2) قصّ صندوق الوجه بهامش 25% → 112×112 RGB → تطبيع [-1,1] → ArcFace.
 * @returns {Promise<number[]|null>} متجه 512 مقنّع L2 — أو null إذا لا وجه
 */
async function embedFaceImage(imageBuffer) {
    const { ort, sharp } = lazyDeps();
    const det = await detectFace(imageBuffer);
    if (!det) {return null;}
    const meta = await sharp(imageBuffer).metadata();
    const W = meta.width || 160, H = meta.height || 160;
    const bx = det.rel.x * W, by = det.rel.y * H, bw = det.rel.w * W, bh = det.rel.h * H;
    const m = Math.max(bw, bh) * 0.25;
    const left = Math.max(0, Math.round(bx - m));
    const top = Math.max(0, Math.round(by - m));
    const width = Math.min(W - left, Math.round(bw + m * 2));
    const height = Math.min(H - top, Math.round(bh + m * 2));
    if (width < 40 || height < 40) {return null;}
    const session = await getSession();
    const { data, info } = await sharp(imageBuffer)
        .removeAlpha()
        .extract({ left, top, width, height })
        .resize(112, 112, { fit: 'cover' })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const chw = new Float32Array(3 * 112 * 112);
    const plane = 112 * 112;
    for (let i = 0; i < plane; i++) {
        chw[i] = (data[i * info.channels] - 127.5) / 127.5;           // R
        chw[plane + i] = (data[i * info.channels + 1] - 127.5) / 127.5; // G
        chw[2 * plane + i] = (data[i * info.channels + 2] - 127.5) / 127.5; // B
    }
    const tensor = new ort.Tensor('float32', chw, [1, 3, 112, 112]);
    const out = await session.run({ [session.inputNames[0]]: tensor });
    const raw = Array.from(out[session.outputNames[0]].data);
    return l2normalize(raw);
}

/** مطابقة: أعلى تشابه كوسيني بين البصمة الحية وأي عينة من القالب */
function matchEmbedding(candidate, storedSamples) {
    const arr = Array.isArray(storedSamples) && Array.isArray(storedSamples[0]) ? storedSamples : [storedSamples];
    let best = -Infinity;
    for (const s of arr) {
        if (!Array.isArray(s) || s.length !== EMB_DIM) {continue;}
        const c = cosineSimilarity(candidate, s);
        if (c > best) {best = c;}
    }
    return Number.isFinite(best) ? best : null;
}

module.exports = { embedFaceImage, matchEmbedding, cosineSimilarity, l2normalize, modelAvailable, EMB_DIM, detectFace };
