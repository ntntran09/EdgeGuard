-- Supabase schema for EdgeGuard

-- 1. ai_logs
CREATE TABLE IF NOT EXISTS ai_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    label TEXT NOT NULL,
    confidence FLOAT,
    image_path TEXT,
    telegram_msg_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent AI logs by device
CREATE INDEX IF NOT EXISTS idx_ai_logs_device_time ON ai_logs(device_id, created_at DESC);

-- 2. alerts
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    message TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying unresolved alerts quickly
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(resolved, created_at DESC);

-- 3. rfid_credentials
CREATE TABLE IF NOT EXISTS rfid_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id TEXT UNIQUE NOT NULL,
    owner_name TEXT NOT NULL,
    access_level TEXT DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optional: Enable RLS (Row Level Security) if your front-end accesses Supabase directly
-- ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE rfid_credentials ENABLE ROW LEVEL SECURITY;
