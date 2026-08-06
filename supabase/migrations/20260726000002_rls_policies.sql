-- =============================================================================
-- DocMind — migration 002: Row Level Security
-- Chaque utilisateur n'accède qu'à ses propres lignes.
-- models / prompts actifs : lecture globale pour users authentifiés.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: uid courant
-- ---------------------------------------------------------------------------

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.tags enable row level security;
alter table public.document_tags enable row level security;
alter table public.models enable row level security;
alter table public.prompts enable row level security;
alter table public.analyses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.evaluations enable row level security;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create policy users_select_own
  on public.users for select
  using (id = public.current_user_id());

create policy users_update_own
  on public.users for update
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- Insert via trigger auth (security definer) — pas de policy insert client

-- ---------------------------------------------------------------------------
-- folders
-- ---------------------------------------------------------------------------

create policy folders_select_own
  on public.folders for select
  using (user_id = public.current_user_id());

create policy folders_insert_own
  on public.folders for insert
  with check (user_id = public.current_user_id());

create policy folders_update_own
  on public.folders for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy folders_delete_own
  on public.folders for delete
  using (user_id = public.current_user_id() and is_system = false);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create policy documents_select_own
  on public.documents for select
  using (user_id = public.current_user_id());

create policy documents_insert_own
  on public.documents for insert
  with check (user_id = public.current_user_id());

create policy documents_update_own
  on public.documents for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy documents_delete_own
  on public.documents for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create policy tags_select_own
  on public.tags for select
  using (user_id = public.current_user_id());

create policy tags_insert_own
  on public.tags for insert
  with check (user_id = public.current_user_id());

create policy tags_update_own
  on public.tags for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy tags_delete_own
  on public.tags for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- document_tags (via ownership du document)
-- ---------------------------------------------------------------------------

create policy document_tags_select_own
  on public.document_tags for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id and d.user_id = public.current_user_id()
    )
  );

create policy document_tags_insert_own
  on public.document_tags for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id and d.user_id = public.current_user_id()
    )
    and exists (
      select 1 from public.tags t
      where t.id = tag_id and t.user_id = public.current_user_id()
    )
  );

create policy document_tags_delete_own
  on public.document_tags for delete
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id and d.user_id = public.current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- models — lecture pour authentifiés ; écriture réservée service_role
-- ---------------------------------------------------------------------------

create policy models_select_authenticated
  on public.models for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- prompts — lecture pour authentifiés ; insert/update via service ou owner
-- ---------------------------------------------------------------------------

create policy prompts_select_authenticated
  on public.prompts for select
  to authenticated
  using (true);

create policy prompts_insert_authenticated
  on public.prompts for insert
  to authenticated
  with check (
    created_by = public.current_user_id()
    or created_by is null
  );

create policy prompts_update_authenticated
  on public.prompts for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- analyses
-- ---------------------------------------------------------------------------

create policy analyses_select_own
  on public.analyses for select
  using (user_id = public.current_user_id());

create policy analyses_insert_own
  on public.analyses for insert
  with check (user_id = public.current_user_id());

create policy analyses_update_own
  on public.analyses for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy analyses_delete_own
  on public.analyses for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create policy subscriptions_select_own
  on public.subscriptions for select
  using (user_id = public.current_user_id());

-- Mutations abonnement réservées au backend (service_role)

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create policy notifications_select_own
  on public.notifications for select
  using (user_id = public.current_user_id());

create policy notifications_insert_own
  on public.notifications for insert
  with check (user_id = public.current_user_id());

create policy notifications_update_own
  on public.notifications for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

create policy notifications_delete_own
  on public.notifications for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------

create policy evaluations_select_own
  on public.evaluations for select
  using (
    user_id = public.current_user_id()
    or user_id is null
  );

create policy evaluations_insert_authenticated
  on public.evaluations for insert
  to authenticated
  with check (
    user_id = public.current_user_id()
    or user_id is null
  );
