const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const REPO = path.join(APP, 'js', 'v2', 'data', 'whatsapp-repo.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'whatsapp.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-whatsapp.css');
const PAGE = path.join(APP, 'v2.html');

function loadEsm(file, injections = {}, collect = []) {
    const source = fs.readFileSync(file, 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^import\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^export\s+/gm, '');
    const tail = collect.length
        ? `\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : '';
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(`${source}${tail}`, context, { filename: file });
    return context;
}

describe('WhatsApp V2 — repository contract', () => {
    test('existing API doors and methods are used; campaign actions are allowlisted', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (url, options = {}) => {
            calls.push({ url, method: options.method || 'GET', body: options.body });
            return {};
        });
        const repo = loadEsm(REPO, { apiFetch }, [
            'fetchWhatsappStatus', 'fetchWhatsappQr', 'refreshWhatsappQr',
            'startWhatsapp', 'stopWhatsapp', 'logoutWhatsapp', 'requestWhatsappPairing',
            'fetchWhatsappMessages', 'fetchWhatsappOutbox', 'sendWhatsappMessage',
            'fetchWhatsappTemplates', 'saveWhatsappTemplate', 'sendWhatsappTemplate',
            'fetchWhatsappCampaigns', 'createWhatsappCampaign', 'actOnWhatsappCampaign',
            'fetchWhatsappRules', 'saveWhatsappRule', 'deleteWhatsappRule',
            'fetchWhatsappManagers', 'addWhatsappManager', 'deleteWhatsappManager',
            'fetchWhatsappLogs', 'fetchWhatsappAutomation', 'saveWhatsappAutomation',
            'testWhatsappAutomation', 'updateWhatsappChatMeta', 'canManageWhatsapp',
        ]);

        await repo.fetchWhatsappStatus();
        await repo.fetchWhatsappQr();
        await repo.refreshWhatsappQr();
        await repo.startWhatsapp();
        await repo.stopWhatsapp();
        await repo.logoutWhatsapp();
        await repo.requestWhatsappPairing(' 966500000000 ');
        await repo.fetchWhatsappMessages(1000);
        await repo.fetchWhatsappOutbox();
        await repo.sendWhatsappMessage('jid', 'hello');
        await repo.fetchWhatsappTemplates();
        await repo.saveWhatsappTemplate({ name: 'welcome' });
        await repo.sendWhatsappTemplate({ to: 'jid', name: 'welcome', lang: 'en', vars: [1] });
        await repo.fetchWhatsappCampaigns();
        await repo.createWhatsappCampaign({ name: 'campaign' });
        await repo.actOnWhatsappCampaign(5, 'approve');
        await repo.fetchWhatsappRules();
        await repo.saveWhatsappRule({ name: 'hello', match_type: 'exact', pattern: 'hi' });
        await repo.deleteWhatsappRule(3);
        await repo.fetchWhatsappManagers();
        await repo.addWhatsappManager('966500000000');
        await repo.deleteWhatsappManager('966500000000');
        await repo.fetchWhatsappLogs();
        await repo.fetchWhatsappAutomation();
        await repo.saveWhatsappAutomation({ dailyReport: true });
        await repo.testWhatsappAutomation();
        await repo.updateWhatsappChatMeta('966500000000@s.whatsapp.net', { status: 'open', priority: 'high' });

        expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
            'GET /whatsapp/status',
            'GET /whatsapp/qr',
            'POST /whatsapp/qr/refresh',
            'POST /whatsapp/start',
            'POST /whatsapp/stop',
            'POST /whatsapp/logout',
            'POST /whatsapp/pairing',
            'GET /whatsapp/messages?limit=100',
            'GET /whatsapp/outbox',
            'POST /whatsapp/send',
            'GET /whatsapp/templates',
            'POST /whatsapp/templates',
            'POST /whatsapp/templates/send',
            'GET /whatsapp/campaigns',
            'POST /whatsapp/campaigns',
            'POST /whatsapp/campaigns/5/approve',
            'GET /whatsapp/rules',
            'POST /whatsapp/rules',
            'DELETE /whatsapp/rules/3',
            'GET /whatsapp/managers',
            'POST /whatsapp/managers',
            'DELETE /whatsapp/managers/966500000000',
            'GET /whatsapp/logs',
            'GET /whatsapp/automation',
            'POST /whatsapp/automation',
            'POST /whatsapp/automation/test',
            'POST /whatsapp/chats/966500000000%40s.whatsapp.net/meta',
        ]);
        expect(JSON.parse(calls[5].body)).toEqual({ confirm: 'LOGOUT' });
        expect(JSON.parse(calls[6].body)).toEqual({ phone: '966500000000' });
        expect(JSON.parse(calls[12].body)).toEqual({ to: 'jid', name: 'welcome', lang: 'en', vars: ['1'] });
        expect(() => repo.actOnWhatsappCampaign(5, 'delete')).toThrow('إجراء الحملة غير صالح');
        expect(repo.canManageWhatsapp('admin')).toBe(true);
        expect(repo.canManageWhatsapp('manager')).toBe(true);
        expect(repo.canManageWhatsapp('auditor')).toBe(false);
    });

    test('campaign recipients without explicit consent never enter the send payload', () => {
        const screen = loadEsm(SCREEN, {}, ['consentedCampaignRecipients']);
        const recipients = screen.consentedCampaignRecipients([
            '966500000001@s.whatsapp.net|yes|أحمد,123',
            '966500000002@s.whatsapp.net|no|مرفوض',
            '966500000003@s.whatsapp.net|نعم|سارة',
            '966500000004@s.whatsapp.net||بدون موافقة',
        ].join('\n'));
        expect(recipients).toEqual([
            { remote_jid: '966500000001@s.whatsapp.net', consent: true, vars: ['أحمد', '123'] },
            { remote_jid: '966500000003@s.whatsapp.net', consent: true, vars: ['سارة'] },
        ]);
    });
});

describe('WhatsApp V2 — UI, permissions, and lifecycle', () => {
    const source = () => fs.readFileSync(SCREEN, 'utf8');

    test('connection, QR, template, campaign, inbox, and outbox panels are present', () => {
        const text = source();
        for (const feature of [
            'data-wa-qr', 'data-wa-phone', 'data-wa-tab="templates"',
            'data-wa-tab="campaigns"', 'data-wa-tab="outbox"',
            'data-wa-template-ar', 'data-wa-template-en',
            'data-wa-campaign-recipients', 'data-wa-message-to',
            'data-wa-tab="rules"', 'data-wa-tab="managers"',
            'data-wa-tab="automation"', 'data-wa-tab="logs"',
            'data-wa-rule-pattern', 'data-wa-auto-time',
        ]) {
            expect(text).toContain(feature);
        }
        expect(text).toContain('ensureQrCode()');
        expect(text).toContain('لم يُعرض نص الرمز لحماية بيانات الربط');
        expect(text).toContain('setInterval');
        expect(text).toMatch(/clearInterval\(statusTimer\)/);
        expect(text).toMatch(/clearInterval\(qrTimer\)/);
        expect(text).toMatch(/el\.removeEventListener\('click', handleClick\)/);
    });

    test('view role may not see write controls; privileged actions require confirmation', () => {
        const text = source();
        expect(text).toContain("const canWrite = canManageWhatsapp(role);");
        expect(text).toContain("const isAdmin = role === 'admin';");
        expect(text).toContain("if (!isAdmin || !id || !['approve', 'pause', 'cancel'].includes(action)) {return;}");
        expect(text).toContain('if (!confirmAction(prompts[action])) {return;}');
        expect(text).toContain('if (!isAdmin || !confirmAction');
        expect(text).toContain('data-wa-action="start"');
    });

    test('screen has no direct network calls or inline event handlers and CSS stays scoped', () => {
        const clean = source().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(clean).not.toMatch(/\bapiFetch\b|\bfetch\s*\(/);
        expect(clean).not.toMatch(/\son[a-z]+\s*=/i);
        const css = fs.readFileSync(CSS, 'utf8');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).toMatch(/\.erp-v2-whatsapp/);
        expect(fs.readFileSync(PAGE, 'utf8')).toContain('css/v2/erp-whatsapp.css?v=');
    });
});
