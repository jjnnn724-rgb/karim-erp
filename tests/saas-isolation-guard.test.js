'use strict';
/**
 * حارس انجراف عزل SaaS — يمنع توسيع سطح المسارات التي تفتح اتصال PG مباشر
 * (pool.connect()) بلا سياق مستأجر. الحصة مسجّلة من شجرة العمل الحالية؛
 * أي ملف يزيد عن حصته أو ملف جديد يستخدم pool.connect() يُفشل الاختبار.
 * لا يُغيّر هذا الحارس السلوك — يمنع تدهورًا صامتًا فقط.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/saas-connect-baseline.json'), 'utf8'));

function scan() {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        const count = (src.match(/pool\.connect\(/g) || []).length;
        if (count) {
          out.set(path.relative(ROOT, full).replace(/\\/g, '/'), count);
        }
      }
    }
  };
  walk(path.join(ROOT, 'backend'));
  return out;
}

describe('SaaS isolation / ratchet اتصالات PG المباشرة', () => {
  test('لا ملف يتجاوز حصته المسجّلة', () => {
    const current = scan();
    const offenders = [];
    for (const [file, count] of current) {
      const allowed = BASELINE.files[file] ?? 0;
      if (count > allowed) {
        offenders.push(`${file}: ${count} > ${allowed}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('لا ملف جديد يفتح اتصالًا مباشرًا', () => {
    const current = scan();
    const added = [...current.keys()].filter((file) => !(file in BASELINE.files));
    expect(added).toEqual([]);
  });

  test('حارس الإقلاع موصول في server.js', () => {
    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    expect(server).toContain('assertTenantIsolationReady()');
  });
});
