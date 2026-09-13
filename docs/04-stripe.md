# Stripe & facturation

## Plans

Catalogue : `src/config/billing.ts`.

| Plan | Prix | Analyses | Recherches | Courriers | Entitlements clés |
|------|------|----------|------------|-----------|-------------------|
| **Gratuit** | — | 5 | 5 | 0 | `analyze`, `memory`, `search`, `alerts`, `documents` |
| **Basique** | 9,99 € / mois | 15 | 40 | 15* | + `letter_agent` |
| **Pro** | 19,99 € / mois | 40 | 120 | 40* | idem Basique |
| **Premium** | 34,99 € / mois | 75 | 250 | 75* | + `priority_support` |
| **Extra** | 59,99 € / mois | 150 | 500 | 150* | idem Premium |

\*Sans `QUOTA_*_LETTER`, le plafond courrier = analyses (`getPlanQuotas`).

Price IDs Stripe (mensuels EUR) :

```
STRIPE_PRICE_BASIQUE=price_…
STRIPE_PRICE_PRO=price_…
STRIPE_PRICE_PREMIUM=price_…
STRIPE_PRICE_EXTRA=price_…
```

Un `price_…` non listé (ex. ancien Premium hors catalogue) → plan **free**.

Limite PDF : **30 pages** / document (`MAX_PDF_PAGES`).

## Fail-open / fail-closed

`src/services/billing/entitlements.ts` :

| Contexte | Comportement |
|----------|--------------|
| Dev local **sans** Stripe | Fail-open (Pro effectif) sauf `BILLING_ENTITLEMENTS_FAIL_OPEN=0` |
| Production / beta / staging **sans** Stripe | **Fail-closed** (Gratuit) — ne pas déployer ainsi |
| Stripe configuré | Toujours état réel de l’abonnement local synchronisé |

## Flux Checkout

```text
UI /facturation
  → POST /api/billing/checkout { plan: basique|pro|premium|extra }
  → Stripe Checkout Session (subscription)
  → succès → redirect app
  → webhook checkout.session.completed / subscription.*
  → applyStripeSubscription → app_subscriptions / subscription.json
```

Autres routes :

- `POST /api/billing/portal` — Customer Portal (changement de plan)  
- `POST /api/billing/cancel` — résiliation fin de période  
- `POST /api/billing/sync` — réconciliation manuelle  
- `GET /api/billing` — overview pour l’UI  

## Webhooks

Endpoint : `POST /api/stripe/webhook` (corps **brut**, signature `stripe-signature`).  
Handler : `src/services/billing/webhook.ts`. **Pas de nouveau webhook** pour le multi-plan.

### Idempotence (concurrence)

1. Single-flight Redis/local : `withKeyedLock(billing:webhook:{event.id})`  
2. Si déjà claimé (`stripe_webhook_events`) → `{ handled: true }` (no-op)  
3. `dispatch` puis **claim définitif uniquement si `handled:true`**  
4. Crash avant claim → pas de claim fantôme → Stripe peut retry  

Ordre des états : `event.created` comparé à `lastWebhookAt` **sous** le mutex `billing:sub:{userId}`.

### Événements gérés

- `checkout.session.completed`  
- `customer.subscription.created|updated|deleted`  
- `invoice.paid|payment_failed|payment_action_required`  
- `charge.refunded`, `refund.created`  
- `charge.dispute.created|funds_withdrawn`  

Remboursement complet → révocation locale (+ tentative cancel Stripe).

### Local

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copier le whsec_… dans STRIPE_WEBHOOK_SECRET
```

Helper création prices : `node scripts/create-stripe-plan-prices.mjs`

## Quotas

`src/config/quotas.ts` (+ overrides `QUOTA_*` dans `.env`).

| Quota | Free | Basique | Pro | Premium | Extra |
|-------|------|---------|-----|---------|-------|
| analyze | 5 | 15 | 40 | 75 | 150 |
| upload | 10 | 30 | 80 | 150 | 300 |
| letter | 0 | 15* | 40* | 75* | 150* |
| search | 5 | 40 | 120 | 250 | 500 |

\*Payant : si `QUOTA_*_LETTER` est omis, `letter = analyze`.

## Accès

- `hasPaidAccess` / `resolveEffectivePlan` — plan payant actif  
- `letter_agent` dès **Basique** (tous les plans payants)  
- `isPremium` dans l’API billing = accès payant (compat UI)
