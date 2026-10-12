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
  // ─── بوابة التغطية (coverage gate) — تُطبَّق فقط عند --coverage ───
  // الأرقام أرضية آمنة «مِصْعَد» (ratchet): ارفعها تدريجيًا مع كل مجموعة
  // تختبرها، ولا تخفضها أبدًا. لقطة الحالية: شغّل npm run test:coverage.
  collectCoverageFrom: [
    'backend/**/*.js',
    '!backend/node_modules/**',
    '!backend/yarasoft/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      statements: 20,
      lines: 20,
      functions: 20,
      branches: 10,
    },
  },
};
