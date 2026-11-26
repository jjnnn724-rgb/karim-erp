'use strict';
/**
 * pos module — الحدود الهيكلية للبيع ونقطة البيع (Stage 6).
 * نفس المسارات ونفس ترتيب التسجيل بالضبط (ترتيب app.use مهم لأسبقية المسارات).
 * المنطق لا يزال في cashier-module — المرحلة 2 تنقله خلف service/repository.
 */
const { register: registerSaleRoute } = require('../../cashier-module/complete-sale');
const shiftRoutes = require('../../cashier-module/shift-routes');
const buffetRoutes = require('../../cashier-module/buffet-routes');
const { logger } = require('../../logger');

function register(app) {
    registerSaleRoute(app);
    app.use('/api/pos', shiftRoutes);
    app.use('/api/pos/buffet', buffetRoutes.router);

    // Daily Z close — معزول، فشله لا يوقف نقطة البيع.
    try {
        const dayCloseRoutes = require('../../cashier-module/day-close-routes');
        app.use('/api/pos', dayCloseRoutes.router);
        dayCloseRoutes.ensureDayCloseSchema();
    } catch (e) {
        logger.error({ err: { message: String(e.message), stack: (e && e.stack) || null } }, '[day-close] module failed to load — Z close disabled, POS still running:');
    }
}

module.exports = { register };
