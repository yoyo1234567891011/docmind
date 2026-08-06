-- =============================================================================
-- DocMind — runtime persistant (subscriptions, usage, history, documents, webhooks)
-- Compatible user_id texte (Supabase UUID + local-dev / eval-runner)
-- =============================================================================

create table if not exists public.app_subscriptions (
  user_id text primary key,
  data jsonb not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists app_subscriptions_stripe_customer_idx
  on public.app_subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists public.app_usage (
  user_id text not null,
  month text not null,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, month)
);

create table if not exists public.app_history (
  id text not null,
  user_id text not null,
  document_id text,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, id)
);

create index if not exists app_history_user_updated_idx
  on public.app_history (user_id, updated_at desc);

create index if not exists app_history_document_idx
  on public.app_history (user_id, document_id);

create table if not exists public.app_documents (
  document_id text not null,
  user_id text not null,
  storage_key text not null,
  file_name text,
  size_bytes bigint,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, document_id)
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default timezone('utc', now())
);

-- Service role only (pas de policies user — accès via DATABASE_URL serveur)
alter table public.app_subscriptions enable row level security;
alter table public.app_usage enable row level security;
alter table public.app_history enable row level security;
alter table public.app_documents enable row level security;
alter table public.stripe_webhook_events enable row level security;
