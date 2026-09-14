# Checklist — changement de plan en prorata (Stripe **test**)

Mode test uniquement (`sk_test_` / bannière « Mode test »). Ne pas utiliser de vraie carte.

## Params attendus (code)

| Avant (full price) | Après (prorata) |
|--------------------|-----------------|
| `proration_behavior: none` | `proration_behavior: always_invoice` |
| `billing_cycle_anchor: now` | *(omis — période conservée)* |
| `payment_behavior: error_if_incomplete` | inchangé |
| assert facture = catalogue plein | `assertProrationInvoiceSane` seulement |

## Script optionnel (compte déjà payant)

```bash
npx tsx scripts/test-plan-change-proration.ts [email] [targetPlan]
```

## Étapes Dashboard Stripe (numérotées)

1. Ouvrir [Dashboard Stripe Test](https://dashboard.stripe.com/test/dashboard) — mode **Test**.
2. Compte Free DocMind → Facturation → souscrire **Basique** (carte `4242…`).
3. Dans Stripe → **Customers** → le client → abonnement Basique actif ; noter `current_period_end`.
4. Dans DocMind → passer à **Premium** (confirm : texte prorata).
5. Stripe → **Invoices** (dernière facture) :
   - statut **Paid** (ou Open puis Paid) ;
   - **au moins une ligne** avec prorata / « unused time » / « remaining time » ;
   - `amount_paid` **≠** 34,99 € plein en général (sauf jour 1 du cycle) ;
   - période d’abonnement : `current_period_end` **identique** (ou très proche) à avant le change — **pas** un reset +30 jours depuis maintenant.
6. DocMind → downgrade **Basique** ; relire la nouvelle facture (crédits prorata).
7. Carte refusée optionnel : `4000 0000 0000 0002` au change → plan local **inchangé**.

## Ce que le client voit (Basique → Premium)

- UI : « Le montant sera ajusté au prorata… » + estimation si preview OK.
- Facture Stripe : lignes négatives (unused Basique) + positives (remaining Premium) ; total = différentiel prorata.
