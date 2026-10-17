/**
 * v2-chat.test.js — عقد الشات الداخلي في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المصدر: backend/internal-chat-routes.js (3 أبواب) + legacy app.js:332-466.
 * الاختبار عقود مصادر: الأبواب/الأدوار/العلم/اللحظي/الهروب/الوصولية، وأن
 * الواجهة القديمة لم تُمسّ.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'chat-repo.js');
const CHAT = path.join(V2, 'chat.js');
const RT = path.join(V2, 'realtime.js');
const FLAGS = path.join(V2, 'write-flags.js');
const HOST = path.join(V2, 'preview.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-chat.css');
const PAGE = path.join(APP, 'v2.html');
const LEGACY = path.join(APP, 'js', 'app.js');
const SERVER = path.join(__dirname, '..', 'backend', 'internal-chat-routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('الشات الداخلي — الأبواب', () => {
    test('الثلاثة أبواب حرفيًّا كما في الخادم (users/history/send)', () => {
        const r = read(REPO);
        expect(r).toContain("apiFetch('/chat/users')");
        expect(r).toContain('`/chat/history?with=${encodeURIComponent(peer)}`');
        expect(r).toContain("apiFetch('/chat/send', {");
        expect(r).toContain('to_user_id: peer');
        expect(r).toContain('body: text.slice(0, CHAT_MAX_BODY)');
        expect(read(SERVER)).toContain("app.get('/api/chat/history'");
        expect(read(SERVER)).toContain("app.get('/api/chat/users'");
        expect(read(SERVER)).toContain("app.post('/api/chat/send'");
    });

    test('أدوار الأقران مرآة استعلام الخادم بلا توسيع', () => {
        expect(read(REPO)).toContain("CHAT_PEER_ROLES = ['admin', 'manager', 'hr', 'warehouse']");
        expect(read(SERVER)).toContain("role IN ('admin','manager','hr','warehouse')");
    });

    test('سقف الرسالة 1000 حرف كما يقتطع الخادم', () => {
        expect(read(REPO)).toContain('CHAT_MAX_BODY = 1000');
        expect(read(SERVER)).toContain('slice(0, 1000)');
    });

    test('البوابة الوحيدة للشبكة core/api — لا fetch خام', () => {
        const code = read(REPO).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).toMatch(/from '\.\.\/\.\.\/core\/api\.js\?v=/);
        expect(code).not.toMatch(/[^a-zA-Z]fetch\(/);
    });
});

describe('الشات الداخلي — اللحظي والعلم', () => {
    test('Socket يتصادق بنفس عقد الخادم ويسجّل الهوية', () => {
        const s = read(RT);
        expect(s).toContain('auth: { token: window._jwt }');
        expect(s).toContain("s.emit('register_user')");
        expect(s).toContain('window._rtSocket');
        expect(read(SERVER)).toContain("io.to(`user:${row.from_user_id}`).emit('chat:new', row)");
    });

    test('العلم v2chat OFF افتراضيًّا وغيابه يلغي التركيب', () => {
        const f = read(FLAGS);
        expect(f).toContain("CHAT_WRITE_FLAG = 'v2chat'");
        expect(f).toContain("readFlag(CHAT_WRITE_FLAG, 'karim_v2_chat', search, storage)");
        const c = read(CHAT);
        expect(c).toContain('if (!chatWriteEnabled())');
        expect(c).toContain('flag OFF');
    });

    test('الحدث chat:new يحترم الطرفين فقط ويمنع التكرار', () => {
        const c = read(CHAT);
        expect(c).toContain("socket.on('chat:new', onNew)");
        expect(c).toContain('String(message.from_user_id) === me');
        expect(c).toContain('st.messages.some((x) => String(x.id) === String(message.id))');
    });
});

describe('الشات الداخلي — الواجهة', () => {
    test('اختيار موظف خاص ثم سجل ثم إرسال — كالقديم', () => {
        const c = read(CHAT);
        expect(c).toContain('data-v2-chat-peer');
        expect(c).toContain('fetchChatHistory(id)');
        expect(c).toContain('await sendChatMessage(body, st.peer)');
        expect(c).toContain('data-v2-chat-back');
        expect(read(LEGACY)).toContain('function backToChatUsers()');
    });

    test('الشارة والتوست للأدمن والصوت', () => {
        const c = read(CHAT);
        expect(c).toContain('data-v2-chat-badge');
        expect(c).toContain('st.unread += 1');
        expect(c).toContain("role) || '') === 'admin'");
        expect(c).toContain('playChime()');
    });

    test('الهروب من XSS على الاسم والجسم والميتا', () => {
        const c = read(CHAT);
        expect(c).toContain('${esc(m.body || \'\')}');
        expect(c).toContain('${esc(u.name || u.username || \'—\')}');
        expect(c).toContain('${esc(m.from_name || \'—\')}');
        expect(c).toMatch(/const esc = \(v\) => String\(v \?\? ''\)/);
    });

    test('وصولية: حوار مسمّى، live region، سقف 1000، aria-expanded', () => {
        const c = read(CHAT);
        expect(c).toContain('role="dialog" aria-label="شات الطاقم"');
        expect(c).toContain('aria-live="polite"');
        expect(c).toContain('maxlength="${CHAT_MAX_BODY}"');
        expect(c).toContain("fab.setAttribute('aria-expanded', 'true')");
    });

    test('بلا معالجات سطرية وبلا شبكة مباشرة', () => {
        const c = read(CHAT).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(c).not.toMatch(/\bapiFetch\b/);
        expect(c).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(c.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        expect(c).toContain("host.addEventListener('click'");
    });
});

describe('الشات الداخلي — التركيب والهوية', () => {
    test('المضيف يركّب الشات ويحدّثه عند الدخول والخروج', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountChat \} from '\.\/chat\.js\?v=/);
        expect(h).toContain('const chat = mountChat({');
        expect(h).toContain('try {chat.refresh();}');
        expect(h).toContain('sessionState.info.user');
    });

    test('CSS tokens فقط وتُحمّل في الصفحة', () => {
        const css = read(CSS);
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/rgba?\(/);
        expect(css).toContain('var(--erp-brand)');
        expect(read(PAGE)).toMatch(/css\/v2\/erp-chat\.css\?v=/);
    });

    test('الواجهة القديمة لم تُمسّ: نفس باب app.js موجود', () => {
        const legacy = read(LEGACY);
        expect(legacy).toContain("apiFetch('/chat/users')");
        expect(legacy).toContain("apiFetch('/chat/history?with='");
        expect(legacy).toContain("apiFetch('/chat/send'");
    });
});
