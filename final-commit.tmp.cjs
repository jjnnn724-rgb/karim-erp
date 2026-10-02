// final-commit.tmp.cjs — commit ختامي عبر مسار git المطلق.
const { execFileSync } = require('child_process');
const B = String.fromCharCode(92);
const git = 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'AppData' + B + 'Local' + B + 'hermes' + B + 'git' + B + 'cmd' + B + 'git.exe';
const opts = { cwd: 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'Desktop' + B + 'k' + B + 'karimabdelhamedeldsouky' + B + 'karimabdelhamed12' + B + 'karim-erp' };
execFileSync(git, ['add', '-A'], opts);
execFileSync(git, ['-c', 'user.name=Karim ERP Owner', '-c', 'user.email=owner@karimerp.local', 'commit', '-m', 'ops: free 20GB - Yarasoft done-files archived to D: with repeatable script; data-folder backup in nightly'], opts);
console.log(execFileSync(git, ['log', '--oneline', '-2'], opts).toString());
