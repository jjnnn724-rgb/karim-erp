#!/usr/bin/env node
import fs from 'node:fs/promises';

const base = process.env.KARIM_TEST_BASE || 'http://127.0.0.1:5000/api';
const username = process.env.KARIM_TEST_USER || 'admin';
const password = process.env.KARIM_TEST_PASSWORD;
if (!password) throw new Error('KARIM_TEST_PASSWORD is required');

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${data?.message || data?.error || text}`);
  return data;
}

const login = await request('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
const token = login.token || login.jwt || login.accessToken || login.access_token || login.data?.token || login.data?.jwt || login.session?.token;
if (!token) throw new Error(`Login did not return a token; response keys: ${Object.keys(login || {}).join(',')}`);
const auth = { Authorization: `Bearer ${token}` };

const departmentsResponse = await request('/departments?page=1&limit=200&sort=id&order=asc', { headers: auth });
const departments = Array.isArray(departmentsResponse) ? departmentsResponse : (departmentsResponse.data || []);
const kitchen = departments.find((d) => {
  const code = String(d.code || '').toLowerCase();
  const name = String(d.name || d.name_ar || '').toLowerCase();
  return code === 'kitchen' || code === 'مطبخ' || name.includes('مطبخ') || name.includes('kitchen');
});
const kitchenDepartment = kitchen || { code: 'kitchen', name: 'المطبخ', _fallback: true };

const inventoryResponse = await request('/inventory?page=1&limit=200&sort=id&order=asc', { headers: auth });
const inventory = Array.isArray(inventoryResponse) ? inventoryResponse : (inventoryResponse.data || []);
const item = inventory.find((row) => Number(row.qty || 0) > 0) || inventory[0];
if (!item) throw new Error('No inventory item exists for the request');

const marker = `AUTOTEST-KITCHEN-DISPATCH-${Date.now()}`;
const created = await request('/dispatches', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    deptCode: kitchenDepartment.code,
    deptName: kitchenDepartment.name || kitchenDepartment.name_ar || 'المطبخ',
    items: [{ itemName: item.name, qty: 0.001, unit: item.unit || 'وحدة' }],
    status: 'pending',
    date: new Date().toISOString().slice(0, 10),
    createdBy: username,
    notes: marker,
  }),
});
const dispatchId = created.id;
try {
  const listResponse = await request('/dispatches?page=1&limit=200&sort=id&order=desc', { headers: auth });
  const dispatches = Array.isArray(listResponse) ? listResponse : (listResponse.data || []);
  const found = dispatches.find((row) => String(row.id) === String(dispatchId) || row.notes === marker);
  if (!found) throw new Error('Created dispatch was not returned by the dispatch list');
  if (found.status !== 'pending') throw new Error(`Expected pending status, got ${found.status}`);
  if (String(found.deptCode || '').toLowerCase() !== String(kitchenDepartment.code || '').toLowerCase()) throw new Error('Dispatch department did not remain kitchen');
  const appCode = await fs.readFile(new URL('../frontend/app/js/app.js', import.meta.url), 'utf8');
  if (!appCode.includes('renderKitchenDispatchRegister') || !appCode.includes('عرض ومتابعة فقط')) throw new Error('Kitchen read-only dispatch register is missing');
  console.log(JSON.stringify({ ok: true, dispatchId, department: found.deptName || found.deptCode, item: item.name, status: found.status, kitchenReadOnlyRegister: true }));
} finally {
  if (dispatchId !== undefined && dispatchId !== null) {
    await request(`/dispatches/${encodeURIComponent(dispatchId)}`, { method: 'DELETE', headers: auth });
  }
}
