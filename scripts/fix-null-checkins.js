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

const BUSINESS_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
const proto = require('../backend/zkteco/protocol');
const IN_STATES = proto.CHECK_IN_STATES;

async function main() {
    // Find all bad rows: checkIn=null, checkOut=not null
    const bad = await p.query(`
        SELECT id, "employeeId", date, "checkIn", "checkOut", "checkOutAt", notes
        FROM attendance 
        WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL
        ORDER BY date DESC
    `);
    console.log(`Found ${bad.rows.length} bad rows (checkIn=null, checkOut=not null)`);

    let fixed = 0;
    let deleted = 0;
    let unresolved = 0;

    for (const row of bad.rows) {
        const [y, mo, d] = row.date.split('-').map(Number);
        const dayStart = new Date(Date.UTC(y, mo - 1, d) - BUSINESS_TZ_OFFSET_MS);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const logs = await p.query(`
            SELECT "attendanceTime", "punchState"
            FROM attendance_logs
            WHERE "employeeId" = $1
              AND "attendanceTime" >= $2
              AND "attendanceTime" < $3
            ORDER BY "attendanceTime"
        `, [row.employeeId, dayStart, dayEnd]);

        const checkOutAt = new Date(row.checkOutAt);
        const inPunches = logs.rows.filter(l =>
            IN_STATES.has(Number(l.punchState)) && new Date(l.attendanceTime) < checkOutAt
        );

        if (inPunches.length > 0) {
            const inPunch = inPunches[0];
            const inTime = new Date(inPunch.attendanceTime);
            const shifted = new Date(inTime.getTime() + BUSINESS_TZ_OFFSET_MS);
            const hh = String(shifted.getUTCHours()).padStart(2, '0');
            const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
            const checkIn = `${hh}:${mm}`;
            const minutes = Math.max(0, Math.round((checkOutAt - inTime) / 60000));

            await p.query(`
                UPDATE attendance
                SET "checkIn" = $1, "checkInAt" = $2, "workMinutes" = COALESCE($3, "workMinutes"),
                    notes = COALESCE(notes, '') || ' | دخول مسترد من سجل البصمات (إصلاح)'
                WHERE id = $4
            `, [checkIn, inTime, minutes, row.id]);
            console.log(`  FIXED: emp=${row.employeeId} date=${row.date} checkIn=${checkIn} checkOut=${row.checkOut}`);
            fixed++;
        } else if (logs.rows.length === 0) {
            await p.query('DELETE FROM attendance WHERE id = $1', [row.id]);
            console.log(`  DELETED (orphan): emp=${row.employeeId} date=${row.date} checkOut=${row.checkOut}`);
            deleted++;
        } else {
            // There are punches but none classified as check-in before checkout
            // Use the earliest punch as check-in (device likely misclassified)
            const earliest = logs.rows[0];
            const inTime = new Date(earliest.attendanceTime);
            if (inTime < checkOutAt) {
                const shifted = new Date(inTime.getTime() + BUSINESS_TZ_OFFSET_MS);
                const hh = String(shifted.getUTCHours()).padStart(2, '0');
                const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
                const checkIn = `${hh}:${mm}`;
                const minutes = Math.max(0, Math.round((checkOutAt - inTime) / 60000));

                await p.query(`
                    UPDATE attendance
                    SET "checkIn" = $1, "checkInAt" = $2, "workMinutes" = COALESCE($3, "workMinutes"),
                        checkin_inferred = false,
                        notes = COALESCE(notes, '') || ' | دخول مستدل من أول بصمة باليوم (إصلاح)'
                    WHERE id = $4
                `, [checkIn, inTime, minutes, row.id]);
                console.log(`  INFERRED: emp=${row.employeeId} date=${row.date} checkIn=${checkIn} (from punchState=${earliest.punchState})`);
                fixed++;
            } else {
                console.log(`  UNRESOLVED: emp=${row.employeeId} date=${row.date} — all punches after checkout`);
                unresolved++;
            }
        }
    }

    console.log(`\nSummary: fixed=${fixed}, deleted=${deleted}, unresolved=${unresolved}`);
    p.end();
}
main().catch(e => { console.error(e); p.end(); });
