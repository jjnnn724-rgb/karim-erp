const fs = require('fs');
const path = require('path');

describe('Fresh installation kitchen schema migration', () => {
  const migrationPath = path.resolve(__dirname, '..', 'database', 'migrations', '030_dispatch_signatures_audit_periods.sql');
  const source = fs.readFileSync(migrationPath, 'utf8');

  test('creates the kitchen audit table before altering its first-login schema', () => {
    const createIndex = source.indexOf('CREATE TABLE IF NOT EXISTS kitchen_audits');
    const alterIndex = source.indexOf('ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS period_start');
    expect(createIndex).toBeGreaterThan(-1);
    expect(alterIndex).toBeGreaterThan(createIndex);
  });

  test('includes the operational kitchen tables without relying on runtime DDL', () => {
    expect(source).toContain('CREATE TABLE IF NOT EXISTS kitchen_policies');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS kitchen_production_batches');
    expect(source).toContain('CREATE TABLE IF NOT EXISTS kitchen_audit_items');
  });
});
