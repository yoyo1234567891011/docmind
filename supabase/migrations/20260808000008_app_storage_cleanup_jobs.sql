-- =============================================================================
-- DocMind — tâches de nettoyage stockage (orphelins S3 après échec PG)
-- =============================================================================

create table if not exists public.app_storage_cleanup_jobs (
  id text primary key,
  kind text not null,
  user_id text not null,
  document_id text not null,
  storage_key text not null,
  reason text not null,
  attempts integer not null default 0,
  status text not null default 'pending',
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_storage_cleanup_jobs_status_chk
    check (status in ('pending', 'done', 'failed'))
);

create index if not exists app_storage_cleanup_jobs_pending_idx
  on public.app_storage_cleanup_jobs (status, created_at)
  where status = 'pending';

alter table public.app_storage_cleanup_jobs enable row level security;
