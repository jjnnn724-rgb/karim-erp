/**
 * Jest must never clone production backups or create/drop databases.
 * Integration tests require an explicitly provisioned synthetic test database.
 */
module.exports = async function () {
    const database = process.env.KARIM_TEST_DB_NAME || process.env.DB_NAME;
    const host = String(process.env.DB_HOST || '127.0.0.1').toLowerCase();

    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to run Jest with NODE_ENV=production.');
    }
    if (database !== 'karim_erp_test' || process.env.DB_NAME !== database) {
        throw new Error('Jest requires DB_NAME and KARIM_TEST_DB_NAME to both equal karim_erp_test.');
    }
    if (process.env.KARIM_TEST_DB_ISOLATED !== '1') {
        throw new Error('Set KARIM_TEST_DB_ISOLATED=1 only after provisioning a disposable database with synthetic data.');
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
        throw new Error('Jest database host must be loopback; remote database connections are refused.');
    }
};
