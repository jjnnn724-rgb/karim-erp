/**
 * core/config.js — app configuration constants (extracted verbatim — EXTRACTION-007).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-007).
 */

const CONFIG = { VERSION: '4.8.2', APP_NAME: 'مطاعم الشرفه العالمي', LOGO_PATH: '/app/assets/karim-logo.ico' };

const ROLES = {
admin: { name: 'مدير النظام', icon: '<i class=ji data-i=crown></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','kitchen','dispatch','recipes','reports','settings','users','permissions','hr-dashboard','employees','leaves','attendance','zkteco','yarasoft','oracle-data','yara-daily-locks','whatsapp','hr-departments','payroll','employee-portal','roster'] },
manager: { name: 'مدير المطعم', icon: '<i class=ji data-i=chart></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','dispatch','recipes','reports','hr-dashboard','employees','leaves','attendance','zkteco','whatsapp','employee-portal','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','kitchen','roster'] },
warehouse: { name: 'أمين المخزن', icon: '<i class=ji data-i=package></i>', menus: ['dashboard','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','dispatch','roster'] },
kitchen: { name: 'الشيف العمومي', icon: '<i class=ji data-i=chef-hat></i>', menus: ['dashboard','kitchen','dispatch','wh-prs','recipes','attendance','leaves','employee-portal','roster'] },
dept_head: { name: 'رئيس قسم', icon: '<i class=ji data-i=user-check></i>', menus: ['dashboard','attendance','leaves','employee-portal','dept-employees','dispatch','roster'] },
hr: { name: 'مدير الموارد البشرية', icon: '<i class=ji data-i=users></i>', menus: ['dashboard','hr-dashboard','employees','leaves','attendance','zkteco','hr-departments','payroll','employee-portal','roster'] },
accountant: { name: 'مدير الحسابات', icon: '<i class=ji data-i=calculator></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','procurement','dispatch','reports','payroll','zkteco','oracle-data','yara-daily-locks','roster'] },
employee: { name: 'موظف', icon: '<i class=ji data-i=user></i>', menus: ['dashboard','attendance','leaves','employee-portal'] },
cashier: { name: 'كاشير', icon: '<i class=ji data-i=receipt></i>', menus: ['dashboard','attendance','leaves','employee-portal'] }
};

export { CONFIG, ROLES };
