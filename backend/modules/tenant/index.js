'use strict';
/**
 * tenant module — الحدود الهيكلية لـStage 6.
 * router/service/repository معاد تصديرها من الموقع القديم (المرحلة 1)؛
 * المرحلة 2 تنقل المنطق خلف هذه الواجهات دون تغيير العقد.
 */
module.exports = {
    router: require('./routes'),
    service: require('./service'),
    repository: require('./repository'),
};
