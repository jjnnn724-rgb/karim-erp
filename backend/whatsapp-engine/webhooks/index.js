/**
 * whatsapp-engine/webhooks/index.js — External system integration
 * ═══════════════════════════════════════════════════════════════
 *
 * Webhooks are HTTP callbacks sent to external systems when
 * specific WhatsApp events occur.
 *
 * Events:
 *   message.received  — New incoming message
 *   message.processed — Message was handled and replied
 *   order.created     — Order placed via WhatsApp
 *   payment.received  — Payment confirmed
 *   delivery.updated  — Delivery status changed
 *   customer.joined   — Customer first messaged
 *   ai.response       — AI chatbot generated a reply
 *
 * Features:
 *   - Retry with exponential backoff (3 attempts)
 *   - HMAC-SHA256 signature verification
 *   - Async — webhook failures don't block WhatsApp processing
 *   - Configurable per-event via wa_settings table
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const { logger } = require('../../logger');
const store = require('../store');

class WebhookManager {
    constructor() {
        this._queue = [];
        this._processing = false;
    }

    /** Register a webhook endpoint */
    async register(event, url, secret) {
        await store.setWebhook(event, url, secret);
        logger.info(`[Webhook] Registered: ${event} → ${url.slice(0, 50)}...`);
    }

    /** Remove a webhook */
    async remove(event) {
        await store.removeWebhook(event);
        logger.info(`[Webhook] Removed: ${event}`);
    }

    /** Trigger a webhook event (async, non-blocking) */
    async trigger(event, data) {
        try {
            const urls = await store.getWebhooks(event);
            for (const { url, secret } of urls) {
                this._queue.push({ event, url, data, secret });
            }
            this._processQueue();
        } catch (e) {
            logger.warn(`[Webhook] trigger failed: ${e.message}`);
        }
    }

    async _processQueue() {
        if (this._processing) {return;}
        this._processing = true;

        while (this._queue.length > 0) {
            const job = this._queue.shift();
            await this._send(job);
        }

        this._processing = false;
    }

    async _send(job) {
        const { url, data, secret } = job;
        const payload = JSON.stringify({ event: job.event, data, ts: Date.now() });
        const signature = crypto.createHmac('sha256', secret || 'default')
            .update(payload).digest('hex');

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await new Promise((resolve, reject) => {
                    const req = https.request(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Webhook-Signature': signature,
                            'X-Webhook-Event': job.event,
                        },
                        timeout: 10000,
                    }, resolve);
                    req.on('error', reject);
                    req.write(payload);
                    req.end();
                });

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    logger.debug(`[Webhook] ${job.event} → ${url.slice(0, 40)} OK`);
                    return;
                }
                logger.warn(`[Webhook] attempt ${attempt}: HTTP ${res.statusCode}`);
            } catch (e) {
                logger.warn(`[Webhook] attempt ${attempt}: ${e.message}`);
            }

            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }

        logger.error(`[Webhook] ${job.event} → ${url.slice(0, 40)} FAILED after 3 attempts`);
    }
}

module.exports = { WebhookManager };