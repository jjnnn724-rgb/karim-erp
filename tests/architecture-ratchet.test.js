'use strict';
/**
 * حارس انجراف معماري — يمنع زيادة حجم server.js أو مواقع DDL خارج migrations.
 * لا يُصلح الدين القديم، لكنه يضمن ألا يتضاعف أثناء عمل الميزات.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/architecture-baseline.json'), 'utf8'));

describe('architecture / ratchet الدين المعماري', () => {
  test('server.js لا يزداد عدد أسطره', () => {
    const lines = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(BASE.serverJsLines);
  });

  test('DDL خارج migrations لا يزيد في أي ملف', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (entry.name.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          const count = (src.match(/\b(?:CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/gi) || []).length;
          const rel = path.relative(ROOT, full).replace(/\\/g, '/');
          if (count > (BASE.ddlFiles[rel] ?? 0)) offenders.push(`${rel}: ${count} > ${BASE.ddlFiles[rel] ?? 0}`);
        }
      }
    };
    walk(path.join(ROOT, 'backend'));
    expect(offenders).toEqual([]);
  });
});
