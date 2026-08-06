# Documentation DocMind

Guide pour un **nouveau développeur** : comprendre, lancer, modifier et opérer le produit sans aide externe.

## Parcours recommandé (1ʳᵉ journée)

1. [Architecture](./01-architecture.md) — stack, dossiers, auth, persistance  
2. Lancer en local (section ci-dessous)  
3. [Pipeline d’analyse](./02-pipeline.md) — upload → P1/P2 → cache  
4. [API](./06-api.md) — endpoints utiles  
5. [Variables d’environnement](./08-variables-env.md) — `.env.local`  
6. [Tests](./12-tests.md) — `npm run e2e` / `chaos`

Ensuite selon besoin : [Mémoire](./03-memoire.md), [Stripe](./04-stripe.md), [Analytics](./05-analytics.md), [Déploiement](./07-deploiement.md), [Monitoring](./09-monitoring.md), [Sauvegardes & restore](./10-sauvegardes-restore.md), [Migration](./11-migration.md).

## Index

| Doc | Contenu |
|-----|---------|
| [01 — Architecture](./01-architecture.md) | Stack, arborescence, auth, modes FS / persistent |
| [02 — Pipeline](./02-pipeline.md) | Upload, extraction, progressive P1/P2, agents, locks |
| [03 — Mémoire](./03-memoire.md) | Graphe documentaire, dual-write, relations, timelines |
| [04 — Stripe](./04-stripe.md) | Plans, entitlements, checkout, webhooks, quotas |
| [05 — Analytics](./05-analytics.md) | Événements, stockage, résumé admin |
| [06 — API](./06-api.md) | Catalogue des routes |
| [07 — Déploiement](./07-deploiement.md) | Build, assert env, checklist prod |
| [08 — Variables ENV](./08-variables-env.md) | Référence complète |
| [09 — Monitoring](./09-monitoring.md) | Dashboard production, alertes, `monitor:check` |
| [10 — Sauvegardes & restore](./10-sauvegardes-restore.md) | Backup, verify, restore |
| [11 — Migration](./11-migration.md) | FS → Postgres + S3 |
| [12 — Tests](./12-tests.md) | E2E, chaos, scripts `test:*`, evaluate |
| [13 — Benchmark](./13-benchmark.md) | DocMind vs ChatGPT / Claude / Gemini / Mistral |

Compléments : [`knowledge/README.md`](../knowledge/README.md), [`corpus/README.md`](../corpus/README.md), [`supabase/README.md`](../supabase/README.md), [`e2e/README.md`](../e2e/README.md), [`chaos/README.md`](../chaos/README.md), [`scripts/benchmark/README.md`](../scripts/benchmark/README.md).

## Démarrage local (5 minutes)

Prérequis : Node 20+, npm, [Ollama](https://ollama.com) installé.

```bash
# 1. Dépendances
cp .env.example .env.local
npm install

# 2. Modèle LLM local
ollama serve          # autre terminal
ollama pull qwen3     # ou le profil actif dans src/config/docmind.ts

# 3. App
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

Sans Supabase dans `.env.local`, l’app tourne en **local-dev** (utilisateur fictif, pas de login).  
Avec Supabase : renseigner `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `ADMIN_EMAILS`.

## Carte mentale du produit

```text
PDF → /api/upload (extract) → /api/analyze
         │                        │
         │                   P1 preview (local)
         │                   P2 agents (Ollama)
         │                        │
         └──────────► history + PDF storage
                              │
                              ▼
                    mémoire (entities/relations)
                    alertes · recherche · insights
                              │
                    billing Stripe (Premium)
```

## Conventions utiles

- **Langue produit** : français (UI, messages d’erreur).  
- **Secrets** : jamais committer `.env*` (voir `.gitignore`).  
- **Admin** : `/admin` — local-dev OK ; sinon email dans `ADMIN_EMAILS`.  
- **CSRF** : routes mutantes (sauf webhook Stripe) — token via `GET /api/csrf`.  
- **Chaos** : `DOCMIND_CHAOS=1` uniquement en test, jamais en prod réelle.
