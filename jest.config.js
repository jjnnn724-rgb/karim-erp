/**
 * jest.config.js — karim ERP test configuration.
 * The project's test suites live in the tests/ directory. scripts/test.js is
 * the test RUNNER (npm test), not a suite — but its filename matched jest's
 * default star-dot-test-dot-js pattern, so bare "npx jest" failed on it with
 * "Your test suite must contain at least one test".
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
};
