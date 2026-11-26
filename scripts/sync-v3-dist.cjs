// V3 deploy sync — mirrors v3/apps/web/dist into frontend/v3.
// Preserves: screens.json, rollout.json, preview/, v2-announce.*
// Deletes: stale hashed assets not present in the new dist (audit lesson: no dead chunks).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'v3', 'apps', 'web', 'dist');
const TARGET = path.join(ROOT, 'frontend', 'v3');

// Sanity: both endpoints must be real directories inside the repo.
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html missing — abort');
  process.exit(1);
}
if (!fs.existsSync(path.join(TARGET, 'screens.json'))) {
  console.error('frontend/v3/screens.json missing — abort (preserve list broken?)');
  process.exit(1);
}

const COPY_TOP = ['index.html', 'sw.js'];
const COPY_DIRS = ['assets', 'icons', 'img'];
const GLOBS = ['manifest*.webmanifest'];
const PRESERVE = new Set(['screens.json', 'rollout.json', 'preview', 'v2-announce']);

// 1. snapshot old assets
const oldAssets = new Set(fs.readdirSync(path.join(TARGET, 'assets')));

// 2. copy dirs
for (const dir of COPY_DIRS) {
  const src = path.join(DIST, dir);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(TARGET, dir);
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(s, d, { recursive: true });
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// 3. copy top-level files + manifests
for (const name of COPY_TOP) {
  const s = path.join(DIST, name);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(TARGET, name));
}
for (const name of fs.readdirSync(DIST)) {
  if (GLOBS.some((g) => new RegExp('^' + g.replace(/\*/g, '.*') + '$').test(name))) {
    fs.copyFileSync(path.join(DIST, name), path.join(TARGET, name));
  }
}

// 4. delete stale hashed assets (only inside TARGET/assets, only files absent from new dist)
const newAssets = new Set(fs.readdirSync(path.join(DIST, 'assets')));
let removed = 0;
for (const name of oldAssets) {
  if (!newAssets.has(name)) {
    fs.unlinkSync(path.join(TARGET, 'assets', name));
    removed++;
  }
}

// 5. report
const stamp = fs.readFileSync(path.join(TARGET, 'index.html'), 'utf8').match(/asset-version" content="([^"]+)"/);
console.log(`synced: assets old=${oldAssets.size} new=${newAssets.size} removed=${removed}`);
console.log(`asset-version: ${stamp ? stamp[1] : 'NOT FOUND'}`);
