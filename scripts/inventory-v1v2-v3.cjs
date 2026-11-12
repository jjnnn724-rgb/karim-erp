#!/usr/bin/env node
/**
 * جرد بيانات v1/v2 مقابل v3 — تقرير قراءة فقط.
 *
 * لكل جدول في قاعدة البيانات يحسب: عدد الصفوف، مدى التاريخ إن وُجد عمود تاريخ،
 * ومن يقرأه فعلًا (خادم v3 / شاشات v3 / واجهات v1-v2 القديمة). الجداول التي
 * تحمل بيانات ولا يقرأها أي سطح في v3 هي «الفجوات» التي يجب نقلها.
 *
 * الاستخدام:
 *   node scripts/inventory-v1v2-v3.cjs [--db=karim_erp] [--json=var/inventory-v1v2-v3.json] [--md=docs/v1-v2-v3-inventory.md]
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = {
    backend: path.join(ROOT, 'backend'),
    v3: path.join(ROOT, 'v3', 'apps', 'web', 'src'),
    v1v2: path.join(ROOT, 'frontend'),
};

function parseArgs(argv) {
    const out = { db: 'karim_erp', json: 'var/inventory-v1v2-v3.json', md: 'docs/v1-v2-v3-inventory.md' };
    for (const arg of argv) {
        const m = /^--(db|json|md)=(.*)$/.exec(arg);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

function readEnv() {
    const env = {};
    const file = path.join(ROOT, '.env');
    if (!fs.existsSync(file)) return env;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(line.trim());
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return env;
}

/** مسح واحد لكل الملفات: كل جدول ← الملفات التي تذكر اسمه (بدل مسحٍ لكل جدول). */
function buildReaderIndex(tables) {
    const wanted = new Set(tables);
    const index = new Map(); // table -> { backend:Set, v3:Set, v1v2:Set }
    for (const table of tables) index.set(table, { backend: new Set(), v3: new Set(), v1v2: new Set() });

    for (const [label, dir] of Object.entries(SCAN_DIRS)) {
        const walk = (current, depth) => {
            if (depth > 7 || !fs.existsSync(current)) return;
            for (const name of fs.readdirSync(current)) {
                if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
                const full = path.join(current, name);
                let stat;
                try {
                    stat = fs.statSync(full);
                } catch {
                    continue;
                }
                if (stat.isDirectory()) {
                    walk(full, depth + 1);
                    continue;
                }
                if (!/\.(js|cjs|mjs|ts|tsx)$/.test(name)) continue;
                let text;
                try {
                    text = fs.readFileSync(full, 'utf8');
                } catch {
                    continue;
                }
                const words = new Set(text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []);
                const rel = path.relative(ROOT, full).replace(/\\/g, '/');
                for (const word of words) {
                    if (!wanted.has(word)) continue;
                    index.get(word)[label].add(rel);
                }
            }
        };
        walk(dir, 0);
    }
    return index;
}

async function dateRange(client, table) {
    const cols = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1
            AND column_name IN ('date','created_at','updated_at','invoice_date','bill_date','entry_date','ts','event_time','punch_time','order_date')
          ORDER BY array_position(ARRAY['date','invoice_date','bill_date','order_date','entry_date','punch_time','event_time','ts','created_at','updated_at'], column_name)`,
        [table],
    );
    for (const row of cols.rows) {
        try {
            const r = await client.query(
                `SELECT min("${row.column_name}")::text AS first, max("${row.column_name}")::text AS last FROM "${table}"
                  WHERE "${row.column_name}" IS NOT NULL`,
            );
            if (r.rows[0]?.last) return { column: row.column_name, first: r.rows[0].first, last: r.rows[0].last };
        } catch {
            /* نوع غير قابل للمقارنة — نتجاوز */
        }
    }
    return null;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const env = readEnv();
    const client = new Client({
        host: env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT || 5432),
        database: args.db,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
    });
    await client.connect();

    const tables = (
        await client.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
        )
    ).rows.map((r) => r.table_name);

    const index = buildReaderIndex(tables);
    const rows = [];
    for (const table of tables) {
        let count = 0;
        try {
            count = (await client.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n;
        } catch {
            continue;
        }
        if (count === 0) continue;
        const readers = index.get(table);
        rows.push({
            table,
            rows: count,
            range: await dateRange(client, table),
            backend: readers.backend.size,
            v3: readers.v3.size,
            v1v2: readers.v1v2.size,
            sample: {
                backend: [...readers.backend].slice(0, 3),
                v3: [...readers.v3].slice(0, 3),
                v1v2: [...readers.v1v2].slice(0, 2),
            },
        });
    }

    rows.sort((a, b) => b.rows - a.rows);
    // فجوة = بيانات لا يقرأها أي سطح في النظام الجديد: لا الخادم (واجهة v3)
    // ولا شاشات v3. جداول يقرأها الخادم فقط متاحة لـv3 عبر واجهاته.
    const gaps = rows.filter((r) => r.backend === 0 && r.v3 === 0);
    const report = {
        database: args.db,
        takenAt: new Date().toISOString(),
        tables: rows.length,
        rows: rows.reduce((s, r) => s + r.rows, 0),
        gaps: gaps.map((g) => ({ table: g.table, rows: g.rows })),
        detail: rows,
    };

    fs.mkdirSync(path.dirname(path.join(ROOT, args.json)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, args.json), JSON.stringify(report, null, 2));

    const md = [
        `# جرد بيانات v1/v2 مقابل v3 — ${args.db}`,
        '',
        `تاريخ الجرد: ${report.takenAt}`,
        '',
        `- جداول فيها بيانات: **${report.tables}** — مجموع الصفوف: **${report.rows.toLocaleString('en-US')}**`,
        `- جداول بلا أي قارئ في النظام الجديد (فجوات): **${gaps.length}**`,
        '',
        '## الفجوات — بيانات موجودة ولا يقرأها خادم v3 ولا شاشاته',
        '',
        '| الجدول | الصفوف | تقرأه واجهات v1/v2 |',
        '| --- | ---: | :---: |',
        ...gaps.map((g) => `| \`${g.table}\` | ${g.rows.toLocaleString('en-US')} | ${g.v1v2 ? '✔' : '—'} |`),
        '',
        '## كل الجداول',
        '',
        '| الجدول | الصفوف | المدى الزمني | خادم | v3 | v1/v2 |',
        '| --- | ---: | --- | :---: | :---: | :---: |',
        ...rows.map(
            (r) =>
                `| \`${r.table}\` | ${r.rows.toLocaleString('en-US')} | ${
                    r.range ? `${String(r.range.first).slice(0, 10)} → ${String(r.range.last).slice(0, 10)}` : '—'
                } | ${r.backend ? '✔' : '—'} | ${r.v3 ? '✔' : '—'} | ${r.v1v2 ? '✔' : '—'} |`,
        ),
        '',
    ].join('\n');
    fs.mkdirSync(path.dirname(path.join(ROOT, args.md)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, args.md), md);

    console.log(`جداول: ${report.tables} | صفوف: ${report.rows} | فجوات بلا قارئ جديد: ${gaps.length}`);
    console.log('أكبر 12 فجوة:', gaps.slice(0, 12).map((g) => `${g.table}(${g.rows})`).join(', '));
    console.log(`التقرير: ${args.md} و${args.json}`);
    await client.end();
}

main().catch((error) => {
    console.error('فشل الجرد:', error.message);
    process.exit(1);
});
