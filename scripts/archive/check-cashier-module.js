try {
  const mod = require('../backend/cashier-module');
  console.log(JSON.stringify({ loaded: true, exports: Object.keys(mod) }));
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
