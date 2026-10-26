#!/usr/bin/env node
import fs from 'node:fs/promises';

const base = process.env.KARIM_TEST_BASE || 'http://127.0.0.1:5000/api';
const adminPassword = process.env.KARIM_TEST_PASSWORD;
if (!adminPassword) throw new Error('KARIM_TEST_PASSWORD is required');

async function request(path, options = {}, expected = null) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expected !== null && response.status !== expected) {
    throw new Error(`${options.method || 'GET'} ${path} expected ${expected}, got ${response.status}`);
  }
  if (expected === null && !response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${data?.message || data?.error || text}`);
  }
  return { status: response.status, data };
}

function tokenFrom(login) {
  return login.data?.access_token || login.data?.token || login.data?.jwt || login.data?.accessToken;
}
function auth(token) { return { Authorization: `Bearer ${token}` }; }
function rows(result) { return Array.isArray(result.data) ? result.data : (result.data?.data || []); }

const adminLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: adminPassword }) });
const adminToken = tokenFrom(adminLogin);
if (!adminToken) throw new Error('Admin login did not return a token');
const adminHeaders = auth(adminToken);
const marker = `permission-test-${Date.now()}`;
let testUserId = null;
let dispatchId = null;
try {
  const user = await request('/users', {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ username: marker, password: 'Temporary-Only-1234!', name: 'اختبار صلاحيات المطبخ', role: 'kitchen', active: true }),
  });
  testUserId = user.data?.id;
  if (!testUserId) throw new Error('Temporary kitchen user was not created');
  const kitchenLogin = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: marker, password: 'Temporary-Only-1234!' }) });
  const kitchenToken = tokenFrom(kitchenLogin);
  if (!kitchenToken) throw new Error('Kitchen login did not return a token');
  const kitchenHeaders = auth(kitchenToken);

  const read = await request('/dispatches?page=1&limit=20&sort=id&order=desc', { headers: kitchenHeaders });
  if (read.status !== 200) throw new Error(`Kitchen read access failed with ${read.status}`);
  const departments = await request('/departments?page=1&limit=200&sort=id&order=asc', { headers: kitchenHeaders });
  const department = rows(departments).find((row) => String(row.code || '').toLowerCase() === 'kitchen') || rows(departments)[0];
  if (!department) throw new Error('No department available for permission test');
  const inventory = await request('/inventory?page=1&limit=200&sort=id&order=asc', { headers: kitchenHeaders });
  const item = rows(inventory).find((row) => Number(row.qty || 0) > 0) || rows(inventory)[0];
  if (!item) throw new Error('No inventory item available for permission test');

  const created = await request('/dispatches', {
    method: 'POST', headers: kitchenHeaders,
    body: JSON.stringify({ deptCode: department.code, deptName: department.name, items: [{ itemName: item.name, qty: 0.001, unit: item.unit || 'وحدة' }], status: 'pending', date: new Date().toISOString().slice(0, 10), createdBy: marker, notes: marker }),
  });
  dispatchId = created.data?.id;
  if (created.status !== 201 || !dispatchId) throw new Error('Kitchen could not create a dispatch request');

  const kitchenApproval = await request(`/warehouse/dispatches/${encodeURIComponent(dispatchId)}/approve`, {
    method: 'POST', headers: kitchenHeaders, body: JSON.stringify({ approvedItems: [], approveNotes: 'must be denied' }),
  }, 403);
  const kitchenUpdate = await request(`/dispatches/${encodeURIComponent(dispatchId)}`, {
    method: 'PUT', headers: kitchenHeaders, body: JSON.stringify({ status: 'approved' }),
  }, 403);
  const appCode = await fs.readFile(new URL('../frontend/app/js/app.js', import.meta.url), 'utf8');
  const routeCode = await fs.readFile(new URL('../backend/warehouse-routes.js', import.meta.url), 'utf8');
  const serverCode = await fs.readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  if (!appCode.includes("d.status==='pending'&&['admin','manager','warehouse'].includes(STATE.currentUser.role)")) throw new Error('Dispatch approval button guard is not restricted correctly');
  if (!routeCode.includes("const WRITE_ROLES = ['admin', 'manager', 'warehouse'];") || !routeCode.includes('requireRole(...APPROVAL_ROLES)')) throw new Error('Approval route still includes kitchen');
  if (!serverCode.includes("const updateRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse']")) throw new Error('Dispatch update route still permits kitchen');
  console.log(JSON.stringify({ ok: true, kitchenCanRead: true, kitchenCanCreate: true, kitchenApproveStatus: kitchenApproval.status, kitchenUpdateStatus: kitchenUpdate.status, warehouseApprovalRole: true, dispatchId, cleanedByFinally: true }));
} finally {
  if (dispatchId !== null) await request(`/dispatches/${encodeURIComponent(dispatchId)}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
  if (testUserId !== null) await request(`/users/${encodeURIComponent(testUserId)}`, { method: 'DELETE', headers: adminHeaders }).catch(() => {});
}
