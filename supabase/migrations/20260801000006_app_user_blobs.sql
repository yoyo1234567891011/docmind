-- Métadonnées utilisateur (dossiers, tags, …) hors FS
create table if not exists public.app_user_blobs (
  user_id text not null,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, key)
);

alter table public.app_user_blobs enable row level security;
