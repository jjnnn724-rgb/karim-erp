'use strict';
/* قراءة فقط: محاكاة قاعدة البديل الآمن — uid سجلّ صاحبه إن لم يكن معرّفًا أساسيًا حيًّا لأحد، وإلا NULL. */
const { pool } = require('./backend/shared-pool');

const SIM = `
WITH roster AS (
    SELECT uid::text AS uid, "userId" AS userid, name
      FROM zk_device_users WHERE "deviceId" = 1
),
dup AS (
    SELECT userid, count(*) n FROM roster GROUP BY userid HAVING count(*) > 1
),
own AS (
    SELECT e.id AS emp_id, e."employeeId" AS code, e.name AS emp_name,
           e."deviceUserId" AS v, e."deviceUserIdAlt" AS alt,
           array_agg(r.uid ORDER BY r.uid) FILTER (WHERE r.uid IS NOT NULL) AS own_uids,
           string_agg(DISTINCT r.name, ',') AS dev_names
      FROM employees e
      LEFT JOIN roster r ON r.userid = e."deviceUserId"
     WHERE e."deviceUserId" IS NOT NULL AND e."deviceUserId" <> ''
     GROUP BY e.id, e."employeeId", e.name, e."deviceUserId", e."deviceUserIdAlt"
),
prim AS (
    SELECT "deviceUserId" AS v, min(id) AS owner_id FROM employees
     WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> '' GROUP BY "deviceUserId"
),
desired AS (
    SELECT o.*,
        CASE
            WHEN o.own_uids IS NULL                 THEN NULL   -- لا سجل في الجهاز
            WHEN cardinality(o.own_uids) > 1        THEN NULL   -- تكرار تسجيل ⇒ غير قابل للإثبات
            WHEN o.own_uids[1] = o.v                THEN NULL   -- المعرفان سيان
            WHEN o.own_uids[1] IN (SELECT v FROM prim) THEN NULL -- مملوك أساسيًا لحيّ
            ELSE o.own_uids[1]
        END AS want
    FROM own o
)
SELECT
    (SELECT count(*) FROM dup) AS dup_userid_rows,
    count(*) AS linked,
    count(*) FILTER (WHERE own_uids IS NULL) AS no_roster,
    count(*) FILTER (WHERE cardinality(own_uids) > 1) AS multi_roster,
    count(*) FILTER (WHERE alt IS DISTINCT FROM want) AS will_change,
    count(*) FILTER (WHERE alt IS DISTINCT FROM want AND want IS NULL) AS to_null,
    count(*) FILTER (WHERE alt IS DISTINCT FROM want AND want IS NOT NULL) AS to_uid,
    count(*) FILTER (WHERE alt = want) AS already_right,
    count(*) FILTER (WHERE alt IS NOT NULL AND alt <> '' AND alt IN (SELECT v FROM prim p WHERE p.owner_id <> emp_id)) AS alt_is_others_primary
FROM desired`;

(async () => {
    const s = (await pool.query(SIM)).rows[0];
    console.log('=== المحاكاة ===');
    console.log(JSON.stringify(s, null, 2));

    const list = await pool.query(`
WITH roster AS (SELECT uid::text AS uid, "userId" AS userid, name FROM zk_device_users WHERE "deviceId" = 1),
own AS (
    SELECT e.id AS emp_id, e."employeeId" AS code, e.name AS emp_name, e."deviceUserId" AS v,
           COALESCE(NULLIF(btrim(e."deviceUserIdAlt"),''),NULL) AS alt,
           array_agg(r.uid ORDER BY r.uid) FILTER (WHERE r.uid IS NOT NULL) AS own_uids,
           string_agg(DISTINCT r.name, ',') AS dev_names
      FROM employees e LEFT JOIN roster r ON r.userid = e."deviceUserId"
     WHERE e."deviceUserId" IS NOT NULL AND e."deviceUserId" <> ''
     GROUP BY e.id, e."employeeId", e.name, e."deviceUserId", alt
),
prim AS (SELECT "deviceUserId" AS v, min(id) AS owner_id FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> '' GROUP BY "deviceUserId"),
d AS (
    SELECT o.*, CASE
        WHEN o.own_uids IS NULL THEN NULL
        WHEN cardinality(o.own_uids) > 1 THEN NULL
        WHEN o.own_uids[1] = o.v THEN NULL
        WHEN o.own_uids[1] IN (SELECT v FROM prim) THEN NULL
        ELSE o.own_uids[1] END AS want
    FROM own o
)
SELECT d.* FROM d WHERE alt IS DISTINCT FROM want ORDER BY code`);
    console.log(`\n=== من سيُغيَّر (${list.rowCount}) ===`);
    for (const r of list.rows) {
        const collide = r.alt ? `· البديل الحالي معرّف أساسيّ لغيري=${r.alt}` : '· بلا بديل';
        console.log(`${r.code} id=${r.emp_id} ${r.emp_name} | v=${r.v} alt=${r.alt || '—'} ⇒ ${r.want || 'NULL'} (${collide}) سجل:[${r.dev_names || '—'}] uids:[${(r.own_uids || []).join(',') || '—'}]`);
    }
    await pool.end();
})().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
