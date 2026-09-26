// Take screenshot of the new design using puppeteer-core + system chrome
const puppeteer = require('/home/z/my-project/verify/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/home/z/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5000/app/index.html', { waitUntil: 'networkidle2' });
  // Wait for splash animation + fonts
  await new Promise(r => setTimeout(r, 3500));

  // Screenshot 1: Login screen
  await page.screenshot({ path: '/home/z/my-project/download/design-01-login.png', fullPage: false });
  console.log('✓ Login screen captured');

  // Try to login to see the main app
  await page.type('#lu', 'admin');
  await page.type('#lp', '1234');
  await page.click('#loginBtn');
  await new Promise(r => setTimeout(r, 2500));

  // Screenshot 2: Dashboard
  await page.screenshot({ path: '/home/z/my-project/download/design-02-dashboard.png', fullPage: false });
  console.log('✓ Dashboard captured');

  // Navigate to inventory
  await page.evaluate(() => { if (window.go) {window.go('warehouse', null);} });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/home/z/my-project/download/design-03-inventory.png', fullPage: false });
  console.log('✓ Inventory page captured');

  // Navigate to employees
  await page.evaluate(() => { if (window.go) {window.go('employees', null);} });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/home/z/my-project/download/design-04-employees.png', fullPage: false });
  console.log('✓ Employees page captured');

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error(e.message); process.exit(1); });
