'use strict';

const store = require('./store');
const { isValidChatJid } = require('./rules');
const { logger } = require('../logger');

async function processCampaigns(engine) {
    if (!engine?.connection?.isConnected() || !engine?.templates || !engine?.sender) {return { skipped: 'engine-not-connected' };}
    await store.pool.query(`
        UPDATE wa_campaign_recipients r
           SET status = CASE WHEN o.status='sent' THEN 'sent' WHEN o.status='failed' THEN 'failed' ELSE r.status END,
               last_error = CASE WHEN o.status='failed' THEN o.last_error ELSE r.last_error END,
               sent_at = CASE WHEN o.status='sent' THEN COALESCE(r.sent_at, o.sent_at, NOW()) ELSE r.sent_at END
          FROM wa_outbox o
         WHERE r.outbox_id=o.id AND r.status='queued' AND o.status IN ('sent','failed')`);
    const campaigns = (await store.pool.query(
        `SELECT * FROM wa_campaigns
          WHERE status IN ('approved','running')
            AND (scheduled_at IS NULL OR scheduled_at <= NOW())
          ORDER BY scheduled_at NULLS FIRST, id
          LIMIT 3`
    )).rows;
    let queued = 0;
    for (const campaign of campaigns) {
        await store.pool.query(`UPDATE wa_campaigns SET status='running', updated_at=NOW() WHERE id=$1 AND status='approved'`, [campaign.id]);
        const recipients = (await store.pool.query(
            `SELECT * FROM wa_campaign_recipients
              WHERE campaign_id=$1 AND status='pending' AND consent=true
              ORDER BY id LIMIT 20`, [campaign.id]
        )).rows;
        if (!recipients.length) {
            const left = await store.pool.query(`SELECT COUNT(*)::int AS c FROM wa_campaign_recipients WHERE campaign_id=$1 AND status IN ('pending','queued')`, [campaign.id]);
            if (!Number(left.rows[0]?.c || 0)) {
                await store.pool.query(`UPDATE wa_campaigns SET status='completed', updated_at=NOW() WHERE id=$1 AND status='running'`, [campaign.id]);
            }
            continue;
        }
        let text;
        try {
            const template = await engine.templates.get(campaign.template_name, campaign.lang);
            if (!template) {throw new Error('CAMPAIGN_TEMPLATE_NOT_FOUND');}
            for (const recipient of recipients) {
                if (!isValidChatJid(recipient.remote_jid)) {
                    await store.pool.query(`UPDATE wa_campaign_recipients SET status='skipped', last_error='INVALID_JID' WHERE id=$1`, [recipient.id]);
                    continue;
                }
                try {
                    const vars = Array.isArray(recipient.vars) ? recipient.vars : [];
                    text = engine.templates.fill(template, ...vars);
                    const out = await engine.sender.enqueue(recipient.remote_jid, text, {
                        createdBy: campaign.created_by,
                        clientKey: `campaign:${campaign.id}:${recipient.id}`,
                    });
                    await store.pool.query(`UPDATE wa_campaign_recipients SET status='queued', outbox_id=$2 WHERE id=$1`, [recipient.id, out.id]);
                    queued += 1;
                } catch (e) {
                    await store.pool.query(`UPDATE wa_campaign_recipients SET status='failed', last_error=$2 WHERE id=$1`, [recipient.id, String(e.message).slice(0, 300)]);
                }
            }
        } catch (e) {
            await store.pool.query(`UPDATE wa_campaign_recipients SET status='failed', last_error=$2 WHERE campaign_id=$1 AND status='pending'`, [campaign.id, String(e.message).slice(0, 300)]);
            logger.error(`[WHATSAPP] campaign ${campaign.id} failed: ${e.message}`);
        }
    }
    return { queued };
}

module.exports = { processCampaigns };
