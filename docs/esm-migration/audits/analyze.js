#!/usr/bin/env node
/**
 * docs/esm-migration/audits/analyze.js — Phase 1B static inventory tool.
 * READ-ONLY: parses app.js + siblings + index.html and writes raw audit JSON.
 * Usage: node docs/esm-migration/audits/analyze.js
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../../../frontend/app');
const OUT = __dirname;
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const appLines = read('js/app.js').split('\n');
const indexHtml = read('index.html');
const siblings = {
  'icons.js': read('js/icons.js'),
  'scanner.js': read('js/scanner.js'),
  'realtime.js': read('js/realtime.js'),
  'db-constraints-client.js': read('js/db-constraints-client.js'),
  'pos.js': read('js/pos.js'),
  'bilingual.js': read('js/bilingual.js'),
  'pos-orders.js': read('js/pos-orders.js'),
};

// ---- sections (from banner titles, verified manually in Phase 1A) ----
const SECTIONS = [
  [2, 'CONFIG & STATE'], [253, 'UTILS'], [257, 'I18N'], [916, 'STORAGE'],
  [1100, 'SMART CARD UTILS'], [1197, 'SMART CARD RENDER'], [1804, 'BULK IMPORT'],
  [2385, 'AUTH & NAVIGATION'], [2727, 'DASHBOARD'], [3035, 'EMPLOYEE PORTAL'],
  [3189, 'ZKTECO'], [3656, 'YARASOFT'], [4438, 'ORACLE'], [4442, 'WHATSAPP'],
  [4942, 'EMPLOYEES'], [5454, 'WAREHOUSE'], [7095, 'SHELVES'], [7217, 'WEIGHT'],
  [7342, 'KITCHEN & DISPATCH'], [8375, 'RECIPES'], [8459, 'REVENUES & EXPENSES'],
  [8675, 'COST ANALYSIS'], [8702, 'P&L'], [8923, 'DEPARTMENTS'], [9182, 'HR DASHBOARD'],
  [9243, 'ATTENDANCE'], [9721, 'LEAVES'], [9790, 'HR DEPARTMENTS'], [9881, 'PAYROLL'],
  [10084, 'REPORTS'], [10751, 'SETTINGS'], [11318, 'USERS'], [11426, 'CFO'],
  [11588, 'MODAL & RENDER PAGE'], [11702, 'PWA'], [11730, 'LOGIN GLOBALS'],
  [11811, 'INITIALIZATION'], [11906, 'ENHANCEMENT PACK'],
];
const sectionOf = (line) => {
  let name = 'HEADER';
  for (const [start, s] of SECTIONS) { if (line >= start) {name = s;} else {break;} }
  return name;
};

// ---- 1. top-level declarations ----
const fnRe = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const varRe = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const fns = [], vars = [];
appLines.forEach((l, i) => {
  const line = i + 1;
  let m;
  if ((m = l.match(fnRe))) {fns.push({ name: m[1], line, section: sectionOf(line) });}
  else if ((m = l.match(varRe))) {vars.push({ name: m[1], line, section: sectionOf(line) });}
});

// ---- 2. window.* assignments and reads ----
const winAssign = new Map(); // name -> [{line, section}]
appLines.forEach((l, i) => {
  for (const m of l.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    const name = m[1];
    if (!winAssign.has(name)) {winAssign.set(name, []);}
    winAssign.get(name).push({ line: i + 1, section: sectionOf(i + 1) });
  }
});
const countUsage = (text, name) => {
  const re = new RegExp('window\\.' + name + '\\b(?!\\s*=(?!=))', 'g');
  return (text.match(re) || []).length;
};
const winGlobals = [...winAssign.keys()].map((name) => {
  const appAssignments = winAssign.get(name);
  const consumers = {};
  for (const [f, txt] of Object.entries(siblings)) {
    const c = countUsage(txt, name);
    if (c) {consumers['js/' + f] = c;}
  }
  consumers['index.html'] = countUsage(indexHtml, name);
  const totalExternal = Object.values(consumers).reduce((a, b) => a + b, 0);
  // reads inside app.js itself (usage anywhere; assignment lines are a small subset)
  const appReads = countUsage(read('js/app.js'), name);
  return {
    name, assignments: appAssignments, appReads, externalConsumers: consumers,
    totalExternal,
  };
}).sort((a, b) => b.totalExternal - a.totalExternal || a.name.localeCompare(b.name));

// ---- 3. inline onclick consumers (generated templates) ----
const onclickFns = {};
for (const m of read('js/app.js').matchAll(/on(?:click|change|input|submit|keyup|keydown|load|error)="([A-Za-z_$][\w$]*)\(/g)) {
  onclickFns[m[1]] = (onclickFns[m[1]] || 0) + 1;
}
for (const m of indexHtml.matchAll(/on(?:click|change|input|submit|keyup|keydown|load|error)="([A-Za-z_$][\w$]*)\(/g)) {
  onclickFns['[index.html] ' + m[1]] = (onclickFns['[index.html] ' + m[1]] || 0) + 1;
}

// ---- 4. DOM references ----
const domIds = {};
for (const m of read('js/app.js').matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g)) {
  domIds[m[1]] = (domIds[m[1]] || 0) + 1;
}
const indexIds = [...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const domQueries = {};
for (const m of read('js/app.js').matchAll(/querySelector(?:All)?\((['"`])((?:\\.|(?!\1).)*)\1\)/g)) {
  domQueries[m[2]] = (domQueries[m[2]] || 0) + 1;
}

// ---- 5. API inventory ----
const apiCalls = [];
appLines.forEach((l, i) => {
  const m = l.match(/apiFetch\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{([^}]*)\})?/);
  if (m) {
    const opts = m[2] || '';
    const method = (opts.match(/method\s*:\s*['"](\w+)['"]/) || [])[1] || 'GET (default)';
    apiCalls.push({ line: i + 1, path: m[1], method, section: sectionOf(i + 1) });
  }
});
const rawFetch = [];
appLines.forEach((l, i) => {
  const m = l.match(/(?:^|[^a-zA-Z.])fetch\(\s*[`'"]([^`'"]+)[`'"]/);
  if (m) {rawFetch.push({ line: i + 1, path: m[1], section: sectionOf(i + 1) });}
});

// ---- 6. storage ----
const storage = {};
const storScan = (label, text) => {
  for (const m of text.matchAll(/(localStorage|sessionStorage)\.(getItem|setItem|removeItem|key)\(\s*['"`]([^'"`]+|[^)]*)/g)) {
    const k = `${label}:${m[1]}.${m[2]}:${m[3].trim()}`;
    storage[k] = (storage[k] || 0) + 1;
  }
  const cookieHits = text.match(/document\.cookie\b/g);
  if (cookieHits) {
    const k = `${label}:document.cookie`;
    storage[k] = (storage[k] || 0) + cookieHits.length;
  }
  for (const m of text.matchAll(/indexedDB|caches\.open\(['"`]([^'"`]+)/g)) {
    const k = `${label}:${m[0].slice(0, 40)}`;
    storage[k] = (storage[k] || 0) + 1;
  }
};
storScan('app.js', read('js/app.js'));
for (const [f, txt] of Object.entries(siblings)) {storScan('js/' + f, txt);}
storScan('index.html', indexHtml);

// ---- 7. events ----
const listeners = [];
const listenScan = (label, text) => {
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/(?:window|document|[A-Za-z_$][\w$.]*)\.addEventListener\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {listeners.push({ where: label, line: i + 1, event: m[1] });}
  });
};
listenScan('app.js', read('js/app.js'));
for (const [f, txt] of Object.entries(siblings)) {listenScan('js/' + f, txt);}
listenScan('index.html', indexHtml);
const customEvents = [];
for (const m of read('js/app.js').matchAll(/(?:dispatchEvent\(new\s+(?:Custom)?Event|new\s+CustomEvent)\(\s*['"`]([^'"`]+)['"`]/g)) {
  customEvents.push(m[1]);
}

// ---- 8. socket.io events (realtime) ----
const socketEvents = {};
for (const m of siblings['realtime.js'].matchAll(/\.on\(\s*['"`]([^'"`]+)['"`]/g)) {
  socketEvents[m[1]] = (socketEvents[m[1]] || 0) + 1;
}

// ---- write outputs ----
const write = (name, data) =>
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 1));
write('inventory.json', {
  meta: {
    appJsLines: appLines.length,
    topLevelFunctions: fns.length,
    topLevelVars: vars.length,
    uniqueWindowAssignments: winGlobals.length,
    inlineHandlerNames: Object.keys(onclickFns).length,
    domIdsReferenced: Object.keys(domIds).length,
    apiCalls: apiCalls.length,
    rawFetches: rawFetch.length,
    listeners: listeners.length,
  },
});
write('functions-by-section.json', fns);
write('top-level-vars.json', vars);
write('window-globals.json', winGlobals);
write('inline-handlers.json', onclickFns);
write('dom-ids.json', { referencedInJs: domIds, declaredInIndexHtml: indexIds, querySelectors: domQueries });
write('api-inventory.json', { apiFetch: apiCalls, rawFetch });
write('storage.json', storage);
write('events.json', { listeners, customEvents: [...new Set(customEvents)], socketEvents });

// ---- console summary ----
const ext = winGlobals.filter((g) => g.totalExternal > 0);
console.log('lines:', appLines.length, '| fns:', fns.length, '| top vars:', vars.length);
console.log('window globals:', winGlobals.length, '| with EXTERNAL consumers:', ext.length);
console.log('external-consumed globals:', ext.slice(0, 20).map((g) => `${g.name}(${g.totalExternal})`).join(', '));
console.log('inline handler names:', Object.keys(onclickFns).length, '| dom ids:', Object.keys(domIds).length);
console.log('api calls:', apiCalls.length, '| raw fetch:', rawFetch.length, '| listeners:', listeners.length);
const notExportedYet = Object.keys(onclickFns).filter((n) => !winAssign.has(n) && !n.startsWith('[index.html]'));
console.log('onclick fns WITHOUT explicit window assignment in app.js:', notExportedYet.length,
  notExportedYet.slice(0, 15).join(', '));
