-- ═══════════════════════════════════════════════════════════════
-- Karim ERP WhatsApp Engine v4.0 — Professional Features
-- ═══════════════════════════════════════════════════════════════
-- Adds tables for AI chatbot, templates, webhooks, workflows, analytics.
-- Run after 053_wa_engine.sql
-- ═══════════════════════════════════════════════════════════════

-- Message templates (approved WhatsApp Business format)
CREATE TABLE IF NOT EXISTS wa_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('UTILITY', 'AUTHENTICATION', 'MARKETING', 'SERVICE')),
    ar TEXT NOT NULL,
    en TEXT NOT NULL,
    variables INT NOT NULL DEFAULT 0,
    is_builtin BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_name ON wa_templates(name);

-- Webhooks configuration
CREATE TABLE IF NOT EXISTS wa_webhooks (
    id SERIAL PRIMARY KEY,
    event VARCHAR(50) NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event, url)
);

CREATE INDEX IF NOT EXISTS idx_wa_webhooks_event ON wa_webhooks(event);

-- Chatbot workflow definitions
CREATE TABLE IF NOT EXISTS wa_workflows (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    flow_key VARCHAR(100) UNIQUE NOT NULL,
    definition JSONB NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_workflows_key ON wa_workflows(flow_key);
CREATE INDEX IF NOT EXISTS idx_wa_workflows_active ON wa_workflows(is_active);

-- AI conversation cache (short-term, avoids repeated LLM calls)
CREATE TABLE IF NOT EXISTS ai_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(64) UNIQUE NOT NULL,
    prompt_hash VARCHAR(64) NOT NULL,
    response TEXT NOT NULL,
    tokens_used INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at);

-- Customer analytics snapshots (daily aggregation)
CREATE TABLE IF NOT EXISTS wa_analytics_daily (
    id SERIAL PRIMARY KEY,
    day DATE NOT NULL,
    jid VARCHAR(255) NOT NULL,
    total_messages INT DEFAULT 0,
    avg_response_sec INT DEFAULT 0,
    orders_confirmed INT DEFAULT 0,
    last_message_at TIMESTAMP,
    UNIQUE(day, jid)
);

CREATE INDEX IF NOT EXISTS idx_wa_analytics_day ON wa_analytics_daily(day);
CREATE INDEX IF NOT EXISTS idx_wa_analytics_jid ON wa_analytics_daily(jid);

-- Circuit breaker state log
CREATE TABLE IF NOT EXISTS wa_cb_log (
    id SERIAL PRIMARY KEY,
    component VARCHAR(50) NOT NULL,
    state VARCHAR(20) NOT NULL,
    failure_count INT DEFAULT 0,
    triggered_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_cb_log_component ON wa_cb_log(component);
CREATE INDEX IF NOT EXISTS idx_wa_cb_log_at ON wa_cb_log(triggered_at);

-- ═══════════════════════════════════════════════════════════════
-- Default templates (populated on first run)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO wa_templates (name, category, ar, en, variables, is_builtin) VALUES
    ('order_confirm', 'UTILITY',
     '✅ تأكيد الطلب\nالطلب #{{1}}\nالمجموع: {{2}} ر.س\nالحالة: تم الاستلام',
     '✅ Order Confirmation\nOrder #{{1}}\nTotal: {{2}} SAR', 2, true),
    ('delivery_update', 'UTILITY',
     '🚚 تحديث التوصيل\nالطلب #{{1}}\nالحالة: {{2}}\nالموظف: {{3}}',
     '🚚 Delivery Update\nOrder #{{1}}\nStatus: {{2}}\nDriver: {{3}}', 3, true),
    ('payment_receipt', 'UTILITY',
     '🧾 إيصال الدفع\nالمبلغ: {{2}} ر.س\nرقم المعاملة: {{1}}',
     '🧾 Payment Receipt\nAmount: {{2}} SAR\nTransaction: {{1}}', 2, true),
    ('welcome', 'AUTHENTICATION',
     '🎉 أهلاً بكم في مطاعم الشرفة العالمي!\nاختر من القائمة:\n1. 📋 طلب جديد\n2. 📊 متابعة طلب\n3. 📞 خدمة العملاء',
     '🎉 Welcome to Al-Shorfa Restaurants!\nChoose from menu:\n1. 📋 New Order\n2. 📊 Track Order\n3. 💬 Support', 0, true)
ON CONFLICT (name) DO NOTHING;

-- Insert default workflow (welcome flow)
INSERT INTO wa_workflows (name, flow_key, definition, is_active, created_by) VALUES
    ('Welcome Flow', 'welcome_flow',
     '{"id":"welcome_flow","name":"Welcome Flow","start":"welcome",
      "nodes":{
        "welcome": {"type":"message","text":"welcome","next":"ask_type"},
        "ask_type": {"type":"question","text":"ماذا تريد؟","options":
          [{"text":"طلب جديد","next":"collect_order"},
           {"text":"متابعة طلب","next":"track_order"},
           {"text":"خدمة العملاء","next":"agent_transfer"}]},
        "collect_order": {"type":"api_call","endpoint":"/api/orders/new","next":"confirm"},
        "track_order": {"type":"question","text":"أدخل رقم الطلب","next":"lookup"},
        "agent_transfer": {"type":"transfer","agentId":"support"},
        "confirm": {"type":"message","text":"order_confirm","next":"end"},
        "end": {"type":"end"}
      }}',
     true, 'system')
ON CONFLICT (flow_key) DO NOTHING;

-- Log the migration
INSERT INTO wa_settings (key, value) VALUES ('wa_migration_055', '2026-09-19')
ON CONFLICT (key) DO UPDATE SET value = '2026-09-19';

-- ═══════════════════════════════════════════════════════════════
-- End of migration
-- ═══════════════════════════════════════════════════════════════
