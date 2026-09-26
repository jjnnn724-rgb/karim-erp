/**
 * patch-html.js — Legacy HTML patcher (RETAINED FOR COMPATIBILITY)
 * ──────────────────────────────────────────────────────────────
 * The original single-file `4Global_View_Premium_v10-4.html` has been
 * removed in favor of the split structure:
 *
 *   frontend/app/index.html        ← main page (creative UI redesign)
 *   frontend/app/css/creative-ui.css ← premium UI layer
 *   frontend/app/css/styles.css    ← base styles
 *   frontend/app/css/realtime.css  ← Socket.io badge / sync toast
 *   frontend/app/css/scanner.css   ← QR/barcode scanner modal
 *   frontend/app/js/app.js         ← main app logic
 *   frontend/app/js/realtime.js    ← Socket.io client
 *   frontend/app/js/scanner.js     ← QR/barcode scanner
 *
 * This script is kept only so `npm run setup` (which calls
 * `node scripts/patch-html.js`) does not fail on a fresh install.
 * It exits gracefully (exit 0) with an informational message.
 *
 * If you ever need to re-patch a legacy single-file HTML build,
 * pass its path explicitly:
 *   node scripts/patch-html.js path/to/legacy.html
 */
const path = require('path');
const originalFile = process.argv[2] || path.join(__dirname, '..', '4Global_View_Premium_v10-4.html');

const fs = require('fs');
if (!fs.existsSync(originalFile)) {
    console.log('ℹ️  patch-html: source HTML not found, skipping.');
    console.log('   The frontend is already split into frontend/app/index.html + css/ + js/.');
    console.log('   (creative-ui.css provides the premium UI layer.)');
    process.exit(0);
}

// Legacy path — only reached if a source file is explicitly provided
console.log('⚠️  patch-html: legacy patching is deprecated.');
console.log('   The frontend has been refactored. No patches applied.');
process.exit(0);
