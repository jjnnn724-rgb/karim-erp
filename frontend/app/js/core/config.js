/**
 * core/config.js â€” app configuration constants (extracted verbatim â€” EXTRACTION-007).
 * Bridge policy: mounted on window by js/main.js (BRIDGE-007).
 */

const CONFIG = { VERSION: '4.9.407', APP_NAME: 'ظ…ط·ط§ط¹ظ… ط§ظ„ط´ط±ظپظ‡ ط§ظ„ط¹ط§ظ„ظ…ظٹ', LOGO_PATH: '/app/assets/karim-logo-128.webp' };

const ROLES = {
admin: { name: 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…', icon: '<i class=ji data-i=crown></i>', menus: ['dashboard','menu-board','cfo','cash-register','cashier-sales','sales-inquiry','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','dept-transfers','procurement','kitchen','veg-requests','dispatch','recipes','reports','settings','users','branches','permissions','hr-dashboard','employees','leaves','attendance','zkteco','yarasoft','oracle-data','yara-daily-locks','sales-analyzer','whatsapp','hr-departments','payroll','employee-portal','roster','query','professional'] },
manager: { name: 'ظ…ط¯ظٹط± ط§ظ„ظ…ط·ط¹ظ…', icon: '<i class=ji data-i=chart></i>', menus: ['dashboard','menu-board','cfo','cash-register','cashier-sales','sales-inquiry','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','dispatch','recipes','reports','hr-dashboard','employees','leaves','zkteco','whatsapp','employee-portal','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','dept-transfers','procurement','kitchen','veg-requests','roster'] },
warehouse: { name: 'ط£ظ…ظٹظ† ط§ظ„ظ…ط®ط²ظ†', icon: '<i class=ji data-i=package></i>', menus: ['dashboard','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','dept-transfers','veg-requests','procurement','dispatch','roster'] },
// ط§ظ„ط´ظٹظپ ط§ظ„ط¹ظ…ظˆظ…ظٹ ظˆط³ظˆ ط´ظٹظپ: ظ†ظپط³ ط§ظ„طµظ„ط§ط­ظٹط§طھ ط¨ط§ظ„ط¶ط¨ط· â€” ط§ظ„ظ„ظˆط­ط© ط§ظ„ط±ط¦ظٹط³ظٹط© ظ„ظ‡ظ… ط´ط§ط´ط© ط§ظ„ظ…ط·ط¨ط® ظ†ظپط³ظ‡ط§ (ط¨ظ„ط§ ظ„ظˆط­ط© طھط­ظƒظ… ظ…ط§ظ„ظٹط©)
kitchen: { name: 'ط§ظ„ط´ظٹظپ ط§ظ„ط¹ظ…ظˆظ…ظٹ', icon: '<i class=ji data-i=chef-hat></i>', menus: ['kitchen','dispatch','wh-prs','dept-transfers','recipes','leaves','employee-portal','roster'] },
sous_chef: { name: 'ط³ظˆ ط´ظٹظپ', icon: '<i class=ji data-i=chef-hat></i>', menus: ['kitchen','dispatch','wh-prs','dept-transfers','veg-requests','sales-analyzer','sales-inquiry','received-analyzer','wh-vs-pos','query','professional','recipes','attendance','leaves','employee-portal','roster'] },
dept_head: { name: 'ط±ط¦ظٹط³ ظ‚ط³ظ…', icon: '<i class=ji data-i=user-check></i>', menus: ['dashboard','leaves','employee-portal','dept-employees','dispatch','dept-transfers','roster'] },
hr: { name: 'ظ…ط¯ظٹط± ط§ظ„ظ…ظˆط§ط±ط¯ ط§ظ„ط¨ط´ط±ظٹط©', icon: '<i class=ji data-i=users></i>', menus: ['dashboard','hr-dashboard','employees','leaves','attendance','zkteco','hr-departments','payroll','employee-portal','roster'] },
accountant: { name: 'ظ…ط¯ظٹط± ط§ظ„ط­ط³ط§ط¨ط§طھ', icon: '<i class=ji data-i=calculator></i>', menus: ['dashboard','cfo','cash-register','cashier-sales','revenues','expenses','cost-center','cost-analysis','pnl','monthly-comparison','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','dept-transfers','procurement','dispatch','reports','payroll','zkteco','oracle-data','yara-daily-locks','roster'] },
employee: { name: 'ظ…ظˆط¸ظپ', icon: '<i class=ji data-i=user></i>', menus: ['dashboard','leaves','employee-portal'] },
// ط§ظ„ظ…ط§ظ„ظƒ: ظ…طھط§ط¨ط¹ط© ط§ظ„ظƒط§ط´ظٹط± (ظ…ط±ط¢ط© ظٹط§ط±ط§ ط³ظˆظپطھ 1/4/5/6/9) + ط¨طµظ…ط© ط§ظ„ط­ط¶ظˆط± + ط§ط³طھط¹ظ„ط§ظ… ط§ظ„ظ…ط¨ظٹط¹ط§طھ â€” ظ‚ط±ط§ط،ط© ظپظ‚ط·
owner: { name: 'ط§ظ„ظ…ط§ظ„ظƒ', icon: '<i class=ji data-i=crown></i>', menus: ['cashier-monitor','dashboard','zkteco','sales-inquiry'] },
cashier: { name: 'ظƒط§ط´ظٹط±', icon: '<i class=ji data-i=receipt></i>', menus: ['dashboard','leaves','employee-portal'] }
};

export { CONFIG, ROLES };
