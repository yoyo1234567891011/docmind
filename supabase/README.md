# Base de données DocMind (Supabase / Postgres)

## Tables

| Table | Rôle |
|-------|------|
| `users` | Profil lié à `auth.users` |
| `folders` | Dossiers documents (système + custom) |
| `documents` | PDF uploadés + texte extrait |
| `tags` / `document_tags` | Tags utilisateur (N:N) |
| `models` | Profils Ollama (qwen, llama…) |
| `prompts` | Versions immuables de prompts |
| `analyses` | Résultats d’analyse IA |
| `subscriptions` | Plan free/pro/team/premium + Stripe |
| `notifications` | Alertes (échéances, paiements…) |
| `evaluations` | Runs d’évaluation qualité |

```text
auth.users 1──1 users 1──* folders
                 │
                 ├──* documents *──* tags (document_tags)
                 │         │
                 │         └──* analyses ──> models
                 │                │
                 │                └──* notifications
                 ├──1 subscriptions
                 └──* evaluations
```

## Migrations

```
supabase/migrations/
  20260726000001_init_schema.sql
  20260726000002_rls_policies.sql
  20260726000003_triggers_and_seed.sql
```

## Appliquer

```bash
# Avec Supabase CLI (projet lié)
supabase db push

# Ou SQL Editor du dashboard : exécuter les 3 fichiers dans l’ordre
```

## RLS

Chaque table utilisateur est isolée par `auth.uid()`.
`models` et `prompts` sont en **lecture** pour les users authentifiés.
Les abonnements ne sont mutables que via `service_role`.

## Types TS

Voir [`src/types/database.ts`](../src/types/database.ts).
