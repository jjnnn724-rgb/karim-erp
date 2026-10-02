// final-commit3.tmp.cjs — commit إصلاح المحرك + تنظيف.
const { execFileSync } = require('child_process');
const fs = require('fs');
const B = String.fromCharCode(92);
const git = 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'AppData' + B + 'Local' + B + 'hermes' + B + 'git' + B + 'cmd' + B + 'git.exe';
const opts = { cwd: 'C:' + B + 'Users' + B + 'RemoteHome' + B + 'Desktop' + B + 'k' + B + 'karimabdelhamedeldsouky' + B + 'karimabdelhamed12' + B + 'karim-erp' };
execFileSync(git, ['add', '-A'], opts);
try { execFileSync(git, ['-c', 'user.name=Karim ERP Owner', '-c', 'user.email=owner@karimerp.local', 'commit', '-m', 'fix(engine): stale-checkout branch used nonexistent _wallParts - real punches silently lost on forgot-checkout sequences; now instantToWall. ops: device checkpoint reset re-imported September logs, Atiq (98) remapped, September attendance rebuilt'], opts); } catch (e) { console.log('commit note: ' + e.message.slice(0, 100)); }
fs.writeFileSync('commit3.tmp.txt', execFileSync(git, ['log', '--oneline', '-3'], opts).toString());
