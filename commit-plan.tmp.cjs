// commit-plan.tmp.cjs — commit تحديث خطة 9/10 بالخريطة الكاملة.
const { execFileSync } = require('child_process');
const B = String.fromCharCode(92);
const git = 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'AppData' + B + 'Local' + B + 'hermes' + B + 'git' + B + 'cmd' + B + 'git.exe';
const opts = { cwd: 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'Desktop' + B + 'k' + B + 'karimabdelhamedeldsouky' + B + 'karimabdelhamed12' + B + 'karim-erp' };
execFileSync(git, ['add', '-A'], opts);
try {
    execFileSync(git, ['-c', 'user.name=Karim ERP Owner', '-c', 'user.email=owner@karimerp.local', 'commit', '-m', 'docs: complete 9-of-10 plan with full CRUD extraction map (deps inventory done) + measured status 8.5'], opts);
} catch (e) { console.log('nothing to commit or note: ' + e.message.slice(0, 80)); }
console.log(execFileSync(git, ['log', '--oneline', '-3'], opts).toString());
