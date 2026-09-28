/**
 * core/config.js — app configuration constants (extracted verbatim — EXTRACTION-007).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-007).
 */

const CONFIG = { VERSION: '4.6.20', APP_NAME: 'مطاعم الشرفه العالمي', LOGO_PATH: '/app/assets/karim-logo.ico' };

const ROLES = {
admin: { name: 'مدير النظام', icon: '<i class=ji data-i=crown></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','warehouse','procurement','kitchen','dispatch','recipes','reports','settings','users','permissions','hr-dashboard','employees','leaves','attendance','zkteco','yarasoft','oracle-data','yara-daily-locks','whatsapp','hr-departments','payroll','employee-portal'] },
manager: { name: 'مدير المطعم', icon: '<i class=ji data-i=chart></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','dispatch','recipes','reports','hr-dashboard','employees','leaves','attendance','zkteco','whatsapp','employee-portal','warehouse','procurement','kitchen'] },
warehouse: { name: 'أمين المخزن', icon: '<i class=ji data-i=package></i>', menus: ['dashboard','warehouse','procurement','dispatch'] },
kitchen: { name: 'الشيف العمومي', icon: '<i class=ji data-i=chef-hat></i>', menus: ['dashboard','kitchen','dispatch','recipes','attendance','leaves','employee-portal'] },
dept_head: { name: 'رئيس قسم', icon: '<i class=ji data-i=user-check></i>', menus: ['dashboard','dispatch'] },
hr: { name: 'مدير الموارد البشرية', icon: '<i class=ji data-i=users></i>', menus: ['dashboard','hr-dashboard','employees','leaves','attendance','zkteco','hr-departments','payroll','employee-portal'] },
accountant: { name: 'مدير الحسابات', icon: '<i class=ji data-i=calculator></i>', menus: ['dashboard','cfo','revenues','expenses','cost-analysis','pnl','departments','warehouse','procurement','dispatch','reports','payroll','zkteco','oracle-data','yara-daily-locks'] },
employee: { name: 'موظف', icon: '<i class=ji data-i=user></i>', menus: ['dashboard','attendance','leaves','employee-portal'] },
cashier: { name: 'كاشير', icon: '<i class=ji data-i=receipt></i>', menus: ['dashboard','attendance','leaves','employee-portal'] }
};

export { CONFIG, ROLES };
