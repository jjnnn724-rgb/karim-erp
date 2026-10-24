#!/usr/bin/env node
/**
 * verify-audit-chain.js — فحص سلامة سلسلة hash لسجل التدقيق (البند ١١)
 * ════════════════════════════════════════════════════════════════════════════
 * قراءة فقط، لا يكتب شيئًا. يستدعي pos_audit_verify_chain في القاعدة (ترحيل
 * 118) ويطبع النتيجة. الخروج 0 = سلسلة سليمة، 1 = كسر مثبت، 2 = تعذّر الفحص.
 *
 *   node scripts/verify-audit-chain.js            # السلسلة كلها
 *   node scripts/verify-audit-chain.js --from 500 # من المعرّف 500
 *
 * الفحص يعتمد على اتصال .env كغيره من السكربتات؛ على الإنتاج يكون حساب
 * القراءة كافيًا. لا يطبع أي صف ولا أي بيانات شخصية — أرقام وحالة فقط.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../backend/shared-pool');

function parseFrom(argv) {
    const i = argv.indexOf('--from');
    if (i < 0) {return null;}
    const raw = String(argv[i + 1] || '').trim();
    if (!/^\d+$/.test(raw)) {
        console.error('--from يحتاج معرّفًا رقميًا.');
        process.exit(2);
    }
    return raw;
}

(async () => {
    const from = parseFrom(process.argv.slice(2));
    try {
        const r = await pool.query(
            'SELECT pos_audit_verify_chain($1::bigint) AS result;',
            [from]
        );
        const result = r.rows[0].result;
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) {
            console.error(`✗ كسر في السلسلة عند الصف ${result.broken_at} (${result.reason}).`);
            process.exitCode = 1;
        } else {
            console.log(`✓ السلسلة سليمة: ${result.checked} صفًا مختومًا · ${result.unchained} غير مختوم.`);
        }
    } catch (err) {
        console.error(`✗ تعذّر الفحص: ${err.message}`);
        process.exitCode = 2;
    } finally {
        await pool.end().catch(() => {});
    }
})();
