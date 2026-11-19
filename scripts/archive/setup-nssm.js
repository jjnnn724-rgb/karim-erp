#!/usr/bin/env node
const { spawnSync } = require('child_process');
const nssmPath = 'C:/HorusData/nssm/nssm-2.24/win64/nssm.exe';
const projectDir = 'C:\\Users\\RemoteHome\\Desktop\\karimabdelhamedeldsouky\\karimabdelhamed12\\horus-erp';
// الإصلاح 2026-11-04 (N2): كلمة مرور superuser كانت مضمّنة هنا — تُقرأ من
// البيئة حصريًا، وبلاها يتوقّف الإعداد (لا سرّ في ملف متتبَّع).
const dbPassword = process.env.DB_PASSWORD || '';
if (!dbPassword) {
    console.error('DB_PASSWORD غير مضبوط في البيئة — أُلغي إعداد الخدمة (لا كلمات مرور في الكود).');
    process.exit(1);
}
const envVars = `PORT=5001 NODE_ENV=production SSL_KEY=C:/HorusData/certs/horus.key SSL_CERT=C:/HorusData/certs/horus.crt DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=horus_erp DB_USER=postgres DB_PASSWORD=${dbPassword}`;

function nssm(args) {
    const result = spawnSync(nssmPath, args, { encoding: 'utf-8', timeout: 10000 });
    const out = (result.stdout || '') + (result.stderr || '');
    return out;
}

console.log('Configuring HorusERP-Server service...');
console.log(nssm(['set', 'HorusERP-Server', 'AppDirectory', projectDir]));
console.log(nssm(['set', 'HorusERP-Server', 'AppParameters', 'serve.js --service']));
console.log(nssm(['set', 'HorusERP-Server', 'AppEnvironmentExtra', envVars]));
console.log(nssm(['set', 'HorusERP-Server', 'Start', 'SERVICE_AUTO_START']));
console.log(nssm(['set', 'HorusERP-Server', 'Type', 'own_program']));
console.log('\nAll done!');
