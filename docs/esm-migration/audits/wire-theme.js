const fs = require('fs');
const APP = 'frontend/app';
let h = fs.readFileSync(APP + '/index.html', 'utf8');

// 1) preload theme-v5 after styles.css preload
if (!h.includes('theme-v5.css')) {
  h = h.replace(
    '  <link rel="preload" as="style" href="css/styles.css">',
    '  <link rel="preload" as="style" href="css/styles.css">\n  <link rel="preload" as="style" href="css/theme-v5.css">'
  );
  // 2) stylesheet link after styles.css link (keep version sync)
  h = h.replace(
    '  <link rel="stylesheet" href="css/styles.css?v=4.7.154">',
    '  <link rel="stylesheet" href="css/styles.css?v=4.7.155">\n  <link rel="stylesheet" href="css/theme-v5.css?v=4.7.155">'
  );
  // fallback: if version differed, just append after the styles.css link whatever its version
  if (!h.includes('theme-v5.css?v=')) {
    h = h.replace(/(  <link rel="stylesheet" href="css\/styles\.css\?v=[\d.]+">)/,
      '$1\n  <link rel="stylesheet" href="css/theme-v5.css?v=4.7.155">');
  }
}
fs.writeFileSync(APP + '/index.html', h);

// 3) sw.js: bump CACHE_VERSION + precache theme-v5
let s = fs.readFileSync(APP + '/sw.js', 'utf8');
s = s.replace(/const CACHE_VERSION = '[^']+';/, "const CACHE_VERSION = '4.7.37';");
if (!s.includes('/app/css/theme-v5.css')) {
  s = s.replace("    '/app/css/styles.css',", "    '/app/css/styles.css',\n    '/app/css/theme-v5.css',");
}
fs.writeFileSync(APP + '/sw.js', s);

console.log('index tags:', [...h.matchAll(/(main|app|styles|theme-v5)\.[a-z]+(?:\?v=([\d.]+))?/g)].map(m => m[1] + '=' + (m[2] || '')).join(' | '));
console.log('sw CACHE_VERSION:', /CACHE_VERSION = '([^']+)'/.exec(s)[1], '| theme-v5 precached:', s.includes('theme-v5.css'));
