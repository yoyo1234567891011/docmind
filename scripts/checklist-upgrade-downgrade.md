# Checklist — upgrade immédiat / downgrade fin de période

Mode **test** (`sk_test_`).

## Règles produit

| Sens | Effet | Quotas `used` | Paiement |
|------|--------|---------------|----------|
| **Upgrade** | Immédiat après paid Portal | **conservé** ; nouvelles `limit` | Page Stripe (prorata) |
| **Downgrade** | Schedule à `current_period_end` | conservé ; limit bas à la date | Souvent 0 € — pas d’apply bas immédiat |

## Tests

### A — Upgrade Pro→Premium, used=2
1. Compteur analyze = 2 sur Pro.
2. Passer à Premium → Confirmer sur Stripe → 4242.
3. Attendu : plan Premium, used **2**, limit 75 (pas 0), avantages Premium.

### B — Abandon page Stripe (upgrade)
1. Ouvrir Portal upgrade puis fermer sans payer.
2. Attendu : toujours Pro, used inchangé.

### C — Downgrade Premium→Basique
1. Confirmer in-app (pas de redirect carte si 0 €).
2. UI : « Passage à Basique le {date}. Jusqu’à cette date vous restez sur Premium. »
3. Avant la date : plan Premium + avantages Premium.
4. Après `period_end` / webhook : Basique, used conservé (si used ≥ limit → remaining 0).

### D — Carte 0002 (upgrade)
Échec sur Stripe → plan inchangé.

### E — Prochains prélèvements
Cohérents avec Stripe (date = period_end ; montant catalogue du plan **effectif** actuel ; pending downgrade visible en alerte).

## Non-régression
- [ ] Payment gate upgrade (Portal)
- [ ] Double-checkout guard
- [ ] past_due → Free
- [ ] Pas de reset used à l’upgrade
