/**
 * ui/enhancement.js — Enhancement Pack v10 (extracted verbatim from app.js — EXTRACTION-024).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-024).
 * Note: the pack DOMContentLoaded listener STAYS in app.js to preserve boot-order semantics.
 */
// ============================================
// <i class=ji data-i=palette></i> ENHANCEMENT PACK v10.0 - JS
// ============================================

// <i class=ji data-i=search></i> Command Palette Data & Functions
const COMMAND_ITEMS = [
  {icon:'<i class=ji data-i=chart></i>',title:'لوحة التحكم',subtitle:'عرض الإحصائيات والتقارير السريعة',action:()=>go('dashboard',null),shortcut:'G D'},
  {icon:'<i class=ji data-i=banknote></i>',title:'الإيرادات',subtitle:'إدارة الإيرادات',action:()=>go('revenues',null),shortcut:'G R'},
  {icon:'<i class=ji data-i=wallet></i>',title:'المصاريف',subtitle:'إدارة المصاريف',action:()=>go('expenses',null),shortcut:'G E'},
  {icon:'<i class=ji data-i=package></i>',title:'المخزن',subtitle:'إدارة المخزون',action:()=>go('warehouse',null),shortcut:'G W'},
  {icon:'<i class=ji data-i=chef-hat></i>',title:'المطبخ',subtitle:'إدارة المطبخ',action:()=>go('kitchen',null)},
  {icon:'<i class=ji data-i=clipboard-list></i>',title:'سجل الصرف',subtitle:'عرض طلبات الصرف',action:()=>go('dispatch',null)},
  {icon:'<i class=ji data-i=utensils></i>',title:'الوصفات',subtitle:'إدارة الوصفات',action:()=>go('recipes',null)},
  {icon:'<i class=ji data-i=trending-up></i>',title:'تحليل التكاليف',subtitle:'الإيرادات مقابل المصاريف',action:()=>go('cost-analysis',null),shortcut:'G C'},
  {icon:'<i class=ji data-i=gem></i>',title:'الأرباح والخسائر',subtitle:'قائمة الدخل الحية من الحركات الفعلية',action:()=>go('pnl',null),shortcut:'G P'},
  {icon:'<i class=ji data-i=building></i>',title:'الأقسام',subtitle:'إدارة الأقسام',action:()=>go('departments',null)},
  {icon:'<i class=ji data-i=user></i>',title:'إدارة الموظفين',subtitle:'قائمة الموظفين',action:()=>go('employees',null),shortcut:'G E'},
  {icon:'<i class=ji data-i=timer></i>',title:'الحضور والانصراف',subtitle:'سجل الحضور',action:()=>go('attendance',null)},
  {icon:'<i class=ji data-i=calendar></i>',title:'الإجازات',subtitle:'طلبات الإجازات',action:()=>go('leaves',null)},
  {icon:'<i class=ji data-i=banknote></i>',title:'الرواتب',subtitle:'إدارة الرواتب',action:()=>go('payroll',null)},
  {icon:'<i class=ji data-i=chart></i>',title:'التقارير',subtitle:'إنشاء التقارير',action:()=>go('reports',null)},
  {icon:'<i class=ji data-i=settings></i>',title:'الإعدادات',subtitle:'إعدادات النظام',action:()=>go('settings',null)},
  {icon:'<i class=ji data-i=users></i>',title:'المستخدمين',subtitle:'إدارة المستخدمين',action:()=>go('users',null)},
  {icon:'<i class=ji data-i=plus></i>',title:'إضافة إيراد',subtitle:'إضافة إيراد جديد',action:()=>showAddRevenueModal(),shortcut:'A R'},
  {icon:'<i class=ji data-i=plus></i>',title:'إضافة مصروف',subtitle:'إضافة مصروف جديد',action:()=>showAddExpenseModal(),shortcut:'A E'},
  {icon:'<i class=ji data-i=package></i>',title:'طلب صرف جديد',subtitle:'إنشاء طلب صرف جديد',action:()=>showDispatchRequestModal(),shortcut:'A D'},
  {icon:'<i class=ji data-i=globe></i>',title:'تبديل اللغة',subtitle:'التبديل بين العربية والإنجليزية',action:()=>toggleLang(),shortcut:'L'},
  {icon:'<i class=ji data-i=moon></i>',title:'تبديل المظهر',subtitle:'تبديل المظهر الفاتح/الداكن',action:()=>toggleTheme(),shortcut:'T'},
  {icon:'<i class=ji data-i=log-out></i>',title:'تسجيل الخروج',subtitle:'الخروج من النظام',action:()=>doLogout(),shortcut:'Q'},
];

let commandPaletteSelected = 0;
let commandPaletteFiltered = [];

function openCommandPalette(){
  document.getElementById('commandPalette').classList.add('show');
  document.getElementById('commandInput').value='';
  document.getElementById('commandInput').focus();
  filterCommands('');
}
function closeCommandPalette(){
  document.getElementById('commandPalette').classList.remove('show');
}
function filterCommands(query){
  const q = query.toLowerCase().trim();
  commandPaletteFiltered = COMMAND_ITEMS.filter(item =>
    item.title.includes(q) || (item.subtitle&&item.subtitle.toLowerCase().includes(q)) || item.icon.includes(q)
  );
  commandPaletteSelected = 0;
  renderCommandResults();
}
function renderCommandResults(){
  const container = document.getElementById('commandResults');
  if(commandPaletteFiltered.length === 0){
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">لا توجد نتائج</div>';
    return;
  }
  container.innerHTML = commandPaletteFiltered.map((item, idx) => `
    <div class="command-item ${idx === commandPaletteSelected ? 'selected' : ''}" data-karim-action="executeCommand" data-karim-arg0="${idx}">
      <div class="command-item-icon">${item.icon}</div>
      <div class="command-item-text">
        <div class="command-item-title">${item.title}</div>
        ${item.subtitle ? `<div class="command-item-subtitle">${item.subtitle}</div>` : ''}
      </div>
      ${item.shortcut ? `<span class="command-item-shortcut">${item.shortcut}</span>` : ''}
    </div>
  `).join('');
}
function executeCommand(idx){
  if(commandPaletteFiltered[idx]){
    commandPaletteFiltered[idx].action();
    closeCommandPalette();
  }
}
function handleCommandKey(e){
  if(e.key === 'Escape'){ closeCommandPalette(); return; }
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    commandPaletteSelected = Math.min(commandPaletteSelected + 1, commandPaletteFiltered.length - 1);
    renderCommandResults();
    return;
  }
  if(e.key === 'ArrowUp'){
    e.preventDefault();
    commandPaletteSelected = Math.max(commandPaletteSelected - 1, 0);
    renderCommandResults();
    return;
  }
  if(e.key === 'Enter'){
    e.preventDefault();
    executeCommand(commandPaletteSelected);
    return;
  }
}
document.getElementById('commandInput')?.addEventListener('input', (e)=>filterCommands(e.target.value));
document.getElementById('commandInput')?.addEventListener('keydown', handleCommandKey);
document.getElementById('commandPalette')?.addEventListener('click',(e)=>{ if(e.target.id==='commandPalette') {closeCommandPalette();} });

// <i class=ji data-i=target></i> FAB Functions
function toggleFabMenu(){
  const menu = document.getElementById('fabMenu');
  if(menu) {menu.classList.toggle('show');}
}
document.addEventListener('click',(e)=>{
  const fab = document.getElementById('fabBtn');
  const menu = document.getElementById('fabMenu');
  if(fab && menu && !fab.contains(e.target) && !menu.contains(e.target)){
    menu.classList.remove('show');
  }
});

// Keyboard activation for shell controls marked data-kb-activate
// (div-based buttons keep their inline onclick untouched; Enter/Space
// simply replays a click so mouse behavior is 100% unchanged).
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter' && e.key !== ' ') {return;}
  const t = e.target && e.target.closest ? e.target.closest('[data-kb-activate]') : null;
  if(!t) {return;}
  const tag = e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {return;}
  e.preventDefault();
  t.click();
});

// <i class=ji data-i=keyboard></i> Global Keyboard Shortcuts
let keyboardSequence = '';
let keyboardTimeout = null;
document.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  const tag = e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable){
    if(e.ctrlKey && e.key === 'k'){
      e.preventDefault();
      openCommandPalette();
    }
    return;
  }
  // Ctrl+K - Command Palette
  if((e.ctrlKey || e.metaKey) && e.key === 'k'){
    e.preventDefault();
    openCommandPalette();
    return;
  }
  // Slash - Command Palette
  if(e.key === '/' && !e.ctrlKey){
    e.preventDefault();
    openCommandPalette();
    return;
  }
  // ? - Show shortcuts help
  if(e.key === '?' && e.shiftKey){
    e.preventDefault();
    showShortcutsHelp();
    return;
  }
  // Ctrl+/ - Toggle sidebar
  if(e.ctrlKey && e.key === '/'){
    e.preventDefault();
    toggleSidebar();
    return;
  }
  // Escape - Close command palette / FAB
  if(e.key === 'Escape'){
    closeCommandPalette();
    const menu = document.getElementById('fabMenu');
    if(menu) {menu.classList.remove('show');}
    closeModal();
    return;
  }
  // Single key shortcuts (only when not in input)
  if(!e.ctrlKey && !e.metaKey && !e.altKey){
    const key = e.key.toLowerCase();
    // Gmail-style sequences (g then letter)
    if(keyboardSequence === 'g'){
      const map = {d:'dashboard',r:'revenues',e:'employees',w:'warehouse',c:'cost-analysis'};
      if(map[key]){ e.preventDefault(); go(map[key], null); keyboardSequence = ''; return; }
    }
    if(key === 'g'){
      keyboardSequence = 'g';
      clearTimeout(keyboardTimeout);
      keyboardTimeout = setTimeout(()=>{ keyboardSequence = ''; }, 800);
      return;
    }
    // Single shortcuts
    const singleMap = {
      'l': ()=>toggleLang(),
      't': ()=>toggleTheme(),
      'q': ()=>doLogout(),
      'n': ()=>{ if(typeof showAddRevenueModal==='function') {showAddRevenueModal();} }
    };
    if(singleMap[key]){
      e.preventDefault();
      singleMap[key]();
      keyboardSequence = '';
      return;
    }
  }
});

function showShortcutsHelp(){
  showModal(`
    <h3 style="color:var(--gold);font-weight:900;margin-bottom:20px"><i class=ji data-i=keyboard></i> اختصارات لوحة المفاتيح</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=search></i> البحث</div>
        <div class="u-t13"><kbd class="u-chip">Ctrl + K</kbd> أو <kbd class="u-chip">/</kbd> فتح لوحة الأوامر</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=globe></i> اللغة والوضع</div>
        <div class="u-t13"><kbd class="u-chip">L</kbd> تبديل اللغة</div>
        <div class="u-t13"><kbd class="u-chip">T</kbd> تبديل المظهر</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=chart></i> التنقل السريع</div>
        <div class="u-t13"><kbd class="u-chip">G D</kbd> لوحة التحكم</div>
        <div class="u-t13"><kbd class="u-chip">G R</kbd> الإيرادات</div>
        <div class="u-t13"><kbd class="u-chip">G E</kbd> الموظفين</div>
        <div class="u-t13"><kbd class="u-chip">G W</kbd> المخزن</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=zap></i> أخرى</div>
        <div class="u-t13"><kbd class="u-chip">Ctrl + /</kbd> طي القائمة</div>
        <div class="u-t13"><kbd class="u-chip">?</kbd> عرض هذه المساعدة</div>
        <div class="u-t13"><kbd class="u-chip">Esc</kbd> إغلاق النوافذ</div>
        <div class="u-t13"><kbd class="u-chip">Q</kbd> تسجيل الخروج</div>
      </div>
    </div>
    <div class="modal-footer" style="margin-top:20px">
      <button class="btn btn-gold" data-karim-action="closeModal">فهمت</button>
    </div>
  `, 'modal-lg');
}

// <i class=ji data-i=party></i> Confetti Celebration
function celebrate(){
  const colors = ['#d4a843','#f0c96b','#2ecc71','#3498db','#9b59b6','#e74c3c'];
  const emojis = ['<i class=ji data-i=party></i>','<i class=ji data-i=party></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>'];
  for(let i = 0; i < 50; i++){
    setTimeout(()=>{
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.left = Math.random() * window.innerWidth + 'px';
      conf.style.top = '-20px';
      conf.style.background = colors[Math.floor(Math.random()*colors.length)];
      conf.style.fontSize = (Math.random() * 20 + 10) + 'px';
      if(Math.random() > 0.5) {conf.textContent = emojis[Math.floor(Math.random()*emojis.length)];}
      conf.style.transform = `rotate(${Math.random()*360}deg)`;
      document.body.appendChild(conf);
      const x = (Math.random() - 0.5) * 200;
      const y = window.innerHeight + 50;
      conf.style.setProperty('--x', x + 'px');
      conf.style.setProperty('--y', y + 'px');
      setTimeout(()=>conf.remove(), 2000);
    }, i * 30);
  }
}

// <i class=ji data-i=star></i> Particle Effect on click
document.addEventListener('click', (e) => {
  // Don't spawn particles on buttons/inputs to avoid noise
  if(e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) {return;}
  if(Math.random() > 0.85){ // Only sometimes
    spawnParticle(e.clientX, e.clientY, '<i class=ji data-i=star></i>');
  }
});
function spawnParticle(x, y, emoji){
  const p = document.createElement('div');
  p.className = 'particle';
  p.textContent = emoji;
  p.style.left = x + 'px';
  p.style.top = y + 'px';
  const xMove = (Math.random() - 0.5) * 100;
  const yMove = -Math.random() * 80 - 20;
  p.style.setProperty('--x', xMove + 'px');
  p.style.setProperty('--y', yMove + 'px');
  document.body.appendChild(p);
  setTimeout(()=>p.remove(), 1000);
}

// <i class=ji data-i=play></i> Splash Screen Hide
function hideSplash(){
  const splash = document.getElementById('splashScreen');
  if(splash){
    setTimeout(()=>{
      splash.classList.add('hide');
      setTimeout(()=>splash.remove(), 800);
    }, 2200);
  }
}

// <i class=ji data-i=clock></i> Live Clock
let _liveClockTimer = null;
function startLiveClock(){
  // Re-rendering the dashboard used to start a NEW untracked 1s interval on
  // every render — dozens of timers accumulating CPU and touching removed DOM.
  if (_liveClockTimer) {clearInterval(_liveClockTimer);}
  function update(){
    const el = document.getElementById('liveClock');
    if(el){
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }
    const dateEl = document.getElementById('liveDate');
    if(dateEl){
      const now = new Date();
      const days = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      dateEl.textContent = `${days[now.getDay()]} · ${now.toLocaleDateString('en-GB')}`;
    }
  }
  update();
  _liveClockTimer = setInterval(update, 1000);
}

// <i class=ji data-i=palette></i> Welcome Banner Injection (for Dashboard)
function injectWelcomeBanner(){
  const content = document.getElementById('content');
  if(!content || !STATE.currentUser) {return;}
  // Only on dashboard
  if(STATE.page !== 'dashboard') {return;}
  const role = STATE.currentUser.role;
  const name = STATE.currentUser.name || 'مستخدم';
  const greeting = (()=>{
    const h = new Date().getHours();
    if(h < 12) {return 'صباح الخير';}
    if(h < 18) {return 'مساء الخير';}
    return 'مساء النور';
  })();
  const roleIcon = (ROLES[role]||{}).icon || '<i class=ji data-i=user></i>';
  const banner = document.createElement('div');
  banner.className = 'welcome-banner';
  banner.innerHTML = `
    <div class="welcome-icon">${roleIcon}</div>
    <div class="welcome-text">
      <div class="welcome-title">${greeting}، ${name} <i class=ji data-i=user-check></i></div>
      <div class="welcome-sub">إليك ملخص سريع لنشاطك اليوم</div>
      <div id="liveDate" style="color:var(--text3);font-size:12px;margin-top:4px"></div>
    </div>
    <div class="welcome-time" id="liveClock">00:00:00</div>
  `;
  content.insertBefore(banner, content.firstChild);
  startLiveClock();
}

// <i class=ji data-i=target></i> Enhanced toast
const _origToast = window.toast || toast;
function enhancedToast(msg, type='success'){
  const container = document.getElementById('toasts');
  if(!container) {return;}
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = {success:'<i class=ji data-i=circle-check></i>',error:'<i class=ji data-i=circle-x></i>',warning:'<i class=ji data-i=alert-triangle></i>',info:'<i class=ji data-i=info></i>'};
  t.innerHTML = `<span style="font-size:18px">${icons[type]||'<i class=ji data-i=info></i>'}</span><span style="flex:1;font-size:13px">${msg}</span>`;
  container.appendChild(t);
  setTimeout(()=>{
    t.classList.add('removing');
    setTimeout(()=>t.remove(), 300);
  }, 3000);
  if(type === 'success' && Math.random() > 0.7){
    setTimeout(()=>spawnParticle(window.innerWidth/2, 100, '<i class=ji data-i=party></i>'), 100);
  }
}
window.enhancedToast = enhancedToast;

// <i class=ji data-i=chart></i> Animated Counter
function animateCounter(element, target, duration = 1500, prefix = '', suffix = ''){
  if(!element) {return;}
  const start = 0;
  const startTime = performance.now();
  function update(now){
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * easeOut;
    element.textContent = prefix + (Number.isInteger(target) ? Math.floor(current).toLocaleString('en-US') : current.toFixed(1).toLocaleString('en-US')) + suffix;
    if(progress < 1) {requestAnimationFrame(update);}
    else {element.textContent = prefix + (Number.isInteger(target) ? target.toLocaleString('en-US') : target.toFixed(1).toLocaleString('en-US')) + suffix;}
  }
  requestAnimationFrame(update);
}

// <i class=ji data-i=star></i> Auto-enhance page on render
const _origRenderPage = window.renderPage;
window.renderPage = async function(){
  if(_origRenderPage) {await _origRenderPage();}
  setTimeout(()=>{
    // Auto-inject welcome banner on dashboard
    if(STATE.page === 'dashboard'){
      injectWelcomeBanner();
    }
    // Add live-dot to topbar time
    const pageTitle = document.getElementById('pageTitle');
    if(pageTitle && !pageTitle.querySelector('.live-dot')){
      // Already styled
    }
    // Auto-number stats with animation
    document.querySelectorAll('.mcard-val, .metric-card-premium .value').forEach(el => {
      const txt = el.textContent;
      const numMatch = txt.match(/[\d,]+\.?\d*/);
      if(numMatch){
        const num = parseFloat(numMatch[0].replace(/,/g, ''));
        if(!isNaN(num) && num < 1000000){
          // Skip animation for static elements to avoid disruption
        }
      }
    });
  }, 50);
};


export { COMMAND_ITEMS, commandPaletteSelected, commandPaletteFiltered, openCommandPalette, closeCommandPalette, filterCommands, renderCommandResults, executeCommand, handleCommandKey, toggleFabMenu, keyboardSequence, keyboardTimeout, showShortcutsHelp, celebrate, spawnParticle, hideSplash, _liveClockTimer, startLiveClock, injectWelcomeBanner, _origToast, enhancedToast, animateCounter, _origRenderPage };
