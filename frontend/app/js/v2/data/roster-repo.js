/**
 * V2 — باب شبكة الدوام الأسبوعية (W2-1) · Door: /api/hr/dept-roster-week
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Mirrors of hr-routes.js (the server keeps the final word on all of them):
 *   • ROSTER_ROLES / ROSTER_PRIVILEGED (:1087-1089) — who reads, who picks a
 *     department (privileged + accountant), who signs (:1479, :1497).
 *   • The week starts Saturday (owner request 2026-10-04): the server snaps
 *     any sent date to its week's Saturday (:1334-1335) and answers with
 *     weekStart. This door never computes a week start; navigation moves in
 *     whole weeks from the weekStart the server sent (weekOf below).
 *   • rosterApprovalKey (:1446-1448) = (depts.join(',') || '*').toLowerCase();
 *     the screen feeds it the depts of the response, which are the scope the
 *     server itself just applied.
 *   • cellEdit mirrors the save-time checks (:1545-1576) so a typo fails next
 *     to the input before the wire; when the server does answer, its message
 *     is what the user reads. Note: the server spells the hours error
 *     ROSTER_BAD_Karim (:1569) — its own code, not mirrored here.
 *
 * Declared deviation from features/roster.js (the legacy chart):
 *   • The legacy save pushed all seven days of every touched row
 *     (roster.js:287), including locked past days — mid-week the server
 *     refuses the whole batch with 422 ROSTER_PAST_DATE (:1556). This door
 *     sends only the cells the user actually edited (dirtyToCells).
 *   • The legacy client key-guessed the approval key from the role
 *     (roster.js:162-166); here the key is computed from the server's own
 *     depts answer, so the two cannot disagree.
 *
 * A save deletes this week's print approval server-side (:1636) — the screen
 * warns in the confirm sentence before the click, not after.
 */

import { apiFetch } from '../../core/api.js?v=4.9.193';

export const ROSTER_ROLES = ['admin', 'hr', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'warehouse', 'accountant'];
export const ROSTER_PRIVILEGED = ['admin', 'hr', 'manager'];
export const ROSTER_APPROVERS = ['hr', 'admin'];
/** Weekday labels in the server's order: days[i].weekday = i, 0 = Saturday. */
export const ROSTER_DAY_LABELS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
export const ROSTER_MAX_CELLS = 700;   // hr-routes.js:1522

export const canRosterWrite = (role) => ROSTER_ROLES.includes(role);
export const canApproveRoster = (role) => ROSTER_APPROVERS.includes(role);
export const canPickDept = (role) => ROSTER_PRIVILEGED.includes(role) || role === 'accountant';

/** Whole-week step from a server-sent week start (YYYY-MM-DD). */
export function weekOf(weekStart, deltaWeeks) {
    const d = new Date(String(weekStart || '') + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) {return '';}
    d.setUTCDate(d.getUTCDate() + (Number(deltaWeeks) || 0) * 7);
    return d.toISOString().slice(0, 10);
}

/** The server's approval key (:1446-1448), fed the depts of its own answer. */
export function rosterApprovalKey(depts) {
    const list = Array.isArray(depts) ? depts.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return (list.length ? list.join(',') : '*').toLowerCase();
}

/** Three states of the print approval row (:1348-1351, :1466-1472). */
export function rosterApprovalState(approval) {
    const a = approval || {};
    if (!a.requested_name && !a.approved_name) {return { key: 'none' };}
    const at = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');
    if (a.approved_name) {
        return { key: 'approved', by: String(a.approved_name), at: at(a.approved_at) };
    }
    return { key: 'pending', by: String(a.requested_name), at: at(a.requested_at) };
}

/** Save-time cell checks, mirrored from :1545-1576; ok → normalized values. */
export function cellEdit(startRaw, hoursRaw) {
    const start = String(startRaw ?? '').trim();
    const sm = start.match(/^(\d{1,2}):(\d{2})$/);
    if (!sm || Number(sm[1]) > 23 || Number(sm[2]) > 59) {
        return { ok: false, code: 'ROSTER_BAD_TIME', error: 'وقت غير صالح — الصيغة HH:MM' };
    }
    const hours = Number(hoursRaw);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
        return { ok: false, code: 'ROSTER_BAD_HOURS', error: 'مدة الدوام بين 1 و24 ساعة' };
    }
    return { ok: true, shiftStart: `${String(sm[1]).padStart(2, '0')}:${sm[2]}`, shiftHours: hours };
}

export const cellKey = (id, date) => `${Number(id)}|${String(date)}`;

/** Map of edited cells → the wire body the server validates (:1538-1583). */
export function dirtyToCells(dirty) {
    const out = [];
    if (!dirty || typeof dirty.values !== 'function') {return out;}
    for (const e of dirty.values()) {
        out.push({
            id: Number(e.id),
            date: String(e.date),
            shift_start: String(e.shift_start),
            shift_hours: Number(e.shift_hours),
            day_off: e.day_off == null ? null : Number(e.day_off),
        });
    }
    return out;
}

// ─── الأبواب ────────────────────────────────────────────────────────────

/** GET /hr/dept-roster-week (:1327) — week '' lets the server pick today's. */
export async function fetchRosterWeek(week, dept) {
    const p = new URLSearchParams();
    if (week) {p.set('week', String(week));}
    if (dept) {p.set('dept', String(dept));}
    const qs = p.toString();
    const res = await apiFetch('/hr/dept-roster-week' + (qs ? '?' + qs : ''));
    return res || {};
}

/** POST /hr/dept-roster-week (:1519) — dirty cells only, dept only if chosen. */
export async function saveRosterWeek({ dept, weekStart, cells }) {
    const body = { week_start: String(weekStart || ''), cells: Array.isArray(cells) ? cells : [] };
    if (dept) {body.dept = String(dept);}
    return apiFetch('/hr/dept-roster-week', { method: 'POST', body: JSON.stringify(body) });
}

/** POST /hr/dept-roster-approval/request (:1458) — resets any prior signing. */
export async function requestRosterApproval({ dept, weekStart }) {
    const body = { week_start: String(weekStart || '') };
    if (dept) {body.dept = String(dept);}
    return apiFetch('/hr/dept-roster-approval/request', { method: 'POST', body: JSON.stringify(body) });
}

/** POST /hr/dept-roster-approval/approve (:1497) — hr/admin only server-side. */
export async function approveRoster({ deptKey, weekStart }) {
    return apiFetch('/hr/dept-roster-approval/approve', {
        method: 'POST',
        body: JSON.stringify({ dept_key: String(deptKey || ''), week_start: String(weekStart || '') }),
    });
}

/** GET /hr/dept-roster-approval/pending (:1479) — hr/admin only server-side. */
export async function fetchRosterPending(week) {
    const qs = week ? `?week=${encodeURIComponent(String(week))}` : '';
    const res = await apiFetch('/hr/dept-roster-approval/pending' + qs);
    return res && Array.isArray(res.pending) ? res.pending : [];
}
