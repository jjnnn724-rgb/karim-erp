// Debug: test the exact code path
const sq = require('./backend/whatsapp-engine/system-query');
const origExecute = sq.executeQuery;
sq.executeQuery = async function(text) {
    console.log('executeQuery called with:', JSON.stringify(text));
    const result = await origExecute.call(this, text);
    console.log('Result includes attendance:', result.includes('تقرير الحضور'));
    console.log('Result includes system:', result.includes('حالة النظام'));
    return result;
};
sq.executeQuery('حضور').then(r => {
    console.log('Final:', r.includes('تقرير الحضور') ? 'ATTENDANCE' : 'SYSTEM');
});
