import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9223);
const baseUrl = process.env.ERP_BASE_URL || 'http://127.0.0.1:5000';
const username = process.env.ERP_TEST_USERNAME || 'admin';
const password = process.env.ERP_TEST_PASSWORD || '';
const chromium = process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const userDataDir = `/tmp/karim-mobile-check-${process.pid}`;
const screenshotPath = process.env.SCREENSHOT_PATH || '/home/ubuntu/screenshots/karim-dashboard-mobile-390.png';

if (!password) throw new Error('ERP_TEST_PASSWORD is required and is intentionally not stored in this script.');

const browser = spawn(chromium, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`, '--window-size=390,844',
  `${baseUrl}/app/index.html`,
], { stdio: ['ignore', 'ignore', 'pipe'] });

let cdp;
const pending = new Map();
let nextId = 1;

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (_) {}
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

try {
  await connect();
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete'`);
  await evaluate(`(() => {
    const u = document.getElementById('lu');
    const p = document.getElementById('lp');
    if (!u || !p) return false;
    u.value = ${JSON.stringify(username)};
    p.value = ${JSON.stringify(password)};
    document.getElementById('loginBtn')?.click();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.stats-grid-premium .metric-card-premium').length >= 4`, 20000);
  await waitFor(`(() => { const el = document.getElementById('splashScreen'); if (!el) return true; const style = getComputedStyle(el); return style.display === 'none' || Number(style.opacity) === 0; })()`, 8000);
  await new Promise(resolve => setTimeout(resolve, 250));

  const report = await evaluate(`(() => {
    const all = [...document.querySelectorAll('.stats-grid-premium .metric-card-premium')];
    const cards = all.slice(0, 4).map(card => {
      const rect = card.getBoundingClientRect();
      const children = [...card.children].map(el => ({ className: String(el.className), top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, height: el.getBoundingClientRect().height }));
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, children };
    });
    const overflowing = [...document.querySelectorAll('body, #app, .main-area, #content')]
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .map(el => ({ id: el.id, className: String(el.className), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, cards, overflowing };
  })()`);

  const png = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(png.data, 'base64'));

  const maxHeight = Math.max(...report.cards.map(card => card.height));
  const visibleContent = report.cards.every(card => card.children.length >= 3 && card.children.every(child => child.height > 0));
  const pass = report.viewport.width === 390 && report.cards.length === 4 && maxHeight <= 210 && report.overflowing.length === 0 && visibleContent;
  console.log(JSON.stringify({ pass, maxHeight, screenshotPath, ...report }, null, 2));
  if (!pass) process.exitCode = 2;
} finally {
  try { cdp?.close(); } catch (_) {}
  browser.kill('SIGTERM');
  await once(browser, 'exit').catch(() => {});
}
