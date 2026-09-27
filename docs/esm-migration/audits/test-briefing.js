const path = require('path');
const { Client } = require('pg');
(async () => {
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await client.connect();
  const poolLike = { query: (s, p) => client.query(s, p) };
  const { collectBriefing, formatWhatsapp } = require(path.join(__dirname, '../../../backend/manager-briefing.js'));
  const b = await collectBriefing(poolLike, undefined);
  const text = formatWhatsapp(b);
  console.log('=== REPORT PREVIEW (first 900 chars) ===');
  console.log(text.slice(0, 900));
  console.log('=== report length:', text.length, 'chars ===');
  await client.end();
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message.slice(0, 150)); process.exit(1); });
