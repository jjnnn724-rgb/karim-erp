#!/usr/bin/env node
import fs from 'node:fs/promises';
import db from '../backend/shared-pool.js';
import authLib from '../backend/cashier-module/jwt-middleware.js';

const { pool } = db;
const { signAccessToken } = authLib;
const base = process.env.KARIM_TEST_BASE || 'http://127.0.0.1:5000/api';
const signatureData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function request(path, options = {}, expected = null) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expected !== null && response.status !== expected) throw new Error(`${options.method || 'GET'} ${path} expected ${expected}, got ${response.status}: ${data?.message || data?.error || text}`);
  if (expected === null && !response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${data?.message || data?.error || text}`);
  return { status: response.status, data };
}
function tokenFrom(login) { return login.data?.access_token || login.data?.token || login.data?.jwt || login.data?.accessToken; }
function auth(token) { return { Authorization: `Bearer ${token}` }; }
function rows(result) { return Array.isArray(result.data) ? result.data : (result.data?.data || []); }

const adminRow = (await pool.query('SELECT id, username, name, role FROM users WHERE username=$1 AND active=true LIMIT 1', ['admin'])).rows[0];
if (!adminRow || adminRow.role !== 'admin') throw new Error('Active admin account was not found');
const adminToken = signAccessToken(adminRow);
if (!adminToken) throw new Error('Admin token creation failed');
const adminHeaders = auth(adminToken);
const marker = `signed-workflow-${Date.now()}`;
let kitchenUserId = null;
let warehouseUserId = null;
let dispatchId = null;
let inventoryAuditId = null;
let kitchenAuditId = null;
try {
  const departments = await request('/departments?page=1&limit=200&sort=id&order=asc', { headers: adminHeaders });
  const department = rows(departments).find((row) => String(row.code || '').toLowerCase() === 'kitchen') || rows(departments)[0];
  if (!department) throw new Error('No department available');
  const inventory = await request('/inventory?page=1&limit=200&sort=id&order=asc', { headers: adminHeaders });
  const item = rows(inventory).find((row) => Number(row.qty || 0) > 0) || rows(inventory)[0];
  if (!item) throw new Error('No inventory item available');

  const kitchenUser = await request('/users', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ username: `${marker}-k`, password: 'Temporary-Only-1234!', name: 'اختبار استلام المطبخ', role: 'kitchen', active: true }) });
  kitchenUserId = kitchenUser.data?.id;
  const warehouseUser = await request('/users', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ username: `${marker}-w`, password: 'Temporary-Only-1234!', name: 'اختبار اعتماد المخزن', role: 'warehouse', active: true }) });
  warehouseUserId = warehouseUser.data?.id;
  const kitchenToken = signAccessToken({ id: kitchenUserId, role: 'kitchen', name: 'اختبار استلام المطبخ' });
  const warehouseToken = signAccessToken({ id: warehouseUserId, role: 'warehouse', name: 'اختبار اعتماد المخزن' });
  if (!kitchenToken || !warehouseToken) throw new Error('Temporary role token creation failed');
  const kitchenHeaders = auth(kitchenToken);
  const warehouseHeaders = auth(warehouseToken);

  const created = await request('/dispatches', { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ deptCode: department.code, deptName: department.name, items: [{ itemName: item.name, qty: 0.001, unit: item.unit || 'وحدة' }], status: 'pending', date: new Date().toISOString().slice(0, 10), createdBy: marker, notes: marker }) });
  dispatchId = created.data?.id;
  if (created.status !== 201 || !dispatchId) throw new Error('Kitchen could not create dispatch');
  await request(`/warehouse/dispatches/${dispatchId}/approve`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ signatureData, approvedItems: [], approveNotes: 'must be denied' }) }, 403);
  await request(`/warehouse/dispatches/${dispatchId}/approve`, { method: 'POST', headers: warehouseHeaders, body: JSON.stringify({ signatureData, approvedItems: [{ itemName: item.name, qty: 0.001, unit: item.unit || 'وحدة' }], approveNotes: marker }) });
  await request(`/warehouse/dispatches/${dispatchId}/receive`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ signatureData, notes: marker, items: [{ itemName: item.name, receivedQty: 0.001 }] }) });
  await request(`/warehouse/dispatches/${dispatchId}/receive`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ signatureData, items: [{ itemName: item.name, receivedQty: 0.001 }] }) }, 409);

  const warehouseAudit = await request('/warehouse/inventory/audits', { method: 'POST', headers: warehouseHeaders, body: JSON.stringify({ periodType: 'annual', periodStart: '2026-01-01', periodEnd: '2026-12-31', countedAt: '2026-08-24', warehouseScope: 'main', notes: marker, items: [{ itemId: Number(item.id), countedQty: Number(item.qty || 0), notes: marker }] }) });
  inventoryAuditId = warehouseAudit.data?.audit?.id;
  if (!inventoryAuditId || warehouseAudit.data.audit.period_type !== 'annual') throw new Error('Warehouse annual audit was not created correctly');
  await request(`/warehouse/inventory/audits/${inventoryAuditId}/submit`, { method: 'POST', headers: warehouseHeaders, body: JSON.stringify({}) }, 422);
  await request(`/warehouse/inventory/audits/${inventoryAuditId}/submit`, { method: 'POST', headers: warehouseHeaders, body: JSON.stringify({ signatureData }) });

  const kitchenAudit = await request('/kitchen/audits', { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ period: 'custom', period_start: '2026-08-01', period_end: '2026-08-24', notes: marker }) });
  kitchenAuditId = kitchenAudit.data?.id;
  if (!kitchenAuditId || kitchenAudit.data.period !== 'custom') throw new Error('Kitchen custom audit was not created correctly');
  if (Array.isArray(kitchenAudit.data.items) && kitchenAudit.data.items.length > 0) {
    const countItems = kitchenAudit.data.items.map((x) => ({ id: Number(x.id), counted_qty: Number(x.system_qty) }));
    await request(`/kitchen/audits/${kitchenAuditId}/count`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ items: countItems }) });
    await request(`/kitchen/audits/${kitchenAuditId}/submit`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({}) }, 422);
    await request(`/kitchen/audits/${kitchenAuditId}/submit`, { method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ signatureData }) });
    await request(`/kitchen/audits/${kitchenAuditId}/approve`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ signatureData }) });
  }

  const routeCode = await fs.readFile(new URL('../backend/warehouse-routes.js', import.meta.url), 'utf8');
  const inventoryRouteCode = await fs.readFile(new URL('../backend/inventory-control-routes.js', import.meta.url), 'utf8');
  const kitchenRouteCode = await fs.readFile(new URL('../backend/kitchen-production-routes.js', import.meta.url), 'utf8');
  if (!routeCode.includes("const RECEIVE_ROLES = ['admin', 'manager', 'kitchen'];") || !routeCode.includes('DISPATCH_RECEIPT_ALREADY_RECORDED')) throw new Error('Dispatch receive workflow guards are missing');
  if (!inventoryRouteCode.includes('SIGNATURE_REQUIRED') || !inventoryRouteCode.includes('period_type')) throw new Error('Warehouse audit signature/period contract is missing');
  if (!kitchenRouteCode.includes("'annual'") || !kitchenRouteCode.includes('kitchen_audit_workflow_events')) throw new Error('Kitchen audit period/event contract is missing');
  console.log(JSON.stringify({ ok: true, kitchenCanCreateDispatch: true, kitchenApprovalStatus: 403, warehouseCanApproveWithSignature: true, kitchenCanReceiveWithSignature: true, duplicateReceiptStatus: 409, warehouseAnnualAuditSubmitted: true, kitchenCustomAuditCreated: true, kitchenAuditApprovedWhenItemsAvailable: true, dispatchId, inventoryAuditId, kitchenAuditId }));
} finally {
  if (dispatchId !== null) await request(`/dispatches/${dispatchId}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
  if (kitchenUserId !== null) await request(`/users/${kitchenUserId}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
  if (warehouseUserId !== null) await request(`/users/${warehouseUserId}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
  if (inventoryAuditId !== null) await pool.query('DELETE FROM inventory_audits WHERE id=$1', [inventoryAuditId]).catch(() => {});
  if (kitchenAuditId !== null) await pool.query('DELETE FROM kitchen_audits WHERE id=$1', [kitchenAuditId]).catch(() => {});
  await pool.end().catch(() => {});
}
