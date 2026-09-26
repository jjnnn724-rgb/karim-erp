#!/usr/bin/env node
/**
 * docs/esm-migration/audits/extract-helper.js — reusable verbatim extraction tool.
 * Usage: node extract-helper.js <mode> ...
 *   audit <startAnchor> <endAnchorExclusivePrefix>   — analyze span: decls + free ids
 *   move  <startAnchor> <endAnchorExclusivePrefix> <targetFile> <exportName> <bridgeName> <pointerText>
 *         — move span verbatim to target module (relative to frontend/app/js), rewrite app.js,
 *           leaving a pointer comment. Does NOT touch main.js/index.html/sw.js.
 * Anchors are matched as regex against full lines. endAnchorExclusivePrefix: span ends before
 * the top banner (// ====) two lines above this anchor line.
 */
const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../../frontend/app/js');

const [mode, startAnchor, endAnchor, targetFile, ...rest] = process.argv.slice(2);
const src = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(EOL);
const find = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; throw new Error('anchor not found: ' + re); };

const s0 = find(new RegExp(startAnchor)) - 1;              // top banner above the anchor line
const endLine = find(new RegExp(endAnchor));
const s1 = endLine - 2;                                    // line before end anchor's top banner
const span = lines.slice(s0, s1 + 1);

// top-level declarations in span
const decls = [];
for (const l of span) {
  let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (m) { decls.push(m[1]); continue; }
  m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
  if (m) decls.push(m[1]);
}

// free-id audit with strings/templates/comments stripped
const body = span.join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/`(?:\\.|[^`\\])*`/g, '``');
const appAll = lines.join('\n');
const winAssigned = new Set([...appAll.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(m => m[1]));
const bridged = new Set(['pwaInstall', 'pwaUpdateOfflineBar', 'I18N', 't', 'readLangLocal', 'persistLangLocal', 'ROLE_NAMES', 'MENU_STRINGS', 'applyI18nMaps', 'applyLangAttrs', 'applyLoginI18n', 'uid', 'esc', 'today', 'nowTime', 'fN', 'fC', 'fD', 'fHijri', 'HIJRI_MONTHS', 'gregToHijriParts', 'hijriToGregorian', 'hijriDateField', 'toggleDateMode', 'syncGregToHijri', 'syncHijriToGreg', 'fDT', 'toast', 'showLoad', 'hideLoad', 'STATE', 'PERSISTED_ENTITIES', 'ROLE_ENTITY_EXCLUSIONS', 'API_BASE', 'apiFetch', 'SERVER_CODE_AR', 'serverErrorInfo', 'CONFIG']);
const builtins = new Set(['STATE', 'document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'Date', 'Math', 'JSON', 'console', 'String', 'Number', 'Boolean', 'Array', 'Object', 'parseFloat', 'parseInt', 'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Promise', 'fetch', 'Intl', 'Error', 'RegExp', 'Map', 'Set', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob', 'crypto', 'FileReader', 'Blob', 'URL', 'Image', 'CustomEvent', 'AbortController', 'structuredClone']);
const kw = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'new', 'typeof', 'of', 'in', 'try', 'catch', 'finally', 'switch', 'case', 'default', 'break', 'continue', 'throw', 'do', 'delete', 'void', 'this', 'await', 'async', 'class', 'extends', 'super', 'yield', 'instanceof', 'arguments', 'true', 'false', 'null', 'undefined']);
// top-level decls elsewhere in app.js (classic auto-globals) + consts referenced via window are NOT auto —
// only function declarations are guaranteed; consts elsewhere are NOT safe unless window-assigned/bridged.
const topFnsElsewhere = new Set();
for (let i = 0; i < lines.length; i++) {
  if (i >= s0 && i <= s1) continue;
  const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (m) topFnsElsewhere.add(m[1]);
}
const params = new Set();
for (const m of body.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach(p => params.add(p.trim().split('=')[0].trim()));
for (const m of body.matchAll(/\(([^)]*)\)\s*=>/g)) m[1].split(',').forEach(p => params.add(p.trim().split('=')[0].trim()));
for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
for (const m of body.matchAll(/\.forEach\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
for (const m of body.matchAll(/\.map\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
for (const m of body.matchAll(/\.filter\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);

const unknown = new Set();
for (const m of body.matchAll(/[A-Za-z_$][\w$]*/g)) {
  const id = m[0];
  if (decls.includes(id) || params.has(id) || bridged.has(id) || winAssigned.has(id) || builtins.has(id) || topFnsElsewhere.has(id) || kw.has(id)) continue;
  unknown.add(id);
}
const realUnknown = [...unknown].filter(id => id.length > 2); // ignore 1-2 char debris
console.log(JSON.stringify({
  spanLines: span.length,
  first: span[0].slice(0, 40),
  last: span[span.length - 1].slice(0, 50),
  declCount: decls.length,
  decls,
  unknownFreeIds: realUnknown,
}, null, 1));

if (mode === 'move') {
  const [exportNamesArg, pointerText] = rest;
  const exportNames = exportNamesArg.split(',');
  const target = path.join(JS, targetFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const rel = './' + targetFile.replace(/\\/g, '/').replace(/^frontend\/app\/js\//, '');
  const header = [
    '/**',
    ` * ${targetFile} — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).`,
    ` * Bridge policy: all top-level bindings are mounted on window by js/main.js (${exportNamesArg.split(',')[0] ? 'see BRIDGE log' : ''}).`,
    ' */',
    '',
  ];
  const exportsLine = ['', 'export { ' + exportNames.join(', ') + ' };'];
  fs.writeFileSync(target, header.join(EOL) + span.join(EOL) + EOL + exportsLine.join(EOL) + EOL);
  lines.splice(s0, s1 - s0 + 1, pointerText);
  fs.writeFileSync(path.join(JS, 'app.js'), lines.join(EOL));
  console.log('MOVED to ' + targetFile + ' | app.js now ' + lines.length + ' lines');
}
