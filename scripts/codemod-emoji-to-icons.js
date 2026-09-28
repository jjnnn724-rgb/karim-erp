#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Karim ERP v4 — Emoji → SVG Icon codemod
   Replaces every UI emoji with an <i class="ji" data-i="..."> marker
   hydrated by js/icons.js. Context-aware: picks attribute quoting
   that cannot break the enclosing JS string literal.
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const M = { // emoji (longest first when overlapping) → icon name
  '👨‍🍳':'chef-hat', '🧑‍🍳':'chef-hat', '🧑‍💼':'user', '🖥️':'monitor', '🖥':'monitor', '🖼️':'image', '🖼':'image',
  '🗓️':'calendar', '🗓':'calendar', '🕐':'clock', '⏱️':'timer', '⏱':'timer', '⏰':'alarm',
  '⏳':'hourglass', '⏹️':'stop', '⏹':'stop', '⏸️':'pause', '⏸':'pause', '↩️':'undo', '↩':'undo',
  '↪️':'redo', '↪':'redo', '↗️':'trending-up', '↗':'trending-up', '↘️':'trending-down', '↘':'trending-down',
  '⬅️':'arrow-left', '⬅':'arrow-left', '➡️':'arrow-right', '➡':'arrow-right', '⬇️':'arrow-down', '⬇':'arrow-down',
  '✅':'circle-check', '❌':'circle-x', '⚠️':'alert-triangle', '⚠':'alert-triangle', 'ℹ️':'info', 'ℹ':'info',
  '⛔':'circle-x', '🚨':'alert-triangle', '✖️':'x', '✖':'x', '✕':'x', '✔':'check', '✓':'check',
  '➕':'plus', '➖':'minus', '✍️':'pen-tool', '✍':'pen-tool', '✨':'star', '💫':'star', '🌟':'star', '⭐':'star',
  '🔄':'refresh', '🔁':'refresh', '↻':'refresh', '💰':'banknote', '💸':'wallet', '💵':'banknote',
  '💳':'credit-card', '🏦':'landmark', '💎':'gem', '🧾':'receipt', '🛒':'shopping-cart', '📊':'chart',
  '📈':'trending-up', '📉':'trending-down', '📋':'clipboard-list', '📄':'file-text', '📝':'file-text',
  '🗒️':'file-text', '📅':'calendar', '📆':'calendar-days', '🗑️':'trash', '🗑':'trash', '📦':'package',
  '📥':'inbox', '📤':'upload', '💾':'save', '🔍':'search', '🔎':'search', '👁️':'eye', '👁':'eye',
  '👤':'user', '👥':'users', '🏢':'building', '🏛️':'building-2', '🏠':'home', '🏬':'store', '🏪':'store',
  '🗄️':'archive', '🗄':'archive', '⚖️':'scale', '⚖':'scale', '🍽️':'utensils', '🍽':'utensils',
  '🥗':'salad', '🥤':'cup-soda', '☕':'coffee', '🍲':'cooking-pot', '🥣':'cooking-pot', '🍗':'drumstick',
  '🥩':'beef', '🐟':'fish', '🍚':'rice', '🫓':'bread', '🍰':'cake', '🧃':'cup-soda', '💧':'droplet',
  '⚙️':'settings', '⚙':'settings', '🔧':'wrench', '👑':'crown', '🔔':'bell', '🌐':'globe', '🚪':'log-out',
  '🔐':'lock', '🔒':'lock', '🔓':'unlock', '🔑':'key', '📱':'smartphone', '📞':'phone', '💬':'message',
  '💼':'briefcase', '🏥':'stethoscope', '🎯':'target', '📍':'map-pin', '📌':'pin', '🧮':'calculator',
  '🆔':'id-card', '🪪':'id-card', '🏷️':'tag', '🏷':'tag', '🎨':'palette', '📷':'camera', '🖨️':'printer',
  '🖨':'printer', '⌨️':'keyboard', '⌨':'keyboard', '🎬':'play', '👋':'user-check', '🚀':'play',
  '🎉':'party', '🎊':'party', '🏅':'award', '🏆':'award', '🔖':'bookmark', '📂':'folder-open', '📁':'folder',
  '🗂️':'folder-open', '🗂':'folder-open', '🌑':'moon', '🌙':'moon', '☀️':'sun', '☀':'sun',
  '🔥':'flame', '🌿':'leaf', '🍃':'leaf', '🏖️':'sun', '🏖':'sun', '🏁':'flag', '🥧':'pie', '⚪':'dot-gray',
  '🟢':'dot-green', '🔴':'dot-red', '🟠':'dot-orange', '🟡':'dot-yellow', '🧨':'alert-triangle',
  '💥':'alert-triangle', '🎭':'activity', '💻':'monitor', '📡':'wifi', '🕒':'clock', '🧑':'user',
  '＋':'plus', '⚡':'zap', '❗':'alert-triangle', '✏️':'pencil', '✏':'pencil', '🍳':'cooking-pot', '🎫':'ticket'
};

const files = [
  'frontend/app/js/app.js',
  'frontend/app/js/pos.js',
  'frontend/app/js/pos-orders.js',
  'frontend/app/js/realtime.js',
  'frontend/app/js/scanner.js',
  'frontend/app/pos.html'
];

// sort keys: multi-codepoint sequences must be tried first
const keys = Object.keys(M).sort((a, b) => b.length - a.length);

let totalReplaced = 0;
const unhandled = {};

for (const rel of files) {
  const fp = path.join(ROOT, rel);
  const src = fs.readFileSync(fp, 'utf8');
  let out = '';
  let i = 0;
  const quote = null; // ', ", ` or null
  const report = [];

  while (i < src.length) {
    const ch = src[i];

    // try emoji match at this position — quote-less markers are safe in
    // every context (single/double/template strings, comments, HTML)
    let matched = null;
    for (const k of keys) {
      if (src.startsWith(k, i)) { matched = k; break; }
    }
    if (matched) {
      const name = M[matched];
      out += `<i class=ji data-i=${name}></i>`;
      report.push(matched);
      totalReplaced++;
      i += matched.length;
      // swallow orphaned VS16 / ZWJ right after a replaced sequence
      while (i < src.length && (src.charCodeAt(i) === 0xFE0F || src.charCodeAt(i) === 0x200D)) {i++;}
      continue;
    }

    // flag remaining pictographics so nothing slips through silently
    const cp = src.codePointAt(i);
    if (cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF) || cp === 0xFE0F || cp === 0x200D || cp === 0x20E3) {
      // consume full grapheme-ish cluster (base + VS16 + ZWJ chain)
      let j = i + String.fromCodePoint(cp).length;
      while (j < src.length) {
        const c2 = src.codePointAt(j);
        if (c2 === 0xFE0F || c2 === 0x200D || (c2 >= 0x1F000) || (c2 >= 0x2600 && c2 <= 0x27BF) || (c2 >= 0x1F3FB && c2 <= 0x1F3FF)) {
          j += String.fromCodePoint(c2).length;
        } else {break;}
      }
      const grapheme = src.slice(i, j);
      unhandled[grapheme] = (unhandled[grapheme] || 0) + 1;
      out += grapheme;
      i = j;
      continue;
    }

    out += ch; i++;
  }

  fs.writeFileSync(fp, out, 'utf8');
  const counts = {};
  report.forEach(e => counts[e] = (counts[e] || 0) + 1);
  console.log(`${rel}: ${report.length} replaced`);
}

console.log(`\nTOTAL replaced: ${totalReplaced}`);
const uh = Object.entries(unhandled);
if (uh.length) {
  console.log('UNHANDLED emojis left in source:');
  uh.sort((a, b) => b[1] - a[1]).forEach(([e, n]) => console.log(`  ${e} U+${e.codePointAt(0).toString(16).toUpperCase()} x${n}`));
} else {
  console.log('No unhandled emojis remain.');
}
