// ============================================================
//  Karim ERP v4.7.0 — Bilingual System (Arabic + English)
//  ============================================================
//  All UI strings are available in both languages.
//  Toggle between AR (RTL) and EN (LTR) via the language button.
// ============================================================

const TRANSLATIONS = {
    ar: {
        // Navigation
        dashboard: 'لوحة التحكم',
        employees: 'الموظفون',
        attendance: 'الحضور',
        inventory: 'المخزون',
        finance: 'المالية',
        settings: 'الإعدادات',
        whatsapp: 'واتساب',
        systemQuery: 'استعلامات',
        logout: 'خروج',

        // Common
        search: 'بحث...',
        save: 'حفظ',
        cancel: 'إلغاء',
        delete: 'حذف',
        edit: 'تعديل',
        add: 'إضافة',
        print: 'طباعة',
        export: 'تصدير',
        refresh: 'تحديث',
        loading: 'جارٍ التحميل...',
        noData: 'لا توجد بيانات',
        confirm: 'تأكيد',

        // Login
        loginTitle: 'Karim ERP v4.7.0',
        loginSubtitle: 'مطاعم الشرفه العالمي — نظام إدارة متكامل',
        username: 'اسم المستخدم',
        password: 'كلمة المرور',
        login: 'تسجيل الدخول',
        language: 'اللغة',

        // Cards
        employeeCard: 'بطاقة الموظف',
        attendanceDays: 'أيام الحضور',
        lateDays: 'أيام التأخير',
        totalDelay: 'إجمالي التأخير',
        actualHours: 'الساعات الفعلية',
        salary: 'الراتب',
        netSalary: 'الراتب الصافي',
        leaveApproved: 'إجازات معتمدة',
        leavePending: 'إجازات معلقة',

        // WhatsApp
        whatsappEngine: 'محرك واتساب',
        qrCode: 'رمز QR',
        refreshQR: 'رمز جديد',
        connected: 'متصل',
        disconnected: 'غير متصل',
        connecting: 'جارٍ الاتصال...',
        messages: 'رسائل',
        sendMessage: 'إرسال رسالة',

        // Query Engine
        queryEngine: 'محرك الاستعلامات',
        queryHere: 'اكتب سؤالك هنا...',
        categories: 'الفئات',
        attendanceQuery: 'استعلام الحضور',
        revenueQuery: 'استعلام الإيرادات',
        inventoryQuery: 'استعلام المخزون',
        employeesQuery: 'استعلام الموظفين',
        financeQuery: 'استعلام مالي',
        systemStatus: 'حالة السيرفر',
        today: 'اليوم',
        thisMonth: 'هذا الشهر',

        // Smart Card
        attendanceRate: 'نسبة الحضور',
        onTimeRate: 'في الموعد',
        workDays: 'أيام العمل',
        lateDaysLabel: 'أيام متأخر',
        approvedLeaves: 'إجازات معتمدة',
        workStart: 'بداية الدوام',
        workEnd: 'نهاية الدوام',
        iqamaExpiry: 'انتهاء الإقامة',
        healthCert: 'الشهادة الصحية',
        badgeExcellent: 'ممتاز',
        badgeGood: 'جيد',
        badgeNeedsImprovement: 'يحتاج تحسين',

        // Actions
        viewQR: 'عرض QR كبير',
        downloadCard: 'حفظ كصورة',
        regenerate: 'تجديد',
        attendanceDay: 'كشف اليوم',
        attendanceMonth: 'كشف الشهر',
        printCard: 'طباعة البطاقة',

        // Professional Card
        professionalCard: 'البطاقة الفاخرة',
        employeeInfo: 'معلومات الموظف',
        contactInfo: 'معلومات التواصل',
        periodInsurance: 'الفترة والتأمين',
        performance: 'أداء الحضور',
        netSalaryLabel: 'الراتب الصافي بعد التأخير',
        basicSalary: 'الأساسي',
        delayDeduction: 'خصم التأخير',
        net: 'صافي',
        delayWarning: '⚠ قبل انتهاء',

        // System
        serverStatus: 'حالة السيرفر',
        healthy: 'صحي',
        unhealthy: 'غير صحي',
        database: 'قاعدة البيانات',
        memory: 'الذاكرة',
        connections: 'الاتصالات',
        uptime: 'وقت التشغيل',

        // Errors
        error: 'خطأ',
        connectionError: 'خطأ في الاتصال',
        unauthorized: 'غير مصرح',
        serverError: 'خطأ في السيرفر',
        retry: 'إعادة المحاولة',

        // PWA
        installApp: 'تثبيت التطبيق',
        offlineMode: 'الوضع غير متصل',
        cacheAvailable: 'متاح في التخزين المؤقت',

        // Header
        appName: 'Karim ERP',
        systemName: 'مطاعم الشرفه العالمي',
        version: 'الإصدار',
        online: 'متصل',
        offline: 'غير متصل',

        // Settings
        generalSettings: 'الإعدادات العامة',
        currency: 'العملة',
        timezone: 'المنطقة الزمنية',
        languageSettings: 'إعدادات اللغة',
        autoStart: 'التشغيل التلقائي',
        whatsappSettings: 'إعدادات واتساب',
        sessionBackup: 'نسخ الجلسة الاحتياطي',

        // Finance
        revenue: 'الإيرادات',
        expenses: 'المصاريف',
        profit: 'الربح',
        pnl: 'الربح والخسارة',
        dailyRevenue: 'إيرادات اليوم',
        monthlyRevenue: 'إيرادات الشهر',
        totalOrders: 'إجمالي الطلبات',
        avgOrderValue: 'متوسط قيمة الطلب',

        // Attendance
        totalPresent: 'الحاضرين',
        totalAbsent: 'الغائبين',
        totalLate: 'المتأخرين',
        attendanceSummary: 'ملخص الحضور',
        employeeName: 'اسم الموظف',
        status: 'الحالة',
        checkInTime: 'وقت الدخول',
        checkOutTime: 'وقت الخروج',
        lateMinutes: 'دقائق التأخير',

        // Inventory
        products: 'المنتجات',
        stockQuantity: 'الكمية في المخزون',
        totalValue: 'القيمة الإجمالية',
        lowStock: 'مخزون منخفض',
        addProduct: 'إضافة منتج',
        updateStock: 'تحديث المخزون',
    },
    en: {
        // Navigation
        dashboard: 'Dashboard',
        employees: 'Employees',
        attendance: 'Attendance',
        inventory: 'Inventory',
        finance: 'Finance',
        settings: 'Settings',
        whatsapp: 'WhatsApp',
        systemQuery: 'System Query',
        logout: 'Logout',

        // Common
        search: 'Search...',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        add: 'Add',
        print: 'Print',
        export: 'Export',
        refresh: 'Refresh',
        loading: 'Loading...',
        noData: 'No data',
        confirm: 'Confirm',

        // Login
        loginTitle: 'Karim ERP v4.7.0',
        loginSubtitle: 'Horus Global Restaurants — Integrated Management System',
        username: 'Username',
        password: 'Password',
        login: 'Sign In',
        language: 'Language',

        // Cards
        employeeCard: 'Employee Card',
        attendanceDays: 'Days Present',
        lateDays: 'Late Days',
        totalDelay: 'Total Delay',
        actualHours: 'Actual Hours',
        salary: 'Salary',
        netSalary: 'Net Salary',
        leaveApproved: 'Approved Leaves',
        leavePending: 'Pending Leaves',

        // WhatsApp
        whatsappEngine: 'WhatsApp Engine',
        qrCode: 'QR Code',
        refreshQR: 'New QR',
        connected: 'Connected',
        disconnected: 'Disconnected',
        connecting: 'Connecting...',
        messages: 'Messages',
        sendMessage: 'Send Message',

        // Query Engine
        queryEngine: 'Query Engine',
        queryHere: 'Type your question...',
        categories: 'Categories',
        attendanceQuery: 'Attendance Query',
        revenueQuery: 'Revenue Query',
        inventoryQuery: 'Inventory Query',
        employeesQuery: 'Employees Query',
        financeQuery: 'Financial Query',
        systemStatus: 'Server Status',
        today: 'Today',
        thisMonth: 'This Month',

        // Smart Card
        attendanceRate: 'Attendance Rate',
        onTimeRate: 'On-Time Rate',
        workDays: 'Work Days',
        lateDaysLabel: 'Late Days',
        approvedLeaves: 'Approved Leaves',
        workStart: 'Shift Start',
        workEnd: 'Shift End',
        iqamaExpiry: 'Iqama Expiry',
        healthCert: 'Health Certificate',
        badgeExcellent: 'Excellent',
        badgeGood: 'Good',
        badgeNeedsImprovement: 'Needs Improvement',

        // Actions
        viewQR: 'View QR Full',
        downloadCard: 'Save as Image',
        regenerate: 'Regenerate',
        attendanceDay: 'Day Report',
        attendanceMonth: 'Monthly Report',
        printCard: 'Print Card',

        // Professional Card
        professionalCard: 'Professional Card',
        employeeInfo: 'Employee Info',
        contactInfo: 'Contact Info',
        periodInsurance: 'Period & Insurance',
        performance: 'Attendance Performance',
        netSalaryLabel: 'Net Salary After Delay',
        basicSalary: 'Basic',
        delayDeduction: 'Delay Deduction',
        net: 'Net',
        delayWarning: '⚠ Expires in',

        // System
        serverStatus: 'Server Status',
        healthy: 'Healthy',
        unhealthy: 'Unhealthy',
        database: 'Database',
        memory: 'Memory',
        connections: 'Connections',
        uptime: 'Uptime',

        // Errors
        error: 'Error',
        connectionError: 'Connection Error',
        unauthorized: 'Unauthorized',
        serverError: 'Server Error',
        retry: 'Retry',

        // PWA
        installApp: 'Install App',
        offlineMode: 'Offline Mode',
        cacheAvailable: 'Available Offline',

        // Header
        appName: 'Karim ERP',
        systemName: 'Horus Global Restaurants',
        version: 'Version',
        online: 'Online',
        offline: 'Offline',

        // Settings
        generalSettings: 'General Settings',
        currency: 'Currency',
        timezone: 'Timezone',
        languageSettings: 'Language Settings',
        autoStart: 'Auto Start',
        whatsappSettings: 'WhatsApp Settings',
        sessionBackup: 'Session Backup',

        // Finance
        revenue: 'Revenue',
        expenses: 'Expenses',
        profit: 'Profit',
        pnl: 'Profit & Loss',
        dailyRevenue: 'Daily Revenue',
        monthlyRevenue: 'Monthly Revenue',
        totalOrders: 'Total Orders',
        avgOrderValue: 'Avg Order Value',

        // Attendance
        totalPresent: 'Present',
        totalAbsent: 'Absent',
        totalLate: 'Late',
        attendanceSummary: 'Attendance Summary',
        employeeName: 'Employee Name',
        status: 'Status',
        checkInTime: 'Check In',
        checkOutTime: 'Check Out',
        lateMinutes: 'Late Minutes',

        // Inventory
        products: 'Products',
        stockQuantity: 'Stock Quantity',
        totalValue: 'Total Value',
        lowStock: 'Low Stock',
        addProduct: 'Add Product',
        updateStock: 'Update Stock',
    }
};

// Current language state
let currentLang = 'ar';

function t(key) {
    return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS['ar']?.[key] || key;
}

function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('erp_lang', lang);
    applyLang();
}

function getLang() {
    return localStorage.getItem('erp_lang') || 'ar';
}

function applyLang() {
    const html = document.documentElement;
    if (currentLang === 'en') {
        html.setAttribute('dir', 'ltr');
        html.setAttribute('lang', 'en');
    } else {
        html.setAttribute('dir', 'rtl');
        html.setAttribute('lang', 'ar');
    }
    // Update all [data-t] elements
    document.querySelectorAll('[data-t]').forEach(el => {
        const key = el.getAttribute('data-t');
        const val = t(key);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = val;
        } else {
            el.textContent = val;
        }
    });
    // Update title
    document.title = currentLang === 'en'
        ? 'Karim ERP v4.7.0 — Horus Global Restaurants'
        : 'مطاعم الشرفه العالمي — نظام إدارة المطاعم المتكامل';
}

// Initialize
currentLang = getLang();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLang);
} else {
    applyLang();
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TRANSLATIONS, t, setLang, getLang, applyLang, currentLang };
}
