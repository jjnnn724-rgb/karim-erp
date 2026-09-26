const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log', 'info'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['warn', 'always'],
      'curly': ['warn', 'all'],
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
      'no-undef': 'off',
    },
  },
  {
    files: ['tests/**/*.test.js', 'tests/**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    files: ['frontend/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-useless-escape': 'off',
      'no-dupe-keys': 'warn',
      'no-control-regex': 'off',
      'no-case-declarations': 'warn',
      'no-unreachable': 'warn',
      'no-const-assign': 'warn',
      'no-useless-assignment': 'warn',
      'prefer-const': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'release/',
      'database/backups/',
      'database/data/',
      '*.log',
      '.env*',
      'coverage/',
      'frontend/app/js/vendor/',
      'frontend/app/js/app.js',
      'electron/',
      'tools/',
      'database/scripts/',
      'scripts/*.mjs',
      'scripts/test-*.mjs',
      'scripts/mobile-layout-check.mjs',
      'scripts/pos-mobile-check.mjs',
      'scripts/test-dispatch-permissions.mjs',
      'scripts/test-kitchen-dispatch.mjs',
      'scripts/test-responsive.mjs',
      'scripts/test-signed-workflows.mjs',
      'test-*.js',
      'debug-*.js',
      'check-*.js',
      'add-*.js',
    ],
  },
];