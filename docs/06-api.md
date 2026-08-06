# API

Toutes les routes vivent sous `src/app/api/`.  
Runtime Node pour les handlers I/O (PDF, PG, S3, Ollama).

## Conventions

| Sujet | Règle |
|-------|--------|
| Réponse | `{ success: true, data }` ou `{ success: false, error: { code, message } }` |
| Auth | Session cookie / local-dev / `x-eval-api-key` |
| CSRF | Header `x-csrf-token` (via `GET /api/csrf`) sur mutations — **sauf** webhook Stripe |
| Rate-limit | Redis en prod (fail-closed) ; mémoire en dev |
| Admin | `requireAdmin` — emails `ADMIN_EMAILS` ou local-dev |

## Documents & analyse

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/upload` | Multipart `file` PDF → stockage + extraction |
| POST | `/api/analyze` | Body JSON : `documentId`, `text`, `mode?`, `fileName?`, … |
| GET | `/api/history` | Liste des analyses |
| GET | `/api/history/[id]` | Détail |
| PATCH | `/api/history/[id]` | Métadonnées (favori, tags, dossier, nom…) |
| DELETE | `/api/history/[id]` | Suppression |
| GET | `/api/documents/[documentId]/file` | Stream PDF (owner) |
| GET/PATCH | `/api/documents/[documentId]/relations` | Relations mémoire UI |

### Exemple analyse (full)

```http
POST /api/analyze
Content-Type: application/json
x-csrf-token: …

{
  "documentId": "<uuid>",
  "text": "…",
  "fileName": "contrat.pdf",
  "mode": "full",
  "skipReadyReply": true
}
```

## Mémoire, recherche, alertes

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/memory/timeline` | `documentId` \| `entityId` \| `view=counterparties` |
| POST | `/api/search` | Recherche NL |
| GET/PATCH | `/api/alerts` | Liste / marquer lu |
| GET/POST | `/api/folders` | Dossiers |
| GET/POST/DELETE | `/api/tags` | Tags |
| POST/GET | `/api/letters` | Agent courrier (Premium) |
| GET | `/api/insights` | Vues Premium |
| GET | `/api/quotas` | Quotas restants |

## Billing & compte

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/billing` | Abonnement + catalogue |
| POST | `/api/billing/checkout` | Session Stripe Checkout |
| POST | `/api/billing/portal` | Customer Portal |
| POST | `/api/billing/cancel` | Cancel at period end |
| POST | `/api/billing/sync` | Sync Stripe → local |
| POST | `/api/stripe/webhook` | Webhooks Stripe (raw body) |
| GET | `/api/account/export` | Export ZIP RGPD |
| POST | `/api/account/delete` | Suppression compte (`confirm: "DELETE"`) |
| GET | `/api/me` | Session + stats |

## Plateforme

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/csrf` | Token CSRF |
| GET | `/api/health` | Santé ; `?details=1` + `x-health-token` |
| POST | `/api/analytics` | Events client whitelistés |
| GET | `/api/logs` | Journal analyses user |
| GET/PATCH | `/api/notifications/preferences` | Préférences notifs |
| GET/POST | `/api/feedback` | Feedback beta |
| GET/POST | `/api/reports` | Signalements (GET admin) |

## Admin

Préfixe `/api/admin/*` — admin uniquement.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/admin` | Config, prompts, perfs, productAnalytics |
| PATCH | `/api/admin/config` | Runtime Ollama / profils |
| GET/POST/DELETE | `/api/admin/prompts` | Versions de prompts |
| POST | `/api/admin/reanalyze` | Rejouer une analyse |
| POST | `/api/admin/compare` | Comparer prompts / sorties |
| GET | `/api/admin/events` | Events admin |
| GET/POST | `/api/admin/monitoring` | Snapshot / force check |
| GET | `/api/admin/production` | Dashboard ops + business |

## Auth hors `/api`

`GET /auth/callback` — callback OAuth Supabase.

## Erreurs fréquentes

| Code / status | Cause typique |
|---------------|---------------|
| 401 | Pas de session |
| 403 | Admin / Premium / eval interdit |
| 429 | Rate-limit ou quota |
| 503 `OLLAMA_UNAVAILABLE` | Ollama down / lock timeout |
| 503 | S3 / Stripe / env manquant |

Implémentation : `src/lib/errors.ts` (`AppError`), `src/lib/api-response.ts`.
