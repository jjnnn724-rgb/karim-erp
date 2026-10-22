/**
 * ai-assistant/tools.js — أدوات المساعد وصلاحياته
 * ══════════════════════════════════════════════════════════════════════
 * مبدأ الصلاحيات: المساعد لا يملك صلاحية مستقلة — يعمل **بصلاحية من
 * يطلبه** (الأدمن = المالك). كل كتابة تمرّ من بوابة النظام نفسها
 * (تحقّق + سجل تدقيق + قواعد الضريبة) ⇒ لا طريق جانبي ولا تجاوز.
 *
 * ثلاث طبقات، كما طلب المالك:
 *   1) قراءة   : أي جدول/شاشة/كود في النظام (قراءة فقط).
 *   2) اقتراح : المساعد يصوغ (مسوّدة) لا ينفّذ.
 *   3) تنفيذ  : المسوّدة لا تُنفَّذ إلا بموافقة المالك من اللوحة.
 *
 * 금지ٌ صريح: لا حذف ولا تعديل أصناف المخزن ولا وصفات الإنتاج ولا
 * إقفال اليوم — هذه للمالك وحده (المخزن خط أحمر).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const ROOT = path.resolve(__dirname, '..', '..');

/* المسوّدة: في الذاكرة (ن ephemerة) — لا جداول جديدة، ولا أثر دائم. */
const drafts = new Map();
let draftSeq = 0;

/* الجداول المسموح قراءتها (كل ما في public) — القراءة فقط. */
const READ_ONLY = true;

/* ───────────────────────── أدوات القراءة ───────────────────────── */

/** جداول النظام (أسماؤها) — المصدر: information_schema. */
async function listTables() {
    const r = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_type='BASE TABLE'
          ORDER BY table_name`);
    return r.rows.map((x) => x.table_name);
}

/** قراءة صفوف من جدول (قراءة فقط + سقف صفوف + أعمدة صريحة). */
async function readTable(table, { limit = 20, order = 'id DESC' } = {}) {
    const name = String(table || '').replace(/[^a-z0-9_]/gi, '');
    if (!name) {throw new Error('BAD_TABLE');}
    const exists = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = $1`, [name]);
    if (!exists.rows.length) {throw new Error('TABLE_NOT_FOUND: ' + name);}
    const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = $1 ORDER BY ordinal_position`, [name]);
    const orderCol = cols.rows.some((c) => c.column_name === order.split(' ')[0]) ? order : '1';
    const r = await pool.query(`SELECT * FROM public."${name}" ORDER BY ${orderCol} LIMIT ${Math.min(Number(limit) || 20, 200)}`);
    return { table: name, columns: cols.rows.map((c) => c.column_name), rows: r.rows };
}

/** بحث نصّي في أعمدة نصية لجدول (قراءة فقط). */
async function searchTable(table, term, { limit = 20 } = {}) {
    const name = String(table || '').replace(/[^a-z0-9_]/gi, '');
    if (!name) {throw new Error('BAD_TABLE');}
    const cols = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema='public' AND table_name = $1
            AND data_type IN ('text','character varying','character')`, [name]);
    if (!cols.rows.length) {return { table: name, rows: [] };}
    const where = cols.rows.map((c, i) => `CAST("${c.column_name}" AS TEXT) ILIKE $${i + 1}`).join(' OR ');
    const params = cols.rows.map(() => `%${String(term || '').trim()}%`);
    const r = await pool.query(`SELECT * FROM public."${name}" WHERE ${where} LIMIT ${Math.min(Number(limit) || 20, 100)}`, params);
    return { table: name, rows: r.rows };
}

/** بحث في كود المشروع (قراءة ملفات فقط). */
function searchCode(pattern, { limit = 20 } = {}) {
    const needle = String(pattern || '').trim();
    if (!needle) {return { hits: [] };}
    const hits = [];
    const skip = new Set(['node_modules', '.git', 'coverage', 'logs', 'database\\backups', 'var', 'runtime']);
    const walk = (dir, depth) => {
        if (depth > 6 || hits.length >= limit) {return;}
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (skip.has(e.name)) {continue;}
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {walk(p, depth + 1); continue;}
            if (!/\.(js|mjs|css|html|sql|md)$/.test(e.name)) {continue;}
            let txt;
            try { txt = fs.readFileSync(p, 'utf8'); } catch (_err) {continue;}
            txt.split(/\r?\n/).forEach((line, i) => {
                if (hits.length < limit && line.includes(needle)) {
                    hits.push({ file: path.relative(ROOT, p).replace(/\\/g, '/'), line: i + 1, text: line.trim().slice(0, 160) });
                }
            });
        }
    };
    walk(ROOT, 0);
    return { hits };
}

/* ───────────────────────── المسوّدة والتنفيذ ───────────────────────── */

const WRITABLE = new Set(['expenses', 'revenues']);

/**
 * مسوّدة: يقترح المساعد تعديلًا، ولا يُنفَّذ شيء بعد.
 * @param {'expense'|'revenue'} kind
 * @param {object} payload
 */
function draft(kind, payload) {
    if (!WRITABLE.has(kind === 'expense' ? 'expenses' : 'revenues')) {
        throw new Error('NOT_WRITABLE: ' + kind);
    }
    draftSeq += 1;
    const id = `d${Date.now().toString(36)}-${draftSeq}`;
    const draftRow = {
        id, kind, payload,
        status: 'pending',
        createdAt: new Date().toISOString(),
    };
    drafts.set(id, draftRow);
    return draftRow;
}

/** المسوّدات المعلّقة. */
function listDrafts() {
    return [...drafts.values()].filter((d) => d.status === 'pending');
}

/**
 * تنفيذ مسوّدة: يكتب عبر بوابة النظام نفسها (PUT/POST على /api/<kind>)
 * بصلاحية المالك نفسه ⇒ كل تحقّقٍ وسجلِ تدقيقٍ في النظام يسري كما هو.
 * @param {string} id
 * @param {{token:string, user?:object}} ctx
 */
async function applyDraft(id, ctx) {
    const d = drafts.get(id);
    if (!d) {throw new Error('DRAFT_NOT_FOUND');}
    if (d.status !== 'pending') {throw new Error('DRAFT_ALREADY_' + String(d.status).toUpperCase());}
    const path = d.kind === 'expense' ? '/expenses' : '/revenues';
    const res = await callSelf(path, d.payload, ctx);
    d.status = res.ok ? 'applied' : 'failed';
    d.appliedAt = new Date().toISOString();
    d.result = res;
    if (res.ok) {logger.info(`[ai-assistant] مسوّدة ${id} (${d.kind}) طُبّقت بواسطة ${(ctx.user && ctx.user.username) || '؟'}`);}
    else {logger.warn(`[ai-assistant] مسوّدة ${id} (${d.kind}) فشلت: ${res.message}`);}
    return d;
}

/** رفض مسوّدة. */
function rejectDraft(id) {
    const d = drafts.get(id);
    if (!d) {throw new Error('DRAFT_NOT_FOUND');}
    d.status = 'rejected';
    d.rejectedAt = new Date().toISOString();
    return d;
}

/** نداء داخلي لنفس الخادم — بنفس قواعده (تحقّق + تدقيق + صلاحيات). */
async function callSelf(path, payload, ctx) {
    const base = process.env.SELF_BASE_URL || `https://127.0.0.1:${process.env.PORT || 5000}`;
    const https = require('https');
    const http = require('http');
    const u = new URL(path, base);
    const mod = u.protocol === 'http:' ? http : https;
    const body = JSON.stringify(payload);
    const apiKey = String(process.env.API_KEY || '').trim();
    return new Promise((resolve) => {
        const req = mod.request({
            hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                ...(ctx && ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
                ...(apiKey ? { 'x-api-key': apiKey } : {}),
            },
            timeout: 20000,
        }, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (_e) { /* غير JSON */ }
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    message: (parsed && (parsed.message || parsed.error)) || String(raw).slice(0, 160),
                    body: parsed,
                });
            });
        });
        req.on('error', (e) => resolve({ ok: false, status: 0, message: String(e.message).slice(0, 120) }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, message: 'انتهت المهلة' }); });
        req.write(body);
        req.end();
    });
}

/* ───────────────────────── تعريف الأدوات للنموذج ───────────────────────── */

const TOOL_DEFS = [
    {
        type: 'function',
        function: {
            name: 'list_tables',
            description: 'يسرد جداول النظام (أسماء فقط). استخدمه قبل أي قراءة لتعرف اسم الجدول الصحيح.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_table',
            description: 'يقرأ صفوفًا من جدول (قراءة فقط، بلا تعديل). استخدم limit للقليل من الصفوف.',
            parameters: {
                type: 'object',
                properties: {
                    table: { type: 'string', description: 'اسم الجدول' },
                    limit: { type: 'integer', description: 'أقصى عدد صفوف (20 افتراضيًا)' },
                },
                required: ['table'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_table',
            description: 'يبحث نصًّا داخل أعمدة جدول نصّية.',
            parameters: {
                type: 'object',
                properties: {
                    table: { type: 'string' },
                    term: { type: 'string' },
                    limit: { type: 'integer' },
                },
                required: ['table', 'term'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_code',
            description: 'يبحث نصًّا في كود المشروع (قراءة ملفات فقط).',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string' },
                    limit: { type: 'integer' },
                },
                required: ['pattern'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_drafts',
            description: 'يسرد المسوّدات المعلّقة (تعديلات مقترحة لم تُنفَّذ).',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'draft_expense',
            description: 'يقترح تسجيل مصروف (مسوّدة فقط — لا يُنفَّذ إلا بموافقة المالك).',
            parameters: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'التاريخ YYYY-MM-DD' },
                    deptId: { type: 'string', description: 'قسم المصروف' },
                    amount: { type: 'number', description: 'المبلغ' },
                    method: { type: 'string', description: 'طريقة الدفع' },
                    note: { type: 'string', description: 'بيان' },
                },
                required: ['date', 'deptId', 'amount'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'draft_revenue',
            description: 'يقترح تسجيل إيراد (مسوّدة فقط — لا يُنفَّذ إلا بموافقة المالك).',
            parameters: {
                type: 'object',
                properties: {
                    date: { type: 'string', description: 'التاريخ YYYY-MM-DD' },
                    deptId: { type: 'string', description: 'قسم الإيراد' },
                    amount: { type: 'number', description: 'المبلغ' },
                    method: { type: 'string', description: 'طريقة الدفع' },
                    note: { type: 'string', description: 'بيان' },
                },
                required: ['date', 'deptId', 'amount'],
            },
        },
    },
];

/* ───────────────────────── منفّذ الأدوات ───────────────────────── */

/**
 * ينفّذ أداة واحدة (بصلاحيات المالك) ويعيد نتيجتها كنصّ.
 * @param {string} name
 * @param {object} args
 * @param {{token:string, user?:object}} ctx
 */
async function runTool(name, args) {
    const a = args || {};
    switch (name) {
        case 'list_tables': {
            const tables = await listTables();
            return { ok: true, text: `جداول النظام (${tables.length}): ` + tables.join('، ') };
        }
        case 'read_table': {
            const r = await readTable(a.table, { limit: a.limit });
            return { ok: true, text: JSON.stringify(r).slice(0, 6000), data: r };
        }
        case 'search_table': {
            const r = await searchTable(a.table, a.term, { limit: a.limit });
            return { ok: true, text: JSON.stringify(r).slice(0, 6000), data: r };
        }
        case 'search_code': {
            const r = searchCode(a.pattern, { limit: a.limit });
            return { ok: true, text: JSON.stringify(r).slice(0, 6000), data: r };
        }
        case 'list_drafts': {
            const list = listDrafts();
            return { ok: true, text: list.length ? JSON.stringify(list).slice(0, 4000) : 'لا مسوّدات معلّقة.' };
        }
        case 'draft_expense':
        case 'draft_revenue': {
            const kind = name === 'draft_expense' ? 'expense' : 'revenue';
            const d = draft(kind, a);
            return {
                ok: true,
                text: `أُنشئت مسوّدة ${d.id} (${kind === 'expense' ? 'مصروف' : 'إيراد'}) — لم يُنفَّذ شيء بعد: يحتاج موافقة المالك من اللوحة.`,
                draft: d,
            };
        }
        default:
            return { ok: false, text: 'أداة غير معروفة: ' + name };
    }
}

module.exports = {
    TOOL_DEFS, runTool, draft, listDrafts, applyDraft, rejectDraft,
    readTable, searchTable, searchCode, listTables, callSelf, READ_ONLY,
};
