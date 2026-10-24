/**
 * v2-settings.test.js — عقد شاشة الإعدادات الكاملة ومرآة أبوابها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/settings-users.js:8-592 + :724-1013 (الأبواب والحمولات
 * والجمل) — الرئيسية/ظهور القوائم/الشعار + ZATCA الكامل + KOT + البطاقات +
 * البصمة الذاتية + النسخ/الاستعادة + التصدير/التصفير.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'settings-repo.js');
const SCREEN = path.join(V2, 'screens', 'settings.js');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

const read = (p) => fs.readFileSync(p, 'utf8');

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
        Date, Math, Promise, Set, Map, Intl, FormData, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

describe('الإعدادات — الأبواب', () => {
    test('ZATCA: نفس المسارات والحمولات', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchZatcaSettings', 'saveZatcaSettings', 'toggleZatca', 'testZatca',
            'generateCsr', 'requestCsid', 'saveCsidManual', 'applyVat',
            'fetchZatcaQueue', 'retryZatcaQueue',
        ]);
        await ctx.fetchZatcaSettings();
        await ctx.saveZatcaSettings({ seller_name: 'م', max_attempts: 10 });
        await ctx.toggleZatca(false);
        await ctx.testZatca(undefined);
        await ctx.generateCsr();
        await ctx.requestCsid('123456');
        await ctx.saveCsidManual({ csid: 'MIIC', vat_number: undefined });
        await ctx.saveCsidManual({ clear: true });
        await ctx.applyVat('300000000000003');
        await ctx.fetchZatcaQueue(20);
        await ctx.retryZatcaQueue('failed');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /zatca/settings',
            'PUT /zatca/settings',
            'POST /zatca/toggle',
            'POST /zatca/test',
            'POST /zatca/csr',
            'POST /zatca/csid',
            'POST /zatca/csid/manual',
            'POST /zatca/csid/manual',
            'POST /zatca/apply-vat',
            'GET /zatca/queue?limit=20',
            'POST /zatca/queue/retry',
        ]);
        expect(JSON.parse(calls[2].body)).toEqual({ enabled: false });
        expect(JSON.parse(calls[5].body)).toEqual({ otp: '123456' });
        expect(JSON.parse(calls[7].body)).toEqual({ clear: true });
    });

    test('KOT والبطاقات والبصمة والنسخ والتصفير: نفس المسارات', async () => {
        const { apiFetch, calls } = repoStub((p) => {
            if (p === '/attendance/portal/settings-admin') {return { settings: [] };}
            if (p.startsWith('/attendance/portal/attempts')) {return { attempts: [], summary: null };}
            return {};
        });
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchKotSettings', 'saveKotSettings', 'fetchCardSettings', 'saveCardSettings',
            'fetchPunchAdmin', 'savePunchSettings', 'removePunchFace',
            'fetchPunchDevices', 'unbindPunchDevice', 'fetchBackups', 'doBackup',
            'restoreBackup', 'resetAllData', 'operationalReset', 'updateMainSettings',
        ]);
        await ctx.fetchKotSettings();
        await ctx.saveKotSettings({ kot_enabled: true, kot_copies: 1, kot_include_notes: false });
        await ctx.fetchCardSettings();
        await ctx.saveCardSettings({ verifyBase: '', emergencyPhone: '' });
        await ctx.fetchPunchAdmin();
        await ctx.savePunchSettings({ punch_portal_enabled: true });
        await ctx.removePunchFace(9);
        await ctx.fetchPunchDevices();
        await ctx.unbindPunchDevice(9);
        await ctx.fetchBackups();
        await ctx.doBackup();
        await ctx.restoreBackup({ file: 'x.sql', restoreEnv: false });
        await ctx.resetAllData();
        await ctx.operationalReset({ confirmation: 'CONFIRM PRODUCTION RESET', reason: 'سبب واضح كاف', force: true });
        await ctx.updateMainSettings({ name: 'م', currency: 'SAR', workStartHour: 9 });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /pos/kot/settings',
            'PUT /pos/kot/settings',
            'GET /hr/card-settings',
            'PUT /hr/card-settings',
            'GET /attendance/portal/settings-admin',
            'GET /attendance/portal/attempts?limit=50',
            'PUT /attendance/portal/settings-admin',
            'DELETE /attendance/portal/face/enroll/9',
            'GET /attendance/portal/punch-devices',
            'DELETE /attendance/portal/punch-devices/9',
            'GET /system/backups',
            'POST /system/backup',
            'POST /system/restore',
            'DELETE /state',
            'POST /warehouse/system/reset-all',
            'PUT /settings/main_settings',
        ]);
        expect(JSON.parse(calls[12].body)).toEqual({ file: 'x.sql', confirm: 'RESTORE', restoreEnv: false });
        expect(JSON.parse(calls[14].body)).toEqual({
            confirmation: 'CONFIRM PRODUCTION RESET', reason: 'سبب واضح كاف', force: true, scope: 'full',
        });
    });
});

describe('الإعدادات — عقد الشاشة', () => {
    const src = () => read(SCREEN);

    test('الأقسام التسعة حاضرة + تأكيدات الخطر حرفية', () => {
        const s = src();
        for (const k of ['data-v2-main', 'data-v2-nav', 'zatca', 'data-v2-zt-save',
            'data-v2-kot-save', 'data-v2-card-save', 'data-v2-pu-save',
            'data-v2-bk-now', 'data-v2-bk-go', 'data-v2-exp-json',
            'data-v2-reset-data', 'data-v2-rs-go']) {
            expect(s).toContain(k);
        }
        expect(s).toContain('CONFIRM PRODUCTION RESET');
        expect(s).toContain('RESTORE');
        expect(s).toContain('10 أحرف');
    });

    test('تسجيل الوجه في V2 يعمل من الشاشة: كاميرا + مستودع، لا رسالة «قيد الربط»', () => {
        const s = src();
        expect(s).toMatch(/import \{ captureFace \} from '\.\.\/portal-face\.js\?v=/);
        expect(s).toMatch(/import \{ enrollFaceV1, enrollFaceV2 \} from '\.\.\/data\/portal-repo\.js\?v=/);
        expect(s).toMatch(/import \{ fetchEmployees \} from '\.\.\/data\/employees-repo\.js\?v=/);
        expect(s).toContain('data-v2-pu-face-user');
        expect(s).toContain('data-v2-pu-enroll');
        expect(s).toMatch(/captureFace\(\{ title: `تسجيل وجه:/);
        expect(s).toMatch(/enrollFaceV2\(userId, face\.images\)/);
        expect(s).toMatch(/enrollFaceV1\(userId, face\.descriptors\)/);
        expect(s).not.toContain('قيد الربط');
    });

    test('بلا شبكة مباشرة ولا معالج سطري ولا حوار حاجب', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/settings-repo\.js\?v=/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s).not.toMatch(/\bprompt\(/);
    });

    test('الوحدة الموحدة', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });

    test('المضيف يبقي المفتاح مربوطًا بالشاشة الجديدة', () => {
        const h = read(HOST);
        expect(h).toMatch(/mount: mountSettingsScreen/);
        expect(h).toMatch(/key: 'settings'/);
    });
});
