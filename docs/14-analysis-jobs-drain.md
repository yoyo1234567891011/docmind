# File d’analyse — drain / cron (beta)

Objectif : un job `pending` ou `processing` à lease expirée doit pouvoir être traité **même sans aucun trafic utilisateur**.

Le kick `after()` (UI / analyze) accélère le drain sous charge, mais **ne remplace pas** le watchdog cron.

Architecture de queue et `generate-lock` : **inchangés** par ce document (ops uniquement).

## Surfaces

| Surface | Rôle |
|---------|------|
| `POST /api/cron/drain-analysis-jobs` | Watchdog HTTP (Next démarré / Vercel) |
| `npm run jobs:drain` | CLI hôte (PG + **Ollama local**, sans HTTP) |
| `npm run jobs:drain:watch` / `npm run jobs:worker` | Boucle locale — **fallback** si pas d’API cloud |
| `npm run jobs:drain -- --via-http` | CLI qui appelle le POST cron |
| `scheduleAnalysisDrainKick` | Best-effort sous trafic (`after()`), rate-limité |

### Architecture recommandée — Vercel 100 % autonome (API cloud)

Sans commande ni PC allumé :

1. Sur Vercel : `GROQ_API_KEY` (ou `LLM_API_KEY`) + `LLM_MODEL` (+ optionnel `LLM_PROVIDER=openai_compatible`).
2. Upload sur l’app → P1 + job `pending` → `after()` drain sur Vercel appelle l’API cloud.
3. L’UI poll → `complete`. Health `/api/health` vérifie l’API cloud (plus Ollama).

Créer une clé Groq : https://console.groq.com/keys

### Architecture alternative — Vercel + Ollama sur ton PC

Si **aucune** clé cloud : Vercel **ne doit pas** dépendre d’un tunnel Cloudflare (URL instable / 403).

1. L’utilisateur upload sur `docmind-blond.vercel.app` → P1 + job `pending` en Postgres.
2. Sur **ce PC** : Ollama + `npm run jobs:worker` (ou Startup `DocMindAnalysisWorker`).
3. Le worker drain la file avec `OLLAMA_BASE_URL=http://127.0.0.1:11434` et le pooler `DATABASE_URL`.
4. L’UI Vercel poll le job → passe en `complete`.

`jobs:worker` recharge toujours `.env.local` (écrase un `DATABASE_URL` périmé du shell) et redémarre en boucle si le process crashe.

Auth HTTP : `Authorization: Bearer $CRON_SECRET` **ou** header `x-cron-secret`.  
Sans `CRON_SECRET` configuré → **503** (drain HTTP désactivé).

## Comment appeler en production

### Option A — HTTP (recommandée si Next tourne en permanence)

```bash
curl -sS -X POST "$APP_URL/api/cron/drain-analysis-jobs" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxJobs":3}'
```

- `maxJobs` optionnel, borné **1–10** (défaut **3**).
- Body vide OK (défaut 3).
- `GET` → **405** (utiliser POST).
- `maxDuration` route = **300 s** (assez pour 1–2 P2 sous generate-lock).

Exemples d’ordonnanceurs : cron hôte, systemd timer, GitHub Actions scheduled (si réseau vers l’app), healthcheck Uptime Kuma → POST, etc.

### Option B — CLI one-shot (même machine que la DB / storage)

```bash
cd /path/to/docmind
npm run jobs:drain -- --max 3
```

Charge `.env.local` / `.env`. Traite jusqu’à `max` jobs via `drainAnalysisJobs` (même worker que le cron).

### Option C — Watch local (Windows / Mac / Linux, sans crontab)

Second terminal pendant `npm run dev` :

```bash
npm run jobs:drain:watch
# équivalent : --watch --interval 90 --max 3
```

Boucle toutes les **90 s**. Idempotent si file vide. Ctrl+C pour arrêter.

### Option D — CLI via HTTP

```bash
npm run jobs:drain:http
# ou : npm run jobs:drain -- --via-http --max 3
```

Nécessite `CRON_SECRET` + app joignable (`EVAL_BASE_URL` ou `NEXT_PUBLIC_APP_URL`, sinon `http://127.0.0.1:3000`).

## Fréquence minimale recommandée (beta)

| Charge | Intervalle |
|--------|------------|
| **Minimum beta** | **toutes les 1–2 minutes** |
| Machine mono-utilisateur calme | 2 min OK |
| File / crash fréquents | 1 min |

Pourquoi ≤ 2 min :

- Lease worker = **120 s** (`ANALYSIS_JOB_LEASE_MS`). Un process mort laisse le job `processing` jusqu’à expiration de lease ; le prochain drain le **reclaim**.
- Un cron à 1–2 min borné le « trou » sans trafic à ~lease + intervalle (ordre de grandeur **2–4 min** avant reprise).
- Un cron **> 5 min** laisse des preview orphelins trop longtemps après crash / fermeture navigateur.

Le drain est **idempotent** : file vide → `processed: 0` (pas d’effet de bord). Appeler trop souvent est sûr ; le coût = claim PG/FS + stats.

## Comportement si aucun trafic

1. Aucun `after()` / kick UI.
2. Le cron / `jobs:drain` appelle `drainAnalysisJobs(maxJobs)`.
3. Pour chaque slot : `claimNext` atomique (`FOR UPDATE SKIP LOCKED` en PG ; mutex FS en local) :
   - `status = pending`, **ou**
   - `status = processing` **et** `lease_expires_at < now()` (worker mort / heartbeat arrêté).
4. P2 sous le **même** `generate-lock` GPU (1 génération).
5. Succès → `completed` ; erreur → `failed` + `last_error` (pas de fausse complétion LLM — voir contrat analyse).

Sans cron : un job enqueued puis abandonné (fermeture navigateur avant kick, crash mid-`after()`) peut rester `pending` / `processing` stale **indéfiniment**.

## Comportement après crash

| Crash | État job | Reprise |
|-------|----------|---------|
| Worker / process Next meurt pendant P2 | `processing`, lease non renew | Après `lease_expires_at`, claim = reclaim (`attempts++`, `last_error` ≈ `reclaimed_stale_lease`) puis re-P2 |
| Crash avant claim | `pending` | Prochain drain claim normal |
| Crash après `completed` / `failed` | terminal | **Jamais** reclaimé |
| Deux instances drain en parallèle | 1 gagnant claim | Pas de double P2 sur le même job |

Heartbeat : toutes les **30 s** tant que `processOneAnalysisJob` tourne — lease glissante pendant un generate long (~150–270 s). Si le process meurt, plus de heartbeat → lease expire → reclaim.

## Garanties vérifiées (tests)

Script : `npm run test:analysis-job-drain` (+ crash / jobs / metrics).

| # | Garantie |
|---|----------|
| 1 | `POST` cron + `CRON_SECRET` (Bearer / header ; secret absent → 503) |
| 2 | `jobs:drain` / `drainAnalysisJobs` |
| 3 | Drain idempotent (file vide / terminés → 0) |
| 4 | Reclaim `processing` lease expirée |
| 5–7 | Instances concurrentes → un seul claim |
| 8 | Pending sans trafic (drain seul) |
| 9 | Worker mort → reclaim |
| 10–11 | `failed` / `completed` non reclaimables |
| 12 | Retry via reclaim (`attempts` incrémenté) |

## Ops — checklist beta

1. Définir `CRON_SECRET` fort (voir `.env.example`).  
2. Planifier drain **≤ 2 min** (HTTP ou CLI).  
3. Vérifier une fois : `POST` → JSON `{ processed, before, after }`.  
4. Ne **pas** compter uniquement sur le kick UI.  
5. Ne pas modifier generate-lock / quotas pour « accélérer » le drain.

Voir aussi : [Monitoring](./09-monitoring.md) · [Pipeline](./02-pipeline.md) · [Déploiement](./07-deploiement.md).
