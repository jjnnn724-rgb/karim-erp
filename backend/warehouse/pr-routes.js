// ─── مسارات طلبات الشراء (النواقص)
// مُستخرج حرفًا من backend/warehouse-routes.js (السطور 3138-3749).
// الترتيب نفسه ونهايات الأسطر نفسها (CRLF/LF كما وردت) — انظر scripts/_warehouse-split.js
// للحدود المختارة: كل زوج علامات تقطعه اختبارات العقد يبقى داخل نطاق واحد.
const { __scope } = require('../warehouse-routes');
const { crypto, router, pool, riyadhToday, jwtAuth, requireRole, logger, postInventoryLedgerEntry, id, n, round, dateOnly, cleanName, json, emit, fail, signatureHash, requireSignature, getWarehouseLocation, ensureLocationBalance } = __scope;
const { PR_CREATE_ROLES, PR_CANCEL_ROLES, PR_CHEF_ROLES, PR_GM_ROLES, PR_WH_ROLES, PR_READ_ROLES, PR_CHEF_CREATE_ROLES, normalizePRItems, prShortageSuggestion, canPRChefDecide, canPRGMDecide } = require('./purchase-void-routes');

function prRequestNumber() {
    const day = riyadhToday().replace(/-/g, '');
    return `PR-${day}-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function ensurePurchaseRequestSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_requests (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_number TEXT UNIQUE NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by BIGINT, creator_name TEXT, creator_role TEXT,
        chef_approved_by BIGINT, chef_approved_name TEXT, chef_approved_at TIMESTAMPTZ,
        chef_signature_data TEXT, chef_signature_hash TEXT, chef_notes TEXT,
        gm_approved_by BIGINT, gm_approved_name TEXT, gm_approved_at TIMESTAMPTZ,
        gm_signature_data TEXT, gm_signature_hash TEXT, gm_notes TEXT,
        rejected_by BIGINT, rejected_name TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT,
        rejection_signature_data TEXT, rejection_signature_hash TEXT,
        last_event_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_request_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        from_status TEXT, to_status TEXT NOT NULL,
        actor_user_id BIGINT, actor_name TEXT, actor_role TEXT,
        signature_hash TEXT,
        event_payload JSONB NOT NULL DEFAULT '{}',
        previous_event_hash TEXT,
        event_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON purchase_requests(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS purchase_request_events_request_idx ON purchase_request_events(request_id);`);
    // ترحيل آمن: نسخة أقدم من جدول طلبات الشراء قد توجد بأعمدة مختلفة —
    // نضيف أعمدة السلسلة الجديدة دون المساس بالبيانات القائمة.
    for (const ddl of [
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS creator_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS creator_role TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_notes TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS last_event_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_notes TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS received_items JSONB',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dept_code TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dept_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS deliver_mode TEXT',
    ]) { await pool.query(ddl); }
    // ترحيل مفتاح الجدول القديم: نسخة سابقة بلا توليد تلقائي للـ id —
    // نضيف الهوية إن غابت ونزامن التسلسل بعد أقصى id محفوظ.
    await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='purchase_requests' AND column_name='id'
                          AND (column_default IS NOT NULL OR is_identity='YES')) THEN
            ALTER TABLE purchase_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
        END IF;
    END $$;`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('purchase_requests','id'), GREATEST(COALESCE((SELECT MAX(id) FROM purchase_requests), 1), 1));`);
    // ترحيل قيد الحالة: نسخة سابقة تسمح فقط (pending_chef/approved/rejected/converted) —
    // نستبدله بحالات السلسلة الجديدة (pending/chef_approved/approved/partially_fulfilled/fulfilled/rejected/cancelled).
    await pool.query(`DO $$ BEGIN
        ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
        ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
            CHECK (status IN ('pending','chef_approved','approved','partially_fulfilled','fulfilled','rejected','cancelled'));
    END $$;`);
}

async function appendPREvent(client, requestId, eventType, fromStatus, toStatus, req, signature, payload = {}) {
    const previous = (await client.query('SELECT event_hash FROM purchase_request_events WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [requestId])).rows[0]?.event_hash || null;
    const actorName = req.user?.name || req.user?.username || String(req.user?.id || 'unknown');
    const actorRole = req.user?.role || 'unknown';
    const canonical = JSON.stringify({ requestId, eventType, fromStatus, toStatus, actorUserId: req.user?.id || null, actorName, actorRole, signatureHash: signatureHash(signature), eventPayload: payload || {}, previous });
    const eventHash = crypto.createHash('sha256').update(canonical).digest('hex');
    const row = (await client.query(`INSERT INTO purchase_request_events(request_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,signature_hash,event_payload,previous_event_hash,event_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [requestId, eventType, fromStatus || null, toStatus, req.user?.id || null, actorName, actorRole, signatureHash(signature), json(payload || {}), previous, eventHash])).rows[0];
    await client.query('UPDATE purchase_requests SET last_event_hash=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [eventHash, requestId]);
    return row;
}

function prStatusCode(code) {
    return {
        PR_NOT_FOUND: [404, 'طلب الشراء غير موجود'],
        PR_CHEF_APPROVAL_REQUIRED: [409, 'طلب الشراء بانتظار توقيع الشيف أولًا'],
        PR_CHEF_DECIDED: [409, 'الشيف بتّ في هذا الطلب مسبقًا'],
        PR_ALREADY_APPROVED: [409, 'طلب الشراء معتمد نهائيًا مسبقًا'],
        PR_REJECTED: [409, 'طلب الشراء مرفوض'],
        PR_CANCELLED: [409, 'طلب الشراء ملغي'],
        PR_SELF_APPROVAL: [409, 'لا يجوز أن يعتمد المدير العام طلبًا وقّعه هو كشيف — يلزم توقيعان مختلفان'],
        PR_INVALID_STATUS: [409, 'حالة طلب الشراء لا تسمح بهذا الإجراء'],
    }[code] || [409, 'تعذر تنفيذ الإجراء على طلب الشراء'];
}

// نواقص المخزن: الأصناف التي بلغت الحد الأدنى أو تحته + الكمية المقترحة للشراء
router.get('/purchase-requests/shortages', jwtAuth, requireRole(...PR_READ_ROLES), async (req, res) => {
    try {
        const r = await pool.query(`SELECT id, name, unit, COALESCE(qty,0) AS qty, COALESCE("minQty",0) AS "minQty" 
            FROM inventory WHERE COALESCE(qty,0) < COALESCE("minQty",0)
            ORDER BY (COALESCE("minQty",0) - COALESCE(qty,0)) DESC NULLS LAST, name LIMIT 200`);
        res.json(r.rows.map(row => ({
            itemId: Number(row.id),
            itemName: row.name,
            unit: row.unit || 'وحدة',
            currentQty: Number(row.qty),
            minQty: Number(row.minQty),
            suggestedQty: prShortageSuggestion(row.qty, row.minQty),
        })));
    } catch (error) {
        logger.error('[pr_shortages]', error);
        res.status(500).json({ error: 'PR_SHORTAGES_FAILED', message: 'تعذر جلب نواقص المخزن' });
    }
});

router.get('/purchase-requests', jwtAuth, requireRole(...PR_READ_ROLES), async (req, res) => {
    try {
        await ensurePurchaseRequestSchema();
        const r = await pool.query('SELECT * FROM purchase_requests ORDER BY created_at DESC LIMIT 200');
        res.json(r.rows);
    } catch (error) {
        logger.error('[pr_list]', error);
        res.status(500).json({ error: 'PR_LIST_FAILED', message: 'تعذر جلب طلبات الشراء' });
    }
});

// إنشاء أمين المخزن: أصناف تلقائية + يدوية مدمجة — يبدأ pending بانتظار الشيف
router.post('/purchase-requests', jwtAuth, requireRole(...PR_CREATE_ROLES), async (req, res) => {
    // الشيف (kitchen/sous_chef) ينشئ الطلب موقّعًا من نفسه — يدخل للمخزن مباشرة
    // بحالة chef_approved بدل انتظار توقيع شيف آخر. بقية الأدوار كما كانت (pending).
    const isChefCreator = PR_CHEF_CREATE_ROLES.includes(req.user.role);
    let chefSignature = null;
    if (isChefCreator) {
        chefSignature = requireSignature(req, res);
        if (!chefSignature) {return;}
    }
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        const items = normalizePRItems(req.body?.items);
        if (!items.length) {return fail(res, 422, 'PR_ITEMS_REQUIRED', 'أضف صنفًا واحدًا على الأقل بكمية موجبة (من النواقص أو يدويًا)');}
        if (items.length > 200) {return fail(res, 422, 'PR_TOO_MANY_ITEMS', 'عدد الأصناف كبير — قسم الطلب على دفعات');}
        await client.query('BEGIN');
        // إثراء تلقائي: الرصيد والحد الأدنى والوحدة من بطاقة الصنف عند توفرها
        for (const it of items) {
            const row = it.itemId
                ? (await client.query('SELECT id,name,unit,qty,"minQty" FROM inventory WHERE id=$1', [it.itemId])).rows[0]
                : (await client.query('SELECT id,name,unit,qty,"minQty" FROM inventory WHERE LOWER(name)=LOWER($1) LIMIT 1', [it.itemName])).rows[0];
            if (row) {
                it.itemId = Number(row.id);
                it.itemName = row.name;
                it.unit = row.unit || it.unit || 'وحدة';
                it.currentQty = Number(row.qty);
                it.minQty = Number(row.minQty);
            }
        }
        const actorName = req.user.name || req.user.username || String(req.user.id);
        // القسم الطالب: يُحفظ مع الطلب (يُستخدم للتسليم المباشر والتكلفة) — إصلاح 2026-10-01:
        // كان يُرسَل من الواجهة ويُرمى هنا (null دائمًا) فيفشل التسليم المباشر لاحقًا
        let deptCode = null, deptName = null;
        const dcRaw = cleanName(req.body?.deptCode || req.body?.dept_code);
        if (dcRaw) {
            const dep = (await client.query(
                'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1', [dcRaw])).rows[0];
            if (!dep) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_DEPT_UNKNOWN', 'القسم الطالب غير مسجل في دليل الأقسام');
            }
            deptCode = dep.code; deptName = dep.name;
        }
        const chefAt = new Date().toISOString();
        // UPGRADE 2026-10-04 (أمر المالك): طلب المطبخ الموقّع من الشيف = نهائي
        // (status='approved') — يروح المخزن مباشرة بدون مرحلة المدير العام.
        const inserted = (await client.query(`INSERT INTO purchase_requests(request_number,items,notes,status,created_by,creator_name,creator_role,dept_code,dept_name,
          chef_approved_by, chef_approved_name, chef_approved_at, chef_signature_data, chef_signature_hash, chef_notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [prRequestNumber(), json(items), cleanName(req.body?.notes) || null,
           isChefCreator ? 'approved' : 'pending',
           req.user.id, actorName, req.user.role, deptCode, deptName,
           isChefCreator ? req.user.id : null,
           isChefCreator ? actorName : null,
           isChefCreator ? chefAt : null,
           isChefCreator ? chefSignature : null,
           isChefCreator ? signatureHash(chefSignature) : null,
           isChefCreator ? (cleanName(req.body?.notes) || null) : null])).rows[0];
        await appendPREvent(client, inserted.id, isChefCreator ? 'chef_approved' : 'created', null, inserted.status, req, isChefCreator ? chefSignature : null, { items, notes: req.body?.notes || null, chefCreated: isChefCreator, chefFinal: isChefCreator });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'create', inserted);
        res.status(201).json(inserted);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        res.status(500).json({ error: 'PR_CREATE_FAILED', message: 'تعذر إنشاء طلب الشراء' });
    } finally { client.release(); }
});

// توقيع الشيف (الخطوة الأولى) — بتوقيع صاحب الحساب حصرًا عبر requireSignature
router.post('/purchase-requests/:id/chef-approve', jwtAuth, requireRole(...PR_CHEF_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRChefDecide(pr);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='chef_approved',
          chef_approved_by=$1, chef_approved_name=$2, chef_approved_at=$3,
          chef_signature_data=$4, chef_signature_hash=$5, chef_notes=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, signature, signatureHash(signature), cleanName(req.body?.notes) || null, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'chef_approved', pr.status, 'chef_approved', req, signature, { notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_chef_approve]', error);
        res.status(500).json({ error: 'PR_CHEF_APPROVE_FAILED', message: 'تعذر توقيع الشيف على طلب الشراء' });
    } finally { client.release(); }
});

router.post('/purchase-requests/:id/chef-reject', jwtAuth, requireRole(...PR_CHEF_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = cleanName(req.body?.reason);
    if (!reason || reason.length < 3) {return fail(res, 422, 'PR_REASON_REQUIRED', 'سبب الرفض مطلوب (3 أحرف على الأقل)');}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRChefDecide(pr);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='rejected',
          rejected_by=$1, rejected_name=$2, rejected_at=$3, rejection_reason=$4,
          rejection_signature_data=$5, rejection_signature_hash=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, reason, signature, signatureHash(signature), pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'chef_rejected', pr.status, 'rejected', req, signature, { reason });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_chef_reject]', error);
        res.status(500).json({ error: 'PR_CHEF_REJECT_FAILED', message: 'تعذر رفض طلب الشراء' });
    } finally { client.release(); }
});

// اعتماد المدير العام (نهائي) — بعد توقيع الشيف، وبتوقيع مختلف عنه
router.post('/purchase-requests/:id/gm-approve', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRGMDecide(pr, req.user);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='approved',
          gm_approved_by=$1, gm_approved_name=$2, gm_approved_at=$3,
          gm_signature_data=$4, gm_signature_hash=$5, gm_notes=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, signature, signatureHash(signature), cleanName(req.body?.notes) || null, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'gm_approved', pr.status, 'approved', req, signature, { notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_gm_approve]', error);
        res.status(500).json({ error: 'PR_GM_APPROVE_FAILED', message: 'تعذر اعتماد المدير العام لطلب الشراء' });
    } finally { client.release(); }
});

router.post('/purchase-requests/:id/gm-reject', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = cleanName(req.body?.reason);
    if (!reason || reason.length < 3) {return fail(res, 422, 'PR_REASON_REQUIRED', 'سبب الرفض مطلوب (3 أحرف على الأقل)');}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (pr.status !== 'chef_approved') {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(pr.status === 'approved' ? 'PR_ALREADY_APPROVED' : pr.status === 'rejected' ? 'PR_REJECTED' : pr.status === 'cancelled' ? 'PR_CANCELLED' : 'PR_INVALID_STATUS');
            return fail(res, status, 'PR_NOT_REJECTABLE', message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='rejected',
          rejected_by=$1, rejected_name=$2, rejected_at=$3, rejection_reason=$4,
          rejection_signature_data=$5, rejection_signature_hash=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, reason, signature, signatureHash(signature), pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'gm_rejected', pr.status, 'rejected', req, signature, { reason });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_gm_reject]', error);
        res.status(500).json({ error: 'PR_GM_REJECT_FAILED', message: 'تعذر رفض طلب الشراء' });
    } finally { client.release(); }
});

// استلام المخزن (الخطوة الأخيرة): توقيع أمين المخزن + دخول البضاعة للمخزون
router.post('/purchase-requests/:id/warehouse-receive', jwtAuth, requireRole(...PR_WH_ROLES), async (req, res) => {
    // مغلق بأمر المالك (2026-10-01): الطلب ينتهي باعتماد المدير العام نهائيًا —
    // البضاعة تدخل المخزون عبر فواتير المشتريات (استلام هنا كان ازدواجًا)
    return fail(res, 410, 'PR_RECEIVE_RETIRED', 'دورة طلب الشراء تنتهي باعتماد المدير العام — سجّل البضاعة بفاتورة مشتريات');
});

// ─── محفوظ ومعطل بأمر المالك (2026-10-01): منطق استلام المخزن القديم ─────────
// أُوقف لمنع ازدواج دخول البضاعة (استلام + فاتورة). يُعاد التفعيل بمناداة هذه
// الدالة من المسار أعلاه فقط — لا تُستدعى من أي مكان حاليًا.
// eslint-disable-next-line no-unused-vars
async function _retiredPRReceive(req, res) {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        // الاستلام الجزئي مسموح: approved أو partially_fulfilled — الباقي يُستلم لاحقًا
        if (!['approved', 'partially_fulfilled'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_RECEIVABLE', 'الاستلام بعد الاعتماد النهائي للمدير العام فقط');
        }
        // جولة الاستلام الحالية (لمفتاح عدم التكرار) + المستلم سابقًا تراكميًا
        const priorRounds = (await client.query(
            `SELECT COUNT(*)::int AS c FROM purchase_request_events WHERE request_id=$1 AND event_type='warehouse_received'`, [pr.id])).rows[0]?.c || 0;
        const roundNo = priorRounds + 1;
        const priorReceived = new Map();
        for (const r of (Array.isArray(pr.received_items) ? pr.received_items : [])) {
            const k = cleanName(r.itemName || r.name).toLowerCase();
            if (k) {priorReceived.set(k, { qty: n(r.receivedQty), packagingQty: r.receivedPackagingQty != null ? n(r.receivedPackagingQty) : null });}
        }
        const reqItems = Array.isArray(pr.items) ? pr.items : [];
        const got = new Map();
        for (const raw of (Array.isArray(req.body?.items) ? req.body.items : [])) {
            const name = cleanName(raw.itemName || raw.name);
            const qty = n(raw.receivedQty ?? raw.qty, NaN);
            if (!name || !Number.isFinite(qty) || qty < 0) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_QTY_INVALID', `كمية استلام غير صحيحة للصنف ${name || '؟'}`);
            }
            const pkgRaw = raw.receivedPackagingQty ?? raw.packagingQty ?? null;
            const pkg = pkgRaw === null || pkgRaw === undefined || pkgRaw === '' ? null : n(pkgRaw, NaN);
            if (pkg !== null && (!Number.isFinite(pkg) || pkg < 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_PACKAGING_INVALID', `عدد كراتين الاستلام غير صحيح للصنف ${name}`);
            }
            got.set(name.toLowerCase(), {
                name, qty: round(qty), unitCost: n(raw.unitCost, 0),
                direct: raw.direct === true ? true : (raw.direct === false ? false : null),
                packagingQty: pkg,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom) || null,
            });
        }
        if (!got.size) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PR_RECEIVE_EMPTY', 'حدد الكميات المستلمة لكل صنف');
        }
        // وضع التسليم: مخزن (دخول مخزني) أو مباشر للقسم (مصروف فوري بلا مخزون)
        const deliverMode = String(req.body?.deliverMode || 'stock').trim().toLowerCase() === 'direct' ? 'direct' : 'stock';
        let recvDept = pr.dept_code ? { code: pr.dept_code, name: pr.dept_name || pr.dept_code } : null;
        if (deliverMode === 'direct' && !recvDept) {
            const dc = String(req.body?.deptCode || '').trim();
            const row = dc ? (await client.query(
                'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1', [dc])).rows[0] : null;
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_DEPT_REQUIRED', 'التسليم المباشر يحتاج قسمًا مستلمًا مسجلًا في الطلب');
            }
            recvDept = { code: row.code, name: row.name };
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const receivedItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let anyPositive = false;
        for (const it of reqItems) {
            const key = cleanName(it.itemName || it.name || '').toLowerCase();
            const g = got.get(key);
            if (!g) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_INCOMPLETE', `سجّل المستلم لكل صنف (حتى لو صفر): ${it.itemName || it.name}`);
            }
            const want = n(it.requestedQty ?? it.qty);
            const alreadyIn = priorReceived.get(key)?.qty || 0;
            // السقف تراكمي عبر الجولات: المستلم الآن + السابق ≤ المطلوب
            if (round(g.qty + alreadyIn) > want) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'PR_RECEIVE_EXCEEDED', `المستلم من ${g.name} أكبر من المتبقي (${round(want - alreadyIn)})`);
            }
            const alreadyPkg = priorReceived.get(key)?.packagingQty;
            if (g.qty <= 0) {
                receivedItems.push({ itemName: it.itemName || it.name, requestedQty: want, receivedQty: alreadyIn,
                    ...(alreadyPkg != null ? { receivedPackagingQty: alreadyPkg } : {}) });
                continue;
            }
            anyPositive = true;
            const unitCost = n(g.unitCost, n(it.unitCost, 0));
            if (unitCost < 0) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_COST_INVALID', `سعر الشراء لا يمكن أن يكون سالبًا للصنف ${g.name}`);
            }
            // مباشر per صنف يتجاوز وضع الطلب العام (خضار/دجاج طازج مباشر + جاف مخزن)
            const isDirect = g.direct === null || g.direct === undefined ? deliverMode === 'direct' : g.direct;
            // تسليم مباشر للقسم: مصروف فوري على القسم ولا حركة مخزنية إطلاقًا
            if (isDirect) {
                if (!(unitCost > 0)) {
                    await client.query('ROLLBACK');
                    return fail(res, 422, 'PR_DIRECT_COST_REQUIRED', `سعر الشراء مطلوب للصنف ${g.name} في التسليم المباشر`);
                }
                const value = round(g.qty * unitCost, 2);
                const expense = (await client.query(
                    `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                     VALUES ($1,$2,$3,$4,$5,$6,true,'مشتريات مباشرة','purchase_direct') RETURNING *`,
                    [id(), recvDept.code, `شراء مباشر - ${g.name} (${g.qty} ${it.unit || 'وحدة'})`, value,
                        dateOnly(new Date()), `طلب الشراء ${pr.request_number} — تسليم مباشر للقسم`]
                )).rows[0];
                receivedItems.push({ itemName: g.name, unit: it.unit || 'وحدة', requestedQty: want, receivedQty: round(alreadyIn + g.qty), receivedThisRound: g.qty, unitCost, totalValue: value, delivered: 'direct' });
                expenses.push(expense);
                continue;
            }
            let inv = it.itemId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [it.itemId])).rows[0]
                : (await client.query('SELECT * FROM inventory WHERE LOWER(name)=LOWER($1) FOR UPDATE', [g.name])).rows[0];
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
                     VALUES ($1,$2,$3,$4,0,$5,0) RETURNING *`,
                    [id(), g.name, 'مشتريات', it.unit || 'وحدة', unitCost]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            const prPkgUom = g.packagingQty !== null && g.packagingQty !== undefined ? (g.packagingUom || inv.packaging_uom || 'كرتون') : null;
            const posted = await postInventoryLedgerEntry(client, {
                transactionType: 'transfer_in', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: g.qty, unit: inv.unit || it.unit || 'وحدة', unitCost,
                destinationLocationId: mainLocation.id,
                referenceType: 'purchase_request', referenceId: String(pr.id), userId: req.user.id,
                idempotencyKey: `pr-receive:${pr.id}:${inv.id}:r${roundNo}`,
                reason: `استلام مشتريات ${pr.request_number} — ${g.name}`,
                metadata: { pr_id: pr.id, request_number: pr.request_number, receive_round: roundNo,
                    ...(g.packagingQty !== null && g.packagingQty !== undefined ? { packaging_qty: g.packagingQty, packaging_uom: prPkgUom } : {}) },
                catchWeightQty: g.packagingQty ?? null, catchWeightUnit: prPkgUom,
            });
            if (posted.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'PR_ALREADY_RECEIVED', `استلام ${g.name} مسجل مسبقًا — حدّث الصفحة قبل إعادة المحاولة`);
            }
            // المتوسط المرجح يشمل الكمية المستلمة بسعرها
            const prOldQty = n(inv.qty);
            if (round(prOldQty + g.qty) > 0) {
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1',
                    [inv.id, round(((prOldQty * n(inv.avgCost)) + (g.qty * unitCost)) / round(prOldQty + g.qty), 2)]);
            }
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, g.qty, dateOnly(new Date()), unitCost, round(g.qty * unitCost, 2),
                    `استلام طلب الشراء ${pr.request_number}`, pr.request_number, g.packagingQty ?? null, prPkgUom]
            )).rows[0];
            const cumPkg = (alreadyPkg ?? 0) + (g.packagingQty ?? 0);
            receivedItems.push({ itemName: inv.name, itemId: Number(inv.id), unit: inv.unit, requestedQty: want,
                receivedQty: round(alreadyIn + g.qty), receivedThisRound: g.qty, unitCost, delivered: 'stock',
                ...(cumPkg > 0 || alreadyPkg != null ? { receivedPackagingQty: round(cumPkg, 3), packagingUom: prPkgUom } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
        }
        if (!anyPositive) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PR_RECEIVE_ALL_ZERO', 'استلم صنفًا واحدًا على الأقل بكمية موجبة');
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const modes = new Set(receivedItems.map(x => x.delivered || 'stock'));
        const finalMode = modes.size > 1 ? 'mixed' : (modes.has('direct') ? 'direct' : 'stock');
        // مكتمل فقط إذا استُلمت كل الأصناف كاملة تراكميًا — وإلا يبقى قابلًا للاستلام
        const fullyReceived = reqItems.every(it => {
            const k = cleanName(it.itemName || it.name || '').toLowerCase();
            const want = n(it.requestedQty ?? it.qty);
            const gotRow = receivedItems.find(r => cleanName(r.itemName).toLowerCase() === k);
            return gotRow && Number(gotRow.receivedQty) >= want;
        });
        const nextStatus = fullyReceived ? 'fulfilled' : 'partially_fulfilled';
        const updated = (await client.query(`UPDATE purchase_requests SET status=$1,
          wh_received_by=$2, wh_received_name=$3, wh_received_at=$4,
          wh_signature_data=$5, wh_signature_hash=$6, wh_notes=$7, received_items=$8, deliver_mode=$9,
          updated_at=CURRENT_TIMESTAMP WHERE id=$10 RETURNING *`,
          [nextStatus, req.user.id, actorName, at, signature, signatureHash(signature),
              cleanName(req.body?.notes) || null, json(receivedItems), finalMode, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'warehouse_received', pr.status, nextStatus, req, signature, { receivedItems, deliverMode: finalMode, receiveRound: roundNo });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ ...updated, stockChanges, transactions, expenses, deliverMode: finalMode });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error({ err: error.message, stack: String(error.stack || '').slice(0, 500) }, '[pr_wh_receive]');
        res.status(500).json({ error: 'PR_RECEIVE_FAILED', message: 'تعذر تسجيل استلام المخزن' });
    } finally { client.release(); }
}

// إلغاء طلب معلّق (صاحبه أو الإدارة) — قبل أي توقيع
router.post('/purchase-requests/:id/cancel', jwtAuth, requireRole(...PR_CANCEL_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (!['pending','chef_approved'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_CANCELLABLE', 'لا يمكن إلغاء طلب تمّ اعتماده من المدير العام');
        }
        if (!['admin', 'manager'].includes(req.user.role) && Number(pr.created_by) !== Number(req.user.id)) {
            await client.query('ROLLBACK');
            return fail(res, 403, 'PR_CANCEL_FORBIDDEN', 'لا يجوز إلغاء طلب أنشأه مستخدم آخر');
        }
        const updated = (await client.query(`UPDATE purchase_requests SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'cancelled', pr.status, 'cancelled', req, null, {});
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_cancel]', error);
        res.status(500).json({ error: 'PR_CANCEL_FAILED', message: 'تعذر إلغاء طلب الشراء' });
    } finally { client.release(); }
});

// حذف نهائي لطلب شراء (تنظيف) — الإدارة فقط، وللطلبات التي لم تصل للمخزون.
// المعتمدة نهائيًا/المستلمة محمية (لها أثر مخزني ومالي) — تُعالج بالاستلام/الارتجاع لا بالحذف.
// يُسجل حدث 'deleted' أولًا فيبقى أثر المراجعة بعد زوال الصف.
router.delete('/purchase-requests/:id', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (['approved', 'partially_fulfilled', 'fulfilled'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_DELETABLE', 'لا يجوز حذف طلب معتمد أو مستلم (ولو جزئيًا) — له أثر مخزني');
        }
        await appendPREvent(client, pr.id, 'deleted', pr.status, 'deleted', req, null, { request_number: pr.request_number });
        await client.query('DELETE FROM purchase_requests WHERE id=$1', [pr.id]);
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'delete', { id: pr.id, request_number: pr.request_number });
        res.json({ ok: true, id: pr.id });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_delete]', error);
        res.status(500).json({ error: 'PR_DELETE_FAILED', message: 'تعذر حذف طلب الشراء' });
    } finally { client.release(); }
});



module.exports = {};
