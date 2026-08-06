-- =============================================================================
-- DocMind — migration 003: triggers auth + seed models / dossiers système
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Créer le profil public.users (+ abonnement free + dossiers système)
-- à chaque inscription auth.users
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  system_folder record;
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  );

  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active');

  for system_folder in
    select * from (
      values
        ('Personnel', 'Documents personnels et administratifs du quotidien'),
        ('Banque', 'Relevés, crédits, conventions et courriers bancaires'),
        ('Assurance', 'Contrats, avenants et sinistres d’assurance'),
        ('Travail', 'Contrats, avenants et courriers liés à l’emploi'),
        ('Logement', 'Baux, états des lieux et documents immobiliers'),
        ('Santé', 'Mutuelle, remboursements et documents de santé'),
        ('Impôts', 'Avis fiscaux, contrôles et échéanciers')
    ) as t(name, description)
  loop
    insert into public.folders (user_id, name, description, is_system)
    values (new.id, system_folder.name, system_folder.description, true);
  end loop;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sync email / nom depuis auth.users
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set
    email = coalesce(new.email, email),
    full_name = coalesce(new.raw_user_meta_data ->> 'full_name', full_name),
    updated_at = timezone('utc', now())
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_user_updated();

-- ---------------------------------------------------------------------------
-- Seed profils modèles (alignés sur src/config/docmind.ts)
-- ---------------------------------------------------------------------------

insert into public.models (
  profile_key, label, description, chat_model, embed_model, config, is_active
) values
(
  'qwen',
  'Qwen',
  'Bon équilibre FR / JSON structuré',
  'qwen3',
  'nomic-embed-text',
  '{
    "defaultTemperatures": {"classify": 0, "analyze": 0.1, "reply": 0.3, "searchIntent": 0},
    "maxTokens": 4096,
    "tasks": {
      "classify": {"temperature": 0},
      "analyze": {"temperature": 0.1, "maxTokens": 4096},
      "reply": {"temperature": 0.3, "maxTokens": 2048},
      "searchIntent": {"temperature": 0, "maxTokens": 1024}
    }
  }'::jsonb,
  true
),
(
  'llama',
  'Llama',
  'Meta Llama — polyvalent',
  'llama3.2',
  'nomic-embed-text',
  '{
    "defaultTemperatures": {"classify": 0, "analyze": 0.1, "reply": 0.3, "searchIntent": 0},
    "maxTokens": 4096,
    "tasks": {
      "classify": {"temperature": 0},
      "analyze": {"temperature": 0.1, "maxTokens": 4096},
      "reply": {"temperature": 0.3, "maxTokens": 2048},
      "searchIntent": {"temperature": 0, "maxTokens": 1024}
    }
  }'::jsonb,
  false
),
(
  'mistral',
  'Mistral',
  'Rapide, efficace sur docs courts',
  'mistral',
  'nomic-embed-text',
  '{
    "defaultTemperatures": {"classify": 0, "analyze": 0.1, "reply": 0.25, "searchIntent": 0},
    "maxTokens": 4096,
    "tasks": {
      "classify": {"temperature": 0},
      "analyze": {"temperature": 0.1, "maxTokens": 4096},
      "reply": {"temperature": 0.25, "maxTokens": 2048},
      "searchIntent": {"temperature": 0, "maxTokens": 1024}
    }
  }'::jsonb,
  false
),
(
  'deepseek',
  'DeepSeek',
  'Fort en raisonnement / longs contextes',
  'deepseek-r1',
  'nomic-embed-text',
  '{
    "defaultTemperatures": {"classify": 0, "analyze": 0.1, "reply": 0.3, "searchIntent": 0},
    "maxTokens": 6144,
    "tasks": {
      "classify": {"temperature": 0},
      "analyze": {"temperature": 0.1, "maxTokens": 6144},
      "reply": {"temperature": 0.3, "maxTokens": 2048},
      "searchIntent": {"temperature": 0, "maxTokens": 1024}
    }
  }'::jsonb,
  false
);
