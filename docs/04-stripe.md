# Stripe & facturation

## Plans

Catalogue : `src/config/billing.ts`.

| Plan | Prix | Entitlements |
|------|------|--------------|
| **Gratuit** | — | `analyze`, `memory`, `search`, `alerts`, `documents` |
| **Premium** | 19 € / mois | + `letter_agent`, `priority_support` |

Price ID Stripe : `STRIPE_PRICE_PREMIUM` (`price_…`).

## Fail-open / fail-closed

`src/services/billing/entitlements.ts` :

| Contexte | Comportement |
|----------|--------------|
| Dev local **sans** Stripe | Fail-open (Premium effectif) sauf `BILLING_ENTITLEMENTS_FAIL_OPEN=0` |
| Production / beta / staging **sans** Stripe | **Fail-closed** (Gratuit) — ne pas déployer ainsi |
| Stripe configuré | Toujours état réel de l’abonnement local synchronisé |

## Flux Checkout

```text
UI /facturation
  → POST /api/billing/checkout
  → Stripe Checkout Session (subscription)
  → succès → redirect app
  → webhook checkout.session.updated / subscription.*
  → applyStripeSubscription → app_subscriptions / subscription.json
```

Autres routes :

- `POST /api/billing/portal` — Customer Portal  
- `POST /api/billing/cancel` — résiliation fin de période  
- `POST /api/billing/sync` — réconciliation manuelle  
- `GET /api/billing` — overview pour l’UI  

## Webhooks

Endpoint : `POST /api/stripe/webhook` (corps **brut**, signature `stripe-signature`).  
Handler : `src/services/billing/webhook.ts`.

### Idempotence

1. `claimStripeWebhookEvent(event.id)` → insert PG `stripe_webhook_events`  
2. Si déjà claim → `{ handled: true }` (no-op)  
3. Traitement ; en erreur → `releaseStripeWebhookEvent` (Stripe peut retry)  

En mode FS (dev) : pas de dédup durable (claim toujours true).

### Événements gérés

- `checkout.session.completed`  
- `customer.subscription.created|updated|deleted`  
- `invoice.paid|payment_failed|payment_action_required`  
- `charge.refunded`, `refund.created`  
- `charge.dispute.created|funds_withdrawn`  

Remboursement complet → révocation Premium locale (+ tentative cancel Stripe).

### Local

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copier le whsec_… dans STRIPE_WEBHOOK_SECRET
```

## Quotas

`src/config/quotas.ts` (+ overrides `QUOTA_*` dans `.env`).

| Quota | Free | Premium |
|-------|------|---------|
| analyze | 30 / mois | 500 |
| upload | 40 | 500 |
| letter | 0 | 100 |
| search | 200 | 2000 |

`-1` = illimité. Consommation : `src/services/quotas/enforce.ts` → `GET /api/quotas`.

## Analytics billing

Events : `billing.checkout_started`, `converted`, `renewed`, `cancel_requested`, `refunded`, `churned`  
(voir [Analytics](./05-analytics.md)).

## Checklist intégration

1. Clés test Stripe + `STRIPE_PRICE_PREMIUM`  
2. `NEXT_PUBLIC_APP_URL` (redirects)  
3. Webhook secret + `stripe listen` en local  
4. Smoke : checkout → webhook → `/api/billing` montre Premium  
5. Test e2e : `e2e/specs/04-billing-premium-refund.spec.ts`
