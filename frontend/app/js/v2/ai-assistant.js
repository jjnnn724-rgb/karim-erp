/**
 * ai-assistant.js — مساعد V2 داخل القشرة (الأدمن)
 * ══════════════════════════════════════════════════════════════════════
 * ثلاث أوضاع تخدم صاحب المشروع:
 *   • معرفة  : «أين باب المخزون؟ · ماذا يضمن عقد المطبخ؟»
 *   • تشخيص : «لماذا فشل هذا الطلب؟ · هل القاعدة والنسخة بخير؟»
 *   • كود    : «أين منطق هذا؟ · اقرأ لي هذا الملف»
 *
 * القواعد:
 *   • البوابة على الخادم (session + admin) — الواجهة لا تُخترع صلاحية.
 *   • بلا معالجات inline (CSP): كل حدث بـaddEventListener.
 *   • الرد يُكتب نصًّا (textContent) — لا HTML من النموذج.
 *   • وضع «قواعدي» يظهر حين لا يوجد مفتاح: الحقائق تُعرض كما هي.
 *   • vm-friendly: لا DOM وقت الاستيراد — كل شيء داخل mount.
 */
import { apiFetch } from '../core/api.js?v=4.9.180';
import { trapFocus } from './focus-trap.js?v=4.9.180';

const MODES = [
    { id: 'knowledge', label: 'معرفة', icon: 'file-text', hint: 'الشاشات والعقود' },
    { id: 'diagnose', label: 'تشخيص', icon: 'activity', hint: 'قراءات حيّة' },
    { id: 'cfo', label: 'المحاسبة', icon: 'banknote', hint: 'مراجعة أرقام اليوم' },
    { id: 'code', label: 'كود', icon: 'layers', hint: 'ملفات المشروع' },
];

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** نصّ عادي بلا HTML — ردّ النموذج يُعرض هكذا دائمًا. */
const clean = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();

/**_paths_: نصّ واحد أو قائمة، مفصولة بمسافات أو فواصل. */
export function parsePaths(raw) {
    return String(raw || '')
        .split(/[\s,،]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 3);
}

/** جسم الطلب — قابل للاختبار بلا DOM. */
export function buildRequest({ question, mode, screen, paths }) {
    const body = {
        question: clean(question).slice(0, 800),
        mode: MODES.some((m) => m.id === mode) ? mode : 'knowledge',
    };
    if (screen) {body.screen = String(screen).slice(0, 60);}
    const list = parsePaths(paths);
    if (list.length) {body.paths = list;}
    return body;
}

/**
 * @param {{root:Node, mountBoundary?:Function, closeMore?:Function}} shell
 * @param {{getRole?:()=>string|null, getScreen?:()=>string, isLive?:()=>boolean, onToast?:(m:string)=>void}} [ctx]
 * @returns {{destroy:()=>void, refresh:()=>void, open:()=>void}}
 */
export function mountAiAssistant(shell, ctx = {}) {
    const getRole = typeof ctx.getRole === 'function' ? ctx.getRole : () => null;
    const getScreen = typeof ctx.getScreen === 'function' ? ctx.getScreen : () => null;
    const toast = typeof ctx.onToast === 'function' ? ctx.onToast : (m) => console.info('[V2 ai]', m);

    let mode = 'knowledge';
    let drawer = null;
    let status = { enabled: false, model: null };
    let statusAsked = false;
    let busy = false;
    let lastFocus = null;
    let releaseTrap = null;

    /* ── الزرّ: في مركز التحكم (مركزُ Header) — للأدمن فقط ───────────── */
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'erp-btn erp-btn--sm';
    trigger.setAttribute('data-erp-ai-open', '');
    trigger.innerHTML = '<i class="ji" data-i="message" aria-hidden="true"></i><span>المساعد</span>';

    /* موجز المدير: زرٌّ في مركز التحكّم — يفتح اللوحة الكاملة. */
    const execBtn = document.createElement('button');
    execBtn.type = 'button';
    execBtn.className = 'erp-btn erp-btn--sm';
    execBtn.setAttribute('data-erp-exec-open', '');
    execBtn.innerHTML = '<i class="ji" data-i="banknote" aria-hidden="true"></i><span>موجز المدير</span>';

    let section = null;
    function mountTrigger() {
        const panel = shell && shell.root ? shell.root.querySelector('[data-erp-more]') : null;
        if (!panel) {return;}
        if (section) {panel.appendChild(section); return;}
        section = document.createElement('section');
        section.className = 'erp-shell__more-section';
        section.setAttribute('data-erp-ai-section', '');
        const head = document.createElement('h3');
        head.className = 'erp-shell__more-label';
        head.textContent = 'المساعد';
        const row = document.createElement('div');
        row.className = 'erp-shell__more-row';
        row.appendChild(trigger);
        row.appendChild(execBtn);
        section.appendChild(head);
        section.appendChild(row);
        panel.appendChild(section);
    }

    /* ── اللوحة ───────────────────────────────────────────────────────── */
    function buildDrawer() {
        const layer = (shell && shell.root) || document.body;
        const backdrop = document.createElement('div');
        backdrop.className = 'erp-ai-backdrop';
        backdrop.setAttribute('data-erp-ai-layer', '');
        backdrop.innerHTML = `
          <section class="erp-ai" role="dialog" aria-modal="true" aria-label="مساعد V2">
            <header class="erp-ai__head">
              <span class="erp-ai__title"><i class="ji" data-i="message" aria-hidden="true"></i><span>مساعد V2</span></span>
              <span class="erp-ai__badge" data-erp-ai-status>مجاني</span>
              <button type="button" class="erp-icon-btn erp-modal-x" data-erp-ai-close aria-label="إغلاق المساعد" title="إغلاق">
                <i class="ji" data-i="x" aria-hidden="true"></i>
              </button>
            </header>
            <div class="erp-ai__modes" role="tablist" aria-label="أوضاع المساعد">
              ${MODES.map((m, i) => `<button type="button" role="tab" class="erp-ai__mode${i === 0 ? ' is-active' : ''}"
                data-erp-ai-mode="${m.id}" aria-selected="${i === 0 ? 'true' : 'false'}" title="${esc(m.hint)}">
                <i class="ji" data-i="${m.icon}" aria-hidden="true"></i><span>${esc(m.label)}</span></button>`).join('')}
            </div>
            <p class="erp-ai__ctx" data-erp-ai-context></p>
            <div class="erp-ai__drafts" data-erp-ai-drafts hidden></div>
            <div class="erp-ai__log" data-erp-ai-log role="log" aria-live="polite"></div>
            <div class="erp-ai__files" data-erp-ai-files hidden>
              <label class="erp-ai__files-label" for="erp-ai-files">ملفات المشروع (اختياري — حتى ٣)</label>
              <input class="erp-input" id="erp-ai-files" type="text" data-erp-ai-path
                     placeholder="frontend/app/js/v2/screens/kitchen.js" autocomplete="off">
            </div>
            <form class="erp-ai__form" data-erp-ai-form>
              <textarea class="erp-ai__input" data-erp-ai-input rows="2" autocomplete="off"
                        placeholder="اسأل عن شاشة أو عقد أو خطأ… (Enter للإرسال، Shift+Enter لسطر جديد)"></textarea>
              <button type="submit" class="erp-btn erp-btn--primary" data-erp-ai-send>
                <i class="ji" data-i="send" aria-hidden="true"></i><span>إرسال</span>
              </button>
            </form>
          </section>`;
        layer.appendChild(backdrop);
        return backdrop;
    }

    function log() {
        return drawer ? drawer.querySelector('[data-erp-ai-log]') : null;
    }

    function push(role, text) {
        const box = log();
        if (!box) {return;}
        const line = document.createElement('p');
        line.className = `erp-ai__msg erp-ai__msg--${role}`;
        line.textContent = text;
        box.appendChild(line);
        box.scrollTop = box.scrollHeight;
    }

    function paintContext() {
        const el = drawer ? drawer.querySelector('[data-erp-ai-context]') : null;
        if (!el) {return;}
        const screen = getScreen();
        el.textContent = screen ? `الشاشة الحالية: ${screen}` : 'لا شاشة محدّدة';
    }

    function paintStatus() {
        const el = drawer ? drawer.querySelector('[data-erp-ai-status]') : null;
        if (!el) {return;}
        if (status.local) { el.textContent = `محلي · ${status.model || 'نموذج على الجهاز'}`; return; }
        if (status.enabled) { el.textContent = `مجاني · ${status.model || 'Gemini'}`; return; }
        el.textContent = 'وضع قواعدي (بلا نموذج)';
    }

    function paintModes() {
        if (!drawer) {return;}
        drawer.querySelectorAll('[data-erp-ai-mode]').forEach((b) => {
            const on = b.dataset.erpAiMode === mode;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const files = drawer.querySelector('[data-erp-ai-files]');
        if (files) {files.hidden = mode !== 'code';}
    }

    async function askStatus() {
        if (statusAsked) {return;}
        statusAsked = true;
        try {
            const r = await apiFetch('/ai-assistant/status');
            status = { enabled: !!(r && r.enabled), local: !!(r && r.local), model: (r && r.model) || null };
        } catch (_e) {
            status = { enabled: false, local: false, model: null };
        }
        paintStatus();
    }

    /* ── المسوّدات: تعديلات مقترحة لم تُنفَّذ — المالك يطبّقها أو يرفضها ── */
    async function refreshDrafts() {
        const host = drawer ? drawer.querySelector('[data-erp-ai-drafts]') : null;
        if (!host) {return;}
        try {
            const r = await apiFetch('/ai-assistant/drafts');
            const list = (r && r.drafts) || [];
            const form = `
              <form class="erp-ai__draft-form" data-erp-ai-draft-form>
                <select class="erp-input" data-erp-ai-kind aria-label="نوع التعديل">
                  <option value="expense">مصروف</option>
                  <option value="revenue">إيراد</option>
                </select>
                <input class="erp-input" data-erp-ai-amount type="number" step="0.01" min="0" placeholder="المبلغ" aria-label="المبلغ" required>
                <input class="erp-input" data-erp-ai-dept type="text" placeholder="القسم" aria-label="القسم">
                <input class="erp-input" data-erp-ai-note type="text" placeholder="بيان" aria-label="بيان">
                <button type="submit" class="erp-btn erp-btn--sm">اقترح</button>
              </form>`;
            host.innerHTML = form
                + (list.length ? `<h4 class="erp-ai__drafts-title">تعديلات مقترحة (لم تُنفَّذ)</h4>`
                    + list.map((d) => `
                    <div class="erp-ai__draft" data-draft="${esc(d.id)}">
                        <span class="erp-ai__draft-label">${esc(d.kind === 'expense' ? 'مصروف' : 'إيراد')} — ${esc(d.payload.date || '')} · ${esc(d.payload.deptId || '')} · ${esc(d.payload.amount || '')}</span>
                        <span class="erp-ai__draft-note">${esc(d.payload.note || '')}</span>
                        <span class="erp-ai__draft-actions">
                          <button type="button" class="erp-btn erp-btn--sm" data-draft-apply="${esc(d.id)}">تطبيق</button>
                          <button type="button" class="erp-btn erp-btn--sm" data-draft-reject="${esc(d.id)}">رفض</button>
                        </span>
                    </div>`).join('') : '');
            host.hidden = false;
            const f = host.querySelector('[data-erp-ai-draft-form]');
            if (f) {
                f.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const amount = Number(host.querySelector('[data-erp-ai-amount]').value);
                    if (!Number.isFinite(amount) || amount <= 0) { toast('اكتب مبلغًا صحيحًا'); return; }
                    try {
                        await apiFetch('/ai-assistant/drafts', {
                            method: 'POST',
                            body: JSON.stringify({
                                kind: host.querySelector('[data-erp-ai-kind]').value,
                                amount,
                                deptId: host.querySelector('[data-erp-ai-dept]').value,
                                note: host.querySelector('[data-erp-ai-note]').value,
                            }),
                        });
                        toast('أُضيفت المسوّدة — راجعها ثم طبّقها');
                        await refreshDrafts();
                    } catch (_err) { toast('تعذّر إنشاء المسوّدة'); }
                });
            }
            host.querySelectorAll('[data-draft-apply]').forEach((b) => {
                b.addEventListener('click', async () => {
                    b.disabled = true;
                    try {
                        const r2 = await apiFetch(`/ai-assistant/drafts/${encodeURIComponent(b.dataset.draftApply)}/apply`, { method: 'POST' });
                        const ok = !!(r2 && r2.ok);
                        toast(ok ? 'طُبِّق التعديل' : `تعذّر التطبيق: ${(r2 && r2.draft && r2.draft.result && r2.draft.result.message) || 'خطأ'}`);
                        await refreshDrafts();
                    } catch (_e) {
                        toast('تعذّر تطبيق التعديل');
                        b.disabled = false;
                    }
                });
            });
            host.querySelectorAll('[data-draft-reject]').forEach((b) => {
                b.addEventListener('click', async () => {
                    try {
                        await apiFetch(`/ai-assistant/drafts/${encodeURIComponent(b.dataset.draftReject)}/reject`, { method: 'POST' });
                        toast('رُفض التعديل');
                        await refreshDrafts();
                    } catch (_e) { toast('تعذّر الرفض'); }
                });
            });
        } catch (_e) { /* لا مسوّدات أو تعذّر الفحص */ }
    }

    function close() {
        if (!drawer) {return;}
        drawer.remove();
        drawer = null;
        releaseTrap?.();
        releaseTrap = null;
        if (lastFocus && typeof lastFocus.focus === 'function') {lastFocus.focus();}
        lastFocus = null;
    }

    function open() {
        if (drawer) {close(); return;}
        lastFocus = document.activeElement;
        drawer = buildDrawer();
        paintModes();
        paintContext();
        paintStatus();
        push('bot', 'اسألني عن أي شاشة أو عقد في V2 — أو اختر «المحاسبة» لأراجع أرقام اليوم، أو «تشخيص» لأقرأ حالة النظام الحيّة.');
        askStatus();

        /* الإغلاق من X أعلى اللوحة وحده — لا Escape ولا نقرة على الخلفية. */
        drawer.querySelector('[data-erp-ai-close]')?.addEventListener('click', close);
        drawer.querySelectorAll('[data-erp-ai-mode]').forEach((b) => {
            b.addEventListener('click', () => {
                mode = b.dataset.erpAiMode;
                paintModes();
            });
        });
        const form = drawer.querySelector('[data-erp-ai-form]');
        const input = drawer.querySelector('[data-erp-ai-input]');
        const files = drawer.querySelector('[data-erp-ai-path]');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            send(input, files);
        });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input, files);
            }
        });
        document.addEventListener('keydown', onKey, true);
        releaseTrap = trapFocus(drawer);
        input?.focus();
    }

    async function send(input, files) {
        if (busy || !input) {return;}
        const question = clean(input.value);
        if (!question) {return;}
        busy = true;
        input.value = '';
        push('me', question);
        const pending = push('bot', '⏳ أجمع الأرقام من النظام…');
        const body = buildRequest({
            question,
            mode,
            screen: getScreen(),
            paths: files ? files.value : '',
        });
        try {
            const r = await apiFetch('/ai-assistant/ask', { method: 'POST', body: JSON.stringify(body) });
            pending.textContent = clean(r && r.text) || 'لا يوجد رد.';
            if (r && r.fallback) {
                pending.classList.add('erp-ai__msg--fallback');
            }
            // «تحليل أعمق»: النموذج المحلي يلخّص ما قرأه (اختيار المالك —
            // على معالجٍ بلا GPU يحتاج ٢٠–٦٠ ثانية، فلا نفرضه على أحد).
            if (r && r.canDeep) {
                const deepBtn = document.createElement('button');
                deepBtn.type = 'button';
                deepBtn.className = 'erp-btn erp-btn--sm erp-ai__deep';
                deepBtn.textContent = 'تحليل أعمق (النموذج المحلي)';
                deepBtn.addEventListener('click', async () => {
                    deepBtn.disabled = true;
                    deepBtn.textContent = '⏳ يفكّر النموذج المحلي…';
                    const line = push('bot', '…');
                    try {
                        const deep = await apiFetch('/ai-assistant/ask/deep', { method: 'POST', body: JSON.stringify(body) });
                        line.textContent = clean(deep && deep.text) || 'لا يوجد ردّ أعمق.';
                    } catch (err) {
                        line.textContent = `تعذّر التحليل العميق: ${(err && err.message) || 'خطأ'}`;
                    } finally {
                        deepBtn.remove();
                        const box2 = log();
                        if (box2) {box2.scrollTop = box2.scrollHeight;}
                    }
                });
                pending.insertAdjacentElement('afterend', deepBtn);
            }
        } catch (e) {
            pending.textContent = `تعذّر إتمام الطلب: ${(e && e.message) || 'خطأ غير معروف'}`;
            toast('تعذّر سؤال المساعد');
        } finally {
            busy = false;
            const box = log();
            if (box) {box.scrollTop = box.scrollHeight;}
            await refreshDrafts();
        }
    }

    trigger.addEventListener('click', open);
    execBtn.addEventListener('click', () => {
        try { shell.closeMore?.(); } catch (_) { /* host decides */ }
        try { shell.navigate('executive'); } catch (e) { console.info('[V2 ai]', e); }
    });

    function refresh() {
        const role = getRole();
        const allowed = role === 'admin' || role === 'owner';
        if (!allowed) {
            if (section) {section.remove(); section = null;}
            close();
            return;
        }
        mountTrigger();
    }

    refresh();

    return {
        refresh,
        open,
        destroy() {
            close();
            trigger.remove();
            if (section) {section.remove(); section = null;}
        },
    };
}
