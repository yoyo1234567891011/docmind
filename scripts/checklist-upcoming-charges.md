# Checklist — Prochains prélèvements (UI vs Stripe Dashboard)

Mode **test** (`sk_test_`). Comparer Facturation DocMind ↔ [Dashboard Stripe Test](https://dashboard.stripe.com/test/subscriptions).

## Cas 1 — Basique stable

1. Abonné Basique `active`, carte `4242`.
2. Stripe → Subscription → noter `current_period_end`.
3. DocMind `/facturation` → section **Prochains prélèvements** :
   - Plan : Basique — 9,99 € / mois (mensuel)
   - Date = `current_period_end` (même jour que Stripe, pas une date « aujourd’hui » prorata)
   - Montant estimé ≈ **9,99 €**

## Cas 2 — Juste après upgrade Pro payé

1. Basique → Pro, paiement OK (sans 3DS ou 3DS validé).
2. DocMind : badge / cartes = **Pro** ; message « Passage à Pro confirmé ».
3. **Prochains prélèvements** :
   - Plan : Pro — 19,99 € / mois
   - Date = même `current_period_end` qu’avant (période conservée)
   - Montant estimé ≈ **19,99 €**
4. Stripe Dashboard : price Pro, upcoming / next invoice cohérent.

## Cas 3 — past_due

1. Forcer un échec de paiement (carte `0002` ou facture open).
2. DocMind : section en **warning** — « Facture à payer » / « À payer » ; **pas** de prochain renouvellement présenté comme OK.
3. Quotas = Free effectif ; bouton portail / payer facture ouverte.

## Non-régression

- [ ] Prorata `always_invoice` + gate paiement inchangés
- [ ] Double-checkout guard OK
- [ ] Montant absent Stripe → « Indisponible », pas de faux chiffre
