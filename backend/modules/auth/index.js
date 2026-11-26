'use strict';
/**
 * auth module — الحدود الهيكلية الأولى لـStage 6.
 * login/refresh/logout/change-password + recovery/MFA/WebAuthn/sessions
 * كلها تُسجَّل من مكان واحد، والمنطق لا يزال في cashier-module/jwt-middleware
 * (المرحلة 2 تنقل المنطق خلف service/repository دون تغيير العقد).
 */
module.exports = {
    register: require('./routes').register,
    controller: require('./controller'),
    service: require('./service'),
    repository: require('./repository'),
};
