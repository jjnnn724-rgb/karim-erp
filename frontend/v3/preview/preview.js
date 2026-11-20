/**
 * عدّاد الانتقال — يقرأ الموعد من rollout.json (مصدر الحقيقة الواحد في
 * `backend/rollout.js` أيضًا) فلا يوجد تاريخ مكرَّر في الصفحة.
 * بعد الموعد تُبدَّل الرسالة: «تم الانتقال» — لا عدّاد سالب.
 */
(function () {
    'use strict';

    var cells = {
        days: document.querySelector('[data-countdown="days"]'),
        hours: document.querySelector('[data-countdown="hours"]'),
        minutes: document.querySelector('[data-countdown="minutes"]'),
        seconds: document.querySelector('[data-countdown="seconds"]'),
    };
    var note = document.querySelector('[data-countdown-note]');
    var box = document.querySelector('.countdown');
    var timer = null;

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function render(leftMs) {
        var total = Math.max(0, Math.floor(leftMs / 1000));
        var days = Math.floor(total / 86400);
        cells.days.textContent = String(days);
        cells.hours.textContent = pad(Math.floor((total % 86400) / 3600));
        cells.minutes.textContent = pad(Math.floor((total % 3600) / 60));
        cells.seconds.textContent = pad(total % 60);
    }

    function done() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (box) {
            box.classList.add('countdown--done');
        }
        if (note) {
            note.textContent = 'تم الانتقال — مدخل النظام الآن هو الإصدار الثالث.';
        }
    }

    fetch('/v3/rollout.json', { cache: 'no-store' })
        .then(function (response) {
            return response.ok ? response.json() : null;
        })
        .then(function (config) {
            var at = config && typeof config.switchAt === 'string' ? Date.parse(config.switchAt) : NaN;
            if (!Number.isFinite(at)) {
                // بلا موعد صالح لا نعرض عدّادًا كاذبًا.
                if (note) {
                    note.textContent = 'المعاينة مفتوحة الآن، والإعلان عن موعد القلب قريبًا.';
                }
                Object.keys(cells).forEach(function (key) {
                    cells[key].textContent = '—';
                });
                return;
            }
            var tick = function () {
                var left = at - Date.now();
                if (left <= 0) {
                    render(0);
                    done();
                    return;
                }
                render(left);
            };
            tick();
            timer = setInterval(tick, 1000);
        })
        .catch(function () {
            if (note) {
                note.textContent = 'تعذّر قراءة موعد الانتقال — المعاينة متاحة الآن على أي حال.';
            }
        });
})();
