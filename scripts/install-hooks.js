#!/usr/bin/env node
/** تثبيت أبواب القلعة المحلية لهذا الـworktree فقط (لا يمس النسخة الإنتاجية). */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
execSync('git config core.hooksPath scripts/git-hooks', { cwd: ROOT, stdio: 'inherit' });
for (const h of ['pre-commit', 'pre-push']) {
    fs.chmodSync(path.join(ROOT, 'scripts', 'git-hooks', h), 0o755);
}
console.log('✓ أبواب القلعة مثبتة: pre-commit (أسرار/ترحيلات/إصدار) + pre-push (fortress القياسي).');
console.log('  ملاحظة: التثبيت لكل worktree على حدة — شغّله في أي نسخة جديدة.');
