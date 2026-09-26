import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9224);
const baseUrl = process.env.ERP_BASE_URL || 'http://127.0.0.1:5000';
const username = process.env.ERP_TEST_USERNAME || 'admin';
const password = process.env.ERP_TEST_PASSWORD || '';
const chromium = process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const userDataDir = `/tmp/karim-pos-mobile-check-${process.pid}`;
const screenshotPath = process.env.SCREENSHOT_PATH || '/home/ubuntu/screenshots/karim-pos-mobile-390.png';

if (!password) throw new Error('ERP_TEST_PASSWORD is required and is intentionally not stored in this script.');

const browser = spawn(chromium, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`, '--window-size=390,844',
  `${baseUrl}/app/pos.html`,
], { stdio: ['ignore', 'ignore', 'pipe'] });

let cdp;
const pending = new Map();
let nextId = 1;

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connect() {
  const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = pages.find(item => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target was not found.');
  cdp = new WebSocket(page.webSocketDebuggerUrl);
  cdp.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP error'));
      else resolve(message.result);
    }
  });
  await once(cdp, 'open');
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

async function waitFor(expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for condition: ${expression}`);
}

function visible(id) {
  return `(() => { const e=document.getElementById(${JSON.stringify(id)}); if(!e)return false; const s=getComputedStyle(e); return !e.classList.contains('hidden') && s.display !== 'none' && s.visibility !== 'hidden'; })()`;
}

try {
  await connect();
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete'`);
  await waitFor(`document.getElementById('username') && document.getElementById('password')`);
  await evaluate(`(() => { document.getElementById('username').value=${JSON.stringify(username)}; document.getElementById('password').value=${JSON.stringify(password)}; document.getElementById('login-form').requestSubmit(); return true; })()`);
  await waitFor(`${visible('shift-open-screen')} || ${visible('pos-screen')}`, 20000);

  const beforeShift = await evaluate(`({shift:${visible('shift-open-screen')}, pos:${visible('pos-screen')}, resume:${visible('resume-shift-btn')}, open:${visible('open-shift-btn')}, newShift:${visible('new-shift-btn')}})`);
  if (!beforeShift.pos && beforeShift.resume) {
    await evaluate(`document.getElementById('resume-shift-btn').click()`);
  }
  await waitFor(visible('pos-screen'), 12000);
  await waitFor(`document.getElementById('mobile-cart-toggle') && document.getElementById('complete-sale-btn')`, 12000);
  await new Promise(resolve => setTimeout(resolve, 500));

  const result = await evaluate(`(() => {
    const rect = id => document.getElementById(id)?.getBoundingClientRect().toJSON() || null;
    const style = id => { const e=document.getElementById(id); if(!e)return null; const s=getComputedStyle(e); return {display:s.display,visibility:s.visibility,position:s.position,minHeight:s.minHeight,disabled:e.disabled}; };
    const overflow = [...document.querySelectorAll('body,#pos-screen,.pos-main,.products-section')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({id:e.id,className:String(e.className),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
    return {viewport:{width:innerWidth,height:innerHeight},toggle:{rect:rect('mobile-cart-toggle'),style:style('mobile-cart-toggle')},completeBefore:{rect:rect('complete-sale-btn'),style:style('complete-sale-btn')},overflow};
  })()`);

  await evaluate(`document.getElementById('mobile-cart-toggle').click()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const openResult = await evaluate(`(() => { const e=document.getElementById('complete-sale-btn'); const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return {cartOpen:document.getElementById('pos-screen').classList.contains('mobile-cart-open'),rect:r.toJSON(),style:{display:s.display,visibility:s.visibility,position:s.position,minHeight:s.minHeight,disabled:e.disabled},withinViewport:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}; })()`);
  const png = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(png.data, 'base64'));

  const toggleRect = result.toggle.rect;
  const toggleWithinViewport = Boolean(toggleRect && toggleRect.left >= 0 && toggleRect.right <= result.viewport.width && toggleRect.top >= 0 && toggleRect.bottom <= result.viewport.height);
  const pass = result.viewport.width === 390 && result.toggle.style?.display !== 'none' && toggleWithinViewport && result.overflow.length === 0 && openResult.cartOpen && openResult.style.display !== 'none' && openResult.withinViewport && openResult.rect.height >= 48;
  console.log(JSON.stringify({ pass, beforeShift, result, openResult, screenshotPath }, null, 2));
  if (!pass) process.exitCode = 2;
} finally {
  try { cdp?.close(); } catch (_) {}
  browser.kill('SIGTERM');
  await once(browser, 'exit').catch(() => {});
}
