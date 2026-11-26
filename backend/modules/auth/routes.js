'use strict';
/**
 * auth/routes — نفس المسارات ونفس سلاسل الـmiddleware بالضبط.
 * أي تغيير هنا = تغيير عقد API (G8) ⇒ ممنوح.
 */
const { authLimiter, refreshLimiter, generalLimiter } = require('../../rate-limiter');
const { jwtAuth } = require('../../cashier-module/jwt-middleware');
const controller = require('./controller');

function register(app) {
    app.post('/api/auth/login', authLimiter, controller.loginHandler);
    app.post('/api/auth/change-password', authLimiter, jwtAuth, controller.changePasswordHandler);
    app.post('/api/auth/refresh', refreshLimiter, controller.refreshHandler);
    app.post('/api/auth/logout', generalLimiter, jwtAuth, controller.logoutHandler);

    const passwordRecovery = require('../../cashier-module/password-recovery-routes');
    app.use('/api/auth/forgot-password', passwordRecovery.router);

    require('../../cashier-module/mfa-routes').register(app);
    require('../../cashier-module/webauthn-routes').register(app);
    require('../../cashier-module/session-routes').register(app);
}

module.exports = { register };
