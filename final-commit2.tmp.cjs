// final-commit2.tmp.cjs — commit الختام.
const { execFileSync } = require('child_process');
const B = String.fromCharCode(92);
const git = 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'AppData' + B + 'Local' + B + 'hermes' + B + 'git' + B + 'cmd' + B + 'git.exe';
const opts = { cwd: 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'Desktop' + B + 'k' + B + 'karimabdelhamedeldsouky' + B + 'karimabdelhamed12' + B + 'karim-erp' };
execFileSync(git, ['add', '-A'], opts);
execFileSync(git, ['-c', 'user.name=Karim ERP Owner', '-c', 'user.email=owner@karimerp.local', 'commit', '-m', 'security+finance: notifications route jwtAuth (hole closed), finance-reconcile auto-repair (fixed 2 orphan supplier payment journals), zero-silence pass on critical files, security-route-audit script (225 routes)'], opts);
fs = require('fs');
fs.writeFileSync('commit.tmp.txt', execFileSync(git, ['log', '--oneline', '-4'], opts).toString());
