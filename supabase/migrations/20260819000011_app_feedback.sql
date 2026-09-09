-- Feedback bêta (persistant — admin)

create table if not exists public.app_feedback (
  id uuid primary key,
  at timestamptz not null,
  user_id text,
  data jsonb not null
);

create index if not exists app_feedback_at_idx
  on public.app_feedback (at desc);

create index if not exists app_feedback_user_idx
  on public.app_feedback (user_id)
  where user_id is not null;

alter table public.app_feedback enable row level security;
