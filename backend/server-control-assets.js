'use strict';
/**
 * server-control-assets.js — صفحة مركز التحكم المستقلة (HTML/CSS/JS).
 * لا اعتماد على ERP ولا على شبكة خارجية: تعمل والخادم متوقف.
 * كل السكربتات خارجية (CSP: script-src 'self') بلا معالجات مضمّنة.
 */

const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Karim ERP — مركز التحكم بالسيرفر</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<main class="shell">
  <header class="top">
    <div class="brand">
      <span class="logo" aria-hidden="true">K</span>
      <div>
        <h1>مركز التحكم بالسيرفر</h1>
        <p>Karim ERP · لوحة مستقلة تبقى تعمل حتى عند إيقاف النظام</p>
      </div>
    </div>
    <div class="userbox" id="userbox" hidden>
      <span class="userchip" id="username"></span>
      <button type="button" class="btn btn-ghost" id="logout">خروج</button>
    </div>
  </header>

  <section class="card login" id="login" hidden>
    <div class="loginhead">
      <span class="shield" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
      </span>
      <div><h2>دخول مدير النظام</h2><p class="muted">هذه اللوحة لا تعتمد على سيرفر ERP — لذلك تبقى متاحة بعد إيقافه.</p></div>
    </div>
    <form id="loginform" autocomplete="on">
      <label class="field">اسم المستخدم
        <input id="u" name="username" autocomplete="username" maxlength="64" required>
      </label>
      <label class="field">كلمة المرور
        <input id="p" name="password" type="password" autocomplete="current-password" maxlength="200" required>
      </label>
      <button type="submit" class="btn btn-primary btn-wide">دخول آمن</button>
      <p class="err" id="loginerr" role="alert"></p>
    </form>
    <p class="footnote">الوصول محلي عبر 127.0.0.1، أو عن بُعد عبر نفق Cloudflare المحمي بدخول مدير النظام. تُسجَّل كل العمليات باسم المنفّذ ووقته وعنوانه.</p>
  </section>

  <section id="dash" hidden>
    <div class="grid">
      <article class="card statuscard">
        <div class="statustop">
          <span class="dot" id="dot" aria-hidden="true"></span>
          <div>
            <h2 id="statetitle">جارٍ القراءة…</h2>
            <p class="muted" id="statesub">—</p>
          </div>
        </div>
        <div class="metrics">
          <div><span>الخدمة</span><b id="svc">—</b></div>
          <div><span>الصحة</span><b id="health">—</b></div>
          <div><span>مدة التشغيل</span><b id="uptime">—</b></div>
          <div><span>آخر إجراء</span><b id="lastop">—</b></div>
        </div>
      </article>

      <article class="card">
        <h3>التحكم</h3>
        <p class="muted">الإيقاف يوقف تطبيق ERP فقط — قاعدة البيانات تبقى تعمل، وهذه اللوحة تبقى متاحة لإعادة التشغيل.</p>
        <div class="actions">
          <button type="button" class="btn btn-start" id="start" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
            <span>تشغيل السيرفر</span>
          </button>
          <button type="button" class="btn btn-stop" id="stop" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            <span>إيقاف السيرفر</span>
          </button>
          <button type="button" class="btn btn-restart" id="restart" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/></svg>
            <span>إعادة تشغيل</span>
          </button>
        </div>
        <div class="opbox" id="opbox" hidden>
          <span class="spinner" aria-hidden="true"></span>
          <div><b id="opstage">جارٍ التنفيذ…</b><p class="muted" id="opdetail">لا تغلق هذه الصفحة.</p></div>
        </div>
        <p class="err" id="actionerr" role="alert"></p>
        <p class="hint" id="actionhint" hidden></p>
      </article>
    </div>

    <article class="card">
      <div class="cardhead">
        <h3>سجل العمليات</h3>
        <button type="button" class="btn btn-ghost" id="refresh">تحديث الآن</button>
      </div>
      <ul class="audit" id="audit"><li class="muted">جارٍ التحميل…</li></ul>
    </article>

    <p class="footnote">اللوحة تستمع على 127.0.0.1 فقط ولا يُفتح المنفذ مباشرة للإنترنت؛ الوصول الخارجي يمر عبر نفق Cloudflare بتسجيل دخول مدير النظام. التشغيل والإيقاف يُنفَّذان عبر خدمة ويندوز <span class="mono">KarimERP-Server</span> بأوامر ثابتة، ولا يمسّان PostgreSQL.</p>
  </section>

  <div class="modal" id="modal" hidden>
    <div class="modalcard" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <h3 id="mtitle"></h3>
      <p class="muted" id="mtext"></p>
      <label class="field" id="mphrasewrap">اكتب <b class="mono" id="mphrase"></b> للتأكيد
        <input id="minput" autocomplete="off" autocapitalize="characters" spellcheck="false">
      </label>
      <div class="modalactions">
        <button type="button" class="btn btn-danger" id="mconfirm">تأكيد التنفيذ</button>
        <button type="button" class="btn btn-ghost" id="mcancel">إلغاء</button>
      </div>
      <p class="err" id="merr" role="alert"></p>
    </div>
  </div>

  <noscript><p class="card err">هذه اللوحة تحتاج JavaScript — فعّله ثم أعد تحميل الصفحة.</p></noscript>
</main>
<script src="/app.js"></script>
</body>
</html>`;

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0b1220;
  --bg2: #111c31;
  --card: rgba(255, 255, 255, 0.045);
  --card2: rgba(255, 255, 255, 0.07);
  --line: rgba(255, 255, 255, 0.10);
  --text: #eef4ff;
  --muted: #9db0cc;
  --brand: #38bdf8;
  --brand2: #22d3ee;
  --ok: #34d399;
  --warn: #fbbf24;
  --danger: #f87171;
  --shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  --radius: 18px;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { min-height: 100%; }
body {
  margin: 0;
  background:
    radial-gradient(1100px 600px at 85% -10%, rgba(56, 189, 248, 0.16), transparent 60%),
    radial-gradient(900px 500px at 5% 110%, rgba(34, 211, 238, 0.10), transparent 60%),
    linear-gradient(160deg, var(--bg) 0%, var(--bg2) 100%);
  color: var(--text);
  font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", "Arial", sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.shell { width: min(1080px, 100%); margin: 0 auto; padding: 28px 18px 48px; }
.top { display: flex; align-items: center; gap: 16px; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo {
  width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center;
  font-size: 26px; font-weight: 800; color: #062a3a;
  background: linear-gradient(135deg, var(--brand), var(--brand2));
  box-shadow: 0 10px 30px rgba(56, 189, 248, 0.35);
}
h1 { font-size: 24px; margin: 0; letter-spacing: -0.2px; }
h2 { font-size: 20px; margin: 0; }
h3 { font-size: 16px; margin: 0 0 10px; }
.brand p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
.card {
  background: linear-gradient(180deg, var(--card2), var(--card));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 22px;
  backdrop-filter: blur(14px);
}
.grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 16px; margin-bottom: 16px; }
@media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
.login { max-width: 520px; margin: 8vh auto 0; }
.loginhead { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 16px; }
.shield { color: var(--brand); background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; flex: 0 0 auto; }
.field { display: block; margin: 12px 0; font-size: 13px; color: var(--muted); }
.field input {
  display: block; width: 100%; margin-top: 6px; padding: 12px 14px;
  background: rgba(3, 10, 22, 0.55); color: var(--text);
  border: 1px solid var(--line); border-radius: 12px; font: inherit; font-size: 15px;
  outline: none; transition: border-color .15s ease, box-shadow .15s ease;
}
.field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.18); }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 16px; border-radius: 12px; border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.06); color: var(--text);
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
  transition: transform .12s ease, background .15s ease, opacity .15s ease;
}
.btn:hover:not(:disabled) { transform: translateY(-1px); background: rgba(255, 255, 255, 0.10); }
.btn:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }
.btn-primary { background: linear-gradient(135deg, #0ea5e9, #06b6d4); border-color: transparent; color: #04202b; }
.btn-wide { width: 100%; padding: 13px 16px; font-size: 15px; }
.btn-start { background: linear-gradient(135deg, #10b981, #34d399); border-color: transparent; color: #052018; }
.btn-stop { background: linear-gradient(135deg, #ef4444, #f87171); border-color: transparent; color: #2a0606; }
.btn-restart { background: linear-gradient(135deg, #f59e0b, #fbbf24); border-color: transparent; color: #2a1a02; }
.btn-danger { background: linear-gradient(135deg, #ef4444, #f87171); border-color: transparent; color: #2a0606; }
.btn-ghost { background: transparent; }
.userbox { display: flex; align-items: center; gap: 10px; }
.userchip { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,.05); font-size: 13px; }
.statuscard { display: flex; flex-direction: column; justify-content: space-between; }
.statustop { display: flex; align-items: center; gap: 16px; }
.dot { width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto; background: var(--muted); box-shadow: 0 0 0 6px rgba(157, 176, 204, 0.10); }
.dot.is-running { background: var(--ok); box-shadow: 0 0 0 6px rgba(52, 211, 153, 0.14); animation: breathe 2.4s ease-in-out infinite; }
.dot.is-stopped { background: var(--danger); box-shadow: 0 0 0 6px rgba(248, 113, 113, 0.14); }
.dot.is-busy { background: var(--warn); box-shadow: 0 0 0 6px rgba(251, 191, 36, 0.14); }
.dot.is-unknown { background: var(--muted); }
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
.metrics div { padding: 10px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.16); border: 1px solid var(--line); min-width: 0; }
.metrics span { display: block; color: var(--muted); font-size: 11px; }
.metrics b { display: block; font-size: 14px; margin-top: 3px; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.actions .btn { flex: 1 1 140px; }
.muted { color: var(--muted); font-size: 13px; margin: 0; }
.err { color: var(--danger); font-size: 13px; min-height: 1.2em; margin: 10px 0 0; }
.hint { color: var(--warn); font-size: 13px; margin: 10px 0 0; }
.footnote { color: var(--muted); font-size: 12px; margin: 18px 2px 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; direction: ltr; unicode-bidi: embed; }
.cardhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.cardhead h3 { margin: 0; }
.opbox { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px 14px; border-radius: 12px; background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.25); }
.opbox b { font-size: 14px; }
.opbox p { margin: 2px 0 0; }
.spinner { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(251, 191, 36, 0.25); border-top-color: var(--warn); animation: spin .8s linear infinite; flex: 0 0 auto; }
@keyframes spin { to { transform: rotate(360deg); } }
.audit { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.audit li { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.14); border: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.audit .when { color: var(--muted); font-size: 12px; min-width: 132px; }
.audit .who { font-weight: 700; }
.badge { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.badge.ok { background: rgba(52, 211, 153, 0.14); color: var(--ok); }
.badge.bad { background: rgba(248, 113, 113, 0.14); color: var(--danger); }
.badge.neutral { background: rgba(157, 176, 204, 0.14); color: var(--muted); }
.modal { position: fixed; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(3, 8, 18, 0.72); backdrop-filter: blur(6px); z-index: 50; }
.modalcard { width: min(460px, 100%); background: linear-gradient(180deg, #15223a, #101a2c); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow); }
.modalactions { display: flex; gap: 10px; margin-top: 16px; }
.modalactions .btn { flex: 1; }
@media (max-width: 520px) {
  .shell { padding: 18px 12px 36px; }
  h1 { font-size: 20px; }
  .logo { width: 46px; height: 46px; border-radius: 13px; font-size: 22px; }
  .card { padding: 16px; border-radius: 15px; }
  .metrics { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

const JS = `
(function () {
  'use strict';
  var csrf = '';
  var pollTimer = null;
  var busy = false;
  var offline = 0;
  var pending = null;
  var lastStatus = null;

  function $(id) { return document.getElementById(id); }
  function text(el, value) { if (el) { el.textContent = value == null ? '—' : String(value); } }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (opts.body) { headers['Content-Type'] = 'application/json'; }
    if (csrf) { headers['x-control-csrf'] = csrf; }
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
          err.status = res.status;
          err.code = data && data.error;
          throw err;
        }
        return data;
      });
    });
  }

  function showLogin(message) {
    csrf = '';
    busy = false;
    stopPolling();
    $('login').hidden = false;
    $('dash').hidden = true;
    $('userbox').hidden = true;
    $('loginerr').textContent = message || '';
    var u = $('u');
    if (u) { setTimeout(function () { try { u.focus(); } catch (e) {} }, 30); }
  }

  function showDash(user) {
    $('login').hidden = true;
    $('dash').hidden = false;
    $('userbox').hidden = false;
    text($('username'), (user && (user.name || user.username)) || 'مدير النظام');
    $('loginerr').textContent = '';
    startPolling();
  }

  function fmtDuration(ms) {
    if (!ms && ms !== 0) { return '—'; }
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    if (d > 0) { return d + ' يوم ' + h + ' ساعة'; }
    if (h > 0) { return h + ' ساعة ' + m + ' دقيقة'; }
    if (m > 0) { return m + ' دقيقة'; }
    return Math.max(0, s) + ' ثانية';
  }
  function fmtWhen(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return d.toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function actionLabel(action) {
    return action === 'start' ? 'تشغيل' : action === 'stop' ? 'إيقاف' : action === 'restart' ? 'إعادة تشغيل' : (action || '—');
  }
  function stageLabel(stage) {
    var map = {
      queued: 'في قائمة التنفيذ…',
      prepare: 'تجهيز العملية…',
      stopping: 'إرسال أمر الإيقاف إلى ويندوز…',
      waiting_stop: 'انتظار إغلاق الخدمة والمنفذ…',
      stopped: 'تم إيقاف الخدمة.',
      starting: 'إرسال أمر التشغيل إلى ويندوز…',
      waiting_health: 'انتظار جاهزية النظام…',
      running: 'النظام يعمل.',
      done: 'اكتملت العملية.',
      failed: 'فشلت العملية.'
    };
    return map[stage] || 'جارٍ التنفيذ…';
  }

  function renderStatus(s) {
    lastStatus = s;
    var service = (s && s.service) || {};
    var erp = (s && s.erp) || {};
    var op = s && s.operation;
    var serviceState = String(service.state || 'UNKNOWN');
    var running = serviceState === 'RUNNING' || erp.healthy === true;
    var stopped = serviceState === 'STOPPED' && erp.healthy !== true;
    var isBusy = !!(op && op.state === 'running');

    var dot = $('dot');
    dot.className = 'dot ' + (isBusy ? 'is-busy' : running ? 'is-running' : stopped ? 'is-stopped' : 'is-unknown');

    if (isBusy) {
      text($('statetitle'), op.action === 'stop' ? 'جارٍ إيقاف السيرفر…' : op.action === 'restart' ? 'جارٍ إعادة التشغيل…' : 'جارٍ تشغيل السيرفر…');
      text($('statesub'), stageLabel(op.stage));
    } else if (running) {
      text($('statetitle'), 'السيرفر يعمل');
      text($('statesub'), erp.healthy === true ? 'النظام يستجيب للفحص الصحي.' : 'الخدمة تعمل، وفحص الصحة لم يستجب بعد.');
    } else if (stopped) {
      text($('statetitle'), 'السيرفر متوقف');
      text($('statesub'), 'يمكنك تشغيله الآن من هذه اللوحة — قاعدة البيانات لم تتأثر.');
    } else if (serviceState === 'NOT_INSTALLED') {
      text($('statetitle'), 'الخدمة غير مثبّتة');
      text($('statesub'), 'لم يُعثر على خدمة KarimERP-Server على هذا الجهاز.');
    } else {
      text($('statetitle'), 'حالة غير معروفة');
      text($('statesub'), 'تعذّر تحديد حالة الخدمة — راجع سجل العمليات.');
    }

    text($('svc'), serviceState === 'RUNNING' ? 'تعمل' : serviceState === 'STOPPED' ? 'متوقفة' : serviceState === 'NOT_INSTALLED' ? 'غير مثبتة' : serviceState);
    text($('health'), erp.healthy === true ? ('سليم' + (erp.latencyMs != null ? ' (' + erp.latencyMs + 'ms)' : '')) : (erp.checked ? 'لا يستجيب' : '—'));
    var uptimeMs = erp.uptimeMs != null ? erp.uptimeMs : (s && s.control && s.control.uptimeSec != null ? s.control.uptimeSec * 1000 : null);
    text($('uptime'), running ? fmtDuration(uptimeMs) : '—');
    var last = (s && s.lastOperation) || null;
    text($('lastop'), last ? (actionLabel(last.action) + ' · ' + (last.state === 'success' ? 'تم بنجاح' : last.state === 'failed' ? 'فشل' : last.state || '')) : '—');

    var controlsEnabled = !isBusy && s && s.control && s.control.actionsEnabled === true;
    $('start').disabled = !(controlsEnabled && stopped);
    $('stop').disabled = !(controlsEnabled && running);
    $('restart').disabled = !(controlsEnabled && running);

    var opbox = $('opbox');
    if (isBusy) {
      opbox.hidden = false;
      text($('opstage'), stageLabel(op.stage));
      text($('opdetail'), op.actor ? ('المنفّذ: ' + op.actor) : 'لا تغلق هذه الصفحة.');
    } else {
      opbox.hidden = true;
    }

    var hint = $('actionhint');
    if (s && s.control && s.control.actionsEnabled === false) {
      hint.hidden = false;
      hint.textContent = 'الأوامر معطّلة في وضع المعاينة — شغّل الخدمة المرافقة بوضع --service لتفعيلها.';
    } else if (s && s.maintenance && s.maintenance.state === 'stopped' && stopped) {
      hint.hidden = false;
      hint.textContent = 'وضع الصيانة مفعّل: المراقب التلقائي لن يعيد تشغيل النظام حتى تضغط «تشغيل السيرفر».';
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }

    renderAudit((s && s.audit) || []);
  }

  function renderAudit(rows) {
    var list = $('audit');
    list.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'لا عمليات مسجلة بعد.';
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var li = document.createElement('li');
      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = fmtWhen(row.at);
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = row.actor || '—';
      var what = document.createElement('span');
      what.textContent = actionLabel(row.action);
      var badge = document.createElement('span');
      var good = row.result === 'success' || row.result === 'accepted' || row.result === 'login';
      badge.className = 'badge ' + (good ? 'ok' : row.result === 'failed' || row.result === 'login_failed' ? 'bad' : 'neutral');
      badge.textContent = row.result === 'success' ? 'نجح' : row.result === 'accepted' ? 'بدأ' : row.result === 'failed' ? 'فشل' : row.result === 'login' ? 'دخول' : row.result === 'login_failed' ? 'دخول مرفوض' : (row.result || '—');
      li.appendChild(when);
      li.appendChild(who);
      li.appendChild(what);
      li.appendChild(badge);
      list.appendChild(li);
    });
  }

  function loadStatus() {
    return api('/api/status').then(function (s) {
      offline = 0;
      renderStatus(s);
      if (pending && s.operation && s.operation.state !== 'running' && s.operation.id === pending) {
        var done = s.operation.state === 'success';
        pending = null;
        busy = false;
        var err = $('actionerr');
        err.textContent = done ? '' : (s.operation.error || 'فشلت العملية.');
        if (done && s.operation.action === 'stop') {
          var hint = $('actionhint');
          hint.hidden = false;
          hint.textContent = 'تم إيقاف السيرفر. أبقِ هذه الصفحة مفتوحة وأضغط «تشغيل السيرفر» عند الحاجة.';
        }
      }
      schedule(s.operation && s.operation.state === 'running' ? 1500 : 5000);
    }).catch(function (e) {
      if (e && e.status === 401) { showLogin('انتهت الجلسة — سجّل الدخول مجددًا.'); return; }
      offline++;
      schedule(offline < 6 ? 2000 : 10000);
      if (offline >= 4) {
        text($('statesub'), 'تعذّر الوصول إلى لوحة التحكم — تحقق من الخدمة المرافقة.');
      }
    });
  }

  function schedule(ms) {
    stopPolling();
    pollTimer = setTimeout(loadStatus, ms);
  }
  function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }
  function startPolling() {
    stopPolling();
    loadStatus();
  }

  var modalAction = null;
  function openModal(action) {
    modalAction = action;
    var phrase = action === 'stop' ? 'STOP' : action === 'restart' ? 'RESTART' : '';
    $('mtitle').textContent = action === 'stop' ? 'تأكيد إيقاف السيرفر' : action === 'restart' ? 'تأكيد إعادة التشغيل' : 'تأكيد تشغيل السيرفر';
    $('mtext').textContent = action === 'stop'
      ? 'ستتوقف واجهة ERP وواجهات الكاشير مؤقتًا. قاعدة البيانات تبقى تعمل. ستحتاج هذه اللوحة لإعادة التشغيل.'
      : action === 'restart' ? 'سيتم إيقاف السيرفر ثم تشغيله مرة أخرى. تنقطع الواجهات لدقائق.' : 'سيتم بدء خدمة KarimERP-Server وانتظار جاهزية النظام.';
    $('mphrase').textContent = phrase;
    $('mphrasewrap').hidden = !phrase;
    $('mconfirm').className = 'btn ' + (action === 'start' ? 'btn-start' : action === 'restart' ? 'btn-restart' : 'btn-danger');
    $('minput').value = '';
    $('merr').textContent = '';
    $('modal').hidden = false;
    setTimeout(function () { try { (phrase ? $('minput') : $('mconfirm')).focus(); } catch (e) {} }, 30);
  }
  function closeModal() {
    $('modal').hidden = true;
    modalAction = null;
  }

  function doAction(action, phrase) {
    busy = true;
    $('actionerr').textContent = '';
    $('actionhint').hidden = true;
    $('opbox').hidden = false;
    text($('opstage'), 'إرسال الأمر…');
    text($('opdetail'), 'جارٍ تسجيل الطلب.');
    return api('/api/actions', { method: 'POST', body: { action: action, confirm: phrase || '' } })
      .then(function (r) {
        pending = (r && r.operationId) || null;
        if (action === 'stop') {
          var hint = $('actionhint');
          hint.hidden = false;
          hint.textContent = 'تم إرسال أمر الإيقاف — ستُفصل واجهة ERP خلال ثوانٍ. هذه الصفحة تبقى متاحة.';
        }
        schedule(500);
      })
      .catch(function (e) {
        busy = false;
        $('opbox').hidden = true;
        $('actionerr').textContent = (e && e.message) || 'تعذّر تنفيذ الأمر.';
      });
  }

  $('loginform').addEventListener('submit', function (event) {
    event.preventDefault();
    $('loginerr').textContent = '';
    var button = event.target.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; }
    api('/api/login', { method: 'POST', body: { username: $('u').value.trim(), password: $('p').value } })
      .then(function (r) {
        csrf = r.csrf || '';
        $('p').value = '';
        showDash(r.user || {});
      })
      .catch(function (e) {
        $('loginerr').textContent = (e && e.message) || 'تعذّر الدخول.';
        if (e && e.status === 503) { $('loginerr').textContent = 'قاعدة البيانات غير متاحة الآن — لا يمكن التحقق من الهوية.'; }
        else if (e && (e.status === 401 || e.status === 403)) { $('loginerr').textContent = 'بيانات الدخول غير صحيحة أو الحساب ليس مدير نظام.'; }
      })
      .then(function () { if (button) { button.disabled = false; } });
  });

  $('logout').addEventListener('click', function () {
    api('/api/logout', { method: 'POST', body: {} }).catch(function () {}).then(function () { showLogin(''); });
  });
  $('refresh').addEventListener('click', function () { loadStatus(); });
  $('start').addEventListener('click', function () { openModal('start'); });
  $('stop').addEventListener('click', function () { openModal('stop'); });
  $('restart').addEventListener('click', function () { openModal('restart'); });
  $('mcancel').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (event) { if (event.target === $('modal')) { closeModal(); } });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !$('modal').hidden) { closeModal(); } });
  $('mconfirm').addEventListener('click', function () {
    if (!modalAction) { return; }
    var action = modalAction;
    var phrase = action === 'stop' ? 'STOP' : action === 'restart' ? 'RESTART' : '';
    if (phrase) {
      var typed = String($('minput').value || '').trim().toUpperCase();
      if (typed !== phrase) {
        $('merr').textContent = 'اكتب ' + phrase + ' تمامًا للتأكيد.';
        return;
      }
    }
    closeModal();
    doAction(action, phrase);
  });

  api('/api/session').then(function (r) {
    csrf = r.csrf || '';
    if (r.user) { showDash(r.user); } else { showLogin(''); }
  }).catch(function (e) {
    if (e && e.status === 401) { showLogin(''); }
    else { showLogin('تعذّر الاتصال بالخدمة المرافقة.'); }
  });
})();
`;

module.exports = { HTML, CSS, JS };
