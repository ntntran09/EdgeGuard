-- EdgeGuard Supabase Schema
-- Idempotent setup for AIoT door security monitoring.

begin;

create extension if not exists pgcrypto;

-- One public bucket, separated by purpose-specific object prefixes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
  image_bucket text,
  image_path text,
  image_mime_type text,
  image_bytes bigint check (image_bytes is null or image_bytes >= 0),
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
  image_path text, -- Public Storage URL used by the UI.
  image_bucket text,
  image_object_path text,
  image_mime_type text,
  image_bytes bigint check (image_bytes is null or image_bytes >= 0),
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
  camera_image_publish_enabled boolean not null default true,
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
  display_name text not null default 'Người dùng Telegram',
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
  name text not null default 'Chưa đặt tên',
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

-- Optional normalized image references. Image bytes/base64 never belong in Postgres.
create table if not exists public.event_images (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  capture_id text,
  storage_mode text not null check (storage_mode in ('telegram', 'supabase_storage')),
  telegram_file_id text,
  telegram_msg_link text,
  storage_bucket text,
  storage_path text,
  public_url text,
  mime_type text,
  image_size_bytes bigint check (image_size_bytes is null or image_size_bytes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (storage_mode = 'telegram' and (telegram_file_id is not null or telegram_msg_link is not null))
    or
    (storage_mode = 'supabase_storage'
      and storage_bucket is not null
      and storage_path is not null
      and public_url is not null)
  )
);

-- Known face references for future face recognition integration.
create table if not exists public.known_faces (
  id uuid primary key default gen_random_uuid(),
  device_id text not null default 'device_001',
  display_name text not null,
  rekognition_face_id text unique,
  image_url text,
  image_bucket text,
  image_path text,
  image_mime_type text,
  image_bytes bigint check (image_bytes is null or image_bytes >= 0),
  credential_id uuid references public.rfid_credentials(id) on delete set null,
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
alter table public.alerts add column if not exists image_bucket text;
alter table public.alerts add column if not exists image_path text;
alter table public.alerts add column if not exists image_mime_type text;
alter table public.alerts add column if not exists image_bytes bigint;

alter table public.ai_logs add column if not exists anomaly_score numeric(5, 4);
alter table public.ai_logs add column if not exists object_count integer not null default 0;
alter table public.ai_logs add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.ai_logs add column if not exists image_bucket text;
alter table public.ai_logs add column if not exists image_object_path text;
alter table public.ai_logs add column if not exists image_mime_type text;
alter table public.ai_logs add column if not exists image_bytes bigint;

alter table public.device_settings add column if not exists telegram_alert_enabled boolean not null default false;
alter table public.device_settings add column if not exists camera_image_publish_enabled boolean not null default true;
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
alter table public.rfid_credentials alter column name set default 'Chưa đặt tên';
update public.rfid_credentials
set name = 'Chưa đặt tên'
where name = 'Chua dat ten';

alter table public.telegram_device_users alter column display_name set default 'Người dùng Telegram';
update public.telegram_device_users
set display_name = 'Người dùng Telegram'
where display_name = 'Telegram user';

-- Localize historical Mini App alert messages without changing identifiers.
update public.alerts set message = replace(message, 'Nguoi dung da bat chuong bao dong', 'Người dùng đã bật chuông báo động')
where position('Nguoi dung da bat chuong bao dong' in message) > 0;
update public.alerts set message = replace(message, 'Nguoi dung da tat chuong bao dong', 'Người dùng đã tắt chuông báo động')
where position('Nguoi dung da tat chuong bao dong' in message) > 0;
update public.alerts set message = replace(message, 'Nguoi dung mo cua tu xa qua Mini App', 'Người dùng mở cửa từ xa qua Mini App')
where position('Nguoi dung mo cua tu xa qua Mini App' in message) > 0;
update public.alerts set message = replace(message, 'Nguoi dung khoa cua tu xa qua Mini App', 'Người dùng khóa cửa từ xa qua Mini App')
where position('Nguoi dung khoa cua tu xa qua Mini App' in message) > 0;
update public.alerts set message = replace(message, 'Da quet the RFID/NFC', 'Đã quét thẻ RFID/NFC')
where position('Da quet the RFID/NFC' in message) > 0;
update public.alerts set message = replace(message, 'Mo cua thanh cong bang the', 'Mở cửa thành công bằng thẻ')
where position('Mo cua thanh cong bang the' in message) > 0;
update public.alerts set message = replace(message, 'The RFID/NFC khong hop le', 'Thẻ RFID/NFC không hợp lệ')
where position('The RFID/NFC khong hop le' in message) > 0;
update public.alerts set message = replace(message, 'Phat hien chuyen dong (cam bien)', 'Phát hiện chuyển động (cảm biến)')
where position('Phat hien chuyen dong (cam bien)' in message) > 0;
update public.alerts set message = replace(message, 'Cua da duoc mo (cam bien)', 'Cửa đã được mở (cảm biến)')
where position('Cua da duoc mo (cam bien)' in message) > 0;
update public.alerts set message = replace(message, 'Tu choi the RFID/NFC', 'Từ chối thẻ RFID/NFC')
where position('Tu choi the RFID/NFC' in message) > 0;
update public.alerts set message = replace(message, 'Da them the RFID/NFC', 'Đã thêm thẻ RFID/NFC')
where position('Da them the RFID/NFC' in message) > 0;
update public.alerts set message = replace(message, 'Da cap nhat the RFID/NFC', 'Đã cập nhật thẻ RFID/NFC')
where position('Da cap nhat the RFID/NFC' in message) > 0;
update public.alerts set message = replace(message, 'Da xoa the RFID/NFC', 'Đã xóa thẻ RFID/NFC')
where position('Da xoa the RFID/NFC' in message) > 0;

alter table public.security_event_views add column if not exists device_id text not null default 'device_001';
alter table public.security_event_views add column if not exists telegram_id text not null default 'dev';
alter table public.security_event_views add column if not exists event_id text;
alter table public.security_event_views add column if not exists viewed_at timestamptz not null default now();

-- Add URL/path columns before removing legacy inline image columns.
alter table public.event_images add column if not exists storage_bucket text;
alter table public.event_images add column if not exists storage_path text;
alter table public.event_images add column if not exists public_url text;
alter table public.event_images add column if not exists image_size_bytes bigint;
alter table public.event_images add column if not exists capture_id text;

alter table public.known_faces add column if not exists image_url text;
alter table public.known_faces add column if not exists image_bucket text;
alter table public.known_faces add column if not exists image_path text;
alter table public.known_faces add column if not exists image_mime_type text;
alter table public.known_faces add column if not exists image_bytes bigint;

-- Never silently discard inline image data. This migration stops with a clear
-- message if legacy base64/bytea rows still need exporting to Storage first.
do $image_migration$
declare
  has_legacy boolean;
begin
  select exists (
    select 1 from public.alerts
    where thumbnail_url like 'data:image/%;base64,%'
  ) or exists (
    select 1 from public.ai_logs
    where image_path like 'data:image/%;base64,%'
  ) into has_legacy;

  if has_legacy then
    raise exception 'Legacy base64 exists in alerts/ai_logs. Upload those images to Storage before rerunning schema.sql.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'event_images' and column_name = 'image_base64'
  ) then
    execute 'select exists (select 1 from public.event_images where image_base64 is not null)'
      into has_legacy;
    if has_legacy then
      raise exception 'Legacy event_images.image_base64 rows exist. Upload them to Storage before rerunning schema.sql.';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'event_images' and column_name = 'image_bytes'
  ) then
    execute 'select exists (select 1 from public.event_images where image_bytes is not null)'
      into has_legacy;
    if has_legacy then
      raise exception 'Legacy event_images.image_bytes rows exist. Upload them to Storage before rerunning schema.sql.';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'known_faces' and column_name = 'image_base64'
  ) then
    execute $$select exists (
      select 1 from public.known_faces
      where image_base64 is not null and image_base64 not like 'http%'
    )$$ into has_legacy;
    if has_legacy then
      raise exception 'Legacy known_faces.image_base64 rows exist. Upload them to Storage before rerunning schema.sql.';
    end if;

    execute $$update public.known_faces
      set image_url = image_base64
      where image_url is null and image_base64 like 'http%'$$;
  end if;
end;
$image_migration$;

alter table public.event_images drop constraint if exists event_images_storage_mode_check;
alter table public.event_images drop constraint if exists event_images_check;
update public.event_images
set storage_mode = 'supabase_storage'
where storage_mode = 'database';
alter table public.event_images drop column if exists image_base64;
alter table public.event_images drop column if exists image_bytes;
alter table public.event_images drop constraint if exists event_images_storage_reference_check;
alter table public.event_images add constraint event_images_storage_mode_check
  check (storage_mode in ('telegram', 'supabase_storage'));
alter table public.event_images add constraint event_images_storage_reference_check check (
  (storage_mode = 'telegram' and (telegram_file_id is not null or telegram_msg_link is not null))
  or
  (storage_mode = 'supabase_storage'
    and storage_bucket is not null
    and storage_path is not null
    and public_url is not null)
);

alter table public.known_faces drop column if exists image_base64;
alter table public.known_faces drop constraint if exists known_faces_storage_reference_check;
alter table public.known_faces add constraint known_faces_storage_reference_check check (
  (image_url is null and image_bucket is null and image_path is null)
  or
  (image_url is not null and image_bucket is not null and image_path is not null)
);

alter table public.alerts drop constraint if exists alerts_image_bytes_check;
alter table public.alerts add constraint alerts_image_bytes_check
  check (image_bytes is null or image_bytes >= 0);
alter table public.ai_logs drop constraint if exists ai_logs_image_bytes_check;
alter table public.ai_logs add constraint ai_logs_image_bytes_check
  check (image_bytes is null or image_bytes >= 0);
alter table public.event_images drop constraint if exists event_images_image_size_bytes_check;
alter table public.event_images add constraint event_images_image_size_bytes_check
  check (image_size_bytes is null or image_size_bytes >= 0);
alter table public.known_faces drop constraint if exists known_faces_image_bytes_check;
alter table public.known_faces add constraint known_faces_image_bytes_check
  check (image_bytes is null or image_bytes >= 0);

-- Fast dashboard and log queries.
create index if not exists idx_alerts_device_timestamp on public.alerts (device_id, timestamp desc);
create index if not exists idx_alerts_unresolved on public.alerts (device_id, timestamp desc) where resolved = false;
create index if not exists idx_alerts_type_timestamp on public.alerts (alert_type, timestamp desc);
create index if not exists idx_alerts_metadata_gin on public.alerts using gin (metadata);
create index if not exists idx_alerts_storage_path on public.alerts (image_bucket, image_path) where image_path is not null;
create index if not exists idx_ai_logs_device_created on public.ai_logs (device_id, created_at desc);
create index if not exists idx_ai_logs_label_created on public.ai_logs (label, created_at desc);
create index if not exists idx_ai_logs_storage_path on public.ai_logs (image_bucket, image_object_path) where image_object_path is not null;
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
create unique index if not exists idx_event_images_device_capture
  on public.event_images (device_id, capture_id);
create index if not exists idx_known_faces_device_active on public.known_faces (device_id, is_active, added_at desc);
create unique index if not exists idx_known_faces_storage_path on public.known_faces (image_bucket, image_path) where image_path is not null;
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
create or replace view public.security_events with (security_invoker = true) as
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
  ('Suy luận AI: ' || label || coalesce(' (' || round(confidence * 100)::text || '%)', '')) as description,
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

-- Public URL reads and direct CameraCapture firmware uploads.
drop policy if exists "Public read EdgeGuard image bucket" on storage.objects;
create policy "Public read EdgeGuard image bucket"
on storage.objects for select
using (bucket_id = 'event-images');

drop policy if exists "CameraCapture firmware upload" on storage.objects;
create policy "CameraCapture firmware upload"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'event-images'
  and (storage.foldername(name))[1] = 'camera-captures'
);

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
drop policy if exists "Public read event_images" on public.event_images;
create policy "Public read event_images"
on public.event_images for select
using (true);

drop policy if exists "CameraCapture insert event_images" on public.event_images;
create policy "CameraCapture insert event_images"
on public.event_images for insert to anon, authenticated
with check (
  storage_mode = 'supabase_storage'
  and storage_bucket = 'event-images'
  and storage_path like 'camera-captures/%'
  and capture_id is not null
);

drop policy if exists "CameraCapture update event_images" on public.event_images;
create policy "CameraCapture update event_images"
on public.event_images for update to anon, authenticated
using (
  storage_mode = 'supabase_storage'
  and storage_bucket = 'event-images'
  and storage_path like 'camera-captures/%'
  and capture_id is not null
)
with check (
  storage_mode = 'supabase_storage'
  and storage_bucket = 'event-images'
  and storage_path like 'camera-captures/%'
  and capture_id is not null
);

drop policy if exists "Enable full access for known_faces" on public.known_faces;
create policy "Enable full access for known_faces" on public.known_faces for all using (true) with check (true);

drop policy if exists "Enable full access for security_event_views" on public.security_event_views;
create policy "Enable full access for security_event_views" on public.security_event_views for all using (true) with check (true);

insert into public.device_settings (device_id)
values ('device_001'), ('camera_capture_001')
on conflict (device_id) do nothing;

commit;

-- BỔ SUNG FOREIGN KEYS (RÀNG BUỘC THIẾT BỊ)
-- Cảnh báo: Khi đã bật Foreign Key này, bạn bắt buộc phải tạo 1 dòng dữ liệu trong bảng device_settings (vd: device_id = 'device_001') TRƯỚC KHI lưu log hoặc tạo cảnh báo. Nếu không Database sẽ báo lỗi!
ALTER TABLE public.ai_logs DROP CONSTRAINT IF EXISTS fk_ai_logs_device;
ALTER TABLE public.ai_logs ADD CONSTRAINT fk_ai_logs_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS fk_alerts_device;
ALTER TABLE public.alerts ADD CONSTRAINT fk_alerts_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.telegram_device_users DROP CONSTRAINT IF EXISTS fk_telegram_users_device;
ALTER TABLE public.telegram_device_users ADD CONSTRAINT fk_telegram_users_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.rfid_credentials DROP CONSTRAINT IF EXISTS fk_rfid_device;
ALTER TABLE public.rfid_credentials ADD CONSTRAINT fk_rfid_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.pending_rfid_scans DROP CONSTRAINT IF EXISTS fk_pending_scans_device;
ALTER TABLE public.pending_rfid_scans ADD CONSTRAINT fk_pending_scans_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.event_images DROP CONSTRAINT IF EXISTS fk_event_images_device;
ALTER TABLE public.event_images ADD CONSTRAINT fk_event_images_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.known_faces DROP CONSTRAINT IF EXISTS fk_known_faces_device;
ALTER TABLE public.known_faces ADD CONSTRAINT fk_known_faces_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.access_logs DROP CONSTRAINT IF EXISTS fk_access_logs_device;
ALTER TABLE public.access_logs ADD CONSTRAINT fk_access_logs_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;

ALTER TABLE public.security_event_views DROP CONSTRAINT IF EXISTS fk_security_views_device;
ALTER TABLE public.security_event_views ADD CONSTRAINT fk_security_views_device FOREIGN KEY (device_id) REFERENCES public.device_settings(device_id) ON DELETE CASCADE;
