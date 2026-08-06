# Tests E2E Playwright (DocMind)

## Lancer

```bash
npm run e2e
```

Une seule commande : génère le PDF fixture, démarre Next (`dev:next`) si besoin, exécute toute la suite Chromium.

## Couverture

| Flux | Spec |
|------|------|
| Inscription / connexion | `01-auth.spec.ts` |
| Upload · analyse · cache hit · export PDF | `02-document-lifecycle.spec.ts` |
| Alertes · mémoire · courrier | `03-alerts-memory-letter.spec.ts` |
| Premium · remboursement webhook | `04-billing-premium-refund.spec.ts` |
| Export RGPD · suppression compte | `05-account-rgpd.spec.ts` |

## Variables utiles

| Variable | Rôle |
|----------|------|
| `PLAYWRIGHT_EMAIL` / `PLAYWRIGHT_PASSWORD` | Connexion Supabase réelle |
| `PLAYWRIGHT_ALLOW_ACCOUNT_DELETE=1` | Autorise le delete réel (compte jetable) |
| `E2E_REQUIRE_OLLAMA=1` | Échoue si Ollama down (sinon skip analyse) |
| `EVAL_API_KEY` | Optionnel — header API (export RGPD bloqué pour eval) |
| `STRIPE_WEBHOOK_SECRET` | Test webhook remboursement signé |
| `PLAYWRIGHT_BASE_URL` | Override (défaut `http://127.0.0.1:3000`) |

Par défaut le serveur e2e tourne en **local-dev** (Supabase désactivé) sur le port **3010** pour un run déterministe.

- `PLAYWRIGHT_USE_SUPABASE=1` + credentials : auth réelle
- Sans Ollama : upload / export PDF / alertes / billing / RGPD passent ; analyse / cache / mémoire / courrier sont skippés (pas d’échec). `E2E_REQUIRE_OLLAMA=1` force l’échec si Ollama est down.
