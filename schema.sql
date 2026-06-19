-- EdgeGuard Supabase Schema
-- Run this in Supabase SQL Editor to reset and configure your database

-- 1. Create alerts table
CREATE TABLE IF NOT EXISTS public.alerts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id text NOT NULL,
    alert_type text NOT NULL,
    message text,
    thumbnail_url text,
    timestamp timestamptz DEFAULT now(),
    resolved boolean DEFAULT false
);

-- 2. Create device_settings table
CREATE TABLE IF NOT EXISTS public.device_settings (
    device_id text PRIMARY KEY,
    object_left_max_seconds integer DEFAULT 60,
    stranger_alert_enabled boolean DEFAULT false,
    camera_blocked_alert_enabled boolean DEFAULT true,
    master_key_enabled boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
);

-- 3. Create rfid_credentials table
CREATE TABLE IF NOT EXISTS public.rfid_credentials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tag_id text UNIQUE NOT NULL,
    name text,
    is_active boolean DEFAULT true,
    added_at timestamptz DEFAULT now(),
    last_used_at timestamptz
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_credentials ENABLE ROW LEVEL SECURITY;

-- 5. Create liberal policies for testing (Allows all operations)
-- If you want secure access, you should use the Service Role Key on the backend instead of these policies.
DROP POLICY IF EXISTS "Enable full access for alerts" ON public.alerts;
CREATE POLICY "Enable full access for alerts" ON public.alerts FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable full access for device_settings" ON public.device_settings;
CREATE POLICY "Enable full access for device_settings" ON public.device_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable full access for rfid_credentials" ON public.rfid_credentials;
CREATE POLICY "Enable full access for rfid_credentials" ON public.rfid_credentials FOR ALL USING (true) WITH CHECK (true);
