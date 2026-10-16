/**
 * V2 — Menu boards screen · شاشات المنيو (تضمين)
 * ═══════════════════════════════════════════════════════════════════════
 * Parity with the legacy 'menu-board' route (page-router.js:123-130): it
 * embeds /app/menu-admin.html in a full-height frame. The menu apps
 * themselves (menu-board/menu-admin/menu-totem-dashboard) are standalone
 * pages with their own contract (arabic-ux-standards: fixed stage +
 * fitStage) — they are NOT rewritten here, only hosted like legacy does.
 *
 * البند ٨ (2026-10-16): `?v2board=1` (أو karim_v2_board=1 مخزّنًا) يُضيف زرًّا
 * يفتح شاشة المنيو الجديدة menu-board-v2.html — لا كانفس ثابت، تعمل على كل
 * الشاشات الطولية. افتراضيًا مطفأة، ومع الإطفاء يبقى السلوك كما كان حرفيًا.
 * لماذا زرٌّ لا إطار؟ سياسة CSP العامة تضع frame-ancestors 'none'، ولا يُسمح
 * بالتضمين إلا بسطر استثناء في الخادم (server.js:2399 لصفحة المنيو القديمة) —
 * وملف الخادم عليه عمل غير محفوظ لغيري، فلا يُلْمَس هنا.
 */

const FLAG_TRUE = new Set(['1', 'true', 'on']);

/** `?v2board=1|0` يغلب المخزّن؛ غياب الاثنين = إطفاء (قرار V2: كل جديد خلف مفتاح). */
export function boardV2Enabled(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2board=([^&]*)/);
    if (match) {return FLAG_TRUE.has(decodeURIComponent(match[1]).toLowerCase());}
    if (stored == null || stored === '') {return false;}
    return FLAG_TRUE.has(String(stored).toLowerCase());
}

function template(boardV2) {
    return `
      <div class="erp-v2-menuboard">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">شاشات المنيو
              <span class="erp-eyebrow" dir="ltr" lang="en">Menu Boards</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite">${boardV2
    ? 'لوحة تحكم شاشات العرض — نفس صفحة الإدارة الحالية داخل الإطار، مع شاشة المنيو V2 للتجربة.'
    : 'لوحة تحكم شاشات العرض — نفس صفحة الإدارة الحالية داخل الإطار.'}</div>
          </div>
          <div class="erp-dash-controls">
            ${boardV2 ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-open-board-v2>
              <i class="ji" data-i="eye" aria-hidden="true"></i><span>شاشة المنيو V2</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-v2-open-board>
              <i class="ji" data-i="eye" aria-hidden="true"></i><span>عرض شاشة العرض</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-frame></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountMenuBoardScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 menu-board]', m);
    void notify;

    let stored = '';
    try {stored = localStorage.getItem('karim_v2_board');} catch { /* private mode */ }
    const boardV2 = boardV2Enabled(window.location.search, stored);

    host.insertAdjacentHTML('beforeend', template(boardV2));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);

    function paint() {
        q('[data-v2-frame]').innerHTML = `<div style="width:100%;height:calc(100vh - 220px);min-height:480px;border-radius:16px;overflow:hidden;border:1px solid var(--erp-border);">`
            + `<iframe src="/app/menu-admin.html" style="width:100%;height:100%;border:none;background:#0b0d14;" title="شاشات المنيو"></iframe>`
            + `</div>`;
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {paint(); return;}
        if (event.target.closest('[data-v2-open-board-v2]')) {
            window.open('/app/menu-board-v2.html', '_blank');
            return;
        }
        if (event.target.closest('[data-v2-open-board]')) {
            window.open('/app/menu-board.html', '_blank');
        }
    });

    paint();

    return {
        el,
        reload: () => {paint(); return Promise.resolve();},
        destroy() {el.remove();},
    };
}
