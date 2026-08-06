# Analytics produit

Instrumentation pour funnel produit, coûts estimés et dashboard admin — **jamais bloquante** pour le pipeline.

## Stockage

- Fichier : `data/system/product-analytics.json`  
- Store : `src/services/analytics/store.ts`  
- Max ~10 000 événements (FIFO)  
- Clé d’idempotence optionnelle (`idempotencyKey` dans meta) — utile webhooks Stripe  

## Événements

Définis dans `src/types/analytics.ts` (`ANALYTICS_EVENT_NAMES`).

### Funnel analyse

| Event | Quand |
|-------|--------|
| `analysis.started` | Début analyse |
| `analysis.p1` | Preview progressive terminée |
| `analysis.p2` | Analyse pleine terminée |
| `analysis.completed` | Succès global |
| `analysis.error` | Échec |
| `analysis.fallback` | Fallback / salvage |
| `analysis.abandon` | Abandon client |
| `extraction.completed` | Texte extrait de l’upload |
| `satisfaction.rated` | Note utilisateur |

### Session

`page.view`, `auth.signup`, `auth.login`

### Billing

`billing.checkout_started`, `converted`, `renewed`, `cancel_requested`, `refunded`, `churned`

### Compte

`account.deleted`, `account.exported`

## Ingestion

| Source | Chemin |
|--------|--------|
| Serveur (pipeline, billing) | `trackAnalyticsEvent({ name, userId, meta })` |
| Client (whitelist) | `POST /api/analytics` — noms dans `CLIENT_ANALYTICS_EVENT_NAMES` |
| Helper client | `trackClientAnalytics` (`src/lib/client/analytics.ts`) |

## Résumé admin

`summarizeProductAnalytics` (`src/services/analytics/summarize.ts`) :

- volumes analyses / erreurs / abandons  
- timings P1 / P2 / total (avg, p50, p95)  
- extraction, satisfaction, top types de docs  
- conversion Free→Premium, churn counts  
- coût estimé EUR (`ANALYTICS_GPU_HOUR_EUR`, `ANALYTICS_TOKEN_MILLION_EUR`)

Exposé via :

- `GET /api/admin` → `productAnalytics`  
- Onglet Admin **Produit**  
- Agrégé dans `GET /api/admin/production` (dashboard Production)

## Coût estimé

Par analyse : durée GPU et/ou tokens → EUR.  
Config : `src/config/analytics.ts`.

## Bonnes pratiques

- Ne jamais logger le texte intégral du PDF dans `meta` (PII).  
- Utiliser des ids / codes / durées.  
- Toujours `try/catch` soft autour de `trackAnalyticsEvent` (déjà fail-soft dans le store).
