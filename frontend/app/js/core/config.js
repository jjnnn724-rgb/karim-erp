/**
 * core/config.js — app configuration constants (extracted verbatim — EXTRACTION-007).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-007).
 */

const CONFIG = { VERSION: '4.9.166', APP_NAME: 'مطاعم الشرفه العالمي', LOGO_PATH: '/app/assets/karim-logo.ico' };

const ROLES = {
admin: { name: 'مدير النظام', icon: '<i class=ji data-i=crown></i>', menus: ['dashboard','menu-board','cfo','cash-register','cashier-sales','sales-inquiry','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','kitchen','veg-requests','dispatch','recipes','reports','settings','users','branches','permissions','hr-dashboard','employees','leaves','attendance','zkteco','yarasoft','oracle-data','yara-daily-locks','sales-analyzer','whatsapp','hr-departments','payroll','employee-portal','roster','query','professional'] },
manager: { name: 'مدير المطعم', icon: '<i class=ji data-i=chart></i>', menus: ['dashboard','menu-board','cfo','cash-register','cashier-sales','sales-inquiry','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','dispatch','recipes','reports','hr-dashboard','employees','leaves','attendance','zkteco','whatsapp','employee-portal','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','kitchen','veg-requests','roster'] },
warehouse: { name: 'أمين المخزن', icon: '<i class=ji data-i=package></i>', menus: ['dashboard','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','veg-requests','procurement','dispatch','roster'] },
// الشيف العمومي وسو شيف: نفس الصلاحيات بالضبط — اللوحة الرئيسية لهم شاشة المطبخ نفسها (بلا لوحة تحكم مالية)
kitchen: { name: 'الشيف العمومي', icon: '<i class=ji data-i=chef-hat></i>', menus: ['kitchen','dispatch','wh-prs','recipes','attendance','leaves','employee-portal','roster'] },
sous_chef: { name: 'سو شيف', icon: '<i class=ji data-i=chef-hat></i>', menus: ['kitchen','dispatch','wh-prs','veg-requests','sales-analyzer','sales-inquiry','received-analyzer','wh-vs-pos','query','professional','recipes','attendance','leaves','employee-portal','roster'] },
dept_head: { name: 'رئيس قسم', icon: '<i class=ji data-i=user-check></i>', menus: ['dashboard','attendance','leaves','employee-portal','dept-employees','dispatch','roster'] },
hr: { name: 'مدير الموارد البشرية', icon: '<i class=ji data-i=users></i>', menus: ['dashboard','hr-dashboard','employees','leaves','attendance','zkteco','hr-departments','payroll','employee-portal','roster'] },
accountant: { name: 'مدير الحسابات', icon: '<i class=ji data-i=calculator></i>', menus: ['dashboard','cfo','cash-register','cashier-sales','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','dispatch','reports','payroll','zkteco','oracle-data','yara-daily-locks','roster'] },
employee: { name: 'موظف', icon: '<i class=ji data-i=user></i>', menus: ['dashboard','attendance','leaves','employee-portal'] },
// المالك: متابعة الكاشير (مرآة يارا سوفت 1/4/5/6/9) + بصمة الحضور + استعلام المبيعات — قراءة فقط
owner: { name: 'المالك', icon: '<i class=ji data-i=crown></i>', menus: ['cashier-monitor','dashboard','zkteco','sales-inquiry'] },
cashier: { name: 'كاشير', icon: '<i class=ji data-i=receipt></i>', menus: ['dashboard','attendance','leaves','employee-portal'] }
};

export { CONFIG, ROLES };
