#!/usr/bin/env python3
"""Fix SET LOCAL app.* = $1; → SELECT set_config('app.*', $1, true);"""
import re
import sys

FILES = [
    '/home/z/my-project/workspace/backend/cashier-module/shift-routes.js',
    '/home/z/my-project/workspace/backend/cashier-module/db-pool.js',
    '/home/z/my-project/workspace/backend/cashier-module/complete-sale.js',
]

# Pattern: SET LOCAL app.<name> = $1;   (with optional spaces around = and after $1)
# Also handle the literal-string case: SET LOCAL app.stock_reason = 'sale';
pattern_param = re.compile(
    r"SET LOCAL app\.(\w+)\s*=\s*\$1\s*;",
    re.IGNORECASE
)
pattern_literal = re.compile(
    r"SET LOCAL app\.(\w+)\s*=\s*'([^']*)'\s*;",
    re.IGNORECASE
)

total_replacements = 0
for fp in FILES:
    with open(fp, 'r', encoding='utf-8') as f:
        src = f.read()
    orig = src
    # Replace $1 parameter version
    src = pattern_param.sub(
        lambda m: f"SELECT set_config('app.{m.group(1)}', $1, true);",
        src
    )
    # Replace literal-string version
    src = pattern_literal.sub(
        lambda m: f"SELECT set_config('app.{m.group(1)}', '{m.group(2)}', true);",
        src
    )
    n = sum(1 for _ in re.finditer(r"set_config\('app\.", src))
    if src != orig:
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(src)
        print(f"  {fp}: {n} set_config() calls now")
        total_replacements += n
    else:
        print(f"  {fp}: no changes")

print(f"\nTotal set_config() calls: {total_replacements}")
