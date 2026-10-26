const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const CONSTRAINTS = path.join(V2, 'data', 'db-constraints-repo.js');
const SHELL_REPO = path.join(V2, 'data', 'shell-repo.js');
const SHELL_EXTRAS = path.join(V2, 'layout', 'shell-extras.js');

function loadModule(file, exports, injections = {}) {
    const source = fs.readFileSync(file, 'utf8')
        .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
        .replace(/^export\s+/gm, '');
    const context = {
        console, Date, Number, String, Object, Array, Promise, Error, RegExp, Math,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(`${source}; Object.assign(globalThis, { ${exports.join(', ')} });`, context, { filename: file });
    return context;
}

describe('V2 database constraint advisory', () => {
    test('requires admin role and validates schema-defined field constraints', async () => {
        const apiFetch = jest.fn(async () => ({
            products: {
                columns: {
                    name: { type: 'character varying', nullable: false, maxLength: 5 },
                    qty: { type: 'integer', nullable: false, default: 0 },
                },
            },
        }));
        const repo = loadModule(CONSTRAINTS, ['fetchDbConstraints', 'validateDbField', 'validateDbForm'], { apiFetch });

        await expect(repo.fetchDbConstraints('manager')).rejects.toThrow('للأدمن فقط');
        expect(apiFetch).not.toHaveBeenCalled();
        expect(await repo.validateDbField('products', 'name', 'طويل جدًا', 'admin')).toMatchObject({
            checked: true, ok: false, errors: [{ code: 'MAX_LENGTH' }],
        });
        expect(await repo.validateDbForm('products', { name: 'رز', qty: '2' }, 'admin'))
            .toMatchObject({ checked: true, ok: true, errors: [] });
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    test('server constraint failures remain visible instead of claiming validation passed', async () => {
        const apiFetch = jest.fn(async () => {throw new Error('schema offline');});
        const repo = loadModule(CONSTRAINTS, ['fetchDbConstraints'], { apiFetch });
        await expect(repo.fetchDbConstraints('admin')).rejects.toThrow('schema offline');
    });
});

describe('V2 server version badge repository', () => {
    test('uses the legacy server-info endpoint and rejects malformed status data', async () => {
        const apiFetch = jest.fn(async () => ({
            upToDate: false, startedAt: '2027-01-01T10:00:00Z', codeMtime: '2027-01-01T11:00:00Z',
        }));
        const repo = loadModule(SHELL_REPO, ['fetchServerInfo'], { apiFetch });

        expect(await repo.fetchServerInfo()).toMatchObject({
            upToDate: false, startedAt: '2027-01-01T10:00:00Z', codeMtime: '2027-01-01T11:00:00Z',
        });
        expect(apiFetch).toHaveBeenCalledWith('/system/server-info');

        const invalidRepo = loadModule(SHELL_REPO, ['fetchServerInfo'], {
            apiFetch: jest.fn(async () => ({ upToDate: 'yes' })),
        });
        await expect(invalidRepo.fetchServerInfo()).rejects.toThrow('صيغة حالة إصدار الخادم غير صالحة');
    });

    test('renders current/outdated status only in live mode and refreshes periodically', () => {
        const extras = fs.readFileSync(SHELL_EXTRAS, 'utf8');
        const repo = fs.readFileSync(SHELL_REPO, 'utf8');
        expect(extras).toContain('fetchHealth, fetchServerInfo');
        expect(repo).toContain("apiFetch('/system/server-info')");
        expect(extras).toContain('const SERVER_INFO_MS = 5 * 60_000');
        expect(extras).toContain('الخادم يعمل بكود قديم');
        expect(extras).toContain('تعذّر فحص إصدار الخادم');
        expect(extras).toContain('if (!live()) {serverInfo.textContent = \'\'; return;}');
    });
});
