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
    // 1. Check unique constraint
    const idx = await p.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'attendance'
        ORDER BY indexname
    `);
    console.log("=== Attendance indexes ===");
    idx.rows.forEach(r => console.log(r.indexname, ":", r.indexdef));

    // 2. Check for duplicate employee+date
    const dups = await p.query(`
        SELECT "employeeId", date, COUNT(*)::int AS cnt
        FROM attendance
        GROUP BY "employeeId", date
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 20
    `);
    console.log("\n=== Duplicate employee+date ===");
    console.log("Count:", dups.rows.length);
    dups.rows.forEach(r => console.log("  emp:", r.employeeId, "date:", r.date, "count:", r.cnt));

    // 3. Check for null checkIn records with checkOut
    const badRows = await p.query(`
        SELECT id, "employeeId", date, "checkIn", "checkOut", notes
        FROM attendance 
        WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL
        ORDER BY date DESC
        LIMIT 10
    `);
    console.log("\n=== checkIn=null, checkOut=not null ===");
    console.log("Count:", badRows.rows.length);
    badRows.rows.forEach(r => console.log("  id:", r.id, "emp:", r.employeeId, "date:", r.date, "checkOut:", r.checkOut, "notes:", r.notes?.substring(0, 50)));

    // 4. Check device sync state
    const sync = await p.query("SELECT * FROM device_sync_state");
    console.log("\n=== Device sync state ===");
    sync.rows.forEach(r => console.log(r));

    // 5. Check devices
    const devs = await p.query("SELECT id, name, ip, port, enabled, last_sync FROM attendance_devices");
    console.log("\n=== Attendance devices ===");
    devs.rows.forEach(r => console.log(r));

    // 6. Check active employees with 0 attendance in Sep
    const zero = await p.query(`
        SELECT e.id, e.name, e."employeeId", e."deviceUserId"
        FROM employees e
        WHERE e.status = 'active'
        AND NOT EXISTS (
            SELECT 1 FROM attendance a 
            WHERE a."employeeId" = e.id AND a.date LIKE '2026-09-%'
        )
        ORDER BY e.name
        LIMIT 20
    `);
    console.log("\n=== Active employees with 0 attendance in Sep ===");
    console.log("Count:", zero.rows.length);
    zero.rows.forEach(r => console.log("  ", r.id, r.name, "empId:", r.employeeId, "device:", r.deviceUserId));

    // 7. Check today's raw logs
    const todayLogs = await p.query(`
        SELECT al."deviceUserId", al."attendanceTime", al."punchState", al."employeeId",
               e.name
        FROM attendance_logs al
        LEFT JOIN employees e ON e.id = al."employeeId"
        WHERE al."attendanceTime" >= '2026-09-25'
        ORDER BY al."attendanceTime" DESC
        LIMIT 20
    `);
    console.log("\n=== Today's raw punch logs ===");
    console.log("Count:", todayLogs.rows.length);
    todayLogs.rows.forEach(r => console.log("  ", r.attendanceTime, "device:", r.deviceUserId, "state:", r.punchState, "emp:", r.name));

    p.end();
}
main().catch(e => { console.error(e); p.end(); });
