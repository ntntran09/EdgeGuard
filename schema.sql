-- EdgeGuard Supabase Schema
-- Idempotent setup for AIoT door security monitoring.

create extension if not exists pgcrypto;

-- Shared timestamp helper.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- System alerts: RFID decisions, camera failures, anomalies, manual actions.
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  alert_type text not null,
  message text not null default '',
  thumbnail_url text,
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'danger')),
  source text not null default 'system'
    check (source in ('ai', 'rfid', 'camera', 'mqtt', 'telegram', 'manual', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  telegram_msg_link text,
  timestamp timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((resolved = false and resolved_at is null) or (resolved = true))
);

-- AI inference logs. This remains useful even when an inference is not alert-worthy.
create table if not exists public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  label text not null,
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  anomaly_score numeric(5, 4) check (anomaly_score is null or (anomaly_score >= 0 and anomaly_score <= 1)),
  object_count integer not null default 0 check (object_count >= 0 and object_count <= 3),
  image_path text,
  telegram_msg_link text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Per-device runtime settings.
create table if not exists public.device_settings (
  device_id text primary key,
  object_left_alert_enabled boolean not null default true,
  object_left_max_seconds integer not null default 60 check (object_left_max_seconds between 5 and 3600),
  auto_lock_enabled boolean not null default true,
  auto_lock_seconds integer default 10 check (auto_lock_seconds is null or auto_lock_seconds between 1 and 3600),
  stranger_alert_enabled boolean not null default true,
  camera_blocked_alert_enabled boolean not null default true,
  telegram_alert_enabled boolean not null default false,
  ai_detection_enabled boolean not null default false,
  master_key_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Telegram notification recipients and mini-app allowlist.
-- Role is kept only for backward compatibility; the app no longer exposes role management.
create table if not exists public.telegram_device_users (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  telegram_id text not null,
  display_name text not null default 'Telegram user',
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, telegram_id)
);

-- RFID/NFC access credentials.
create table if not exists public.rfid_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  tag_id text not null,
  name text not null default 'Chua dat ten',
  role text not null default 'resident'
    check (role in ('owner', 'admin', 'resident', 'guest')),
  is_active boolean not null default true,
  added_at timestamptz not null default now(),
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (device_id, tag_id)
);

-- Scans waiting for admin approval while Master Key mode is enabled.
create table if not exists public.pending_rfid_scans (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  tag_id text not null,
  scan_count integer not null default 1 check (scan_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  reviewed_by_telegram_id text,
  reviewed_at timestamptz
);

-- Optional database image storage. Telegram mode stores only telegram_file_id/link on logs.
create table if not exists public.event_images (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  storage_mode text not null check (storage_mode in ('telegram', 'database')),
  telegram_file_id text,
  telegram_msg_link text,
  mime_type text,
  image_bytes bytea,
  image_base64 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (storage_mode = 'telegram' and (telegram_file_id is not null or telegram_msg_link is not null))
    or
    (storage_mode = 'database' and (image_bytes is not null or image_base64 is not null))
  )
);

-- Known face references for future face recognition integration.
create table if not exists public.known_faces (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  display_name text not null,
  image_base64 text,
  embedding jsonb,
  is_active boolean not null default true,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional audit trail for access decisions.
create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  tag_id text,
  credential_id uuid references public.rfid_credentials(id) on delete set null,
  decision text not null check (decision in ('granted', 'denied')),
  reason text,
  created_at timestamptz not null default now()
);

-- Per-Telegram-user read state for security event cards.
create table if not exists public.security_event_views (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  telegram_id text not null,
  event_id text not null,
  viewed_at timestamptz not null default now(),
  unique (device_id, telegram_id, event_id)
);

-- Add columns safely for older databases.
alter table public.alerts add column if not exists severity text not null default 'info';
alter table public.alerts add column if not exists source text not null default 'system';
alter table public.alerts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.alerts add column if not exists telegram_msg_link text;
alter table public.alerts add column if not exists created_at timestamptz not null default now();
alter table public.alerts add column if not exists updated_at timestamptz not null default now();
alter table public.alerts add column if not exists resolved_at timestamptz;

alter table public.ai_logs add column if not exists anomaly_score numeric(5, 4);
alter table public.ai_logs add column if not exists object_count integer not null default 0;
alter table public.ai_logs add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.device_settings add column if not exists telegram_alert_enabled boolean not null default false;
alter table public.device_settings add column if not exists ai_detection_enabled boolean not null default false;
alter table public.device_settings add column if not exists object_left_alert_enabled boolean not null default true;
alter table public.device_settings add column if not exists auto_lock_enabled boolean not null default true;
alter table public.device_settings add column if not exists auto_lock_seconds integer;
alter table public.device_settings alter column auto_lock_seconds set default 10;
update public.device_settings
set auto_lock_seconds = 10
where auto_lock_enabled = true
  and auto_lock_seconds is null;
alter table public.device_settings drop column if exists image_storage_mode;

alter table public.rfid_credentials add column if not exists device_id text not null default 'device_001';
alter table public.rfid_credentials add column if not exists role text not null default 'resident';
alter table public.rfid_credentials add column if not exists updated_at timestamptz not null default now();

alter table public.security_event_views add column if not exists device_id text not null default 'device_001';
alter table public.security_event_views add column if not exists telegram_id text not null default 'dev';
alter table public.security_event_views add column if not exists event_id text;
alter table public.security_event_views add column if not exists viewed_at timestamptz not null default now();

alter table public.known_faces add column if not exists image_base64 text;
update public.known_faces
set image_base64 = image_url
where image_base64 is null
  and image_url is not null
  and image_url like 'data:image/%;base64,%';
alter table public.known_faces drop column if exists image_url;

-- Fast dashboard and log queries.
create index if not exists idx_alerts_device_timestamp on public.alerts (device_id, timestamp desc);
create index if not exists idx_alerts_unresolved on public.alerts (device_id, timestamp desc) where resolved = false;
create index if not exists idx_alerts_type_timestamp on public.alerts (alert_type, timestamp desc);
create index if not exists idx_alerts_metadata_gin on public.alerts using gin (metadata);
create index if not exists idx_ai_logs_device_created on public.ai_logs (device_id, created_at desc);
create index if not exists idx_ai_logs_label_created on public.ai_logs (label, created_at desc);
create index if not exists idx_rfid_credentials_device_tag on public.rfid_credentials (device_id, tag_id);
create index if not exists idx_rfid_credentials_active on public.rfid_credentials (device_id, is_active);
create index if not exists idx_access_logs_device_created on public.access_logs (device_id, created_at desc);
create index if not exists idx_telegram_device_users_device_role on public.telegram_device_users (device_id, role, is_active);
create index if not exists idx_pending_rfid_scans_device_status on public.pending_rfid_scans (device_id, status, last_seen_at desc);
alter table public.pending_rfid_scans drop constraint if exists pending_rfid_scans_device_id_tag_id_status_key;
create unique index if not exists idx_pending_rfid_scans_unique_pending
  on public.pending_rfid_scans (device_id, tag_id)
  where status = 'pending';
create index if not exists idx_event_images_device_created on public.event_images (device_id, created_at desc);
create index if not exists idx_known_faces_device_active on public.known_faces (device_id, is_active, added_at desc);
create unique index if not exists idx_security_event_views_unique on public.security_event_views (device_id, telegram_id, event_id);
create index if not exists idx_security_event_views_viewer on public.security_event_views (device_id, telegram_id, viewed_at desc);

drop trigger if exists trg_alerts_updated_at on public.alerts;
create trigger trg_alerts_updated_at
before update on public.alerts
for each row execute function public.set_updated_at();

drop trigger if exists trg_device_settings_updated_at on public.device_settings;
create trigger trg_device_settings_updated_at
before update on public.device_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_rfid_credentials_updated_at on public.rfid_credentials;
create trigger trg_rfid_credentials_updated_at
before update on public.rfid_credentials
for each row execute function public.set_updated_at();

drop trigger if exists trg_telegram_device_users_updated_at on public.telegram_device_users;
create trigger trg_telegram_device_users_updated_at
before update on public.telegram_device_users
for each row execute function public.set_updated_at();

drop trigger if exists trg_known_faces_updated_at on public.known_faces;
create trigger trg_known_faces_updated_at
before update on public.known_faces
for each row execute function public.set_updated_at();

-- Register an unknown RFID scan for admin review.
create or replace function public.record_pending_rfid_scan(p_device_id text, p_tag_id text)
returns uuid
language plpgsql
security definer
as $$
declare
  pending_id uuid;
begin
  update public.pending_rfid_scans
  set scan_count = scan_count + 1,
      last_seen_at = now()
  where device_id = p_device_id
    and tag_id = p_tag_id
    and status = 'pending'
  returning id into pending_id;

  if pending_id is null then
    insert into public.pending_rfid_scans(device_id, tag_id)
    values (p_device_id, p_tag_id)
    returning id into pending_id;
  end if;

  return pending_id;
end;
$$;

-- Validate RFID and record the access attempt in one round trip.
create or replace function public.validate_rfid_access(p_device_id text, p_tag_id text)
returns table (
  ok boolean,
  credential_id uuid,
  holder_name text,
  reason text
)
language plpgsql
security definer
as $$
declare
  credential record;
begin
  select *
  into credential
  from public.rfid_credentials
  where device_id = p_device_id
    and tag_id = p_tag_id
  limit 1;

  if credential.id is null then
    insert into public.access_logs(device_id, tag_id, decision, reason)
    values (p_device_id, p_tag_id, 'denied', 'unknown_tag');

    return query select false, null::uuid, null::text, 'unknown_tag'::text;
    return;
  end if;

  if credential.is_active is not true then
    insert into public.access_logs(device_id, tag_id, credential_id, decision, reason)
    values (p_device_id, p_tag_id, credential.id, 'denied', 'inactive_tag');

    return query select false, credential.id, credential.name, 'inactive_tag'::text;
    return;
  end if;

  update public.rfid_credentials
  set last_used_at = now()
  where id = credential.id;

  insert into public.access_logs(device_id, tag_id, credential_id, decision, reason)
  values (p_device_id, p_tag_id, credential.id, 'granted', 'active_tag');

  return query select true, credential.id, credential.name, 'active_tag'::text;
end;
$$;

-- Unified feed for dashboards and logs.
create or replace view public.security_events as
select
  ('alert-' || id::text) as id,
  device_id,
  alert_type as event_type,
  message as description,
  severity,
  source,
  case
    when alert_type in ('person_detected', 'stranger_detected') then 'person'
    when alert_type in ('object_detected', 'object_left', 'unknown_object') then 'object'
    when alert_type in ('door_unlocked', 'door_locked', 'access_granted') then 'door'
    when alert_type in ('rfid_scan', 'rfid_invalid', 'rfid_added', 'rfid_deleted', 'access_denied') then 'rfid'
    else 'system'
  end as category,
  (source = 'rfid' and alert_type in ('rfid_scan', 'rfid_invalid', 'rfid_added', 'rfid_deleted')) as is_admin_only,
  thumbnail_url,
  null::numeric as ai_confidence,
  telegram_msg_link,
  metadata,
  timestamp as occurred_at,
  created_at
from public.alerts
union all
select
  ('ai-' || id::text) as id,
  device_id,
  label as event_type,
  ('AI inference: ' || label || coalesce(' (' || round(confidence * 100)::text || '%)', '')) as description,
  case
    when label in ('stranger_detected', 'camera_blocked') then 'danger'
    when label in ('object_left', 'unknown_object') then 'warning'
    else 'info'
  end as severity,
  'ai' as source,
  case
    when label in ('person_detected', 'stranger_detected') then 'person'
    when label in ('object_detected', 'object_left', 'unknown_object') then 'object'
    else 'system'
  end as category,
  false as is_admin_only,
  image_path as thumbnail_url,
  confidence as ai_confidence,
  telegram_msg_link,
  metadata,
  created_at as occurred_at,
  created_at
from public.ai_logs;

-- Enable Row Level Security.
alter table public.alerts enable row level security;
alter table public.ai_logs enable row level security;
alter table public.device_settings enable row level security;
alter table public.rfid_credentials enable row level security;
alter table public.access_logs enable row level security;
alter table public.telegram_device_users enable row level security;
alter table public.pending_rfid_scans enable row level security;
alter table public.event_images enable row level security;
alter table public.known_faces enable row level security;
alter table public.security_event_views enable row level security;

-- Development policies. Production should prefer service-role access from the backend.
drop policy if exists "Enable full access for alerts" on public.alerts;
create policy "Enable full access for alerts" on public.alerts for all using (true) with check (true);

drop policy if exists "Enable full access for ai_logs" on public.ai_logs;
create policy "Enable full access for ai_logs" on public.ai_logs for all using (true) with check (true);

drop policy if exists "Enable full access for device_settings" on public.device_settings;
create policy "Enable full access for device_settings" on public.device_settings for all using (true) with check (true);

drop policy if exists "Enable full access for rfid_credentials" on public.rfid_credentials;
create policy "Enable full access for rfid_credentials" on public.rfid_credentials for all using (true) with check (true);

drop policy if exists "Enable full access for access_logs" on public.access_logs;
create policy "Enable full access for access_logs" on public.access_logs for all using (true) with check (true);

drop policy if exists "Enable full access for telegram_device_users" on public.telegram_device_users;
create policy "Enable full access for telegram_device_users" on public.telegram_device_users for all using (true) with check (true);

drop policy if exists "Enable full access for pending_rfid_scans" on public.pending_rfid_scans;
create policy "Enable full access for pending_rfid_scans" on public.pending_rfid_scans for all using (true) with check (true);

drop policy if exists "Enable full access for event_images" on public.event_images;
create policy "Enable full access for event_images" on public.event_images for all using (true) with check (true);

drop policy if exists "Enable full access for known_faces" on public.known_faces;
create policy "Enable full access for known_faces" on public.known_faces for all using (true) with check (true);

drop policy if exists "Enable full access for security_event_views" on public.security_event_views;
create policy "Enable full access for security_event_views" on public.security_event_views for all using (true) with check (true);

insert into public.device_settings (device_id)
values ('device_001')
on conflict (device_id) do nothing;
