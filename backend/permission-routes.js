'use strict';

/**
 * permission-routes.js — User permission grants (admin assigns, user sees own).
 * ────────────────────────────────────────────────────────────────────────────
 *   GET  /api/permissions/catalog        الكتالوج (admin+)
 *   GET  /api/permissions/users/:id      منح مستخدم (admin+)
 *   PUT  /api/permissions/users/:id      تعيين المنح {grants[], reason} (admin, audit)
 *   GET  /api/permissions/me             صلاحياتي الفعالة (أي مصادق)
 *
 * Grants are additive over roles. Only admin can assign (managers keep
 * ROLE_ASSIGNMENT_FORBIDDEN semantics — no privilege escalation path).
 */

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { PERMISSIONS, PERM_MAP, menusForGrants, menusForDenies, getUserPerms, getUserGrants, invalidateUser } = require('./permissions');

const router = express.Router();
const ADMIN_ONLY = ['admin'];

function fail(res, status, error, message) {
    return res.status(status).json({ error, message });
}

router.get('/catalog', jwtAuth, requireRole(...ADMIN_ONLY), async (req, res) => {
    try {
        res.json(PERMISSIONS.map((p) => ({
            key: p.key, ar: p.ar, group: p.group, menus: p.menus,
            entitiesRead: p.entitiesRead, entitiesWrite: p.entitiesWrite,
        })));
    } catch (error) {
        logger.error('[permissions/catalog]', error);
        fail(res, 500, 'CATALOG_FAILED', 'تعذر جلب كتالوج الصلاحيات');
    }
});

router.get('/users/:id', jwtAuth, requireRole(...ADMIN_ONLY), async (req, res) => {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {return fail(res, 422, 'INVALID_USER_ID', 'معرف المستخدم غير صحيح');}
        const user = (await pool.query(`SELECT id, username, name, role, active FROM users WHERE id = $1`, [userId])).rows[0];
        if (!user) {return fail(res, 404, 'USER_NOT_FOUND', 'المستخدم غير موجود');}
        const grants = [...(await getUserGrants(userId))];
        const { denies } = await getUserPerms(userId);
        const audit = (await pool.query(
            `SELECT perm_key, action, acted_by, reason, created_at FROM permission_audit
              WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [userId])).rows;
        res.json({ user, grants, denies: [...denies], menus: menusForGrants(grants), audit });
    } catch (error) {
        logger.error('[permissions/user-get]', error);
        fail(res, 500, 'PERMISSIONS_GET_FAILED', 'تعذر جلب صلاحيات المستخدم');
    }
});

router.put('/users/:id', jwtAuth, requireRole(...ADMIN_ONLY), async (req, res) => {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {return fail(res, 422, 'INVALID_USER_ID', 'معرف المستخدم غير صحيح');}
        const target = (await pool.query(`SELECT id, username, name, role FROM users WHERE id = $1`, [userId])).rows[0];
        if (!target) {return fail(res, 404, 'USER_NOT_FOUND', 'المستخدم غير موجود');}
        if (target.role === 'admin') {return fail(res, 422, 'ADMIN_HAS_ALL', 'المدير يملك كل الصلاحيات — لا حاجة لمنح');}
        if (!Array.isArray(req.body?.grants)) {return fail(res, 422, 'INVALID_GRANTS', 'grants يجب أن تكون مصفوفة');}
        const wanted = [...new Set(req.body.grants.map((g) => String(g)).filter((g) => PERM_MAP.has(g)))];
        const wantedDenies = Array.isArray(req.body?.denies)
            ? [...new Set(req.body.denies.map((g) => String(g)).filter((g) => PERM_MAP.has(g)))]
            : null; // null = لا تغيير على السحب
        const reason = String(req.body?.reason ?? '').slice(0, 300) || null;
        const actor = req.user?.username || String(req.user?.id || '');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const current = new Map((await client.query(`SELECT perm_key, effect FROM user_permissions WHERE user_id = $1`, [userId])).rows.map((r) => [r.perm_key, r.effect || 'grant']));
            const next = new Set(wanted);
            const audit = async (k, action) => {
                await client.query(`INSERT INTO permission_audit (user_id, perm_key, action, acted_by, reason) VALUES ($1,$2,$3,$4,$5)`, [userId, k, action, actor, reason]);
            };
            const writeRow = async (k, effect) => {
                await client.query(
                    `INSERT INTO user_permissions (user_id, perm_key, effect, granted_by) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (user_id, perm_key) DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by, granted_at = NOW()`,
                    [userId, k, effect, actor]);
            };
            // المنح: إضافة الجديد + إسقاط المزال (ما لم يتحول لسحب أدناه)
            for (const k of next) {
                if (current.get(k) === 'grant') {continue;}
                await writeRow(k, 'grant');
                await audit(k, 'grant');
            }
            for (const [k, eff] of current) {
                if (eff === 'grant' && !next.has(k) && !(wantedDenies && wantedDenies.includes(k))) {
                    await client.query(`DELETE FROM user_permissions WHERE user_id = $1 AND perm_key = $2`, [userId, k]);
                    await audit(k, 'revoke');
                }
            }
            // السحب: إضافة الجديد + إسقاط المزال (يغلب المنح والدور)
            if (wantedDenies) {
                const denySet = new Set(wantedDenies);
                for (const k of denySet) {
                    if (current.get(k) === 'deny') {continue;}
                    await writeRow(k, 'deny');
                    await audit(k, 'deny');
                }
                for (const [k, eff] of current) {
                    if (eff === 'deny' && !denySet.has(k)) {
                        await client.query(`DELETE FROM user_permissions WHERE user_id = $1 AND perm_key = $2`, [userId, k]);
                        await audit(k, 'undeny');
                    }
                }
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
        invalidateUser(userId);
        try { require('./api-cache').invalidateAll(); } catch (_) {}
        try {
            if (req.io) {req.io.to(`user:${userId}`).emit('permissions_changed', { at: new Date().toISOString() });}
        } catch (_) {}
        const { grants, denies } = await getUserPerms(userId);
        res.json({ ok: true, user: target, grants: [...grants], denies: [...denies], menus: menusForGrants([...grants]) });
    } catch (error) {
        logger.error('[permissions/user-put]', error);
        fail(res, 500, 'PERMISSIONS_SAVE_FAILED', 'تعذر حفظ الصلاحيات');
    }
});

router.get('/me', jwtAuth, async (req, res) => {
    try {
        const { grants, denies } = await getUserPerms(req.user.id);
        const g = [...grants], d = [...denies];
        const denySet = new Set(menusForDenies(d));
        // الفعالة = منح ناقص مسحوب؛ إخفاء قوائم الدور يعالَج في الواجهة عبر deniedMenus
        const menus = menusForGrants(g).filter((m) => !denySet.has(m));
        res.json({ grants: g, denies: d, menus, deniedMenus: [...denySet] });
    } catch (error) {
        logger.error('[permissions/me]', error);
        fail(res, 500, 'PERMISSIONS_ME_FAILED', 'تعذر جلب صلاحياتك');
    }
});

module.exports = { router };
