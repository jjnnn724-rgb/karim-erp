const { pool } = require('../backend/shared-pool');

async function testHierarchy() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert Level 1
    const l1 = [
      [7001, '1', 'الأصول', 'Assets', 'asset', null, false],
      [7002, '2', 'الالتزامات', 'Liabilities', 'liability', null, false],
      [7003, '3', 'حقوق الملكية', 'Equity', 'equity', null, false],
      [7004, '4', 'الإيرادات', 'Revenues', 'revenue', null, false],
      [7005, '5', 'تكلفة النشاط والمبيعات', 'Cost of Goods Sold', 'cogs', null, false],
      [7006, '6', 'المصروفات التشغيلية والإدارية', 'Operating & Administrative Expenses', 'expense', null, false],
    ];

    for (const r of l1) {
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (code) DO NOTHING
      `, r);
    }

    // 2. Insert Level 2
    const l2 = [
      [7011, '11', 'الأصول المتداولة', 'Current Assets', 'asset', '1', false],
      [7012, '12', 'الأصول غير المتداولة', 'Non-Current Assets', 'asset', '1', false],
      [7021, '21', 'الالتزامات المتداولة', 'Current Liabilities', 'liability', '2', false],
      [7022, '22', 'الالتزامات غير المتداولة', 'Non-Current Liabilities', 'liability', '2', false],
      [7031, '31', 'رأس المال والاحتياطيات', 'Capital & Reserves', 'equity', '3', false],
      [7032, '32', 'الحسابات الجارية للشركاء', 'Partners Current Accounts', 'equity', '3', false],
      [7041, '41', 'إيرادات النشاط التشغيلي', 'Operating Sales Revenues', 'revenue', '4', false],
      [7042, '42', 'إيرادات تشغيلية أخرى ومتنوعة', 'Other Operating Revenues', 'revenue', '4', false],
      [7051, '51', 'تكلفة المواد المباشرة والخامات', 'Direct Materials Cost', 'cogs', '5', false],
      [7052, '52', 'تكاليف تشغيلية مباشرة ومواد تعبئة', 'Direct Operating & Packaging Costs', 'cogs', '5', false],
      [7061, '61', 'تكاليف ومنافع الموظفين', 'Salaries & Employee Benefits', 'expense', '6', false],
      [7062, '62', 'مصروفات تشغيل الفروع والمطابخ', 'Branch & Kitchen Operating Expenses', 'expense', '6', false],
      [7063, '63', 'مصروفات التسويق والمبيعات', 'Marketing & Selling Expenses', 'expense', '6', false],
      [7064, '64', 'مصروفات عمومية وإدارية وتمويلية', 'General, Administrative & Financial', 'expense', '6', false],
    ];

    for (const r of l2) {
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (code) DO NOTHING
      `, r);
    }

    // 3. Insert Level 3
    const l3 = [
      [7111, '111', 'النقدية وما في حكمها', 'Cash & Cash Equivalents', 'asset', '11', false],
      [7112, '112', 'البنوك والوساطة المالية والشبكة', 'Banks & POS Clearing', 'asset', '11', false],
      [7113, '113', 'الذمم المدينة والعملاء', 'Accounts Receivable & Debtors', 'asset', '11', false],
      [7114, '114', 'المخزون', 'Inventory', 'asset', '11', false],
      [7115, '115', 'الأرصدة المدينة الأخرى والمدفوعات مقدماً', 'Prepayments & Other Receivables', 'asset', '11', false],
      [7211, '211', 'الموردون والذمم الدائنة', 'Suppliers & Accounts Payable', 'liability', '21', false],
      [7212, '212', 'المستحقات الحكومية والضريبية', 'Tax & Government Payables', 'liability', '21', false],
      [7213, '213', 'مستحقات الموظفين والمصروفات المستحقة', 'Accrued Payroll & Expenses', 'liability', '21', false],
      [7214, '214', 'أمانات ودفعات مقدمة من العملاء', 'Deposits & Customer Advances', 'liability', '21', false],
    ];

    for (const r of l3) {
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (code) DO NOTHING
      `, r);
    }

    // 4. Update existing 28 accounts parent_code
    const parentUpdates = {
      '1000': '111',
      '1010': '112',
      '1150': '115',
      '1200': '114',
      '1300': '113',
      '1400': '115',
      '1500': '12',
      '2000': '211',
      '2100': '212',
      '2200': '213',
      '2300': '213',
      '3000': '31',
      '3100': '31',
      '4000': '41',
      '4100': '42',
      '5000': '51',
      '5100': '51',
      '6000': '61',
      '6100': '62',
      '6200': '62',
      '6300': '62',
      '6400': '63',
      '6500': '62',
      '6600': '64',
      '6700': '64',
      '6900': '64',
    };

    for (const [code, parentCode] of Object.entries(parentUpdates)) {
      await client.query('UPDATE chart_of_accounts SET parent_code = $1 WHERE code = $2', [parentCode, code]);
    }

    // 5. Insert Level 4
    const l4 = [
      // Assets
      [7201, '1001', 'صندوق كاشير الصالة / الفرع', 'POS Cashier Cash', 'asset', '111', true],
      [7202, '1005', 'عهد نقدية ومصاريف نثرية', 'Petty Cash Custody', 'asset', '111', true],
      [7203, '1011', 'البنك — مصرف الراجحي', 'Al Rajhi Bank', 'asset', '112', true],
      [7204, '1012', 'البنك — البنك الأهلي السعودي', 'SNB Bank', 'asset', '112', true],
      [7205, '1020', 'وسيط تسوية نقاط البيع والمدفوعات الإلكترونية', 'POS / Mada Clearing', 'asset', '112', true],
      [7206, '1310', 'مستحقات شركات تطبيقات التوصيل', 'Delivery Apps Receivables', 'asset', '113', true],
      [7207, '1320', 'عملاء بوفيهات وحفلات وضيافة', 'Catering & Corporate Clients', 'asset', '113', true],
      [7208, '1210', 'مخزون اللحوم والدواجن والأسماك', 'Meat & Poultry Inventory', 'asset', '114', true],
      [7209, '1220', 'مخزون الخضار والفاكهة الطازجة', 'Produce Inventory', 'asset', '114', true],
      [7210, '1230', 'مخزون البقالة والمواد الجافة', 'Dry Goods & Grocery Inventory', 'asset', '114', true],
      [7215, '1240', 'مخزون مواد التعبئة والتغليف والمستهلكات', 'Packaging & Disposables Inventory', 'asset', '114', true],
      [7216, '1250', 'مخزون الإنتاج التام — قسم التصنيع', 'Finished Goods Inventory - Factory', 'asset', '114', true],
      [7217, '1410', 'سلف موظفين مستردة', 'Employee Advances', 'asset', '115', true],
      [7218, '1420', 'تأمينات مستردة لدى الغير', 'Security Deposits', 'asset', '115', true],
      [7219, '1511', 'أجهزة حاسب آلي ونقاط بيع وشبكات', 'IT & POS Systems', 'asset', '1500', true],
      [7220, '1512', 'سيارات ودراجات التوصيل والنقل', 'Vehicles & Delivery Fleet', 'asset', '1500', true],
      [7221, '1513', 'ديكورات وتحسينات المباني المستأجرة', 'Leasehold Improvements', 'asset', '1500', true],
      [7222, '1514', 'أثاث ومفروشات الصالة والمكاتب', 'Furniture & Fixtures', 'asset', '1500', true],
      
      // Liabilities
      [7230, '2010', 'موردو اللحوم والدواجن', 'Meat & Poultry Suppliers', 'liability', '211', true],
      [7231, '2020', 'موردو الخضار والفواكه', 'Produce Suppliers', 'liability', '211', true],
      [7232, '2030', 'موردو التعبئة والتغليف والمستهلكات', 'Packaging Suppliers', 'liability', '211', true],
      [7233, '2040', 'موردو الصيانة والخدمات', 'Maintenance & Service Suppliers', 'liability', '211', true],
      [7234, '2120', 'مخصص الزكاة الشرعية وضريبة الدخل', 'Zakat & Income Tax Provision', 'liability', '212', true],
      [7235, '2130', 'التأمينات الاجتماعية المستحقة (GOSI)', 'GOSI Payable', 'liability', '212', true],
      [7236, '2210', 'مستحقات إجازات وتذاكر وبدلات مستحقة', 'Accrued Leave & Benefits', 'liability', '213', true],
      [7237, '2400', 'دفعات مقدمة من العملاء', 'Customer Advances', 'liability', '214', true],
      [7238, '2410', 'أمانات وتأمينات للغير', 'Third-Party Deposits', 'liability', '214', true],
      [7239, '2250', 'مخصص مكافأة نهاية الخدمة للموظفين', 'End of Service Indemnity Provision', 'liability', '22', true],

      // Equity
      [7250, '3200', 'الاحتياطي النظامي', 'Statutory Reserve', 'equity', '31', true],
      [7251, '3300', 'جاري الشركاء والمسحوبات الشخصية', 'Partners Current Accounts', 'equity', '32', true],

      // Revenues
      [7260, '4010', 'مبيعات الصالة (محلي)', 'Dine-In Sales', 'revenue', '41', true],
      [7261, '4020', 'مبيعات السفري والتيك أواي', 'Takeaway Sales', 'revenue', '41', true],
      [7262, '4030', 'مبيعات تطبيقات التوصيل', 'Delivery Apps Sales', 'revenue', '41', true],
      [7263, '4040', 'مبيعات المنافذ الخارجية والمعارض', 'External Sales Outlets', 'revenue', '41', true],
      [7264, '4050', 'إيرادات وتحويلات قسم التصنيع والمصنع', 'Factory Production Deliveries', 'revenue', '41', true],
      [7265, '4200', 'إيرادات بيع مخلفات وكرتون وإيرادات متنوعة', 'Miscellaneous Income', 'revenue', '42', true],

      // COGS
      [7270, '5120', 'تكلفة اللحوم والدواجن والأسماك', 'Meat & Poultry Cost', 'cogs', '51', true],
      [7271, '5130', 'تكلفة الخضار والفاكهة الطازجة', 'Produce Cost', 'cogs', '51', true],
      [7272, '5140', 'تكلفة البقالة والخامات الجافة', 'Dry Goods & Groceries Cost', 'cogs', '51', true],
      [7273, '5200', 'تكلفة مواد التعبئة والتغليف والمستهلكات', 'Packaging & Disposables Cost', 'cogs', '52', true],
      [7274, '5300', 'هدر وتالف تشغيلي طبيعي وغير طبيعي', 'Waste & Spoilage Cost', 'cogs', '52', true],
      [7275, '5400', 'تكاليف تصنيع وتحويلات المصنع المباشرة', 'Factory Direct Production Costs', 'cogs', '52', true],

      // Expenses
      [7280, '6010', 'بدل سكن وبدل انتقال ومنافع نقدية', 'Housing & Transport Allowances', 'expense', '61', true],
      [7281, '6020', 'حوافز ومكافآت وإضافي', 'Incentives & Overtime', 'expense', '61', true],
      [7282, '6030', 'رسوم إقامات ورخص عمل وشهادات صحية وتأشيرات', 'Work Permits & Health Certificates', 'expense', '61', true],
      [7283, '6040', 'تأمين طبي ومنافع صحية للموظفين', 'Medical Insurance', 'expense', '61', true],
      [7284, '6420', 'عمولات تطبيقات التوصيل (جاهز، هنقرستيشن...)', 'Delivery Aggregators Commissions', 'expense', '63', true],
      [7285, '6430', 'مطبوعات وبروشورات وهوية بصرية وتصوير', 'Promotional & Branding Expenses', 'expense', '63', true],
      [7286, '6800', 'رسوم بنكية وعمولات مدى وفيزا وأجهزة نقاط البيع', 'Bank Charges & POS Card Fees', 'expense', '64', true],
      [7287, '6810', 'اتصالات وإنترنت واشتراكات برمجيات وسيرفرات', 'Telecom, Internet & Cloud ERP', 'expense', '64', true],
      [7288, '6820', 'أتعاب مهنية ومحاسبية وقانونية واستشارية', 'Professional & Legal Fees', 'expense', '64', true],
    ];

    for (const r of l4) {
      await client.query(`
        INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (code) DO NOTHING
      `, r);
    }

    // Integrity check 1: Type mismatch between parent and child
    const mismatch = await client.query(`
      SELECT c.code AS child_code, c.type AS child_type, p.code AS parent_code, p.type AS parent_type
      FROM chart_of_accounts c
      JOIN chart_of_accounts p ON p.code = c.parent_code
      WHERE c.type <> p.type
    `);
    console.log('Type mismatches (must be 0):', mismatch.rows.length);

    // Integrity check 2: Missing parent
    const orphan = await client.query(`
      SELECT c.code, c.parent_code
      FROM chart_of_accounts c
      WHERE c.parent_code IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM chart_of_accounts p WHERE p.code = c.parent_code)
    `);
    console.log('Orphan accounts with missing parent (must be 0):', orphan.rows.length);

    // Integrity check 3: Root accounts count
    const roots = await client.query(`
      SELECT code, name_ar, type FROM chart_of_accounts WHERE parent_code IS NULL ORDER BY code
    `);
    console.log('Root accounts (should be 1..6):', roots.rows);

    await client.query('ROLLBACK');
    console.log('Hierarchy test PASSED and rolled back.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Hierarchy test failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

testHierarchy();
