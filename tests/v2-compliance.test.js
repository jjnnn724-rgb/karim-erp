/**
 * v2-compliance.test.js — عقد قسم «الامتثال السعودي» في إعدادات V2 (GATE 03)
 * ────────────────────────────────────────────────────────────────────────────
 * يثبت: مسارات المستودع، الربط بالشاشة، عدم تسريب الاعتماد، واستخدام
 * أصناف CSS الموجودة فعلًا (لا أصناف خيالية).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'integration-repo.js');
const SCREEN = path.join(V2, 'screens', 'compliance.js');
const SETTINGS = path.join(V2, 'screens', 'settings.js');
const V2_HTML = path.join(APP, 'v2.html');
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

describe('الامتثال — مستودع البيانات', () => {
    test('المسارات والحمولات مطابقة لعقد /api/integration', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchComplianceHealth', 'fetchComplianceProviders', 'setComplianceProviderEnabled',
            'saveComplianceCredential', 'fetchComplianceOutbox', 'retryComplianceRow',
            'reviewComplianceRow', 'fetchComplianceEvents',
        ]);
        await ctx.fetchComplianceHealth();
        await ctx.fetchComplianceProviders();
        await ctx.setComplianceProviderEnabled('zatca', false);
        await ctx.saveComplianceCredential('gosi', 'client_secret', 'v'.repeat(12));
        await ctx.fetchComplianceOutbox('dead_letter');
        await ctx.retryComplianceRow(7);
        await ctx.reviewComplianceRow(7, 'abandon', 'سبب مقبول');
        await ctx.fetchComplianceEvents(10);

        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /integration/health?live=1',
            'GET /integration/providers',
            'PUT /integration/providers/zatca/settings',
            'PUT /integration/credentials/gosi/client_secret',
            'GET /integration/outbox?live=1&status=dead_letter',
            'POST /integration/outbox/7/retry',
            'POST /integration/outbox/7/review',
            'GET /integration/events?live=1&limit=10',
        ]);
        expect(JSON.parse(calls[2].body)).toEqual({ enabled: false });
        expect(JSON.parse(calls[3].body)).toEqual({ value: 'v'.repeat(12) });
        expect(JSON.parse(calls[6].body)).toEqual({ decision: 'abandon', reason: 'سبب مقبول' });
    });

    test('لا مسار لقراءة الاعتماد أو كشفه', () => {
        const s = read(REPO);
        expect(s).not.toMatch(/ciphertext/i);
        expect(s).not.toMatch(/fetchComplianceCredential|getCredential/);
    });

    test('مسارات مدد/التأمينات/قوى مطابقة لعقد الخادم', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchWpsRequirements', 'fetchWpsReadiness', 'saveEmployeeBank',
            'generateWpsSheet', 'fetchGosiRates', 'fetchGosiPreview', 'fetchQiwaReadiness',
        ]);
        await ctx.fetchWpsRequirements('2026-10');
        await ctx.fetchWpsReadiness('2026-10');
        await ctx.saveEmployeeBank(5, { iban: 'SA4420000001234567891234', nationality: 'SA' });
        await ctx.generateWpsSheet('2026-10');
        await ctx.fetchGosiRates();
        await ctx.fetchGosiPreview('2026-10', 'legacy_before_2024_07');
        await ctx.fetchQiwaReadiness();

        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /integration/wps/requirements?live=1&month=2026-10',
            'GET /integration/wps/readiness?live=1&month=2026-10',
            'PUT /integration/wps/employees/5/bank',
            'POST /integration/wps/export',
            'GET /integration/gosi/rates?live=1',
            'GET /integration/gosi/preview?live=1&month=2026-10&rate_set=legacy_before_2024_07',
            'GET /integration/qiwa/readiness?live=1',
        ]);
        expect(JSON.parse(calls[2].body)).toEqual({ iban: 'SA4420000001234567891234', nationality: 'SA' });
        expect(JSON.parse(calls[3].body)).toEqual({ month: '2026-10' });
    });

    test('شاشة مدد تعرض الحظر والمتطلبات ولا تدّعي ربطًا حكوميًا', () => {
        const s = read(SCREEN);
        expect(s).toContain('حماية الأجور (مدد)');
        expect(s).toContain('التأمينات (GOSI)');
        expect(s).toContain('قوى — جاهزية البيانات');
        expect(s).toContain('data-wps-month');
        expect(s).toContain('data-wps-export');
        expect(s).toContain('data-gosi-rate');
        expect(s).toContain('data-bank-save');
        expect(s).toMatch(/export_ready/);
        expect(s).not.toMatch(/مقبول من مدد/);
    });
});

describe('الامتثال — الشاشة والربط', () => {
    test('الشاشة تستورد المستودع ولا تتصل بالشبكة مباشرة', () => {
        const s = read(SCREEN);
        expect(s).toMatch(/from '\.\.\/data\/integration-repo\.js\?v=/);
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s).toMatch(/export function mountComplianceSection/);
    });

    test('بطاقات المزوّدين تُبنى بعقد DOM آمن بدل إدخال بيانات الخادم في HTML', () => {
        const s = read(SCREEN);
        expect(s).toContain('function providerCard');
        expect(s).toMatch(/title\.append\(document\.createTextNode\(String\(p\.name_ar/);
        expect(s).toMatch(/englishName\.textContent = String\(p\.name_en/);
        expect(s).toMatch(/evidence\.textContent = String\(p\.evidence_note/);
        expect(s).toMatch(/providerGrid\.append\(providerCard\(provider\)\)/);
        expect(s).not.toContain('providers.map(providerCard)');
        expect(s).toMatch(/esc\(r\.event_type\)/);
        expect(s).toMatch(/esc\(e\.provider_code\)/);
        expect(s).toMatch(/esc\(r\.last_error_code \|\|/);
    });

    test('لا أصناف CSS غير موجودة في طبقة V2', () => {
        const s = read(SCREEN);
        for (const bad of ['erp-grid', 'erp-grid--cards', 'erp-badges', 'erp-table-wrap']) {
            expect(s).not.toContain(bad);
        }
        expect(s).toContain('erp-table__scroll');
        expect(s).toContain('erp-table__grid');
        expect(s).toContain('erp-cards');
    });

    test('الإعدادات تربط القسم بصلاحية عرض ولا تعرضه لمن لا يملكها', () => {
        const s = read(SETTINGS);
        expect(s).toMatch(/import \{ mountComplianceSection \} from '\.\/compliance\.js\?v=/);
        expect(s).toMatch(/canCompliance\s*=\s*isAdmin\s*\|\|\s*liveGrants\.includes\('compliance\.view'\)/);
        expect(s).toMatch(/canCompliance \? sectionCard\('compliance', 'shield-check', 'الامتثال السعودي', 'compliance', 'compliance'\) : ''/);
        expect(s).toMatch(/key === 'compliance'\) \{loadCompliance\(\);/);
        expect(s).toMatch(/complianceSection\.destroy\(\)/);
    });

    test('الوحدة الموحدة على الملفات الثلاثة', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN, SETTINGS]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });

    test('لا أسرار في الشاشة أو المستودع', () => {
        for (const f of [REPO, SCREEN]) {
            const s = read(f);
            expect(s).not.toMatch(/VAULT_KEY|client_secret\s*[:=]\s*['"][^'"]+['"]/);
            expect(s).not.toMatch(/console\.log/);
        }
    });
});
