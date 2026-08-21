-- =============================================================================
-- DocMind — file d'analyse durable (Architecture A minimale)
-- PostgreSQL = source de vérité ; Redis conserve le generate-lock GPU.
-- =============================================================================

create table if not exists public.app_analysis_jobs (
  id text primary key,
  user_id text not null,
  document_id text not null,
  history_id text not null,
  file_name text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  -- Options P2 (texte = history.extractedText — pas de duplication lourde)
  skip_ready_reply boolean not null default true,
  p1_duration_ms integer,
  user_email text,
  pages jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_analysis_jobs_status_chk
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

-- Un seul job actif par document utilisateur
create unique index if not exists app_analysis_jobs_active_doc_uidx
  on public.app_analysis_jobs (user_id, document_id)
  where status in ('pending', 'processing');

create index if not exists app_analysis_jobs_pending_idx
  on public.app_analysis_jobs (status, created_at)
  where status = 'pending';

create index if not exists app_analysis_jobs_lease_idx
  on public.app_analysis_jobs (status, lease_expires_at)
  where status = 'processing';

create index if not exists app_analysis_jobs_history_idx
  on public.app_analysis_jobs (user_id, history_id);

alter table public.app_analysis_jobs enable row level security;
