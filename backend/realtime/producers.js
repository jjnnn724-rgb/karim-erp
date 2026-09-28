'use strict';

/**
 * realtime/producers.js — flagged domain-event wiring (TASK 9).
 * ────────────────────────────────────────────────────────────────────────────
 * Every producer is OFF unless its RT_EVT_<MODULE> flag is 'true' (coexistence,
 * zero behavior change by default). When on, the outbox row is inserted with
 * tryInsertDomainEvent INSIDE the business txn (same pattern as complete-sale),
 * fail-open (G1) — a dead outbox never breaks the operation.
 */

const { tryInsertDomainEvent } = require('./outbox');

function producersEnabled(module) {
    return String(process.env[`RT_EVT_${module}`] || '').trim().toLowerCase() === 'true';
}

// Deterministic rooms + server-checked target per event family.
const ROUTES = {
    kitchen: { rooms: ['role:kitchen', 'role:manager'], target: { type: 'permission', value: 'dispatch.view' } },
    dispatch: { rooms: ['role:warehouse', 'role:kitchen', 'role:manager'], target: { type: 'permission', value: 'dispatch.view' } },
    purchase: { rooms: ['role:warehouse', 'role:accountant', 'role:manager'], target: { type: 'permission', value: 'purchase.view' } },
    inventory: { rooms: ['role:warehouse', 'role:manager'], target: { type: 'permission', value: 'inventory.view' } },
    hr: { rooms: ['role:hr', 'role:manager'], target: { type: 'permission', value: 'hr.view' } },
    expense: { rooms: ['role:accountant', 'role:manager'], target: { type: 'permission', value: 'expense.view' } },
    payment: { rooms: ['role:accountant', 'role:manager'], target: { type: 'permission', value: 'purchase.view' } },
};

/**
 * @param {object} pool shared pool (for table-presence check)
 * @param {object} client open txn client (row lands in the business txn)
 * @param {string} module flag group: KITCHEN|DISPATCH|PURCHASE|INVENTORY|HR|EXPENSE|PAYMENT
 * @param {object} spec { eventType, aggregateType, aggregateId, payload, eventVersion? }
 * @returns inserted {eventId, sequence} or null (flag off / fail-open)
 */
async function emitDomainEvent(pool, client, module, spec) {
    if (!producersEnabled(module)) {return null;}
    const route = ROUTES[String(module || '').toLowerCase()] || ROUTES.dispatch;
    const dept = spec.deptCode ? `dept:${spec.deptCode}` : null;
    const rooms = dept && !route.rooms.includes(dept) ? [...route.rooms, dept] : route.rooms;
    return tryInsertDomainEvent(pool, client, {
        eventType: spec.eventType,
        eventVersion: spec.eventVersion || 1,
        aggregateType: spec.aggregateType,
        aggregateId: spec.aggregateId,
        payload: spec.payload || {},
        routingMetadata: { rooms, target: route.target },
    });
}

module.exports = { producersEnabled, emitDomainEvent, ROUTES };
