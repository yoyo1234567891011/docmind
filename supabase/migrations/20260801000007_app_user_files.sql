-- Fichiers utilisateur génériques (mémoire, index recherche, …) hors FS local
create table if not exists public.app_user_files (
  user_id text not null,
  path text not null,
  content text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, path)
);

create index if not exists app_user_files_user_prefix_idx
  on public.app_user_files (user_id, path);

alter table public.app_user_files enable row level security;
