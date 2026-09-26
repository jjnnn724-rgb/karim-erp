/**
 * Electron Preload Script - karim ERP 🦅
 * ==========================================
 * This script runs in a sandboxed context before the renderer loads.
 * It provides a secure bridge between renderer and main process using
 * contextBridge.
 * 
 * Security: contextIsolation is ENABLED, nodeIntegration is DISABLED
 * 
 * @version 2.0.0
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── Expose Protected API to Renderer ─────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
    // ─── System Status ──────────────────────────────────
    
    /**
     * الحصول على حالة الخدمات
     * @returns {Promise<{serverRunning: boolean, dbRunning: boolean, port: number, host: string, ipAddresses: object}>}
     */
    getStatus: () => ipcRenderer.invoke('app:get-status'),
    
    /**
     * الحصول على معلومات التطبيق
     * @returns {Promise<{version: string, name: string, platform: string, arch: string}>}
     */
    getAppInfo: () => ipcRenderer.invoke('app:get-info'),
    
    // ─── Server Control ─────────────────────────────────
    
    /**
     * إعادة تشغيل السيرفر
     * @returns {Promise<boolean>}
     */
    restartServer: () => ipcRenderer.invoke('app:restart-server'),
    
    // ─── UI Actions ─────────────────────────────────────
    
    /**
     * فتح رابط خارجي في المتصفح الافتراضي
     * @param {string} url - الرابط المطلوب فتحه
     */
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    
    /**
     * عرض نافذة عناوين IP
     */
    showIpDialog: () => ipcRenderer.invoke('app:show-ip-dialog'),
    
    // ─── Event Listeners ───────────────────────────────
    
    /**
     * الاستماع لحدث جاهزية الخدمات
     * @param {function} callback - الدالة التي تُستدعى عند الحدث
     * @returns {function} دالة لإزالة المستمع
     */
    onServicesReady: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('services:ready', listener);
        return () => ipcRenderer.removeListener('services:ready', listener);
    },
    
    /**
     * الاستماع لحدث إعادة تشغيل السيرفر
     * @param {function} callback - الدالة التي تُستدعى عند الحدث
     * @returns {function} دالة لإزالة المستمع
     */
    onServerRestarted: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('server:restarted', listener);
        return () => ipcRenderer.removeListener('server:restarted', listener);
    }
});

// ─── Console Log Enhancement ──────────────────────────────
// Add prefix to distinguish renderer logs in development
if (process.env.NODE_ENV === 'development') {
    const originalLog = console.log;
    console.log = (...args) => originalLog('[Renderer]', ...args);
}

console.log('[Preload] Electron API exposed to renderer.');
