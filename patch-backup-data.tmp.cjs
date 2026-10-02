// patch-backup-data.tmp.cjs — إضافة مجلدات البيانات الحرجة للنسخة الليلية.
const fs = require('fs');
let s = fs.readFileSync('scripts/backup-nightly.js', 'utf8');
const anchor = "console.log('[backup] done ✓');";
if (!s.includes(anchor)) { throw new Error('anchor missing'); }
if (!s.includes('karim_data-folders-')) {
    const block = [
        '',
        '// ── نسخ مجلدات البيانات الحرجة: جلسة واتساب + شهادة HTTPS + KarimData ──',
        '// (ROOT FIX 2026-10-02: كانت خارج أي نسخ احتياطي — ضياعها يعني مسح QR',
        '//  وإعادة إصدار شهادة HTTPS). Yarasoft/ يستثنى (20GB staging قابلة للإعادة).',
        "const CRIT = ['C:/HorusData/certs', 'C:/HorusData/whatsapp-sessions', 'C:/HorusData/links', 'C:/KarimData'];",
        'const dataZip = path.join(BACKUPS, `karim_data-folders-${today}.zip`);',
        'try {',
        "    execFileSync('powershell', ['-NoProfile', '-Command',",
        "        `Compress-Archive -Force -Path '${CRIT.join(\"','\")}' -DestinationPath '${dataZip}'`], { stdio: 'pipe' });",
        "    console.log('[backup] data-folders.zip →', dataZip, `(${Math.round(fs.statSync(dataZip).size / 1024)}KB)`);",
        '} catch (e) { console.warn("[backup] data-folders zip skipped:", e.message); }',
        'const dZips = fs.readdirSync(BACKUPS).filter((f2) => f2.startsWith("karim_data-folders-")).sort().reverse();',
        'for (const old of dZips.slice(3)) { fs.unlinkSync(path.join(BACKUPS, old)); console.log("[backup] pruned:", old); }',
        '',
        anchor,
    ].join('\n');
    s = s.replace(anchor, block);
    fs.writeFileSync('scripts/backup-nightly.js', s);
}
console.log('patched ✓');
