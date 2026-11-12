import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWhatsappStateAr, whatsappEngineState, whatsappTemplateRows } from './whatsapp';
import {
    actOnWhatsappCampaign,
    addWhatsappManager,
    askWhatsappQuery,
    automationFormError,
    campaignFormError,
    canManageWhatsapp,
    consentedCampaignRecipients,
    createWhatsappCampaign,
    deleteWhatsappRule,
    isWhatsappAdmin,
    logoutWhatsapp,
    managerNumberError,
    messageFormError,
    pairingPhoneError,
    requestWhatsappPairing,
    ruleFormError,
    saveWhatsappRule,
    saveWhatsappTemplate,
    sendWhatsappMessage,
    sendWhatsappTemplate,
    templateFormError,
    updateWhatsappChatMeta,
    waAnswerText,
} from './whatsapp-write';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(body: unknown = { ok: true }) {
    const fetchMock = vi.fn(async () => json(body));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function request(fetchMock: ReturnType<typeof stubFetch>, index = 0): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls[index] as unknown as [RequestInfo | URL, RequestInit];
    return { url: String(call[0]), init: call[1] };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أدوار واتساب', () => {
    it('الكتابة لمدير النظام والمدير فقط، والجلسة للـadmin وحده', () => {
        expect(canManageWhatsapp('admin')).toBe(true);
        expect(canManageWhatsapp('manager')).toBe(true);
        expect(canManageWhatsapp('cashier')).toBe(false);
        expect(canManageWhatsapp(null)).toBe(false);
        expect(canManageWhatsapp(undefined)).toBe(false);

        expect(isWhatsappAdmin('admin')).toBe(true);
        expect(isWhatsappAdmin('manager')).toBe(false);
        expect(isWhatsappAdmin(null)).toBe(false);
    });
});

describe('حالة المحرك', () => {
    it('يفضّل connection.state كما يعيده الخادم', () => {
        expect(whatsappEngineState({ connection: { state: 'QR_REQUIRED', qrAvailable: true, reconnects: 0 } })).toBe('QR_REQUIRED');
        expect(whatsappEngineState({ status: 'CONNECTED' })).toBe('CONNECTED');
        expect(whatsappEngineState(undefined)).toBe('DISCONNECTED');
    });

    it('يترجم كل حالات المحرك إلى عربية بنبرة صحيحة', () => {
        expect(resolveWhatsappStateAr('CONNECTED', false)).toEqual({ label: 'متصل ومفعّل', tone: 'success' });
        expect(resolveWhatsappStateAr('QR_REQUIRED', undefined).tone).toBe('warn');
        expect(resolveWhatsappStateAr('RECONNECTING', undefined).label).toBe('جارٍ إعادة الاتصال');
        expect(resolveWhatsappStateAr('AUTHENTICATING', undefined).tone).toBe('warn');
        expect(resolveWhatsappStateAr('INITIALIZING', undefined).tone).toBe('warn');
        expect(resolveWhatsappStateAr('BANNED', undefined)).toEqual({ label: 'الرقم محظور', tone: 'danger' });
        expect(resolveWhatsappStateAr('FAILED', undefined)).toEqual({ label: 'خطأ في الاتصال', tone: 'danger' });
        expect(resolveWhatsappStateAr('LOGGED_OUT', undefined).tone).toBe('danger');
        expect(resolveWhatsappStateAr('STOPPED', undefined)).toEqual({ label: 'المحرك متوقف', tone: 'muted' });
        expect(resolveWhatsappStateAr('SOMETHING_ELSE', undefined)).toEqual({ label: 'غير متصل', tone: 'muted' });
    });

    it('يقرأ القوالب من templates أولًا ثم rows', () => {
        const template = { name: 'فاتورة', body: '', category: 'فواتير', ar: 'نص', en: '', variables: 0 };
        expect(whatsappTemplateRows({ templates: [template] })).toHaveLength(1);
        expect(whatsappTemplateRows({ rows: [template] })).toHaveLength(1);
        expect(whatsappTemplateRows({})).toEqual([]);
        expect(whatsappTemplateRows(undefined)).toEqual([]);
    });
});

describe('التحقق من النماذج', () => {
    it('رقم الربط من 7 إلى 16 رقمًا بعد حذف الرموز', () => {
        expect(pairingPhoneError('+966 50 123 4567')).toBe('');
        expect(pairingPhoneError('123456')).not.toBe('');
        expect(pairingPhoneError('12345678901234567')).not.toBe('');
        expect(pairingPhoneError('')).not.toBe('');
        expect(managerNumberError('0501234567')).toBe('');
        expect(managerNumberError('123')).not.toBe('');
    });

    it('الرسالة تتطلب مستلمًا ونصًا', () => {
        expect(messageFormError('', 'نص')).not.toBe('');
        expect(messageFormError('96650@s.whatsapp.net', '')).not.toBe('');
        expect(messageFormError('96650@s.whatsapp.net', 'نص')).toBe('');
    });

    it('القالب يتطلب اسمًا ونصًا ومتغيرات 0..20', () => {
        expect(templateFormError({ name: '', category: '', ar: 'x', en: '', variables: 0 })).not.toBe('');
        expect(templateFormError({ name: 'ق', category: '', ar: '', en: '', variables: 0 })).not.toBe('');
        expect(templateFormError({ name: 'ق', category: '', ar: 'x', en: '', variables: 21 })).not.toBe('');
        expect(templateFormError({ name: 'ق', category: '', ar: 'x', en: '', variables: 2 })).toBe('');
    });

    it('قاعدة الرد: اسم ونوع مطابقة معروف ونمط', () => {
        const base = { name: 'قاعدة', match_type: 'exact', pattern: 'مرحبا', response: '', enabled: true };
        expect(ruleFormError({ ...base, name: '' })).not.toBe('');
        expect(ruleFormError({ ...base, match_type: 'regex' })).not.toBe('');
        expect(ruleFormError({ ...base, pattern: ' ' })).not.toBe('');
        expect(ruleFormError(base)).toBe('');
    });

    it('وقت التقرير اليومي HH:MM', () => {
        expect(automationFormError({ dailyTime: '23:30' })).toBe('');
        expect(automationFormError({ dailyTime: '9:5' })).not.toBe('');
    });

    it('الحملة تتطلب اسمًا وقالبًا ومستلمًا موافقًا', () => {
        const recipients = [{ remote_jid: '9665@s.whatsapp.net', consent: true, vars: [] }];
        expect(campaignFormError({ name: '', templateName: 't', recipients })).not.toBe('');
        expect(campaignFormError({ name: 'ح', templateName: '', recipients })).not.toBe('');
        expect(campaignFormError({ name: 'ح', templateName: 't', recipients: [] })).not.toBe('');
        expect(campaignFormError({ name: 'ح', templateName: 't', recipients, scheduledAt: 'ليس تاريخًا' })).not.toBe('');
        expect(campaignFormError({ name: 'ح', templateName: 't', recipients })).toBe('');
    });
});

describe('مستلمو الحملة — نسخة V2 حرفيًا', () => {
    it('يقبل الموافقة الصريحة فقط ويحذف الأسطر الفارغة', () => {
        const rows = consentedCampaignRecipients(
            [
                '9665AAA@s.whatsapp.net|yes|أحمد, 123',
                '9665BBB@s.whatsapp.net|no|سارة',
                '9665CCC@s.whatsapp.net|نعم',
                '',
                '9665DDD@s.whatsapp.net|1|x',
            ].join('\r\n'),
        );
        expect(rows.map((row) => row.remote_jid)).toEqual(['9665AAA@s.whatsapp.net', '9665CCC@s.whatsapp.net', '9665DDD@s.whatsapp.net']);
        expect(rows[0]?.vars).toEqual(['أحمد', '123']);
    });

    it('يحدّ المتغيرات بعشرين والمستلمين بألف', () => {
        const vars = Array.from({ length: 25 }, (_, index) => `v${index}`).join(',');
        const [first] = consentedCampaignRecipients(`9665@s.whatsapp.net|yes|${vars}`);
        expect(first?.vars).toHaveLength(20);

        const many = Array.from({ length: 1005 }, (_, index) => `9665${index}@s.whatsapp.net|yes`).join('\n');
        expect(consentedCampaignRecipients(many)).toHaveLength(1000);
    });
});

describe('عقود الكتابة المرسلة للخادم', () => {
    it('logout يرسل تأكيد LOGOUT وتفريغ الجلسة يمرّ بنفس المسار', async () => {
        const fetchMock = stubFetch();
        await logoutWhatsapp();
        const { url, init } = request(fetchMock);
        expect(url).toBe('/api/whatsapp/logout');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ confirm: 'LOGOUT' });
    });

    it('رمز الربط يُرسل أرقامًا فقط ويُرفض محليًا قبل الشبكة', async () => {
        const fetchMock = stubFetch({ ok: true, code: 'ABCD-1234' });
        expect(() => requestWhatsappPairing('12')).toThrow();
        expect(fetchMock).not.toHaveBeenCalled();

        const data = await requestWhatsappPairing('+966 50 123 4567');
        expect(data.code).toBe('ABCD-1234');
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({ phone: '966501234567' });
    });

    it('الإرسال يقصّ الطرفين ويحدّ النص بأربعة آلاف حرف', async () => {
        const fetchMock = stubFetch();
        await sendWhatsappMessage('  9665@s.whatsapp.net  ', `  ${'x'.repeat(4500)}  `);
        const body = JSON.parse(String(request(fetchMock).init.body)) as { to: string; body: string };
        expect(body.to).toBe('9665@s.whatsapp.net');
        expect(body.body).toHaveLength(4000);
    });

    it('حفظ القالب يضبط فئة افتراضية عامة ويحوّل المتغيرات رقمًا', async () => {
        const fetchMock = stubFetch();
        await saveWhatsappTemplate({ name: ' إشعار ', category: '  ', ar: ' نص ', en: '', variables: 2 });
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({
            name: 'إشعار',
            category: 'general',
            ar: 'نص',
            en: '',
            variables: 2,
        });
    });

    it('قالب المرسل: اللغة افتراضيًا عربية والمتغيرات نصوص محدودة', async () => {
        const fetchMock = stubFetch();
        await sendWhatsappTemplate({ to: '9665@s.whatsapp.net', name: 'فاتورة', vars: ['أحمد'] });
        const body = JSON.parse(String(request(fetchMock).init.body)) as { lang: string; vars: string[] };
        expect(body.lang).toBe('ar');
        expect(body.vars).toEqual(['أحمد']);
    });

    it('قاعدة الرد: id رقمي عند التعديل ولا يُرسل عند الإضافة', async () => {
        const fetchMock = stubFetch({ ok: true });
        await saveWhatsappRule({ name: 'ق', match_type: 'contains', pattern: 'سعر', response: 'راجع الموقع', enabled: false });
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({
            name: 'ق',
            match_type: 'contains',
            pattern: 'سعر',
            response: 'راجع الموقع',
            enabled: false,
        });

        await saveWhatsappRule({ id: '12', name: 'ق', match_type: 'exact', pattern: 'x', response: '', enabled: true });
        expect((JSON.parse(String(request(fetchMock, 1).init.body)) as { id: number }).id).toBe(12);

        await deleteWhatsappRule('a/b');
        expect(request(fetchMock, 2).url).toBe('/api/whatsapp/rules/a%2Fb');
        expect(request(fetchMock, 2).init.method).toBe('DELETE');
    });

    it('أرقام الإدارة تُرسل أرقامًا فقط', async () => {
        const fetchMock = stubFetch();
        await addWhatsappManager('+966 (50) 123-4567');
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({ number: '966501234567' });
    });

    it('إنشاء الحملة يرسل template_name ويحوّل الجدولة إلى ISO', async () => {
        const fetchMock = stubFetch();
        await createWhatsappCampaign({
            name: 'عرض',
            templateName: 'فاتورة',
            recipients: consentedCampaignRecipients('9665@s.whatsapp.net|yes|أحمد'),
            scheduledAt: '2026-11-12T10:00',
        });
        const body = JSON.parse(String(request(fetchMock).init.body)) as Record<string, unknown>;
        expect(body.name).toBe('عرض');
        expect(body.template_name).toBe('فاتورة');
        expect(body.recipients).toEqual([{ remote_jid: '9665@s.whatsapp.net', consent: true, vars: ['أحمد'] }]);
        expect(typeof body.scheduled_at).toBe('string');
        expect(new Date(String(body.scheduled_at)).getTime()).not.toBeNaN();
    });

    it('إجراء الحملة يبني المسار المعتمد ويَرفض إجراءً مجهولًا', async () => {
        const fetchMock = stubFetch();
        await actOnWhatsappCampaign('c-1', 'approve');
        expect(request(fetchMock).url).toBe('/api/whatsapp/campaigns/c-1/approve');
        expect(() => actOnWhatsappCampaign('c-1', 'delete' as never)).toThrow();
    });

    it('حالة المحادثة: URL مشفّر ورفض القيم الخارجة عن القائمة', async () => {
        const fetchMock = stubFetch({ ok: true });
        await updateWhatsappChatMeta('9665@s.whatsapp.net', { status: 'resolved', priority: 'high' });
        expect(request(fetchMock).url).toBe('/api/whatsapp/chats/9665%40s.whatsapp.net/meta');
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({ status: 'resolved', priority: 'high' });
        expect(() => updateWhatsappChatMeta('', { status: 'open', priority: 'normal' })).toThrow();
        expect(() => updateWhatsappChatMeta('x', { status: 'closed', priority: 'normal' })).toThrow();
    });

    it('سؤال النظام يرسل السؤال مقصوصًا ويرفض الفارغ', async () => {
        const fetchMock = stubFetch({ ok: true, result: '<div>42</div>' });
        const data = await askWhatsappQuery('  كم مبيعات اليوم؟  ');
        expect(JSON.parse(String(request(fetchMock).init.body))).toEqual({ question: 'كم مبيعات اليوم؟' });
        expect(data.result).toBe('<div>42</div>');
        expect(() => askWhatsappQuery('   ')).toThrow();
    });
});

describe('تحويل إجابة النظام إلى نص آمن', () => {
    it('يحذف الوسوم ويفك الكيانات ويحول الحواجز إلى أسطر', () => {
        const html = '<div>المبيعات: <b>1,200</b> &amp; النمو <span>+5%</span></div><div>الفواتير: 12</div>';
        expect(waAnswerText(html)).toBe('المبيعات: 1,200 & النمو +5%\nالفواتير: 12');
        expect(waAnswerText('<p>a&lt;b&gt;c</p>')).toBe('a<b>c');
        expect(waAnswerText('<div>سطر<br>ثانٍ</div>')).toBe('سطر\nثانٍ');
        expect(waAnswerText('')).toBe('');
    });
});
