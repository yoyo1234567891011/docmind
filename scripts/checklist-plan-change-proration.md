# Checklist — changement de plan via page Stripe (Portal)

Mode test (`sk_test_`). Confirm in-app → **toujours** redirect Customer Portal
(`subscription_update_confirm`), jamais de charge silencieuse de la carte enregistrée.

## Params

| Règle | Valeur |
|-------|--------|
| Flux | Portal `flow_data.type=subscription_update_confirm` |
| Prorata Portal | `always_invoice` (config `docmind_plan_change`) |
| Apply local | après retour / webhook seulement |

## Étapes

1. Compte Basique actif → Facturation → Passer à Pro → **Confirmer sur Stripe**.
2. Vérifier redirection `billing.stripe.com` (détail prorata + carte).
3. **4242** : payer → retour DocMind → « Passage à Pro confirmé », plan Pro.
4. Recommencer avec carte **3220** : 3DS sur Stripe → plan OK après succès.
5. Carte **0002** : échec sur Stripe → revenir / abandonner → plan **inchangé**.
6. Ouvrir Portal puis fermer sans payer → plan **inchangé**.

## UI bouton

Libellé : « Confirmer sur Stripe · X,XX € » → spinner « Redirection Stripe… ».
