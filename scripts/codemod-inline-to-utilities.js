#!/usr/bin/env node
/**
 * codemod-inline-to-utilities.js — v4.2 engineering pass
 *
 * Replaces exact, repeated `style="..."` attribute strings in JS render
 * templates with named utility classes defined in styles.css.
 * Exact full-attribute matching only — no partial/attribute rewriting.
 * Elements that already carry a class get the utility MERGED into it.
 *
 * `style="display:none"` is intentionally left in place: JS toggles
 * those elements via el.style.display, and a class would win that fight.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');

// exact inline declaration list -> utility class (longest first)
const MAP = [
  ['display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)', 'u-footer-sep'],
  ['display:flex;justify-content:space-between;align-items:center;margin-bottom:16px', 'u-row-between'],
  ['width:100%;padding:8px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);color:var(--text)', 'u-input'],
  ['flex:2;padding:8px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);color:var(--text)', 'u-input-f2'],
  ['flex:1;padding:8px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);color:var(--text)', 'u-input-f1'],
  ['text-align:center;padding:40px;grid-column:1/-1', 'u-empty-grid'],
  ['background:var(--bg3);padding:2px 6px;border-radius:4px', 'u-chip'],
  ['font-size:11px;color:var(--text3);margin-top:4px', 'u-sub'],
  ['font-size:11px;color:var(--text3);font-weight:600', 'u-sub-strong'],
  ['font-weight:700;color:var(--gold);margin-bottom:6px', 'u-num-hero'],
  ['font-size:22px;font-weight:700;color:var(--text)', 'u-panel-title'],
  ['text-align:center;padding:40px', 'u-empty'],
  ['text-align:center;padding:30px', 'u-empty-sm'],
  ['text-align:center;padding:20px', 'u-empty-xs'],
  ['display:flex;gap:8px;flex-wrap:wrap', 'u-row-wrap'],
  ['font-size:16px;font-weight:700', 'u-t16-bold'],
  ['color:var(--gold);font-weight:800', 'u-gold-strong'],
  ['padding:14px;border-radius:12px', 'u-pad-card'],
  ['text-align:left;font-weight:800', 'u-num-l'],
  ['font-size:11px;opacity:0.8', 'u-faint-80'],
  ['font-size:13px;color:var(--text2)', 'u-t13'],
  ['text-align:center', 'u-ta-c'],
  ['text-align:left', 'u-ta-l'],
  ['margin-top:16px', 'u-mt16'],
  ['margin-top:12px', 'u-mt12'],
  ['margin-top:8px', 'u-mt8'],
  ['padding:10px', 'u-p10'],
  ['flex:1', 'u-flex1'],
  ['font-size:28px', 'u-f28'],
  ['font-size:14px', 'u-t14'],
  ['color:var(--text3)', 'u-faint'],
  ['color:var(--red)', 'u-red'],
];

const files = ['js/app.js', 'js/pos.js', 'js/pos-orders.js'];
const tagRe = /<[a-zA-Z][^>]*>/g;
let totalReplaced = 0;

for (const rel of files) {
  const file = path.join(APP, rel);
  let src = fs.readFileSync(file, 'utf8');
  let count = 0;

  src = src.replace(tagRe, (tag) => {
    for (const [decl, cls] of MAP) {
      const styleAttr = `style="${decl}"`;
      if (!tag.includes(styleAttr)) {continue;}
      const classMatch = tag.match(/\sclass="([^"]*)"/);
      if (classMatch) {
        // merge into existing class attribute, drop the style attribute
        const merged = ` class="${classMatch[1]} ${cls}"`;
        tag = tag.replace(/\sclass="[^"]*"/, merged).replace(` ${styleAttr}`, '');
      } else {
        tag = tag.replace(styleAttr, `class="${cls}"`);
      }
      count++;
    }
    return tag;
  });

  fs.writeFileSync(file, src);
  console.log(`${rel}: ${count} inline styles -> utility classes`);
  totalReplaced += count;
}

console.log(`TOTAL: ${totalReplaced}`);
