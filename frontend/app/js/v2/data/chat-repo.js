/**
 * V2 — Internal chat repository (الشات الداخلي بين أجهزة الطاقم)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM backend/internal-chat-routes.js — NOT INVENTED
 *   GET  /chat/users        → { users:[{id,username,name,role,online}] }
 *        (role IN admin|manager|hr|warehouse, active only — :67-78)
 *   GET  /chat/history?with → { messages:[…50] } private pair only (:47-64)
 *   POST /chat/send {body,to_user_id} → { message } (:82-107)
 *        server caps the body at 1000 chars and throttles 2s/user.
 * The server owns every permission and validation; this file only shapes
 * the three calls. No cache, no local persistence: messages live in the
 * `internal_chat` table and vanish after the server's 7-day prune.
 */

import { apiFetch } from '../../core/api.js?v=4.9.152';

export const CHAT_PEER_ROLES = ['admin', 'manager', 'hr', 'warehouse'];
export const CHAT_MAX_BODY = 1000;

export async function fetchChatUsers() {
    const data = await apiFetch('/chat/users');
    const rows = Array.isArray(data && data.users) ? data.users : [];
    return rows
        .filter((u) => u && u.id !== undefined && u.id !== null)
        .map((u) => ({
            id: u.id,
            username: String(u.username || ''),
            name: String(u.name || ''),
            role: String(u.role || ''),
            online: u.online === true,
        }));
}

export async function fetchChatHistory(withId) {
    const peer = Number(withId);
    if (!Number.isInteger(peer) || peer <= 0) {throw new Error('اختر موظفًا أولًا');}
    const data = await apiFetch(`/chat/history?with=${encodeURIComponent(peer)}`);
    return Array.isArray(data && data.messages) ? data.messages : [];
}

export async function sendChatMessage(body, toUserId) {
    const text = String(body || '').trim();
    if (!text) {throw new Error('الرسالة فارغة');}
    const peer = Number(toUserId);
    if (!Number.isInteger(peer) || peer <= 0) {throw new Error('اختر موظفًا أولًا');}
    const data = await apiFetch('/chat/send', {
        method: 'POST',
        body: JSON.stringify({ body: text.slice(0, CHAT_MAX_BODY), to_user_id: peer }),
    });
    return (data && data.message) || null;
}
