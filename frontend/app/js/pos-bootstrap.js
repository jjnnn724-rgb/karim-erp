/**
 * pos-bootstrap.js — تهيئة شاشة الكاشير (POS)
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا هذا الملف منفصل وليس <script> داخل pos.html:
 *   سكربتات inline داخل HTML **محجوبة** بسياسة CSP المتروّضة، لأن وجود
 *   'nonce-…' في script-src يجعل المتصفح يتجاهل 'unsafe-inline' (قاعدة CSP2).
 *   أي أن التهيئة التي كانت داخل pos.html لم تكن تُنفَّذ إطلاقًا:
 *     · تطبيق سياسة توحيد مسار POS (Phase 4.2) كانت صامتة بلا أثر،
 *     · تسجيل Service Worker على شاشة الكاشير لم يكن يحدث (كان يعتمد على
 *       صفحة الدخول فقط).
 *   نقلها إلى ملف خارجي يجعلها تعمل تحت السياسة المطبَّقة وتحت السياسة
 *   الصارمة مستقبلًا (بلا inline على الإطلاق).
 *
 * الترتيب: pos.html يحمّل pos-path-guard.js ثم هذا الملف (سكربتات كلاسيكية
 * بالترتيب) ⇒ window.PosPathGuard جاهز قبل الاستدعاء.
 */
(function () {
    'use strict';

    // ─── Phase 4.2: سياسة توحيد مسار POS (off | banner | redirect) ───
    // الافتراضي off = لا تغيير إطلاقًا. الفشل يُتجاهل بصمت.
    if (window.PosPathGuard && typeof window.PosPathGuard.applyPosPathPolicy === 'function') {
        try {
            const p = window.PosPathGuard.applyPosPathPolicy();
            if (p && typeof p.catch === 'function') {p.catch(function () { /* لا سياسة = لا تغيير */ });}
        } catch (_) { /* لا سياسة = لا تغيير */ }
    }

    // ─── تسجيل Service Worker (تخزين مؤقت للعمل دون اتصال) ───
    if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/app/sw.js').catch(function () { /* غير حرج */ });
        });
    }
})();
