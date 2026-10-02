// final-commit.tmp.cjs — commit ختام جولة 9/10.
const { execFileSync } = require('child_process');
const B = String.fromCharCode(92);
const git = 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'AppData' + B + 'Local' + B + 'hermes' + B + 'git' + B + 'cmd' + B + 'git.exe';
const opts = { cwd: 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'Desktop' + B + 'k' + B + 'karimabdelhamedeldsouky' + B + 'karimabdelhamed12' + B + 'karim-erp' };
execFileSync(git, ['add', '-A'], opts);
try {
    execFileSync(git, ['-c', 'user.name=Karim ERP Owner', '-c', 'user.email=owner@karimerp.local', 'commit', '-m', 'tools: crud-e2e.js permanent smoke (8 checks) + inventory force-delete FK cleanup in generic path + ops hygiene'], opts);
} catch (e) { console.log('note: ' + e.message.slice(0, 80)); }
console.log(execFileSync(git, ['log', '--oneline', '-2'], opts).toString());
