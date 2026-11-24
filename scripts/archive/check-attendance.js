require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
    max: 1
});

async function main() {
    // 1. Total attendance records
    const total = await p.query("SELECT COUNT(*)::int AS total, MIN(date) AS first_date, MAX(date) AS last_date FROM attendance");
    console.log("Total attendance rows:", total.rows[0]);

    // 2. Recent dates
    const dates = await p.query("SELECT date, COUNT(*)::int AS punches FROM attendance GROUP BY date ORDER BY date DESC LIMIT 15");
    console.log("Recent dates:", dates.rows);

    // 3. Active employees
    const emp = await p.query("SELECT COUNT(*)::int AS active_emp FROM employees WHERE status='active'");
    console.log("Active employees:", emp.rows[0]);

    // 4. Sep 2026 data
    const sep = await p.query("SELECT COUNT(*)::int AS sep_rows FROM attendance WHERE date LIKE '2026-09-%'");
    console.log("September 2026:", sep.rows[0]);

    // 5. Aug 2026 data
    const aug = await p.query("SELECT COUNT(*)::int AS aug_rows FROM attendance WHERE date LIKE '2026-08-%'");
    console.log("August 2026:", aug.rows[0]);

    // 6. Check if attendance_logs has recent data (raw punches)
    const logs = await p.query("SELECT COUNT(*)::int AS total_logs, MAX(\"attendanceTime\") AS last_punch FROM attendance_logs");
    console.log("Raw punch logs:", logs.rows[0]);

    // 7. Recent punch logs
    const recentLogs = await p.query("SELECT DATE(\"attendanceTime\") AS day, COUNT(*)::int AS cnt FROM attendance_logs GROUP BY DATE(\"attendanceTime\") ORDER BY day DESC LIMIT 10");
    console.log("Recent punch days:", recentLogs.rows);

    // 8. Today's attendance
    const today = await p.query("SELECT e.name, a.date, a.\"checkIn\", a.\"checkOut\", a.late, a.on_leave FROM attendance a JOIN employees e ON e.id = a.\"employeeId\" WHERE a.date = '2026-09-25' ORDER BY e.name LIMIT 20");
    console.log("Today (2026-09-25):", today.rows.length, "records");
    today.rows.forEach(r => console.log("  ", r.name, r.checkIn, "->", r.checkOut, r.late ? "LATE" : "", r.on_leave ? "LEAVE" : ""));

    // 9. Check schema of attendance table
    const cols = await p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='attendance' ORDER BY ordinal_position");
    console.log("\nAttendance columns:");
    cols.rows.forEach(r => console.log("  ", r.column_name, ":", r.data_type));

    // 10. Monthly summary test
    const { buildMonthlyAttendanceSummaryQuery } = require('../backend/monthly-attendance-query');
    const monthData = await p.query(buildMonthlyAttendanceSummaryQuery(), ['2026-09']);
    console.log("\nMonthly summary 2026-09:", monthData.rows.length, "employees");
    monthData.rows.slice(0, 5).forEach(r => console.log("  ", r.name, "days:", r.days, "present:", r.present, "late:", r.late, "minutes:", r.minutes));

    p.end();
}
main().catch(e => { console.error(e); p.end(); });
