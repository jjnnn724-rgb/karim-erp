const fs = require('fs');
const path = require('path');

describe('destructive scenario test safety', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'expanded-pos-scenarios.js'), 'utf8');

  test('requires a dedicated test database and rejects the live database name', () => {
    expect(source).toContain('KARIM_TEST_DB_NAME is required');
    expect(source).toContain("TEST_DB_NAME === 'karim_erp'");
    expect(source).toContain('Refusing to run destructive POS scenarios');
  });
});
