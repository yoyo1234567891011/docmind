-- =============================================================================
-- DocMind — migration 001: schema initial
-- Tables: users, folders, documents, tags, document_tags, models, prompts,
--         analyses, subscriptions, notifications, evaluations
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.risk_level as enum ('faible', 'modere', 'eleve', 'critique');

create type public.prompt_key as enum (
  'classification',
  'analysis',
  'reply',
  'searchIntent'
);

create type public.subscription_plan as enum ('free', 'pro', 'team');

create type public.subscription_status as enum (
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete'
);

create type public.notification_kind as enum (
  'deadline_soon',
  'renewal',
  'termination',
  'important_payment',
  'system'
);

create type public.notification_severity as enum ('info', 'warning', 'critical');

create type public.analysis_status as enum ('pending', 'ok', 'failed');

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users (profil applicatif, lié à auth.users)
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  locale text not null default 'fr-FR',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint users_email_not_blank check (char_length(trim(email)) > 0)
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create index users_email_idx on public.users (lower(email));

-- ---------------------------------------------------------------------------
-- folders
-- ---------------------------------------------------------------------------

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint folders_name_not_blank check (char_length(trim(name)) > 0),
  constraint folders_name_len check (char_length(name) <= 60),
  constraint folders_user_name_unique unique (user_id, name)
);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create index folders_user_id_idx on public.folders (user_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text not null,
  extracted_text text,
  page_count integer check (page_count is null or page_count >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint documents_file_name_not_blank check (char_length(trim(file_name)) > 0),
  constraint documents_storage_path_not_blank check (char_length(trim(storage_path)) > 0)
);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create index documents_user_id_idx on public.documents (user_id);
create index documents_folder_id_idx on public.documents (folder_id);
create index documents_user_created_idx on public.documents (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- tags + document_tags (N:N)
-- ---------------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  slug text not null,
  color text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tags_name_not_blank check (char_length(trim(name)) > 0),
  constraint tags_slug_not_blank check (char_length(trim(slug)) > 0),
  constraint tags_user_slug_unique unique (user_id, slug)
);

create index tags_user_id_idx on public.tags (user_id);

create table public.document_tags (
  document_id uuid not null references public.documents (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, tag_id)
);

create index document_tags_tag_id_idx on public.document_tags (tag_id);

-- ---------------------------------------------------------------------------
-- models (profils Ollama / runtime)
-- ---------------------------------------------------------------------------

create table public.models (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  label text not null,
  description text not null default '',
  chat_model text not null,
  embed_model text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint models_profile_key_not_blank check (char_length(trim(profile_key)) > 0),
  constraint models_chat_model_not_blank check (char_length(trim(chat_model)) > 0)
);

create trigger models_set_updated_at
  before update on public.models
  for each row execute function public.set_updated_at();

-- Un seul profil actif à la fois
create unique index models_one_active_idx
  on public.models (is_active)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- prompts (versions immuables)
-- ---------------------------------------------------------------------------

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  key public.prompt_key not null,
  version integer not null check (version >= 1),
  label text not null,
  content text not null,
  parent_id uuid references public.prompts (id) on delete set null,
  note text,
  created_by uuid references public.users (id) on delete set null,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint prompts_label_not_blank check (char_length(trim(label)) > 0),
  constraint prompts_content_not_blank check (char_length(trim(content)) > 0),
  constraint prompts_key_version_unique unique (key, version)
);

create index prompts_key_idx on public.prompts (key);
create index prompts_created_by_idx on public.prompts (created_by);

-- Une version active max par clé
create unique index prompts_one_active_per_key_idx
  on public.prompts (key)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- analyses
-- ---------------------------------------------------------------------------

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  model_id uuid references public.models (id) on delete set null,
  status public.analysis_status not null default 'pending',
  category text not null default 'autre',
  category_label text not null default 'Autre',
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  title text,
  document_type text,
  summary text,
  risk_score integer check (risk_score is null or (risk_score >= 0 and risk_score <= 100)),
  risk_level public.risk_level,
  result jsonb not null default '{}'::jsonb,
  ready_reply jsonb not null default '{}'::jsonb,
  prompts_used jsonb not null default '[]'::jsonb,
  model_name text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  tokens jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  analyzed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger analyses_set_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

create index analyses_user_id_idx on public.analyses (user_id);
create index analyses_document_id_idx on public.analyses (document_id);
create index analyses_user_analyzed_idx on public.analyses (user_id, analyzed_at desc nulls last);
create index analyses_category_idx on public.analyses (user_id, category);
create index analyses_risk_level_idx on public.analyses (user_id, risk_level);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  plan public.subscription_plan not null default 'free',
  status public.subscription_status not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subscriptions_user_unique unique (user_id)
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index subscriptions_status_idx on public.subscriptions (status);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  analysis_id uuid references public.analyses (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  kind public.notification_kind not null,
  severity public.notification_severity not null default 'info',
  title text not null,
  message text not null,
  evidence jsonb not null default '[]'::jsonb,
  due_date date,
  amount numeric(14, 2),
  fingerprint text,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint notifications_title_not_blank check (char_length(trim(title)) > 0)
);

create index notifications_user_id_idx on public.notifications (user_id);
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null and dismissed_at is null;
create unique index notifications_user_fingerprint_idx
  on public.notifications (user_id, fingerprint)
  where fingerprint is not null;

-- ---------------------------------------------------------------------------
-- evaluations (runs d’évaluation qualité)
-- ---------------------------------------------------------------------------

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  analysis_id uuid references public.analyses (id) on delete set null,
  relative_path text not null,
  category text not null,
  file_name text not null,
  success boolean not null default false,
  score numeric(5, 4) check (score is null or (score >= 0 and score <= 1)),
  expected jsonb not null default '{}'::jsonb,
  predicted jsonb not null default '{}'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  prompts_used jsonb not null default '[]'::jsonb,
  model_name text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_message text,
  report_path text,
  created_at timestamptz not null default timezone('utc', now())
);

create index evaluations_created_idx on public.evaluations (created_at desc);
create index evaluations_category_idx on public.evaluations (category);
create index evaluations_user_id_idx on public.evaluations (user_id);
