'use strict';
/**
 * tenant-rooms.js — غرف WebSocket المقسّمة حسب المستأجر (Stage 2).
 * لا يثق بأي tenantID قادم من العميل؛ يأخذ السياق من socket.data الذي ملأناه
 * من JWT + tenant_memberships في handshake.
 */
function roomFor(tenantId) {
    const id = Number(tenantId);
    return Number.isFinite(id) && id > 0 ? `tenant:${id}` : null;
}

/**
 * بثّ داخل غرفة المستأجر فقط. غياب السياق = لا بثّ (fail closed).
 * @param {{to:(room:string)=>any}|null|undefined} io
 */
function emitToTenant(io, tenantId, event, data, exceptSocketId) {
    const room = roomFor(tenantId);
    if (!io || !room) {return false;}
    let target = io.to(room);
    if (exceptSocketId) {
        if (!target.except) {return false;}
        target = target.except(exceptSocketId);
    }
    target.emit(event, data);
    return true;
}

module.exports = { roomFor, emitToTenant };
