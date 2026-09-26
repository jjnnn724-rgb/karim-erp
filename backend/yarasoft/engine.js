/**
 * yarasoft/engine.js — محرك التكامل داخل عملية الخادم (نفس نمط zkteco)
 * ────────────────────────────────────────────────────────────────────────────
 * يُشغَّل من server.js بعد ensureYarasoftSchema():
 *     const yarasoftEngine = new YarasoftEngine();
 *     yarasoftEngine.start(io);   // و عند الإيقاف الآمن: yarasoftEngine.stop()
 *
 * المسؤوليات:
 *   • دورة: فحص المشاركة → اكتشاف الجديد → معالجة متزامنة محدودة
 *   • التعافي من انقطاع الشبكة تلقائيًا (Phase 11) بلا أي انهيار
 *   • قفل تزامن داخلي (Phase 12): ملف واحد = معالجة واحدة
 *   • مقاييس وحالة حية للمسار /api/yarasoft/status (Phase 14)
 *   • إعادة معالجة مجلد Processing بعد حل الربط (runNow)
 */

'use strict';

const path = require('path');
const { loadConfig, joinShare } = require('./config');
const files = require('./files');
const { scanDirectory, pruneKnown } = require('./watcher');
const importer = require('./importer');
const { STATUS } = require('./importer');
const { logger } = require('../logger');
const { pool } = require('../shared-pool');

class YarasoftEngine {
    constructor() {
        this.config = loadConfig();
        this.profile = null;          // ملف تعريف الصيغة (يُحمّل كسولًا)
        this.running = false;
        this.io = null;
        this.known = new Map();       // مسار → إشارة الحجم/التعديل
        this.inFlight = new Set();    // قفل التزامن (Phase 12)
        this.timer = null;
        this.networkOk = null;
        this.lastScanAt = null;
        this.lastError = null;
        this.lastSuccessfulImportAt = null;
        this.lastFailedImportAt = null;
        this.startupScanDone = false;
        this.metrics = {
            filesDetected: 0,
            invoicesCompleted: 0,
            invoicesFailed: 0,
            duplicatesDetected: 0,
            reviewRequired: 0,
            dryRuns: 0,
            networkRetries: 0,
        };
    }

    /** تحميل ملف تعريف الصيغة إن وُجد (اختياري) */
    loadProfile() {
        try {
             
            const fs = require('fs');
            if (fs.existsSync(this.config.profilePath)) {
                this.profile = JSON.parse(fs.readFileSync(this.config.profilePath, 'utf8'));
            }
        } catch (error) {
            logger.warn(`[YARASOFT] تعذر قراءة ملف تعريف الصيغة (${error.message}) — سيُستخدم الشمّام التلقائي`);
            this.profile = null;
        }
        importer.profile = this.profile;
    }

    async start(io) {
        this.io = io || null;
        importer.io = this.io;
        this.loadProfile();
        if (!this.config.enabled) {
            logger.info('[YARASOFT] التكامل معطّل (YARASOFT_ENABLED=false) — المسار والواجهة متاحان للمعاينة والتشخيص');
            return false;
        }
        this.running = true;
        // تهيئة مجلدات العمل (Invoices/Processing/Archive/Failed) — غيابها كان
        // يسبب ضجيج ENOENT كل 30 ثانية على الأجهزة الجديدة
        try {
            const fs = require('fs');
            const { joinShare } = require('./config');
            for (const d of [this.config.invoicesDir, this.config.processingDir, this.config.archiveDir, this.config.failedDir]) {
                try { fs.mkdirSync(joinShare(this.config, d), { recursive: true }); } catch (_) {}
            }
        } catch (_) {}
        logger.info(`[YARASOFT] بدأ محرك الاستيراد — المشاركة: ${this.config.shareRoot}${this.config.dryRun ? ' (DRY_RUN: بلا كتابة)' : ''}`);
        this.scheduleScan(0); // فحص بدء التشغيل فورًا (Phase 3-A)
        return true;
    }

    stop() {
        this.running = false;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        logger.info('[YARASOFT] أُوقف محرك الاستيراد بأمان');
    }

    scheduleScan(delaySec) {
        if (!this.running) {return;}
        clearTimeout(this.timer);
        const delay = (delaySec ?? this.config.scanIntervalSec) * 1000;
        this.timer = setTimeout(() => this.runCycle().catch(err => {
            logger.error('[YARASOFT] دورة غير متوقعة:', err.message);
            this.lastError = err.message;
            this.scheduleScan(this.config.networkRetryIntervalSec);
        }), delay);
    }

    /** دورة كاملة: توفر الشبكة → مسح → معالجة الجديد (بسقف تزامن) */
    async runCycle() {
        if (!this.running) {return;}
        const invoicesDir = joinShare(this.config, this.config.invoicesDir);
        const processingDir = joinShare(this.config, this.config.processingDir);

        // ─── توفر الشبكة (Phase 11) ───
        const probe = await files.probeShare(invoicesDir);
        this.networkOk = probe.ok;
        if (!probe.ok) {
            this.metrics.networkRetries++;
            this.lastError = `المشاركة غير متاحة (${probe.code}) — إعادة محاولة بعد ${this.config.networkRetryIntervalSec}ث`;
            logger.warn(`[YARASOFT] ${this.lastError}`);
            this.scheduleScan(this.config.networkRetryIntervalSec);
            return;
        }

        this.lastScanAt = new Date().toISOString();
        const discovered = [];
        const allPaths = new Set();
        try {
            // مجلد الفواتير الجديدة
            const fresh = await scanDirectory(invoicesDir, this.known, { patterns: this.config.filePatterns });
            discovered.push(...fresh.found.map(f => ({ ...f, from: 'invoices' })));
            fresh.allLowerPaths.forEach(p => allPaths.add(p));
            // مجلد المعالجة (بانتظار حل ربط أصنافه)
            const procProbe = await files.probeShare(processingDir);
            if (procProbe.ok) {
                const pending = await scanDirectory(processingDir, this.known, { patterns: this.config.filePatterns });
                discovered.push(...pending.found.map(f => ({ ...f, from: 'processing' })));
                pending.allLowerPaths.forEach(p => allPaths.add(p));
                pruneKnown(this.known, allPaths); // نظّف الذاكرة فقط حين رأينا كل المجلدات
            }
            this.startupScanDone = true;
        } catch (error) {
            this.networkOk = false;
            this.metrics.networkRetries++;
            this.lastError = error.message;
            this.scheduleScan(this.config.networkRetryIntervalSec);
            return;
        }

        this.metrics.filesDetected += discovered.length;
        if (discovered.length && this.io) {this.io.emit('yarasoft:detected', { count: discovered.length });}

        // ─── معالجة متزامنة محدودة (لا غرق للشبكة ولا قفل لعملية الخادم) ───
        const MAX_CONCURRENT = 3;
        const queue = discovered.filter(f => !this.inFlight.has(f.filePath));
        const workers = [];
        for (let i = 0; i < Math.min(MAX_CONCURRENT, queue.length); i++) {
            workers.push(this.drainQueue(queue));
        }
        await Promise.allSettled(workers);
        this.scheduleScan(this.config.scanIntervalSec);
    }

    async drainQueue(queue) {
        while (queue.length) {
            const file = queue.shift();
            if (!file) {break;}
            const key = file.filePath.toLowerCase();
            if (this.inFlight.has(key)) {continue;} // Phase 12
            this.inFlight.add(key);
            try {
                const result = await importer.processFile({
                    filePath: file.filePath,
                    fileName: file.fileName,
                    deviceKey: file.relDir ? String(file.relDir).split('/')[0] : '',
                    config: this.config,
                    importer: { io: this.io, profile: this.profile },
                });
                this.recordResult(result);
            } catch (error) {
                if (files.isTransientError(error)) {
                    this.networkOk = false;
                    this.metrics.networkRetries++;
                    this.lastError = error.message;
                    break; // أوقف الدوران — الشبكة ساقطة، الدورة القادمة تعيد
                }
                logger.error('[YARASOFT] فشل معالجة ملف:', error.message);
                this.lastError = error.message;
            } finally {
                this.inFlight.delete(key);
            }
        }
    }

    recordResult(result) {
        switch (result.status) {
            case STATUS.COMPLETED:
                this.metrics.invoicesCompleted++;
                this.lastSuccessfulImportAt = new Date().toISOString();
                break;
            case STATUS.DUPLICATE:
                this.metrics.duplicatesDetected++;
                break;
            case STATUS.FAILED:
                this.metrics.invoicesFailed++;
                this.lastFailedImportAt = new Date().toISOString();
                break;
            case STATUS.REQUIRES_REVIEW:
                this.metrics.reviewRequired++;
                break;
            case STATUS.DRY_RUN:
                this.metrics.dryRuns++;
                break;
            default:
                break; // BUSY / RETRY_LATER — يُعادون تلقائيًا
        }
    }

    /** إعادة معالجة فورية (زر "تشغيل الآن" أو بعد حل مراجعة) */
    async runNow() {
        if (!this.running) {
            // حتى لو معطّل: دورة واحدة يدوية آمنة (تُحترم DRY_RUN)
            const saved = this.running;
            this.running = true;
            try { await this.runCycleOnceManual(); } finally { this.running = saved; }
            return { ok: true, manual: true };
        }
        clearTimeout(this.timer);
        await this.runCycle();
        return { ok: true, manual: true };
    }

    async runCycleOnceManual() {
        // دورة واحدة بلا جدولة (لأن running قد يكون false)
        const invoicesDir = joinShare(this.config, this.config.invoicesDir);
        const probe = await files.probeShare(invoicesDir);
        this.networkOk = probe.ok;
        if (!probe.ok) {return { ok: false, reason: probe.code };}
        const fresh = await scanDirectory(invoicesDir, this.known, { patterns: this.config.filePatterns });
        await this.drainQueue(fresh.found.map(f => ({ ...f, from: 'invoices' })));
        return { ok: true };    }

    /** حالة حية للمسار status (Phase 14) */
    getStatus() {
        return {
            enabled: this.config.enabled,
            running: this.running,
            dryRun: this.config.dryRun,
            shareRoot: this.config.shareRoot,
            networkOk: this.networkOk,
            startupScanDone: this.startupScanDone,
            lastScanAt: this.lastScanAt,
            lastError: this.lastError,
            lastSuccessfulImportAt: this.lastSuccessfulImportAt,
            lastFailedImportAt: this.lastFailedImportAt,
            profileLoaded: Boolean(this.profile),
            profileKind: this.profile?.kind || null,
            queueSize: this.inFlight.size,
            metrics: { ...this.metrics },
        };
    }
}

module.exports = { YarasoftEngine };
