/**
 * v2-zkteco.test.js — عقد شاشة 11 (أجهزة البصمة) ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-procurement.test.js: المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة تسجّل كل رحلة، والشاشة تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا (P2-2، 2026-10-17):
 *   • بوابة الكتابة مرآة لثابت الخادم (routes.js:31 WRITE_ROLES = admin|hr)
 *   • كل أبواب القديم الخمسة عشر تطابق الراوتر مسارًا وطريقة: الأجهزة CRUD،
 *     فحص/مزامنة، مسح الشبكة، الربط اليدوي/التلقائي، مستخدمو الجهاز المخزنون
 *     والحيّون، الاستيراد، السجل، التغطية والتصدير
 *   • commKey (اعتماد الجهاز) لا يخرج من deviceToRow أبدًا، وحقله في نموذج
 *     التعديل يبدأ فارغًا (فارغ = أبقِ المخزّن)
 *   • المزامنة/الحذف/الربط التلقائي/تغيير عنوان الجهاز تسأل قبل الكتابة،
 *     والاختبار نبضة بلا سؤال
 *   • الشاشة لا تملك fetch ولا apiFetch ولا inline handler (CSP)، وتحرس
 *     isConnected بعد كل انتظار، وتدمّر الجدول
 *   • التبويبات الأربعة موجودة، والكتابة كلها خلف الدور + علم v2zkwrite
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'zkteco-repo.js');
const SCREEN = path.join(V2, 'screens', 'zkteco.js');
const SERVER = path.join(__dirname, '..', 'backend', 'zkteco', 'routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** يحمّل وحدة ESM في vm بعد نزع الاستيرادات وكلمة export — نمط الموجات السابقة. */
function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', opts: opts || {} });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

function rolesOf(serverSrc, name) {
    const m = serverSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    expect(m).not.toBeNull();
    return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

const EXPORTS = [
    'fetchZkStatus', 'fetchZkDevices', 'fetchZkMappings', 'fetchZkLogs',
    'fetchZkCoverage', 'fetchStoredDeviceUsers', 'fetchLiveDeviceUsers',
    'testDevice', 'syncDevice', 'createDevice', 'updateDevice', 'deleteDevice',
    'scanNetwork', 'saveMapping', 'autoLinkMappings', 'importDeviceUsers',
    'deviceToRow', 'mappingStats', 'coverageStats', 'validateDeviceForm',
    'punchStateName', 'verifyTypeName', 'downloadZkLogsCsv',
];

describe('v2 شاشة 11 — أجهزة البصمة: مرآة الخادم', () => {
    const serverSrc = read(SERVER);

    test('بوابة كتابة الأجهزة مرآة لثابت الخادم WRITE_ROLES', async () => {
        const write = rolesOf(serverSrc, 'WRITE_ROLES');
        const readRoles = rolesOf(serverSrc, 'READ_ROLES');
        const ctx = loadEsm(REPO, {}, ['ZK_WRITE_ROLES']);
        expect(ctx.ZK_WRITE_ROLES).toEqual(write);
        expect(write).not.toEqual(readRoles); // القراءة أوسع — والتوثيق يقول ذلك
    });

    test('كل أبواب القديم تطابق الراوتر مسارًا وطريقة', async () => {
        const { apiFetch, calls } = repoStub((p) => {
            if (p.startsWith('/zkteco/mappings')) {return { employees: [], unmapped: [] };}
            if (p.startsWith('/zkteco/coverage')) {return { summary: {}, problems: [], ok: [] };}
            return {};
        });
        const ctx = loadEsm(REPO, { apiFetch }, EXPORTS);
        await ctx.fetchZkStatus();
        await ctx.fetchZkDevices();
        await ctx.fetchZkMappings();
        await ctx.fetchZkLogs(200);
        await ctx.fetchZkCoverage(7);
        await ctx.fetchStoredDeviceUsers(3);
        await ctx.fetchLiveDeviceUsers(3);
        await ctx.createDevice({ name: 'بوابة', ipAddress: '192.168.1.50' });
        await ctx.updateDevice(7, { enabled: false });
        await ctx.deleteDevice(7);
        await ctx.testDevice(7);
        await ctx.syncDevice('7');
        await ctx.scanNetwork();
        await ctx.saveMapping(9, '42');
        await ctx.autoLinkMappings();
        await ctx.importDeviceUsers(3, ['1', '2'], 'KIT');

        expect(calls).toEqual([
            { path: '/zkteco/status', method: 'GET', opts: {} },
            { path: '/zkteco/devices', method: 'GET', opts: {} },
            { path: '/zkteco/mappings', method: 'GET', opts: {} },
            { path: '/zkteco/logs?limit=200', method: 'GET', opts: {} },
            { path: '/zkteco/coverage?days=7', method: 'GET', opts: {} },
            { path: '/zkteco/devices/3/stored-users', method: 'GET', opts: {} },
            { path: '/zkteco/devices/3/users', method: 'GET', opts: {} },
            { path: '/zkteco/devices', method: 'POST', opts: { method: 'POST', body: '{"name":"بوابة","ipAddress":"192.168.1.50"}' } },
            { path: '/zkteco/devices/7', method: 'PUT', opts: { method: 'PUT', body: '{"enabled":false}' } },
            { path: '/zkteco/devices/7', method: 'DELETE', opts: { method: 'DELETE' } },
            { path: '/zkteco/devices/7/test', method: 'POST', opts: { method: 'POST' } },
            { path: '/zkteco/devices/7/sync', method: 'POST', opts: { method: 'POST' } },
            { path: '/zkteco/scan', method: 'POST', opts: { method: 'POST', body: '{}' } },
            { path: '/zkteco/mappings/9', method: 'PUT', opts: { method: 'PUT', body: '{"deviceUserId":"42"}' } },
            { path: '/zkteco/mappings/auto', method: 'POST', opts: { method: 'POST', body: '{}' } },
            { path: '/zkteco/devices/3/import-users', method: 'POST', opts: { method: 'POST', body: '{"userIds":["1","2"],"department":"KIT"}' } },
        ]);

        // المسارات نفسها مسماة في الراوتر حرفيًا
        for (const door of [
            "router.get('/status'", "router.get('/devices'", "router.post('/devices'",
            "router.put('/devices/:id'", "router.delete('/devices/:id'",
            "router.post('/devices/:id/test'", "router.post('/devices/:id/sync'",
            "router.get('/devices/:id/users'", "router.get('/devices/:id/stored-users'",
            "router.post('/devices/:id/import-users'", "router.get('/mappings'",
            "router.put('/mappings/:employeeId'", "router.post('/mappings/auto'",
            "router.get('/logs'", "router.get('/logs/export'", "router.get('/coverage'",
            "router.post('/scan'",
        ]) {
            expect(serverSrc).toContain(door);
        }
    });

    test('commKey لا يخرج من deviceToRow — لا قيمة ولا مفتاح ولا نص', () => {
        const ctx = loadEsm(REPO, {}, ['deviceToRow']);
        const row = ctx.deviceToRow({
            id: 1, name: 'المطبخ', ipAddress: '192.168.1.202', port: 4370,
            commKey: 'SECRET-KEY-123', enabled: 1, status: 'online',
            totalSynced: '1200', live: { syncing: true, consecutiveFailures: '3', lastError: 'timeout' },
        });
        const json = JSON.stringify(row);
        expect(json).not.toContain('commKey');
        expect(json).not.toContain('SECRET-KEY-123');
        expect(row.enabled).toBe(true);
        expect(row.nameResolved).toBe(true);
        expect(row.syncing).toBe(true);
        expect(row.failures).toBe(3);
        expect(row.ipAddress).toBe('192.168.1.202');
        expect(row.syncIntervalSeconds).toBe(30);
    });

    test('الاسم المجهول يُعرض raw (#id) مع nameResolved=false — لا اختراع', () => {
        const ctx = loadEsm(REPO, {}, ['deviceToRow']);
        const row = ctx.deviceToRow({ id: 42 });
        expect(row.name).toBe('#42');
        expect(row.nameResolved).toBe(false);
    });

    test('summarizeDevices مشتق من الصفوف — صفر طلبات', () => {
        const ctx = loadEsm(REPO, {}, ['summarizeDevices']);
        const c = ctx.summarizeDevices([
            { status: 'online', enabled: true, syncing: true },
            { status: 'offline', enabled: true, syncing: false },
            { status: 'online', enabled: false, syncing: false },
        ]);
        expect(c).toEqual({ total: 3, online: 2, enabled: 2, syncing: 1 });
    });

    test('validateDeviceForm يكرر شروط الخادم — والفارغ في التعديل يعني «أبقِ المفتاح»', () => {
        const ctx = loadEsm(REPO, {}, ['validateDeviceForm']);
        const good = ctx.validateDeviceForm({
            name: ' بوابة ', ipAddress: '192.168.1.50', port: '4370',
            commKey: '', syncIntervalSeconds: '30', enabled: true,
        });
        expect(good.errors).toEqual([]);
        expect(good.value).toEqual({
            name: 'بوابة', ipAddress: '192.168.1.50', port: 4370,
            enabled: true, syncIntervalSeconds: 30,
        });
        expect('commKey' in good.value).toBe(false);

        const badIp = ctx.validateDeviceForm({ name: 'x', ipAddress: '999.1.1.1' });
        expect(badIp.errors.map((e) => e.field)).toContain('ipAddress');
        const longName = ctx.validateDeviceForm({ name: 'x'.repeat(101), ipAddress: '192.168.1.1' });
        expect(longName.errors.map((e) => e.field)).toContain('name');
        const badKey = ctx.validateDeviceForm({ name: 'x', ipAddress: '192.168.1.1', commKey: '70000' });
        expect(badKey.errors.map((e) => e.field)).toContain('commKey');
        const badInterval = ctx.validateDeviceForm({ name: 'x', ipAddress: '192.168.1.1', syncIntervalSeconds: 2 });
        expect(badInterval.errors.map((e) => e.field)).toContain('syncIntervalSeconds');

        const partial = ctx.validateDeviceForm({ enabled: false }, { partial: true });
        expect(partial.errors).toEqual([]);
        expect(partial.value).toEqual({ enabled: false });
    });

    test('mappingStats وcoverageStats مشتقان — صفر طلبات', () => {
        const ctx = loadEsm(REPO, {}, ['mappingStats', 'coverageStats']);
        expect(ctx.mappingStats({
            employees: [{ deviceUserId: '1' }, { deviceUserId: '' }, { deviceUserId: null }, {}],
            unmapped: [{}, {}],
        })).toEqual({ employees: 4, linked: 1, unlinked: 3, unmapped: 2 });
        expect(ctx.coverageStats({
            summary: { total_employees: '10', ok: 7, problems: 3, face_enrolled: 2, unmapped_device_users: 1 },
        })).toEqual({ total: 10, ok: 7, problems: 3, face: 2, unmapped: 1 });
    });

    test('أسماء الحركة والتحقق من قاموس القديم نفسه', () => {
        const ctx = loadEsm(REPO, {}, ['punchStateName', 'verifyTypeName']);
        expect(ctx.punchStateName(0)).toBe('حضور');
        expect(ctx.punchStateName(5)).toBe('خروج أوفر تايم');
        expect(ctx.punchStateName(9)).toBe('حالة 9');
        expect(ctx.verifyTypeName(1)).toBe('بصمة');
        expect(ctx.verifyTypeName(15)).toBe('وجه');
        expect(ctx.verifyTypeName(99)).toBe('أخرى');
    });

    test('تصدير CSV: باب الشبكة الوحيد في المستودع، والترويسة والاستعلام صحيحان', async () => {
        const seen = [];
        const fetch = jest.fn(async (url, opts) => {
            seen.push({ url, opts });
            return { ok: true, blob: async () => 'CSV-BLOB' };
        });
        const window = { _jwt: 'JWT', _appKey: 'KEY' };
        const ctx = loadEsm(REPO, {
            fetch, window, API_BASE: 'https://erp.test/api',
        }, ['downloadZkLogsCsv']);
        const res = await ctx.downloadZkLogsCsv({ from: '2026-10-01', to: '2026-10-17' });
        expect(seen).toHaveLength(1);
        expect(seen[0].url).toBe('https://erp.test/api/zkteco/logs/export?from=2026-10-01&to=2026-10-17');
        expect(seen[0].opts.headers).toEqual({ Authorization: 'Bearer JWT', 'x-api-key': 'KEY' });
        expect(await res.blob).toBe('CSV-BLOB');
        expect(res.filename).toBe('fingerprints-2026-10-01_2026-10-17.csv');
        // لا fetch في الشاشة — التصدير يمر من هنا
        expect(read(SCREEN)).not.toMatch(/\bfetch\s*\(/);
    });
});

describe('v2 شاشة 11 — عقد المصدر (CSP/تأكيد/هدم/تبويبات)', () => {
    const src = read(SCREEN);

    test('لا inline handler ولا fetch ولا apiFetch في الشاشة (CSP nonce + باب واحد)', () => {
        expect(src).not.toMatch(/\son(click|change|submit|keydown|input)=/i);
        expect(src).not.toMatch(/\bfetch\s*\(/);
        expect(src).not.toMatch(/\bapiFetch\b|core\/api\.js/);
    });

    test('التبويبات الأربعة وألواحها موجودة بأسماء القديم', () => {
        for (const tab of ['devices', 'mappings', 'logs', 'coverage']) {
            expect(src).toContain(`data-v2-tab="${tab}"`);
            expect(src).toContain(`data-v2-pane="${tab}"`);
        }
        expect(src).toMatch(/role="tablist"/);
    });

    test('كل كتابات القديم مستوردة ومستدعاة — لا زر بلا باب', () => {
        for (const fn of [
            'createDevice', 'updateDevice', 'deleteDevice', 'scanNetwork',
            'saveMapping', 'autoLinkMappings', 'importDeviceUsers',
        ]) {
            expect(src).toContain(fn);
        }
        expect(src).toMatch(/testDevice|syncDevice/);
    });

    test('الكتابة مزدوجة القفل: الدور + علم v2zkwrite', () => {
        expect(src).toMatch(/import \{ zkWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(src).toMatch(/canWrite\(ctx\.role, ZK_WRITE_ROLES\) && zkWriteEnabled\(\)/);
        // كل عمليات الكتابة تبدأ بحارس writable
        for (const guard of [
            /function openDeviceForm[\s\S]{0,80}if \(!writable\)/,
            /async function saveDeviceForm[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function runOp[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function toggleDevice[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function removeDevice[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function runScan[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function saveMapRow[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function runAutoLink[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function previewImport[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function confirmImport[\s\S]{0,80}if \(!writable \|\| saving\)/,
            /async function useFoundDevice[\s\S]{0,80}if \(!writable \|\| saving\)/,
        ]) {
            expect(src).toMatch(guard);
        }
    });

    test('commKey لا يُملأ مسبقًا في التعديل — الحقل فارغ دائمًا', () => {
        expect(src).toMatch(/name="commKey"[^>]*value=""/);
        expect(src).not.toMatch(/row\.commKey|d\.commKey|source\.commKey/);
    });

    test('التأكيدات: المزامنة والحذف والربط التلقائي وتغيير عنوان الجهاز', () => {
        expect(src).toContain('بدء مزامنة');
        expect(src).toContain('سيُحذف معه سجل بصماته الخام');
        expect(src).toContain('ربط تلقائي: كل موظف بلا رقم بصمة');
        expect(src).toContain('تحديث عنوان الجهاز');
        // نية واحدة في كل لحظة
        expect(src).toMatch(/if \(saving\)\s*\{return;\}/);
    });

    test('حارس isConnected بعد الانتظار — لا كتابة بعد الرحيل', () => {
        expect((src.match(/if \(!el\.isConnected\)\s*\{return;\}/g) || []).length).toBeGreaterThanOrEqual(8);
        expect(src).toContain('table.destroy()');
    });

    test('الجداول ببنية erp-table__scroll > erp-table__grid', () => {
        expect(src).toContain('erp-table__scroll');
        expect(src).toContain('erp-table__grid');
        expect(src).not.toMatch(/class="erp-table"/);
    });

    test('رسالة 401 منطوقة من مسار apiFetch نفسه', () => {
        expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(src).toContain('القرار للخادم وحده');
    });

    test('أزرار التشغيل لا تُعرض إلا لبوابة الكتابة (writable)', () => {
        expect(src).toMatch(/\.\.\.\(writable \? \[\{/);
        expect(src).toMatch(/\$\{writable \? `<button type="button" class="erp-btn erp-btn--sm" data-v2-auto-link>/);
    });

    test('التصدير يستخدم مستودع الـCSV ولا يصنع رابط download من fetch', () => {
        expect(src).toContain('downloadZkLogsCsv');
        expect(src).toContain('URL.createObjectURL');
        expect(src).toMatch(/data-v2-log-from/);
        expect(src).toMatch(/data-v2-log-to/);
    });
});
