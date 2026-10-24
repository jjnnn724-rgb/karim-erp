/**
 * V2 — Permissions screen · منح فردية فوق الدور (أدمن فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * Same per-screen contract as dept-employees: single network door
 * (data/permissions-repo.js), event delegation only (no inline handlers),
 * isConnected guards after every await, one live instance (destroy),
 * server sentences echoed verbatim (ADMIN_HAS_ALL / 422 / 404).
 *
 * Behavior mirror of features/permissions.js (116 lines, read fully):
 * اختيار مستخدم ← شبكة المنح/السحب/التدقيق ← منح/سحب/وراثة لكل صلاحية ←
 * حفظ بسبب مسجل ← سجل تدقيق (آخر 50). هدف admin: الكل ضمنيًا بلا حفظ.
 * World-class delta (no behavior change): KPI strip + unsaved-changes
 * counter + grouped cards + audit badges — same gates, better experience.
 */

import { canWrite } from '../session.js?v=4.9.154';
import { ROLES } from '../../core/config.js?v=4.9.154';
import { formatInt } from '../data/reports-repo.js?v=4.9.154';
import {
    PERM_WRITE_ROLES, fetchPermCatalog, fetchUserPerms, saveUserPerms,
    fetchPermissionUsers, groupCatalog, permMode, auditActionLabel,
} from '../data/permissions-repo.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const roleLabelOf = (role) => (ROLES[role] && ROLES[role].name) || 'دور غير معروف';

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="مؤشرات الصلاحيات">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span></div>
        <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

function template(canAdmin) {
    return `
      <div class="erp-v2-perms">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الصلاحيات
              <span class="erp-eyebrow" dir="ltr" lang="en">Permissions</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite">منح فردية فوق الدور — المدير العام فقط، والخادم يحسم كل حفظ.</div>
          </div>
          <div class="erp-dash-controls">
            ${canAdmin ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>` : ''}
          </div>
        </div>
        <div data-v2-body></div>
      </div>`;
}

function modeSelect(key, mode, disabled, label) {
    return `<select data-perm="${esc(key)}" ${disabled ? 'disabled' : ''} aria-label="حالة ${esc(label)}" class="erp-select" style="max-width:120px">`
        + `<option value="inherit"${mode === 'inherit' ? ' selected' : ''}>وراثة الدور</option>`
        + `<option value="grant"${mode === 'grant' ? ' selected' : ''}>منح</option>`
        + `<option value="deny"${mode === 'deny' ? ' selected' : ''}>سحب</option>`
        + `</select>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userId?: number|string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (m:string)=>boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getState: ()=>object, destroy: ()=>void}}
 */
export function mountPermissionsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 permissions]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canAdmin = canWrite(ctx.role, PERM_WRITE_ROLES);

    let catalog = [];
    let users = [];
    let userId = null;
    let target = null;
    let grants = new Set();
    let denies = new Set();
    let savedGrants = new Set();
    let savedDenies = new Set();
    let audit = [];
    let loading = false;
    let saving = false;
    let reasonText = '';

    host.insertAdjacentHTML('beforeend', template(canAdmin));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const body = q('[data-v2-body]');

    function dirtyCount() {
        let n = 0;
        for (const k of grants) {if (!savedGrants.has(k)) {n += 1;}}
        for (const k of savedGrants) {if (!grants.has(k)) {n += 1;}}
        for (const k of denies) {if (!savedDenies.has(k)) {n += 1;}}
        for (const k of savedDenies) {if (!denies.has(k)) {n += 1;}}
        return n;
    }

    function paint() {
        if (!canAdmin) {
            body.innerHTML = `<div class="mcard"><i class="ji" data-i="lock" aria-hidden="true"></i> صفحة الصلاحيات للمدير العام فقط</div>`;
            return;
        }
        const groups = groupCatalog(catalog);
        const isAdminTarget = target && target.role === 'admin';
        const dirty = dirtyCount();
        const userOpts = users.map((u) => `<option value="${esc(String(u.id))}"${String(userId) === String(u.id) ? ' selected' : ''}>${esc(u.name || u.username)} (${esc(roleLabelOf(u.role))})${u.role === 'admin' ? ' — الكل' : ''}</option>`).join('');
        body.innerHTML = kpiStrip([
            { icon: 'key', label: 'صلاحيات الكتالوج', en: 'Catalog', value: formatInt(catalog.length), hint: 'مجموعات حسب النظام' },
            { icon: 'user-check', label: 'ممنوحة للهدف', en: 'Granted', value: formatInt(grants.size), hint: target ? `لـ ${target.name || target.username}` : 'اختر مستخدمًا' },
            { icon: 'circle-x', label: 'مسحوبة من الهدف', en: 'Denied', value: formatInt(denies.size), hint: 'السحب يغلب المنح والدور' },
        ])
        + `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">منح فردية فوق الدور</h3>`
        + `<span class="erp-grow"></span><label class="erp-text-sm erp-text-muted" for="v2perm-user">المستخدم</label>`
        + `<select class="erp-select" id="v2perm-user" data-v2-user style="max-width:260px"><option value="">— اختر المستخدم —</option>${userOpts}</select></div>`
        + `<div class="erp-card__body erp-stack">`
        + (!target
            ? `<p class="erp-text-sm erp-text-muted">اختر مستخدمًا لعرض صلاحياته ومنح صلاحيات إضافية لدوره الحالي</p>`
            : `<p class="erp-text-sm erp-text-muted">المستخدم: <b>${esc(target.name || target.username)}</b> — الدور: <b>${esc(roleLabelOf(target.role))}</b>${target.role === 'admin' ? ' (يملك كل الصلاحيات — لا حاجة لمنح)' : ''}${dirty ? ` — <b>تغييرات غير محفوظة: ${formatInt(dirty)}</b>` : ''}</p>`
            + groups.map((g) => `<div class="erp-card__head" style="border-top:1px solid var(--erp-border)"><h3 class="erp-card__title">${esc(g.name)}</h3></div>`
                + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">`
                + g.items.map((p) => {
                    const mode = permMode(p.key, grants, denies);
                    return `<label style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;margin:0;background:var(--erp-surface);border:1px solid var(--erp-border);border-radius:8px;cursor:${isAdminTarget ? 'not-allowed' : 'pointer'};${mode === 'deny' ? 'border-color:var(--erp-danger-text);' : ''}">`
                    + `<span style="flex:1"><b>${esc(p.ar)}</b><br><small class="erp-text-muted" dir="ltr">${esc(p.key)}</small></span>`
                    + modeSelect(p.key, mode, isAdminTarget, p.ar)
                    + `</label>`;
                }).join('') + `</div>`).join('')
            + (target.role === 'admin' ? '' : `<div class="erp-emp-actions erp-no-print"><div class="erp-emp-field" style="max-width:320px"><label for="v2perm-reason">سبب المنح/السحب (يُسجَّل في التدقيق)</label>`
                + `<input class="erp-input" id="v2perm-reason" data-v2-reason maxlength="300" placeholder="اختياري" autocomplete="off" value="${esc(reasonText)}"></div>`
                + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-save${dirty && !saving ? '' : ' disabled'}>`
                + `<i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ الصلاحيات</span></button></div>`)
            + (audit.length ? `<div class="erp-card__head"><h3 class="erp-card__title"><i class="ji" data-i="history" aria-hidden="true"></i> سجل التدقيق (آخر 50)</h3></div>`
                + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>التاريخ</th><th>الصلاحية</th><th>الإجراء</th><th>بواسطة</th><th>السبب</th></tr></thead><tbody>`
                + audit.map((a) => {
                    const lbl = auditActionLabel(a.action);
                    return `<tr><td class="erp-td erp-text-sm">${esc(String(a.created_at || '').slice(0, 19).replace('T', ' '))}</td>`
                    + `<td class="erp-td erp-text-sm" dir="ltr">${esc(a.perm_key)}</td>`
                    + `<td class="erp-td"><span class="erp-badge" data-tone="${esc(lbl.tone)}">${esc(lbl.label)}</span></td>`
                    + `<td class="erp-td">${esc(a.acted_by || '—')}</td><td class="erp-td">${esc(a.reason || '—')}</td></tr>`;
                }).join('') + `</tbody></table></div>` : ''))
        + `</div></section>`;
    }

    async function selectUser(id) {
        userId = id || null;
        grants = new Set();
        denies = new Set();
        savedGrants = new Set();
        savedDenies = new Set();
        audit = [];
        target = null;
        if (!id) {paint(); return;}
        try {
            const r = await fetchUserPerms(id);
            if (!el.isConnected) {return;}
            target = r.user;
            grants = new Set(r.grants);
            denies = new Set(r.denies);
            savedGrants = new Set(r.grants);
            savedDenies = new Set(r.denies);
            audit = r.audit;
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذر جلب صلاحيات المستخدم', 'error');
        }
        paint();
    }

    async function save() {
        if (saving || !userId || (target && target.role === 'admin')) {return;}
        if (!dirtyCount()) {notify('لا تغييرات للحفظ', 'info'); return;}
        if (!confirmFn(`حفظ صلاحيات «${target.name || target.username}»؟ (منح: ${grants.size} · سحب: ${denies.size})`)) {return;}
        const reason = reasonText.trim();
        saving = true;
        paint();
        try {
            const r = await saveUserPerms(userId, { grants: [...grants], denies: [...denies], reason });
            if (!el.isConnected) {return;}
            reasonText = '';
            grants = new Set(r.grants);
            denies = new Set(r.denies);
            notify('حُفظت الصلاحيات (منح وسحب)', 'success');
            await selectUser(userId);
        } catch (e) {
            if (!el.isConnected) {return;}
            notify((e && e.message) || 'تعذر الحفظ', 'error');
        } finally {
            saving = false;
            if (el.isConnected) {paint();}
        }
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            const [c, u] = await Promise.all([fetchPermCatalog(), fetchPermissionUsers()]);
            if (!el.isConnected) {return;}
            catalog = c;
            users = u;
            if (userId) {await selectUser(userId); return;}
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            catalog = [];
            users = [];
            body.innerHTML = `<div class="erp-state" role="alert"><span class="erp-state__title">${
                e && e.message === 'UNAUTHORIZED' ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض الصلاحيات بهذا الحساب — القرار للخادم وحده.'
                : `تعذّر تحميل الصلاحيات: ${(e && e.message) || 'خطأ'}`)}</span></div>`;
        } finally {
            loading = false;
        }
    }

    el.addEventListener('input', (event) => {
        if (event.target.closest('[data-v2-reason]')) {reasonText = event.target.value || '';}
    });
    el.addEventListener('change', (event) => {
        const userSel = event.target.closest('[data-v2-user]');
        if (userSel) {reasonText = ''; selectUser(userSel.value || null); return;}
        const permSel = event.target.closest('[data-perm]');
        if (permSel && target && target.role !== 'admin') {
            const key = permSel.dataset.perm;
            grants.delete(key);
            denies.delete(key);
            if (permSel.value === 'grant') {grants.add(key);}
            else if (permSel.value === 'deny') {denies.add(key);}
            paint();
        }
    });
    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-save]')) {save(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
    });

    reload();

    return {
        el,
        reload,
        getState: () => ({ userId, target, grants: [...grants], denies: [...denies], audit }),
        destroy() {
            el.remove();
        },
    };
}
