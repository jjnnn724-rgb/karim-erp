// ══════════════════════════════════════════════════════
//  Karim ERP — QR / Barcode Scanner Module
//  يدعم: كاميرا الهاتف/الكمبيوتر (عبر Html5Qrcode)
//        + ماسحات الباركود الفيزيائية (USB/Bluetooth تعمل كلوحة مفاتيح)
//        + إدخال يدوي كخيار احتياطي
// ══════════════════════════════════════════════════════
'use strict';

let _gvHtml5QrCode = null;
let _gvScannerOnDecode = null;
let _gvScannerHandled = false;
let _gvScannerObserver = null;

function openScanner(opts = {}) {
    const {
        title = '<i class=ji data-i=camera></i> مسح QR / باركود',
        instruction = 'وجّه الكاميرا نحو الرمز',
        onDecode = null,
    } = opts;

    _gvScannerOnDecode = onDecode;
    _gvScannerHandled = false;
    const boxId = 'gv-qr-box-' + Date.now();

    showModal(`
<h3>${title}</h3>
<div class="scanner-tabs">
  <button type="button" class="scanner-tab active" data-tab="camera" onclick="switchScannerTab(this,'camera')"><i class=ji data-i=camera></i> كاميرا</button>
  <button type="button" class="scanner-tab" data-tab="manual" onclick="switchScannerTab(this,'manual')"><i class=ji data-i=keyboard></i> ماسح / إدخال يدوي</button>
</div>
<div class="scanner-panel" data-panel="camera">
  <div id="${boxId}" class="scanner-camera-box"></div>
  <div class="scanner-hint">${instruction}</div>
  <div class="scanner-note"><i class=ji data-i=wifi></i> ملاحظة: الوصول إلى الكاميرا يتطلب اتصالاً آمناً (HTTPS) أو فتح الصفحة من الجهاز نفسه (localhost). إذا لم تعمل الكاميرا من جهاز آخر على الشبكة، استخدم تبويب «ماسح / إدخال يدوي».</div>
</div>
<div class="scanner-panel" data-panel="manual" style="display:none">
  <div class="fg">
    <label>وجّه ماسح الباركود هنا واضغط، أو اكتب الكود يدوياً ثم Enter</label>
    <input type="text" id="scannerManualInput" placeholder="امسح هنا أو اكتب الكود..." autocomplete="off">
  </div>
</div>
<div class="modal-footer"><button class="btn" onclick="closeScannerModal()">إلغاء</button></div>
`, 'scanner-modal');

    _startScannerCamera(boxId);

    setTimeout(() => {
        const input = document.getElementById('scannerManualInput');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = input.value.trim();
                    if (val) {_handleScanResult(val);}
                }
            });
        }
        // إيقاف الكاميرا تلقائياً لو اتقفلت المودال بأي طريقة (كليك برّه، إلخ)
        const modalsDiv = document.getElementById('modals');
        if (modalsDiv && window.MutationObserver) {
            if (_gvScannerObserver) {_gvScannerObserver.disconnect();}
            _gvScannerObserver = new MutationObserver(() => {
                if (!document.getElementById(boxId)) {
                    _stopScannerCamera();
                    _gvScannerObserver.disconnect();
                    _gvScannerObserver = null;
                }
            });
            _gvScannerObserver.observe(modalsDiv, { childList: true, subtree: true });
        }
    }, 50);
}

function switchScannerTab(btn, tab) {
    document.querySelectorAll('.scanner-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.scanner-panel').forEach(p => {
        p.style.display = (p.dataset.panel === tab) ? '' : 'none';
    });
    if (tab === 'manual') {
        const input = document.getElementById('scannerManualInput');
        if (input) { input.value = ''; input.focus(); }
    }
}

async function _startScannerCamera(boxId) {
    const box = document.getElementById(boxId);
    if (typeof Html5Qrcode === 'undefined') {
        if (box) {box.innerHTML = '<div class="scanner-error"><i class=ji data-i=alert-triangle></i> مكتبة الكاميرا غير محمّلة. استخدم تبويب الإدخال اليدوي.</div>';}
        return;
    }
    try {
        _gvHtml5QrCode = new Html5Qrcode(boxId);
        const config = { fps: 10, qrbox: { width: 240, height: 240 } };
        await _gvHtml5QrCode.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => _handleScanResult(decodedText),
            () => { /* تجاهل أخطاء الفريمات العادية أثناء البحث عن رمز */ }
        );
    } catch (e) {
        if (box) {
            box.innerHTML = `<div class="scanner-error"><i class=ji data-i=alert-triangle></i> تعذر تشغيل الكاميرا.<br><small>${esc ? esc(String(e.message || e)) : String(e.message || e)}</small><br><small>تأكد من السماح بإذن الكاميرا، أو استخدم تبويب الإدخال اليدوي.</small></div>`;
        }
    }
}

function _stopScannerCamera() {
    if (_gvHtml5QrCode) {
        const instance = _gvHtml5QrCode;
        _gvHtml5QrCode = null;
        instance.stop().then(() => instance.clear()).catch(() => {});
    }
}

function closeScannerModal() {
    _stopScannerCamera();
    if (_gvScannerObserver) { _gvScannerObserver.disconnect(); _gvScannerObserver = null; }
    closeModal();
}

function _handleScanResult(text) {
    if (_gvScannerHandled) {return;}
    _gvScannerHandled = true;
    const cb = _gvScannerOnDecode;
    closeScannerModal();
    if (typeof cb === 'function') {cb(text);}
    setTimeout(() => { _gvScannerHandled = false; }, 300);
}

window.openScanner = openScanner;
window.switchScannerTab = switchScannerTab;
window.closeScannerModal = closeScannerModal;
