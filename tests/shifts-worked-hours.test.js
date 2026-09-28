const { aggregateWorkedHours, workedMinutesOf } = require('../backend/shifts-engine');

// صفوف حضور خام كما تخرج من استعلام workedHoursAudit (JOIN employees + attendance)
const row = (over) => ({
    id: 1, name: 'احمد', emp_no: 'EMP-001', fp: '45',
    shift_start: '16:00', shift_hours: 12,
    date: '2026-09-01', checkIn: '16:00', checkOut: '04:00',
    ...over,
});

describe('محرك الدوام: الموظف دا كم ساعة (تدقيق الساعات الفعلية)', () => {
    test('وردية ليلية 16:00 → 04:00 = 720 دقيقة (12 ساعة)', () => {
        expect(workedMinutesOf('16:00', '04:00')).toBe(720);
        expect(workedMinutesOf('04:00', '16:00')).toBe(720);
    });

    test('12 ساعة بالضبط على وردية 12 → يوم كامل والدوام تمام', () => {
        const [emp] = aggregateWorkedHours([row({})]);
        expect(emp.shiftHours).toBe(12);
        expect(emp.completeDays).toBe(1);
        expect(emp.shortDays).toBe(0);
        expect(emp.workedHours).toBe(12);
        expect(emp.requiredHours).toBe(12);
        expect(emp.verdict).toBe('تمام');
        expect(emp.line).toContain('دا 12س');
        expect(emp.line).toContain('تمام');
    });

    test('أهم قاعدة — ما داه لا يقل عن دوامه: 11:54 على وردية 12 = يوم ناقص −6 دقائق', () => {
        const [emp] = aggregateWorkedHours([row({ checkOut: '03:54' })]);
        expect(emp.shortDays).toBe(1);
        expect(emp.completeDays).toBe(0);
        expect(emp.shortfallHours).toBe(0.1);
        expect(emp.verdict).toBe('ناقص');
        expect(emp.line).toContain('ناقص');
    });

    test('موظف وردية 10 ساعات: 10 ساعات بالضبط = تمام (الوردية تختلف من موظف لآخر)', () => {
        const emps = aggregateWorkedHours([
            row({ name: 'موظف_عشرة', shift_hours: 10, shift_start: '09:00', checkIn: '09:00', checkOut: '19:00' }),
            row({ id: 2, name: 'موظف_اثنتا_عشرة', emp_no: 'EMP-002', date: '2026-09-02' }),
        ]);
        const ten = emps.find(x => x.shiftHours === 10);
        const twelve = emps.find(x => x.shiftHours === 12);
        expect(ten.verdict).toBe('تمام');
        expect(ten.workedHours).toBe(10);
        expect(twelve.verdict).toBe('تمام');
    });

    test('زيادة عن الدوام تُحتسب إضافي دون تغيير الحكم', () => {
        const [emp] = aggregateWorkedHours([row({ checkOut: '05:30' })]);
        expect(emp.verdict).toBe('تمام');
        expect(emp.overtimeHours).toBe(1.5);
    });

    test('دخول بدون بصمة خروج = يوم مفتوح لا يُحكم عليه ولا يُحسب ناقص', () => {
        const [emp] = aggregateWorkedHours([row({ checkOut: null })]);
        expect(emp.openDays).toBe(1);
        expect(emp.daysCounted).toBe(0);
        expect(emp.verdict).toBe('بانتظار الانصراف');
    });

    test('دخول = خروج (بصمة مكررة بصفر ساعات) = قيد المراجعة', () => {
        const [emp] = aggregateWorkedHours([row({ checkIn: '16:05', checkOut: '16:05' })]);
        expect(emp.reviewDays).toBe(1);
        expect(emp.verdict).toBe('قيد المراجعة');
    });

    test('أكثر من بصمة في نفس اليوم (وردية مقسمة) تُجمع دقائقها', () => {
        const [emp] = aggregateWorkedHours([
            row({ shift_hours: 10, shift_start: '08:00', checkIn: '08:00', checkOut: '12:00' }),
            row({ shift_hours: 10, shift_start: '08:00', date: '2026-09-01', checkIn: '13:00', checkOut: '19:00' }),
        ]);
        expect(emp.workedHours).toBe(10);
        expect(emp.completeDays).toBe(1);
        expect(emp.verdict).toBe('تمام');
    });

    test('allOk عند المالك: يوم ناقص واحد يُسقط «الدوام تمام» للموظف', () => {
        const emps = aggregateWorkedHours([
            row({ id: 1, name: 'كامل', date: '2026-09-01' }),
            row({ id: 2, name: 'ناقص', date: '2026-09-01', checkOut: '03:00' }), // 11 ساعة على وردية 12
        ]);
        const short = emps.find(x => x.shortDays > 0);
        expect(short.name).toBe('ناقص');
        expect(short.shortfallHours).toBe(1);
        // الترتيب: الناقص أولًا ليظهر للمالك فورًا
        expect(emps[0].name).toBe('ناقص');
    });
});
