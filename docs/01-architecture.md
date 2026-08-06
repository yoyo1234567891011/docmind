# Architecture

## Stack

| Couche | Techno |
|--------|--------|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 4, composants `src/components/ui` |
| LLM | Ollama (HTTP local), profils dans `src/config/docmind.ts` |
| Auth | Supabase Auth (cookies SSR) ou **local-dev** sans Supabase |
| Persistance | Mode `fs` (dev) ou `persistent` (Postgres + S3 + Redis) |
| Paiements | Stripe Checkout / Portal / webhooks |

## Vue d’ensemble

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Browser    │────►│  Next.js (Node)  │────►│  Ollama     │
│  UI + CSRF  │     │  app/ + services/ │     │  generate   │
└─────────────┘     │  middleware      │     └─────────────┘
                    └────────┬─────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
      data/ ou PG        S3 / uploads      Redis (RL+cache)
      history, memory    PDF bytes         rate-limit
```

## Arborescence `src/`

| Dossier | Rôle |
|---------|------|
| `app/` | Pages App Router + routes `api/` |
| `ai/` | Pipelines, agents multi-spécialistes, cache, locks, client Ollama |
| `services/` | Domaine métier (documents, history, memory, billing, analytics, …) |
| `lib/` | Auth, CSRF, Redis, pool PG, S3, Stripe, chaos, helpers client |
| `components/` | UI produit + admin |
| `config/` | Billing, quotas, persistance, chemins, optimisations |
| `prompts/` | Prompts classification / catégories (complété par `ai/prompts`) |
| `types/` | Types partagés |

Point d’entrée middleware : `middleware.ts` (maintenance → CSRF → session Supabase).  
Assert env au boot : `src/instrumentation.ts` → `src/lib/env-validate.ts`.

## Authentification

Résolution utilisateur (`src/lib/auth/require-user.ts`) :

1. Header `x-eval-api-key` valide → utilisateur **eval** (scripts `evaluate`, pas d’admin).  
2. Supabase **non** configuré et hors production → utilisateur **`local-dev`**.  
3. Sinon session Supabase (cookies).

Admin (`requireAdmin`) : local-dev autorisé ; eval **refusé** ; sinon email dans `ADMIN_EMAILS`.

Workspace utilisateur : `src/services/auth/workspace.ts` (dossiers `data/users/<id>/…` en mode FS).

## Persistance : deux modes

Config : `src/config/persistence.ts`.

| Mode | Quand | Où vivent les données |
|------|-------|------------------------|
| **fs** | Défaut local si DB/S3 incomplets, ou `DOCMIND_STORAGE=fs` | `data/`, `uploads/` |
| **persistent** | `DOCMIND_STORAGE=persistent` ou auto si `DATABASE_URL` + S3 | Postgres (`app_*`) + S3 (PDF) + Redis |

En **production / beta / staging** : persistent + Redis obligatoires (boot refuse sinon, sauf `DOCMIND_SKIP_ENV_ASSERT=1`).

Tables runtime clés (migrations `supabase/migrations/20260801000005_*` et suivantes) :

- `app_history`, `app_documents`  
- `app_subscriptions`, `app_usage`  
- `app_user_files`, `app_user_blobs`  
- `stripe_webhook_events`

Wrappers : `src/services/persistence/*-pg.ts`, `src/lib/db/pool.ts`, `src/lib/storage/s3.ts`, `src/lib/redis.ts`.

## Flux métier (résumé)

1. Upload PDF → stockage + extraction texte.  
2. Analyse → historique + fiche + (async) mémoire.  
3. Produit : alertes, recherche, dossiers/tags, courrier Premium, insights.  
4. Compte : export RGPD, suppression, facturation Stripe.

## Principes de conception

- **Isolation utilisateur** : chemins et requêtes toujours scopés `userId`.  
- **Fail-closed en prod** : rate-limit Redis, entitlements Stripe, assert env.  
- **Instrumentation soft** : analytics / monitoring ne doivent pas casser le pipeline.  
- **LLM local** : pas d’appel cloud modèle ; Ollama doit être joignable pour P2.

## Suite

- Détail analyse → [Pipeline](./02-pipeline.md)  
- Graphe → [Mémoire](./03-memoire.md)  
- Routes → [API](./06-api.md)
