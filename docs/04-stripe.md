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
| upload | = analyze | = analyze | = analyze | = analyze | = analyze |
| letter | 0 | 15* | 40* | 75* | 150* |
| search | 5 | 40 | 120 | 250 | 500 |

\*Payant : si `QUOTA_*_LETTER` est omis, `letter = analyze`.  
**Import PDF** : pas de plafond séparé — préflight sur **analyze** ; débit analyze à l’analyse.

### Source de vérité (analyze / search / letter)

| Champ | Source |
|-------|--------|
| `plan` | `resolveEffectivePlan(subscription)` — un seul plan |
| `used` | compteur mensuel par métrique |
| `limit` | `getPlanQuotas(plan)[metric]` (`upload` = `analyze`) |
| `remaining` | `max(0, limit - used)` |

`GET /api/quotas` et l’agent courrier utilisent le **même** `getQuotaStatus`.  
Page Analyser / `/api/upload` : vérité = **analyses** (pas de blocage sur un compteur upload fantôme).

### Changement de plan

| Événement | Usage du mois | Limites |
|-----------|---------------|---------|
| **Upgrade** de palier | `analyze` + `search` + `letter` + `upload` → **0** | nouveau plan |
| **Downgrade** / renew | **conservé** | plan actuel |
| `past_due` | conservé | effective = **free** |

Affichage : toujours `Plan · used/limit` du plan **actuel** (pas un « restants » orphelin d’un autre plafond).

### Facturation mid-cycle (prorata)

`changeSubscriptionPlan` utilise `PLAN_CHANGE_PRORATION_UPDATE` :

| Paramètre | Valeur | Effet |
|-----------|--------|--------|
| `proration_behavior` | **`always_invoice`** | Lignes de prorata + facture immédiate |
| `payment_behavior` | **`pending_if_incomplete`** | Price Stripe inchangé tant que le paiement n’est pas OK ; 3DS → `pending_update` + redirect facture hébergée |
| `billing_cycle_anchor` | *(omis)* | Période / ancre **conservées** (pas de reset `now`) |

**Apply local (plan + quotas)** uniquement si : pas de `pending_update`, price cible confirmé, facture `paid` (ou `amount_due ≤ 0`). Sinon : sync ancien plan + URL `hosted_invoice_url` (ou Customer Portal). Webhooks `customer.subscription.updated` / `invoice.paid` finalisent après 3DS.

**Pourquoi pas `error_if_incomplete` :** ce mode refuse le 3DS (erreur API sans PaymentIntent / URL). `pending_if_incomplete` + facture hébergée est le flux SCA compatible.

Exemple **Basique → Premium → Basique** dans le même mois (cartes **test**) :

1. Checkout Basique : facture catalogue ~9,99 €, période commence.
2. Upgrade Premium : facture avec lignes de **prorata** (crédit temps non utilisé Basique + débit temps Premium restant). Montant **&lt;** 34,99 € en général (selon jours restants). **Pas** de nouveau cycle `now`.
3. Downgrade Basique : nouvelle facture prorata (crédit Premium restant / débit Basique). Souvent montant dû faible ou 0 + crédit solde client pour la suite.

Les quotas non consommés **n’influencent pas** le montant Stripe.

Checklist Dashboard test : `docs/04-stripe.md` section ci-dessous + `scripts/checklist-plan-change-proration.md`.

Affichage `/facturation` — section **Prochains prélèvements** :
- date = `current_period_end` Stripe (abonnement) ;
- montant = preview Stripe / catalogue mensuel du plan actuel ;
- facture `open` éventuelle affichée à part (à payer), surtout en `past_due`.

Checklist : `scripts/checklist-upcoming-charges.md`.

## Accès

- `hasPaidAccess` / `resolveEffectivePlan` — plan payant actif **uniquement** si `active` ou `trialing` (+ période non expirée)
- **`past_due`** : quotas / entitlements = **Free** jusqu’à régularisation (Customer Portal). Le plan catalogue reste en base ; l’accès payant revient au webhook `active` après paiement réussi. Compatible portal Stripe.
- `letter_agent` dès **Basique** (tous les plans payants)
- `isPremium` dans l’API billing = accès payant (compat UI)

### Checkout — anti double abonnement

Avant `checkout.sessions.create`, l’API liste les abonnements Stripe du customer et **refuse** un nouveau Checkout s’il existe déjà un statut `active` | `trialing` | `past_due` | `unpaid` | `paused` (message : gérer via Facturation / portail). Les changements Basique↔Pro… passent par `changeSubscriptionPlan` (pas un 2ᵉ Checkout).

### Mapping plan (webhook / sync)

Source de vérité = `price_id` ↔ `STRIPE_PRICE_*`.  
**Fail-closed** : en déployé, ou dès qu’**un** `STRIPE_PRICE_*` est défini, la metadata `plan` / `docmind_plan` n’est **jamais** utilisée. Fallback metadata uniquement en local sans aucun price configuré.
