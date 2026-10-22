/**
 * ai-assistant/local-llm.js — عقلٌ محلي بلا أي مفتاح API
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: المساعد يجب أن يعمل بصلاحيات المالك وبلا خدمة سحابية ت��ى
 * مفاتيح أو ترسل أرقام المحل إلى الخارج. ⇒ نموذج صغير يعمل على الجهاز
 * (Ollama) + أدواتٍ-limited تُنفَّذ في العملية نفسها.
 *
 * المعايير:
 *   · لا يغادر الجهاز شيء: الطلب إلى 127.0.0.1 فقط.
 *   · مهلة قصيرة (النموذج على المعالج بطيء) —<Response سريع أو صريح.
 *   · تدهورٌ رشيق: إن كان النموذج غائبًا ⇒ يعود المساعد إلى الوضع
 *     القواعدي (الحقائق مباشرة) بدل أن يفشل.
 */
'use strict';

const http = require('http');
const { URL } = require('url');

const HOST = String(process.env.LOCAL_LLM_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MODEL = String(process.env.LOCAL_LLM_MODEL || 'qwen2.5:1.5b-instruct');
const TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS || 90000);
const TAGS_TIMEOUT_MS = 1500;

function post(path, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const u = new URL(path, HOST);
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: u.hostname,
            port: u.port || 11434,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: timeoutMs,
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch (e) { reject(new Error('LOCAL_LLM_PARSE: ' + String(e.message).slice(0, 80))); }
            });
        });
        req.on('error', (e) => reject(new Error('LOCAL_LLM_NET: ' + String(e.message).slice(0, 80))));
        req.on('timeout', () => { req.destroy(); reject(new Error('LOCAL_LLM_TIMEOUT')); });
        req.write(data);
        req.end();
    });
}

function get(path, timeoutMs) {
    return new Promise((resolve, reject) => {
        const u = new URL(path, HOST);
        const req = http.request({
            hostname: u.hostname, port: u.port || 11434, path: u.pathname + u.search, method: 'GET', timeout: timeoutMs,
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch (_e) { reject(new Error('LOCAL_LLM_PARSE')); }
            });
        });
        req.on('error', (_e) => reject(new Error('LOCAL_LLM_NET')));
        req.on('timeout', () => { req.destroy(); reject(new Error('LOCAL_LLM_TIMEOUT')); });
        req.end();
    });
}

/** هل النموذج المحلي حاضر؟ (فحص سريع — ثانيتان) */
let availableCache = { at: 0, value: false };
async function available() {
    if (Date.now() - availableCache.at < 30_000) {return availableCache.value;}
    const ok = await get('/api/tags', TAGS_TIMEOUT_MS)
        .then((r) => ((r.body && r.body.models) || []).length > 0)   // أي نموذج محلي يكفي
        .catch(() => false);
    availableCache = { at: Date.now(), value: ok };
    return ok;
}

/** اسم النموذج المتاح فعليًا (أو الاسم المطلوب). */
async function activeModel() {
    try {
        const r = await get('/api/tags', TAGS_TIMEOUT_MS);
        const models = (r.body && r.body.models) || [];
        const exact = models.find((m) => String(m.name || '') === MODEL);
        if (exact) {return exact.name;}
        const same = models.find((m) => String(m.name || '').split(':')[0] === MODEL.split(':')[0]);
        return same ? same.name : (models[0] ? models[0].name : MODEL);
    } catch (_e) { return MODEL; }
}

/**
 * محادثة واحدة مع النموذج المحلي، مع أدوات (tool calls).
 * @param {{system:string, messages:Array, tools?:Array, temperature?:number, maxTokens?:number}} input
 * @returns {Promise<{text:string, toolCalls:Array}>}
 */
async function chat(input) {
    const model = await activeModel();
    const res = await post('/api/chat', {
        model,
        messages: [
            { role: 'system', content: input.system },
            ...(input.messages || []),
        ],
        tools: input.tools && input.tools.length ? input.tools : undefined,
        stream: false,
        keep_alive: '10m',
        options: {
            temperature: typeof input.temperature === 'number' ? input.temperature : 0.2,
            num_predict: input.maxTokens || 900,
            num_ctx: 4096,
        },
    }, TIMEOUT_MS);
    if (res.status !== 200) {
        throw new Error('LOCAL_LLM_HTTP_' + res.status + ': ' + String((res.body && res.body.error) || '').slice(0, 100));
    }
    const msg = (res.body && res.body.message) || {};
    const toolCalls = (msg.tool_calls || []).map((t) => ({
        name: t.function && t.function.name,
        arguments: (() => {
            try { return JSON.parse((t.function && t.function.arguments) || '{}'); }
            catch (_e) { return {}; }
        })(),
    }));
    return { text: String(msg.content || '').trim(), toolCalls, model };
}

module.exports = { available, activeModel, chat, MODEL, HOST };
