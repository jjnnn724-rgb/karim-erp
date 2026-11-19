// Take screenshots of the new POS design
const puppeteer = require('/home/z/my-project/verify/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/home/z/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5000/app/pos.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));

  // Screenshot 1: Login screen
  await page.screenshot({ path: '/home/z/my-project/download/pos-01-login.png' });
  console.log('✓ POS Login captured');

  // Login
  await page.type('#username', 'admin');
  await page.type('#password', '1234');
  await page.click('#login-form button[type="submit"]');
  await new Promise(r => setTimeout(r, 2000));

  // Screenshot 2: Shift open screen
  await page.screenshot({ path: '/home/z/my-project/download/pos-02-shift-open.png' });
  console.log('✓ Shift open screen captured');

  // Open shift
  await page.click('#open-shift-btn');
  await new Promise(r => setTimeout(r, 2500));

  // Screenshot 3: Main POS screen (empty cart)
  await page.screenshot({ path: '/home/z/my-project/download/pos-03-main-empty.png' });
  console.log('✓ Main POS (empty cart) captured');

  // Click on a few products to fill the cart
  const products = await page.$$('.product-card');
  console.log(`Found ${products.length} products`);
  for (let i = 0; i < Math.min(3, products.length); i++) {
    if (i < products.length) {
      await products[i].click();
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Screenshot 4: POS with cart items
  await page.screenshot({ path: '/home/z/my-project/download/pos-04-with-cart.png' });
  console.log('✓ POS with cart captured');

  // Type in cash payment
  await page.type('#pay-cash', '100');
  await new Promise(r => setTimeout(r, 500));

  // Screenshot 5: Payment filled
  await page.screenshot({ path: '/home/z/my-project/download/pos-05-payment.png' });
  console.log('✓ Payment captured');

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error(e.message); process.exit(1); });
