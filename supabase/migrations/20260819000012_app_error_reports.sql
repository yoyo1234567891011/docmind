-- Signalements bêta (persistant — admin)

create table if not exists public.app_error_reports (
  id uuid primary key,
  at timestamptz not null,
  user_id text,
  data jsonb not null
);

create index if not exists app_error_reports_at_idx
  on public.app_error_reports (at desc);

create index if not exists app_error_reports_user_idx
  on public.app_error_reports (user_id)
  where user_id is not null;

alter table public.app_error_reports enable row level security;
