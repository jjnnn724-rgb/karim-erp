#!/usr/bin/env node
const { spawnSync } = require('child_process');
const nssmPath = 'C:/HorusData/nssm/nssm-2.24/win64/nssm.exe';
const projectDir = 'C:\\Users\\RemoteHome\\Desktop\\karimabdelhamedeldsouky\\karimabdelhamed12\\horus-erp';
const envVars = 'PORT=5001 NODE_ENV=production SSL_KEY=C:/HorusData/certs/horus.key SSL_CERT=C:/HorusData/certs/horus.crt DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=horus_erp DB_USER=postgres DB_PASSWORD=karim2026admin';

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
