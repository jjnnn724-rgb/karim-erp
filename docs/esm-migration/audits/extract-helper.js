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

let s0, s1, span;
if (mode === 'audit' || mode === 'move') {
  const titleLine = find(new RegExp(startAnchor));
  s0 = titleLine - 1;                                  // top banner sits directly above the title line
  const endTitle = find(new RegExp(endAnchor), s0 + 1); // end anchor searched AFTER span start
  s1 = endTitle - 2;                                   // line before end anchor's top banner
  span = lines.slice(s0, s1 + 1);
}

// top-level declarations in span (audit/move only)
let decls = [], unknownFreeIds = [];
if (mode === 'audit' || mode === 'move') {
  decls = [];
  for (const l of span) {
    let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) { decls.push(m[1]); continue; }
    m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (m) decls.push(m[1]);
  }
}

// free-id audit with strings/templates/comments stripped
let body = '';
if (mode === 'audit' || mode === 'move') {
  body = span.join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}
const appAll = lines.join('\n');
const winAssigned = new Set([...appAll.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(m => m[1]));
const bridged = new Set(['pwaInstall', 'pwaUpdateOfflineBar', 'I18N', 't', 'readLangLocal', 'persistLangLocal', 'ROLE_NAMES', 'MENU_STRINGS', 'applyI18nMaps', 'applyLangAttrs', 'applyLoginI18n', 'uid', 'esc', 'today', 'nowTime', 'fN', 'fC', 'fD', 'fHijri', 'HIJRI_MONTHS', 'gregToHijriParts', 'hijriToGregorian', 'hijriDateField', 'toggleDateMode', 'syncGregToHijri', 'syncHijriToGreg', 'fDT', 'toast', 'showLoad', 'hideLoad', 'STATE', 'PERSISTED_ENTITIES', 'ROLE_ENTITY_EXCLUSIONS', 'API_BASE', 'apiFetch', 'SERVER_CODE_AR', 'serverErrorInfo', 'CONFIG']);
const builtins = new Set(['STATE', 'document', 'window', 'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'Date', 'Math', 'JSON', 'console', 'String', 'Number', 'Boolean', 'Array', 'Object', 'parseFloat', 'parseInt', 'isNaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Promise', 'fetch', 'Intl', 'Error', 'RegExp', 'Map', 'Set', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob', 'crypto', 'FileReader', 'Blob', 'URL', 'Image', 'CustomEvent', 'AbortController', 'structuredClone']);
const kw = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'new', 'typeof', 'of', 'in', 'try', 'catch', 'finally', 'switch', 'case', 'default', 'break', 'continue', 'throw', 'do', 'delete', 'void', 'this', 'await', 'async', 'class', 'extends', 'super', 'yield', 'instanceof', 'arguments', 'true', 'false', 'null', 'undefined']);
// top-level decls elsewhere in app.js (classic auto-globals) + consts referenced via window are NOT auto —
// only function declarations are guaranteed; consts elsewhere are NOT safe unless window-assigned/bridged.
const topFnsElsewhere = new Set();
if (mode === 'audit' || mode === 'move') {
  for (let i = 0; i < lines.length; i++) {
    if (i >= s0 && i <= s1) continue;
    const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) topFnsElsewhere.add(m[1]);
  }
}
const params = new Set();
if (mode === 'audit' || mode === 'move') {
  for (const m of body.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach(p => params.add(p.trim().split('=')[0].trim()));
  for (const m of body.matchAll(/\(([^)]*)\)\s*=>/g)) m[1].split(',').forEach(p => params.add(p.trim().split('=')[0].trim()));
  for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
  for (const m of body.matchAll(/\.forEach\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
  for (const m of body.matchAll(/\.map\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
  for (const m of body.matchAll(/\.filter\(\s*\(?([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
}

const unknown = new Set();
if (mode === 'audit' || mode === 'move') {
  for (const m of body.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const id = m[0];
    if (decls.includes(id) || params.has(id) || bridged.has(id) || winAssigned.has(id) || builtins.has(id) || topFnsElsewhere.has(id) || kw.has(id)) continue;
    unknown.add(id);
  }
}
const realUnknown = [...unknown].filter(id => id.length > 2); // ignore 1-2 char debris
if (mode === 'audit') console.log(JSON.stringify({
  spanLines: span.length,
  first: span[0].slice(0, 40),
  last: span[span.length - 1].slice(0, 50),
  declCount: decls.length,
  decls,
  unknownFreeIds: realUnknown,
}, null, 1));

if (mode === 'move') {
  const [exportNamesArg, pointerText] = rest;
  let exportNames = exportNamesArg === 'auto' ? null : exportNamesArg.split(',');
  if (!exportNames) {
    // precise top-level declaration list via acorn (sloppy script, span only)
    const acorn = require('acorn');
    const ast = acorn.parse(span.join(EOL), { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    exportNames = [];
    for (const node of ast.body) {
      if (node.type === 'FunctionDeclaration' && node.id) exportNames.push(node.id.name);
      else if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          if (d.id.type === 'Identifier') exportNames.push(d.id.name);
          else if (d.id.type === 'ObjectPattern') d.id.properties.forEach(p => { if (p.value.type === 'Identifier') exportNames.push(p.value.name); });
        }
      }
    }
  }
  const target = path.join(JS, targetFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const header = [
    '/**',
    ` * ${targetFile} — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).`,
    ` * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).`,
    ' */',
    '',
  ];
  const exportsLine = ['', 'export { ' + exportNames.join(', ') + ' };'];
  fs.writeFileSync(target, header.join(EOL) + span.join(EOL) + EOL + exportsLine.join(EOL) + EOL);
  lines.splice(s0, s1 - s0 + 1, pointerText);
  fs.writeFileSync(path.join(JS, 'app.js'), lines.join(EOL));
  console.log('MOVED to ' + targetFile + ' | exports(' + exportNames.length + '): ' + exportNames.join(',') + ' | app.js now ' + lines.length + ' lines');
}

if (mode === 'repoint') {
  // Remove `window.<name>=<name>` assignments (and `window.<name>=function...`) whose name is in
  // the moved set, from multi-assignment export lines; keep the remaining assignments on the line.
  const names = (rest[0] || startAnchor).split(',');
  const nameSet = new Set(names);
  let removed = 0, touched = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/window\./.test(l)) continue;
    // split into assignment statements at top level of the line (naive: split on ';' outside quotes/backticks)
    const parts = [];
    let cur = '', depth = 0, inS = null;
    for (const ch of l) {
      cur += ch;
      if (inS) { if (ch === inS && cur[cur.length - 2] !== '\\') inS = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      if (ch === ')' || ch === '}' || ch === ']') depth--;
      if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; }
    }
    if (cur.trim()) parts.push(cur);
    const kept = [];
    let lineChanged = false;
    for (const p of parts) {
      const m = p.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?\s*$/);
      if (m && nameSet.has(m[1])) { removed++; lineChanged = true; continue; }
      kept.push(p);
    }
    if (lineChanged) {
      touched++;
      lines[i] = kept.length ? kept.join(';') + (l.trim().endsWith(';') ? ';' : '') : '// (export repointed to main.js bridge)';
    }
  }
  fs.writeFileSync(path.join(JS, 'app.js'), lines.join(EOL));
  console.log('repoint: removed ' + removed + ' assignments across ' + touched + ' lines');
}
