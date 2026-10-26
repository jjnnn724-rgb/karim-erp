/**
 * jest.config.js — karim ERP test configuration.
 * The project's test suites live in the tests/ directory. scripts/test.js is
 * the test RUNNER (npm test), not a suite — but its filename matched jest's
 * default star-dot-test-dot-js pattern, so bare "npx jest" failed on it with
 * "Your test suite must contain at least one test".
 */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests/global-setup.js',
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  /* Every suite talks to a real isolated PostgreSQL; with 266 suites in
     parallel the CPU and the pool are saturated and a handful of DB-bound
     tests legitimately exceed jest's 5s default. A timed-out test proves
     load, not a bug — 2026-10-26 saw webauthn (bcrypt cost 12) and
     migration-lock fail at 5s while both passed instantly alone. 20s is a
     ceiling, not an expectation: the suite still finishes in ~60s. */
  testTimeout: 20000,
  // ─── بوابة التغطية (coverage gate) — تُطبَّق فقط عند --coverage ───
  // الأرقام أرضية آمنة «مِصْعَد» (ratchet): ارفعها تدريجيًا مع كل مجموعة
  // تختبرها، ولا تخفضها أبدًا. لقطة 2026-10-13: stmts 31.2٪ lines 32.5٪
  // funcs 33.3٪ branches 25.9٪ — العتبات تُشدّ تحت المقياس بهامش أمان صغير.
  collectCoverageFrom: [
    'backend/**/*.js',
    '!backend/node_modules/**',
    '!backend/yarasoft/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      statements: 28,
      lines: 29,
      functions: 30,
      branches: 23,
    },
  },
};
