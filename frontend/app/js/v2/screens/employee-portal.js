/**
 * V2 — Employee portal screen · بوابة الموظف — البطاقة الذكية
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of features/employee-portal.js:19-109 + mobile-shell.js
 * (punch card :127-188, punch flow :717-912, face camera :350-555):
 * ربط الحساب بموظف (إداري: أوّل موظف + مبدّل، غيره: موظف userId نفسه،
 * وبلا ربط = رسالة HR) · مؤشرات الراتب/الساعات/الأيام/الإجازات ·
 * سجل الحضور + طباعة يوم/شهر · سجل الإجازات · لوحة بصمات اليوم.
 *
 * P2-3 — الأبواب الأربعة الناقصة على الخادم صارت هنا:
 *   POST /attendance/portal/punch              → punchPortal
 *   POST /attendance/portal/punch/client-reject → reportClientReject
 *   POST /attendance/portal/face/enroll         → enrollFaceV1
 *   POST /attendance/portal/face/enroll-v2      → enrollFaceV2
 * البصمة كلها وراء دور الخادم + علم v2portalwrite، وقوالب الوجه وراء
 * admin/hr + علم v2facewrite. العلمان OFF افتراضيًا، والخادم يبقى الحاكم.
 *
 * Data doors (read): employees + attendance report + leave workflow/types
 * + my punches + portal status. Bounded deviation: attendance window is
 * year-to-date (legacy read the whole in-memory STATE). Print layout is
 * V2's own (same content, not pixel-parity).
 */

import { canWrite } from '../session.js?v=4.9.150';
import { openInAppReport } from '../report-viewer.js?v=4.9.150';
import { portalWriteEnabled, faceWriteEnabled } from '../write-flags.js?v=4.9.150';
import { formatInt, formatMoney, formatQty, fetchCurrency } from '../data/reports-repo.js?v=4.9.150';
import {
    fetchPortalStatus, fetchMyPunches, PUNCH_ROLES, FACE_ENROLL_ROLES,
    faceV1Required, portalDeviceId, punchPortal, punchActionLabel,
    reportClientReject, enrollFaceV1, enrollFaceV2, removeFaceEnrollment,
} from '../data/portal-repo.js?v=4.9.150';
import { captureFace } from '../portal-face.js?v=4.9.150';
import { fetchEmployees } from '../data/employees-repo.js?v=4.9.150';
import { fetchAttendanceReport } from '../data/attendance-repo.js?v=4.9.150';
import { fetchLeaveWorkflow, fetchLeaveTypes } from '../data/leaves-repo.js?v=4.9.150';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ADMIN_ROLES = ['admin', 'hr', 'manager'];

const GEO_TARGET = 6;
const GEO_SESSION_MS = 9000;

/** ساعات العمل مع الالتفاف الليلي — مرآة portalWorkHours (employee-portal.js:7). */
export function portalWorkHours(a = {}) {
    if (!(a.checkIn && a.checkOut)) {return null;}
    const mins = (t) => {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
        return m ? (Number(m[1]) * 60 + Number(m[2])) : null;
    };
    const ci = mins(a.checkIn);
    const co = mins(a.checkOut);
    if (ci == null || co == null) {return null;}
    let diff = co - ci;
    if (diff < 0) {diff += 24 * 60;}
    return diff / 60;
}

function fD(v) {
    if (!v) {return '—';}
    const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(v).slice(0, 10)
        : d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * 6 قراءات GPS خلال ~9 ثوانٍ — نفس تحصين القديم (mobile-shell.js:669):
 * السيرفر يحلل التجميد/الانتقال/التشتت/الدقة الثابتة. محاولة ثانية فقط عند
 * الفشل التام (هوائيات داخلية بطيئة)، لا عند النجاح الجزئي.
 * @param {(done:number,total:number,accuracy:number|null)=>void} [onFix]
 * @returns {Promise<Array|null>}
 */
function collectLocationFixes(onFix) {
    const once = () => new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        const fixes = [];
        const sendTime = Date.now();
        let settled = false;
        let watchId = null;
        let timer = null;
        const done = (value) => {
            if (settled) { return; }
            settled = true;
            if (watchId != null) { try { navigator.geolocation.clearWatch(watchId); } catch (_) { /* متجاهَل عمدًا */ } }
            if (timer != null) { clearTimeout(timer); }
            resolve(value);
        };
        const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
        try {
            watchId = navigator.geolocation.watchPosition((pos) => {
                const c = pos.coords || {};
                fixes.push({
                    lat: c.latitude,
                    lng: c.longitude,
                    accuracy: numOrNull(c.accuracy) ?? 999,
                    fixAgeS: Math.max(0, Math.round((sendTime - (pos.timestamp || Date.now())) / 1000)),
                    alt: numOrNull(c.altitude),
                    altAcc: numOrNull(c.altitudeAccuracy),
                    heading: numOrNull(c.heading),
                    speed: numOrNull(c.speed),
                    t: Number(pos.timestamp) || Date.now(),
                });
                try { onFix?.(fixes.length, GEO_TARGET, numOrNull(c.accuracy)); } catch (_) { /* متجاهَل عمدًا */ }
                if (fixes.length >= GEO_TARGET) { done(fixes); }
            }, () => done(fixes.length ? fixes : null), {
                enableHighAccuracy: true, maximumAge: 0, timeout: GEO_SESSION_MS,
            });
        } catch (_) { done(null); return; }
        timer = setTimeout(() => done(fixes.length ? fixes : null), GEO_SESSION_MS + 500);
    });
    return (async () => {
        let fixes = await once();
        if (!fixes) { fixes = await once(); }
        return fixes;
    })();
}

/** إشارات تزييف الجهاز الأصلية (Android فقط) — null على الويب/PWA. */
async function nativeMockSignals() {
    try {
        const plugin = globalThis.Capacitor?.Plugins?.MockLocationDetector;
        if (!plugin || typeof plugin.isMockLocation !== 'function') { return null; }
        const result = await Promise.race([
            plugin.isMockLocation(),
            new Promise((res) => setTimeout(() => res(null), GEO_SESSION_MS)),
        ]);
        return result && typeof result.mocked === 'boolean' ? result : null;
    } catch (_) { return null; }
}

/** رسالة موحدة لنتيجة التسجيل المزدوج — نص القديم نفسه (mobile-shell.js:558). */
function faceEnrollMessage(saved) {
    if (saved.v2 && saved.v1) { return 'تم تسجيل الوجه بالمحركين — البصمة جاهزة من أي كاميرا'; }
    if (saved.v2) { return 'تم تسجيل الوجه بالمحرك المتقدم' + (saved.v1Error ? ' (الأساسي: ' + saved.v1Error + ')' : ''); }
    if (saved.v1) { return 'تم تسجيل الوجه بالمحرك الأساسي' + (saved.v2Error ? ' (المتقدم: ' + saved.v2Error + ')' : ''); }
    return 'فشل التسجيل: ' + (saved.v2Error || saved.v1Error || 'لا لقطة صالحة');
}

function template() {
    return `
      <div class="erp-v2-eportal">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">بوابة الموظف
              <span class="erp-eyebrow" dir="ltr" lang="en">Employee Portal</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-switch></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-body></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userId?: number|string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountEmployeePortalScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 employee-portal]', m);
    const isAdmin = ADMIN_ROLES.includes(String(ctx.role || ''));
    const selfUserId = ctx.userId != null ? String(ctx.userId) : null;

    let employees = [];
    let emp = null;
    let records = [];
    let leaves = [];
    let leaveTypes = [];
    let punches = null;
    let currency = '';
    let loading = false;
    const punchRole = canWrite(ctx.role, PUNCH_ROLES);
    const canPunch = canWrite(ctx.role, PUNCH_ROLES) && portalWriteEnabled();
    const canFace = canWrite(ctx.role, FACE_ENROLL_ROLES) && faceWriteEnabled();
    let portalStatus = null;
    let punchBusy = false;
    let faceBusy = false;
    let faceUserId = '';
    let lastPunch = null;
    let faceResult = null;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    function resultClass(result) {
        if (!result) { return 'erp-text-muted'; }
        if (result.kind === 'ok') { return 'erp-text-success'; }
        if (result.kind === 'error') { return 'erp-text-danger'; }
        return 'erp-text-muted';
    }

    function punchCardHtml() {
        if (!punchRole) { return ''; }
        const s = portalStatus || {};
        const loaded = portalStatus !== null;
        const faceBlocked = Boolean(s.faceEnabled) && s.faceEnrolled === false;
        let chip = '<span class="erp-badge" data-tone="neutral">الحالة غير معروفة</span>';
        if (loaded) {
            if (!s.enabled) { chip = '<span class="erp-badge" data-tone="neutral">غير مفعّلة إداريًا</span>'; }
            else if (s.hasEmployeeProfile === false) { chip = '<span class="erp-badge" data-tone="warning">بلا ربط موظف</span>'; }
            else if (faceBlocked) { chip = '<span class="erp-badge" data-tone="warning">الوجه غير مسجّل</span>'; }
            else { chip = '<span class="erp-badge" data-tone="success">مفعّلة</span>'; }
        }
        let action;
        if (!canPunch) {
            action = '<p class="erp-text-sm erp-text-muted">البصمة الذاتية للقراءة فقط — الكتابة مغلقة بعلم التفعيل.</p>';
        } else if (!loaded) {
            action = '<p class="erp-text-sm erp-text-danger">تعذر قراءة حالة البوابة — أعد التحديث.</p>';
        } else if (!s.enabled) {
            action = '<p class="erp-text-sm erp-text-muted">البصمة الذاتية غير مفعّلة من الإدارة بعد.</p>';
        } else if (s.hasEmployeeProfile === false) {
            action = '<p class="erp-text-sm erp-text-muted">لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية.</p>';
        } else if (faceBlocked) {
            action = '<p class="erp-text-sm erp-text-warning">لم يتم تسجيل وجهك بعد — راجع الموارد البشرية لتسجيله.</p>';
        } else {
            action = `<div class="erp-portal-punch__row">
              <button type="button" class="erp-btn erp-btn--primary" data-v2-punch${punchBusy ? ' disabled' : ''}>${punchBusy ? 'جارٍ تسجيل البصمة…' : 'تسجيل البصمة الآن'}</button>
              <span class="erp-text-sm erp-text-muted">${s.faceEnabled
        ? 'سيُطلب تأكيد الوجه ثم الموقع — الوقت من ساعة الخادم.'
        : 'سيُقرأ موقعك لحظة البصمة فقط — الوقت من ساعة الخادم.'}</span>
            </div>`;
        }
        return `<section class="erp-card erp-portal-punch">
          <div class="erp-card__head">
            <h3 class="erp-card__title">البصمة الذاتية</h3>
            <span class="erp-grow"></span>
            ${canPunch && isAdmin ? '<span class="erp-text-xs erp-text-muted">تُسجَّل لصاحب الحساب الحالي</span>' : ''}
            ${chip}
          </div>
          <div class="erp-card__body erp-stack">
            ${action}
            <p class="erp-text-sm ${resultClass(lastPunch)}" data-v2-punch-result role="status" aria-live="polite">${lastPunch ? esc(lastPunch.text) : ''}</p>
          </div>
        </section>`;
    }

    function faceCardHtml() {
        if (!canFace) { return ''; }
        const targets = employees.filter((e) => e.userId != null && String(e.userId) !== '');
        const picker = targets.length
            ? `<label class="erp-field"><span class="erp-text-sm erp-text-muted">الموظف</span>
                <select class="erp-select" data-v2-face-user>
                  <option value="">— اختر الموظف —</option>
                  ${targets.map((e) => `<option value="${esc(String(e.userId))}"${String(e.userId) === faceUserId ? ' selected' : ''}>${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('')}
                </select></label>
              <button type="button" class="erp-btn erp-btn--primary" data-v2-face-enroll${faceBusy ? ' disabled' : ''}>تسجيل الوجه</button>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-face-remove${faceBusy ? ' disabled' : ''}>إزالة القالب</button>`
            : '<p class="erp-text-sm erp-text-muted">لا يوجد موظفون مرتبطون بحسابات مستخدمين — اربط الحساب أولًا.</p>';
        return `<section class="erp-card erp-portal-face">
          <div class="erp-card__head">
            <h3 class="erp-card__title">تسجيل وجوه الموظفين</h3>
            <span class="erp-grow"></span>
            <span class="erp-badge" data-tone="info">إدارة / موارد بشرية</span>
          </div>
          <div class="erp-card__body erp-stack">
            <div class="erp-portal-face__actions">${picker}</div>
            <p class="erp-text-sm ${resultClass(faceResult)}" data-v2-face-result role="status" aria-live="polite">${faceResult ? esc(faceResult.text) : ''}</p>
            <p class="erp-text-xs erp-text-muted">تُجمع حتى 5 لقطات للقالب. الصور لا تُخزَّن على الخادم — تُستهلك لاستخراج البصمة ثم تُهمل.</p>
          </div>
        </section>`;
    }

    function money(v) {
        const m = formatMoney(v, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
    }

    function sourceBadge(src) {
        const map = { device: ['info', 'بصمة'], qr: ['success', 'QR'], portal: ['brand', 'كاميرا التطبيق'], backfill: ['neutral', 'أرشيف'] };
        const [tone, label] = map[src] || ['neutral', 'يدوي'];
        return `<span class="erp-badge" data-tone="${tone}">${label}</span>`;
    }

    function statusBadge(a) {
        const hasIn = !!(a.checkIn && String(a.checkIn).trim());
        const hasOut = !!(a.checkOut && String(a.checkOut).trim());
        if (!hasIn) {return '<span class="erp-badge" data-tone="warning">بلا حضور</span>';}
        if (!hasOut) {return '<span class="erp-badge" data-tone="warning">بلا انصراف</span>';}
        if (a.late || Number(a.lateMinutes || 0) > 0 || Number(a.earlyLeaveMinutes || 0) > 0) {
            return '<span class="erp-badge" data-tone="warning">متأخر</span>';
        }
        return '<span class="erp-badge" data-tone="success">في الوقت</span>';
    }

    function paint() {
        const body = q('[data-v2-body]');
        if (!emp) {
            const sw = q('[data-v2-switch]');
            if (sw) {sw.innerHTML = '';}
            body.innerHTML = punchCardHtml() + faceCardHtml()
                + `<section class="erp-card"><div class="erp-card__body" style="text-align:center;padding:60px 20px">`
                + `<h3>لم يتم ربط حسابك بملف موظف</h3><p class="erp-text-sm erp-text-muted">تواصل مع مدير الموارد البشرية لربط حسابك</p></div></section>`;
            return;
        }
        if (isAdmin && employees.length > 1) {
            q('[data-v2-switch]').innerHTML = `<label class="erp-text-sm erp-text-muted">الموظف</label> `
                + `<select class="erp-select" data-v2-emp style="max-width:280px">`
                + employees.map((e) => `<option value="${esc(String(e.id))}"${String(e.id) === String(emp.id) ? ' selected' : ''}>${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('')
                + `</select>`;
        }
        const myLeaves = leaves.filter((l) => String(l.employeeId) === String(emp.id));
        const withIn = records.filter((a) => a.checkIn);
        const totalKarim = withIn.reduce((s, a) => s + (portalWorkHours(a) || 0), 0);
        const typeName = (id) => {
            const t = (leaveTypes || []).find((x) => String(x.id) === String(id));
            return t ? t.name : '—';
        };
        body.innerHTML = punchCardHtml() + faceCardHtml()
            + `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title">${esc(emp.name)} <span class="erp-text-muted erp-text-sm erp-mono" dir="ltr">${esc(emp.employeeId || '')}</span></h3>`
            + `<span class="erp-grow"></span><span class="erp-text-sm erp-text-muted">${esc(emp.position || '')} · ${esc(emp.department || '')}</span>`
            + `</div></section>`
            + `<ul class="erp-kpis">`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الراتب الأساسي</span></div><div class="erp-kpi__value">${money(emp.salary || 0)}</div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">إجمالي ساعات العمل</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatQty(Math.round(totalKarim * 10) / 10)}</span> <span class="erp-text-sm erp-text-muted">ساعة</span></div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">أيام الحضور</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(withIn.length)}</span></div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">إجمالي الإجازات</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(myLeaves.length)}</span></div></li>`
            + `</ul>`
            + (punches ? `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">بصمات اليوم</h3>`
            + `<span class="erp-grow"></span>${punches.linked
                ? `<span class="erp-badge" data-tone="success">مربوطة — رقم البصمة: <span class="erp-mono" dir="ltr">${esc(String(punches.deviceUserId))}</span></span>`
                : '<span class="erp-badge" data-tone="warning">غير مربوطة بجهاز الحضور</span>'}</div>`
            + `<div class="erp-card__body"><p class="erp-text-sm">`
            + ((punches.punches || []).map((p) => `<span class="erp-badge" data-tone="${p.punchState === 0 ? 'success' : 'danger'}">${p.punchState === 0 ? 'حضور' : 'انصراف'} · <span dir="ltr">${esc(String(p.attendanceTime || ''))}</span> · ${esc(p.deviceName || '')}</span>`).join(' ')
                || '<span class="erp-text-muted">لا توجد بصمات مسجلة لك اليوم</span>')
            + `</p></div></section>` : '')
            + `<section class="erp-card"><div class="erp-card__head erp-portal-report__head"><h3 class="erp-card__title">سجل الحضور والانصراف</h3><span class="erp-grow"></span>`
            + `<input class="erp-input erp-input--ltr" type="month" data-v2-month value="${todayIso().slice(0, 7)}" aria-label="شهر الكشف">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-print-day>اليوم</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-print-month>الشهر كامل</button></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>المصدر</th><th>الحالة</th></tr></thead><tbody>`
            + (withIn.slice().reverse().map((a) => {
                const h = a.checkIn && a.checkOut ? (portalWorkHours(a) ?? 0).toFixed(2) : '—';
                return `<tr><td class="erp-td">${esc(fD(a.date))}</td>`
                    + `<td class="erp-td erp-mono" dir="ltr">${esc(a.checkIn || '—')}</td>`
                    + `<td class="erp-td erp-mono" dir="ltr">${esc(a.checkOut || '—')}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${h} ساعة</td>`
                    + `<td class="erp-td">${sourceBadge(a.source)}</td><td class="erp-td">${statusBadge(a)}</td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="6">لا توجد سجلات</td></tr>')
            + `</tbody></table></div></div></section>`
            + `<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">سجل الإجازات</h3></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th></tr></thead><tbody>`
            + (myLeaves.slice().reverse().map((l) => {
                const days = Math.ceil((new Date(l.endDate) - new Date(l.startDate)) / 86400000) + 1;
                const st = l.status === 'approved' ? ['success', 'معتمد'] : (l.status === 'rejected' ? ['danger', 'مرفوض'] : ['warning', 'معلق']);
                return `<tr><td class="erp-td">${esc(typeName(l.leaveTypeId))}</td><td class="erp-td">${esc(fD(l.startDate))}</td><td class="erp-td">${esc(fD(l.endDate))}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${Number.isFinite(days) ? days : '—'}</td>`
                    + `<td class="erp-td"><span class="erp-badge" data-tone="${st[0]}">${st[1]}</span></td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="5">لا توجد إجازات</td></tr>')
            + `</tbody></table></div></div></section>`;
    }

    function printDoc(title, rowsHtml, summaryHtml) {
        const w = openInAppReport(title);
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>`
            + `<style>body{font-family:'Cairo',Tahoma,sans-serif;padding:28px;color:#1a1a1a;direction:rtl}h2{text-align:center}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:6px;text-align:center}th{background:#f4ead2}`
            + `.controls{text-align:center;margin-bottom:14px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<h2>${esc(title)}</h2><p style="text-align:center">الموظف: ${esc(emp.name)} (${esc(emp.employeeId || '')})</p>${summaryHtml}${rowsHtml}</body></html>`);
        w.document.close();
        const bp = w.document.querySelector('[data-pl-print]');
        if (bp) {bp.addEventListener('click', () => w.print());}
        const bc = w.document.querySelector('[data-pl-close]');
        if (bc) {bc.addEventListener('click', () => w.close());}
        w.focus();
    }

    async function printRange(from, to, title) {
        if (!emp) {return;}
        say('جارٍ تجهيز الكشف…');
        try {
            const rep = await fetchAttendanceReport({ employeeId: emp.id, from, to });
            if (!el.isConnected) {return;}
            const recs = Array.isArray(rep.records) ? rep.records : [];
            const s = rep.summary || {};
            const rows = `<table><thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead><tbody>`
                + (recs.map((a) => {
                    const h = a.checkIn && a.checkOut ? (portalWorkHours(a) ?? 0).toFixed(2) : '—';
                    const st = !a.checkIn ? 'بلا حضور' : (!a.checkOut ? 'بلا انصراف' : 'مسجل');
                    return `<tr><td>${esc(String(a.date || '').slice(0, 10))}</td><td dir="ltr">${esc(a.checkIn || '—')}</td><td dir="ltr">${esc(a.checkOut || '—')}</td><td>${h}</td><td>${st}</td></tr>`;
                }).join('') || '<tr><td colspan="5">لا سجلات</td></tr>') + `</tbody></table>`;
            const sum = `<p style="text-align:center">أيام الحضور: ${s.daysPresent ?? recs.length} · إجمالي الساعات: ${s.totalHours ?? '—'}</p>`;
            printDoc(title, rows, sum);
            say('تم تجهيز الكشف');
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذر تحميل الكشف');
        }
    }

    /**
     * بصمة ذاتية واحدة — كاميرا الوجه (إن كانت مفعّلة) ثم 6 قراءات موقع ثم
     * الخادم. كل الرفض المحلي يُوثَّق عبر client-reject فلا رفض صامت.
     */
    async function doPunch() {
        if (!canPunch || punchBusy) { return; }
        const s = portalStatus || {};
        if (s.enabled !== true) {
            lastPunch = {kind: 'error', text: 'البصمة الذاتية غير مفعّلة إداريًا'};
            paint();
            return;
        }
        if (s.hasEmployeeProfile === false) {
            lastPunch = {kind: 'error', text: 'لم يتم ربط حسابك بملف موظف'};
            paint();
            return;
        }
        if (s.faceEnabled && s.faceEnrolled === false) {
            lastPunch = {kind: 'error', text: 'لم يتم تسجيل وجهك بعد — راجع الموارد البشرية'};
            paint();
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            lastPunch = {kind: 'error', text: 'لا يوجد اتصال بالشبكة — اتصل بشبكة المطعم وأعد المحاولة'};
            paint();
            return;
        }

        punchBusy = true;
        lastPunch = null;
        paint();
        try {
            let face = null;
            if (s.faceEnabled) {
                face = await captureFace({
                    title: 'تأكيد البصمة بالوجه',
                    target: 1,
                    wantDescriptors: true,
                    requireDescriptor: faceV1Required(s),
                });
                if (!el.isConnected) { return; }
            }

            let fixes = null;
            let mockSignals = null;
            if (s.geofence) {
                const [collected, signals] = await Promise.all([
                    collectLocationFixes((done, total, accuracy) => {
                        const btn = q('[data-v2-punch]');
                        if (!btn) { return; }
                        btn.textContent = accuracy != null
                            ? `تحديد الموقع ${done}/${total} — الدقة ${Math.round(accuracy)}م`
                            : `تحديد الموقع ${done}/${total}…`;
                    }),
                    nativeMockSignals(),
                ]);
                fixes = collected;
                mockSignals = signals;
                if (!el.isConnected) { return; }
                if (mockSignals && mockSignals.mocked === true) {
                    reportClientReject('PUNCH_LOCATION_MOCKED_CLIENT', mockSignals.detail).catch(() => {});
                    lastPunch = {kind: 'error', text: '✋ قراءة الموقع على جهازك معلَّمة كموقع مزيف — أوقف تطبيقات تغيير الموقع ثم أعد المحاولة'};
                    return;
                }
                if (!fixes) {
                    reportClientReject('PUNCH_LOCATION_UNAVAILABLE_CLIENT', mockSignals && mockSignals.detail).catch(() => {});
                    lastPunch = {kind: 'error', text: '✋ تعذر تحديد موقعك — شغّل خدمة الموقع وانتظر إشارة أفضل ثم أعد المحاولة'};
                    return;
                }
                if (mockSignals) {
                    for (const fix of fixes) { fix.mocked = false; }
                }
            }

            const payload = {
                deviceId: portalDeviceId(),
                location: s.geofence
                    ? {fixes, mocked: false, spoofSignals: mockSignals && mockSignals.mockAppSelected === true ? ['MOCK_APP_SELECTED'] : []}
                    : null,
            };
            if (face && face.descriptors.length) { payload.faceDescriptor = face.descriptors[0]; }
            if (face && face.images.length) { payload.faceImage = face.images[0]; }
            const res = await punchPortal(payload);
            if (!el.isConnected) { return; }
            lastPunch = {kind: 'ok', text: punchActionLabel(res && res.action)};
            await reload();
            if (el.isConnected) { say(lastPunch.text); }
        } catch (e) {
            if (!el.isConnected) { return; }
            if (e && e.message === 'FACE_CANCELLED') {
                lastPunch = {kind: 'neutral', text: 'أُلغيت البصمة — لم يُسجَّل شيء'};
            } else {
                lastPunch = {kind: 'error', text: '✋ ' + ((e && e.message) || 'تعذر تسجيل البصمة')};
            }
        } finally {
            punchBusy = false;
            if (el.isConnected) { paint(); }
        }
    }

    function selectedFaceUser() {
        const raw = q('[data-v2-face-user]')?.value ?? faceUserId;
        const id = Number(raw);
        const row = employees.find((e) => String(e.userId) === String(raw)) || null;
        return {id, row, raw: String(raw || '')};
    }

    async function enrollSelectedFace() {
        if (!canFace || faceBusy) { return; }
        const target = selectedFaceUser();
        if (!target.id) {
            faceResult = {kind: 'error', text: 'اختر الموظف أولًا'};
            paint();
            return;
        }
        faceBusy = true;
        faceResult = null;
        paint();
        try {
            const face = await captureFace({
                title: `تسجيل وجه: ${target.row ? target.row.name : ''}`,
                target: 5,
                wantDescriptors: true,
                requireDescriptor: false,
            });
            if (!el.isConnected) { return; }
            const saved = {v2: false, v1: false};
            if (face.images.length) {
                try { await enrollFaceV2(target.id, face.images); saved.v2 = true; }
                catch (e) { saved.v2Error = (e && e.message) || 'فشل المحرك المتقدم'; }
            }
            if (!el.isConnected) { return; }
            if (face.descriptors.length) {
                try { await enrollFaceV1(target.id, face.descriptors); saved.v1 = true; }
                catch (e) { saved.v1Error = (e && e.message) || 'فشل المحرك الأساسي'; }
            }
            if (!el.isConnected) { return; }
            faceResult = saved.v2 || saved.v1
                ? {kind: 'ok', text: faceEnrollMessage(saved)}
                : {kind: 'error', text: 'فشل التسجيل: ' + (saved.v2Error || saved.v1Error || 'لا لقطة صالحة')};
        } catch (e) {
            if (!el.isConnected) { return; }
            if (!e || e.message !== 'FACE_CANCELLED') {
                faceResult = {kind: 'error', text: (e && e.message) || 'فشل التسجيل'};
            }
        } finally {
            faceBusy = false;
            if (el.isConnected) { paint(); }
        }
    }

    async function removeSelectedFace() {
        if (!canFace || faceBusy) { return; }
        const target = selectedFaceUser();
        if (!target.id) {
            faceResult = {kind: 'error', text: 'اختر الموظف أولًا'};
            paint();
            return;
        }
        if (!window.confirm('إزالة قالب الوجه لهذا الموظف؟')) { return; }
        faceBusy = true;
        faceResult = null;
        paint();
        try {
            const res = await removeFaceEnrollment(target.id);
            if (!el.isConnected) { return; }
            const removed = Number((res && res.removed) || 0) + Number((res && res.removedV2) || 0);
            faceResult = removed > 0
                ? {kind: 'ok', text: 'تمت إزالة القالب'}
                : {kind: 'neutral', text: 'لا يوجد قالب نشط لهذا الموظف — لم يتغيّر شيء'};
        } catch (e) {
            if (!el.isConnected) { return; }
            faceResult = {kind: 'error', text: (e && e.message) || 'فشلت الإزالة'};
        } finally {
            faceBusy = false;
            if (el.isConnected) { paint(); }
        }
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            const [emps, lv, lt, pu, cur, st] = await Promise.all([
                fetchEmployees().catch(() => []),
                fetchLeaveWorkflow().catch(() => []),
                fetchLeaveTypes().catch(() => []),
                fetchMyPunches().catch(() => null),
                fetchCurrency().catch(() => ''),
                fetchPortalStatus().catch(() => null),
            ]);
            if (!el.isConnected) {return;}
            employees = Array.isArray(emps) ? emps : [];
            leaves = Array.isArray(lv) ? lv : (lv && Array.isArray(lv.data) ? lv.data : []);
            const ltArr = Array.isArray(lt) ? lt : [];
            leaveTypes = ltArr;
            punches = pu;
            currency = String(cur ?? '');
            portalStatus = st && typeof st === 'object' ? st : null;
            if (faceUserId && !employees.some((e) => String(e.userId) === faceUserId)) {
                faceUserId = '';
            }
            if (isAdmin) {
                emp = employees.find((e) => emp && String(e.id) === String(emp.id))
                    || employees.find((e) => selfUserId !== null && String(e.userId) === selfUserId)
                    || employees[0] || null;
            } else {
                emp = selfUserId !== null
                    ? employees.find((e) => String(e.userId) === selfUserId) || null
                    : null;
            }
            if (emp) {
                try {
                    const year = todayIso().slice(0, 4);
                    const rep = await fetchAttendanceReport({ employeeId: emp.id, from: `${year}-01-01`, to: todayIso() });
                    if (!el.isConnected) {return;}
                    records = Array.isArray(rep.records) ? rep.records : [];
                } catch {
                    if (!el.isConnected) {return;}
                    records = [];
                }
            } else {
                records = [];
            }
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'خطأ');
        } finally {
            loading = false;
        }
    }

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-emp]')) {
            const next = employees.find((e) => String(e.id) === String(event.target.value));
            if (next) {
                emp = next;
                reload();
            }
            return;
        }
        if (event.target.matches('[data-v2-face-user]')) {
            faceUserId = String(event.target.value || '');
        }
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-punch]')) {doPunch(); return;}
        if (event.target.closest('[data-v2-face-enroll]')) {enrollSelectedFace(); return;}
        if (event.target.closest('[data-v2-face-remove]')) {removeSelectedFace(); return;}
        if (event.target.closest('[data-v2-print-day]')) {printRange(todayIso(), todayIso(), `كشف حضور وانصراف يوم ${todayIso()}`); return;}
        if (event.target.closest('[data-v2-print-month]')) {
            const m = el.querySelector('[data-v2-month]')?.value || todayIso().slice(0, 7);
            const [y, mm] = m.split('-').map(Number);
            const last = new Date(y, mm, 0).getDate();
            const p = (n) => String(n).padStart(2, '0');
            printRange(`${y}-${p(mm)}-01`, `${y}-${p(mm)}-${last}`, `كشف حضور وانصراف شهر ${m}`);
        }
    });

    reload();

    return {
        el, reload,
        destroy() { el.remove(); },
    };
}
