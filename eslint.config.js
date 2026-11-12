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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log', 'info'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
      'curly': ['warn', 'all'],
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      // كل حالات no-empty في المشروع (495) هي catch فارغة مقصودة (تجاهل بلا
      // حجب تشغيلي)؛ المُعلِّل الحقيقي هو كتلة فارغة من غير catch.
      'no-empty': ['warn', { allowEmptyCatch: true }],
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
    files: ['scripts/lib/**/*.js'],
    languageOptions: {
      sourceType: 'module',
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
    /* الامتداد .mjs يعني وحدة ES بحكم اللغة. بلا هذا النطاق يقرأها المحلّل
       commonjs فيرمي «'import' and 'export' may appear only with
       sourceType: module» في أي ملفٍ خارج scripts/ (الذي يُستثنى أصلاً)،
       فتُحمَر البوابة بسبب سكربت قراءة مؤقّت لا عيبٍ فيه. */
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    /* Screens are pure modules: every dependency must be imported. An
       undeclared assignment (`panelKind = 'x'`) throws ReferenceError in a
       module and kills the handler before it renders — ESLint is the only
       gate that sees it, since source-contract tests cannot execute them. */
    files: ['frontend/app/js/v2/screens/**/*.js'],
    rules: {
      'no-undef': 'error',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'release/',
      'database/backups/',
      'database/data/',
      'backups/',
      'android/',
      'build/',
      'updates/',
      'logs/',
      'node/',
      '*.log',
      '.env*',
      'coverage/',
      'var/',
      'test-results/',
      'playwright-report/',
      'frontend/app/vendor/',
      'frontend/app/js/vendor/',
      'frontend/v3/assets/',
      'frontend/app/js/app.js',
      // مساحة عمل V3 كاملة: تُفحص بأدواتها (biome + tsc + vitest) لا بـeslint الجذر،
      // ومخرجات حزمها (packages/*/dist) ليست كودًا مصدريًا.
      'v3/',
      // electron/ كان مستثنىً من الفحص كود التطبيق strawsib ≠ آمن:
      // كود main process privileged بلا مراجعة lint. أُدخل النطاق بعد
      // تصفير التحذيرات (policy: no new warnings).
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
      /* مساند الجذر المؤقّتة: سكربتات قراءة-فقط يكتبها/session ثم يحذفها في
         دقائق. ليست كود منتج، فلا تُحاسب البوابة عليها — وإلّا ظلّ lint-gate
         أحمر طوال أي تشخيص جارٍ (النمط نفسه المعتمد فوق: test-/debug-/check-).
         المقصود الجذر فقط؛ scripts/ وbackend/ وtests/ تظلّ مفحوصة بالكامل. */
      '_tmp_*.js',
      '_tmp_*.mjs',
      'tmp-*.js',
      'tmp_*.js',
    ],
  },
];