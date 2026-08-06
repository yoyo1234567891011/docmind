# Variables d’environnement

Source de vérité commentée : [`.env.example`](../.env.example).  
Copier vers `.env.local` en développement.

## Application

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_ENV` | `development` \| `beta` \| `staging` \| `production` |
| `NEXT_PUBLIC_APP_VERSION` | Version affichée / health |
| `NEXT_PUBLIC_APP_URL` | URL publique (Stripe redirects) — **obligatoire** en deploy |
| `DOCMIND_SKIP_ENV_ASSERT` | `1` = saute l’assert boot (CI seulement) |
| `MAINTENANCE_MODE` | Active la page maintenance |
| `MAINTENANCE_MESSAGE` | Message affiché |
| `MAINTENANCE_BYPASS_SECRET` | Secret bypass ops |
| `BETA_FEEDBACK_ENABLED` | Active signalements |

## Auth & admin

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé anon |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (delete compte) |
| `ADMIN_EMAILS` | Emails admin séparés par virgules |
| `EVAL_API_KEY` | Clé scripts evaluate (`x-eval-api-key`) |
| `EVAL_ALLOW_IN_DEPLOY` | Autorise eval key en prod (déconseillé) |
| `EVAL_BASE_URL` | Base URL pour evaluate |
| `HEALTH_DETAILS_TOKEN` | Token pour `/api/health?details=1` |

## Légal (pages publiques)

`NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`, `NEXT_PUBLIC_LEGAL_ENTITY_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS`

## Ollama

| Variable | Description |
|----------|-------------|
| `OLLAMA_BASE_URL` | Défaut `http://127.0.0.1:11434` |
| `OLLAMA_PROFILE` | Profil (`qwen`, `llama`, …) |
| `OLLAMA_MODEL` / `_CLASSIFY` / `_ANALYZE` / `_REPLY` / `_SEARCH` | Overrides modèles |
| `OLLAMA_EMBED_MODEL` | Embeddings |
| `OLLAMA_ALLOWED_HOSTS` | Hosts additionnels (anti-SSRF) |
| `OLLAMA_GENERATE_TIMEOUT_MS` | Timeout génération |
| `OLLAMA_LOCK_MAX_WAIT_MS` | Attente max file GPU |

## Optimisations

`OPT_ANALYSIS_CACHE`, `OPT_CONDITIONAL_JSON_RETRY`, `OPT_OLLAMA_KEEP_ALIVE` (`1`/`0`)  
`MEMORY_RELATION_LLM_VERIFY` — vérif LLM relations ambiguës

## Stripe & quotas

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Secret API |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable |
| `STRIPE_PRICE_PREMIUM` | `price_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `BILLING_ENTITLEMENTS_FAIL_OPEN` | `1` force fail-open (jamais en prod) |
| `QUOTA_FREE_*` / `QUOTA_PREMIUM_*` | analyze, upload, letter, search |

## Persistance

| Variable | Description |
|----------|-------------|
| `DOCMIND_STORAGE` | `fs` \| `persistent` |
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Redis rate-limit + cache |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage |
| `S3_ENDPOINT`, `S3_REGION` / `AWS_REGION` | Endpoint / région |
| `S3_FORCE_PATH_STYLE` | `1` pour MinIO etc. |
| `PG_POOL_MAX`, `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED` | Pool PG |
| `DOCMIND_FS_FALLBACK` | Lecture FS si miss PG (défaut on en persistent) |
| `DOCMIND_FS_DUAL_WRITE` | Écrit FS+PG (rollback) |

## Analytics & monitoring

| Variable | Description |
|----------|-------------|
| `ANALYTICS_GPU_HOUR_EUR` | Coût estimé |
| `ANALYTICS_TOKEN_MILLION_EUR` | Coût tokens |
| `MONITOR_MIN_SUCCESS_RATE` | Seuil alerte (défaut 0.5) |
| `MONITOR_MAX_AVG_DURATION_MS` | Seuil latence |
| `MONITOR_MAX_AVG_WAIT_MS` | Seuil queue |
| `MONITOR_MAX_SERVER_ERRORS` | Seuil 5xx / 24h |
| `MONITOR_REQUIRE_OLLAMA` | Alerte si Ollama down |
| `MONITORING_WEBHOOK_URL` | Webhook alertes |
| `BACKUP_KEEP` | Rétention backups (défaut 14) |

## Benchmark concurrentiel

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Active ChatGPT dans `npm run benchmark` |
| `ANTHROPIC_API_KEY` | Active Claude |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Active Gemini |
| `MISTRAL_API_KEY` | Active Mistral Le Chat (API) |
| `BENCHMARK_OPENAI_MODEL` | Override modèle OpenAI |
| `BENCHMARK_ANTHROPIC_MODEL` | Override Claude |
| `BENCHMARK_GEMINI_MODEL` | Override Gemini |
| `BENCHMARK_MISTRAL_MODEL` | Override Mistral |
| `BENCHMARK_LIMIT` | Docs par suite (défaut 2) |
| `BENCHMARK_BASE_URL` | Alias de `EVAL_BASE_URL` |

## Chaos (tests uniquement)

| Variable | Description |
|----------|-------------|
| `DOCMIND_CHAOS` | `1` active l’injection |
| `DOCMIND_CHAOS_FAULTS` | Liste `ollama_down,redis_down,…` |
| `DOCMIND_CHAOS_ALLOW_IN_PROD` | Autorise en production (drills) |
| `DOCMIND_CHAOS_STRIPE_DELAY_MS` | Délai timeout Stripe simulé |

## Playwright / E2E

Voir [`e2e/README.md`](../e2e/README.md) : `PLAYWRIGHT_*`, `E2E_REQUIRE_OLLAMA`, etc.

## Environnements typiques

### Dev minimal

```env
NEXT_PUBLIC_APP_ENV=development
OLLAMA_BASE_URL=http://127.0.0.1:11434
# Pas de Supabase → local-dev
```

### Staging / production

Toutes les variables « obligatoires » de [Déploiement](./07-deploiement.md) + `DOCMIND_STORAGE=persistent`.
