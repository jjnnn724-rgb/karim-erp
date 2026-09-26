-- 042_accounting_core.sql — نواة قسم المحاسبة: شجرة الحسابات + القيود المزدوجة
-- ────────────────────────────────────────────────────────────────────────────
-- chart_of_accounts: شجرة الحسابات (code فريد، نوع، أب اختياري)
-- journal_entries: رأس القيد (ترقيم تلقائي + مصدر خارجي فريد لمنع الازدواج)
-- journal_lines: سطور القيد (مدين/دائن — سطر واحد لطرف واحد)

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id BIGINT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name_ar VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    type VARCHAR(20) NOT NULL CHECK (type IN ('asset','liability','equity','revenue','cogs','expense')),
    parent_code VARCHAR(20) REFERENCES chart_of_accounts(code) ON DELETE SET NULL,
    is_postable BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts(type);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_code);

CREATE TABLE IF NOT EXISTS journal_entries (
    id BIGINT PRIMARY KEY,
    entry_no VARCHAR(30) NOT NULL UNIQUE,
    date DATE NOT NULL,
    memo TEXT,
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_id VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_journal_source UNIQUE NULLS NOT DISTINCT (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_type, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
    id BIGINT PRIMARY KEY,
    entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_code VARCHAR(20) NOT NULL REFERENCES chart_of_accounts(code),
    debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    memo VARCHAR(255),
    CONSTRAINT ck_journal_line_side CHECK ((debit > 0)::int + (credit > 0)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

-- ─── شجرة حسابات مطعم قياسية ───
INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable) VALUES
(101,'1000','النقدية بالصندوق','Cash on Hand','asset',NULL,true),
(102,'1010','البنك — الحساب الجاري','Bank Current Account','asset',NULL,true),
(103,'1200','مخزون المواد','Inventory','asset',NULL,true),
(104,'1300','ذمم مدينة (عملاء)','Accounts Receivable','asset',NULL,true),
(105,'1400','مصاريف مدفوعة مقدمًا','Prepaid Expenses','asset',NULL,true),
(106,'1500','الأصول الثابتة','Fixed Assets','asset',NULL,false),
(107,'1510','معدات المطعم','Restaurant Equipment','asset','1500',true),
(201,'2000','ذمم دائنة (موردون)','Accounts Payable','liability',NULL,true),
(202,'2100','ضريبة القيمة المضافة مستحقة','VAT Payable','liability',NULL,true),
(203,'2200','رواتب مستحقة','Salaries Payable','liability',NULL,true),
(204,'2300','مصاريف مستحقة أخرى','Other Accrued Expenses','liability',NULL,true),
(301,'3000','رأس المال','Capital','equity',NULL,true),
(302,'3100','الأرباح المحتجزة','Retained Earnings','equity',NULL,true),
(401,'4000','إيرادات المبيعات','Sales Revenue','revenue',NULL,true),
(402,'4100','إيرادات التوصيل والخدمات','Delivery & Service Revenue','revenue',NULL,true),
(501,'5000','تكلفة البضاعة المباعة — أغذية','Food COGS','cogs',NULL,true),
(502,'5100','تكلفة البضاعة المباعة — مشروبات','Beverage COGS','cogs',NULL,true),
(601,'6000','الرواتب والأجور','Salaries & Wages','expense',NULL,true),
(602,'6100','الإيجارات','Rent','expense',NULL,true),
(603,'6200','الكهرباء والمياه والغاز','Utilities','expense',NULL,true),
(604,'6300','الصيانة والإصلاح','Maintenance & Repairs','expense',NULL,true),
(605,'6400','التسويق والإعلان','Marketing','expense',NULL,true),
(606,'6500','المستلزمات والمنظفات','Supplies','expense',NULL,true),
(607,'6600','الإهلاك','Depreciation','expense',NULL,true),
(608,'6700','رسوم وتراخيص','Fees & Licenses','expense',NULL,true),
(609,'6900','مصاريف تشغيلية أخرى','Other Operating Expenses','expense',NULL,true)
ON CONFLICT (code) DO NOTHING;
