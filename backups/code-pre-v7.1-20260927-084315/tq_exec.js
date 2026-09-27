// Test executeQuery the same way the server does
const sq = require('./backend/whatsapp-engine/system-query');
sq.executeQuery('حضور').then(r => {
    const hasAttendance = r.includes('تقرير الحضور');
    const hasSystem = r.includes('حالة النظام');
    const hasNotFound = r.includes('لا أجد');
    console.log('Has attendance:', hasAttendance);
    console.log('Has system:', hasSystem);
    console.log('Has not found:', hasNotFound);
    console.log('Result:', r.substring(0, 150));
}).catch(e => console.log('Error:', e.message));
