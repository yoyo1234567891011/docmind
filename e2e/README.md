# Tests E2E Playwright (DocMind)

## Environnements (séparation stricte)

| Cible | Commande | LLM | Données | Production |
|-------|----------|-----|---------|------------|
| **LOCAL dev** | `npm run dev` | Ollama (FS `data/`) | FS isolé — cloud coupé au runtime | Jamais |
| **LOCAL cloud bêta** | `npm run dev:cloud-beta` | Selon `.env.cloud-beta.local` | PG/S3 si configuré (opt-in) | Jamais sans intention |
| **LOCAL E2E** | `npm run e2e:dashboard:local` | Ollama `gpt-oss:120b` | FS `data-e2e/` | Jamais |
| **STAGING / E2E** | `npm run e2e:dashboard:staging` | Groq `openai/gpt-oss-120b` | FS `data-e2e/` | Jamais |
| **PRODUCTION** | — | — | — | **Interdit aux E2E** |

`npm run dev` applique `scripts/local-dev-env.mjs` : vide PG/S3/Redis/Stripe/Supabase sauf `DOCMIND_CLOUD_BETA=1`.
Playwright **vide** toujours `DATABASE_URL`, S3, Redis, Stripe, Supabase (sauf `PLAYWRIGHT_USE_SUPABASE=1` explicite).

### Staging LLM

1. Copier `.env.e2e.staging.example` → `.env.e2e.staging.local`
2. Renseigner `E2E_STAGING_GROQ_API_KEY` (clé **staging**, pas un dump Vercel Production)
3. `npm run e2e:dashboard:staging`

## Lancer

```bash
npm run e2e
npm run e2e:dashboard:local
npm run e2e:dashboard:staging
```

## Couverture

| Flux | Spec |
|------|------|
| Inscription / connexion | `01-auth.spec.ts` |
| Upload · analyse · cache hit · export PDF | `02-document-lifecycle.spec.ts` |
| Alertes · mémoire · courrier | `03-alerts-memory-letter.spec.ts` |
| Premium · remboursement webhook | `04-billing-premium-refund.spec.ts` |
| Export RGPD · suppression compte | `05-account-rgpd.spec.ts` |
| Dashboard (UI + analyse réelle) | `07-dashboard-e2e.spec.ts` |

## Variables utiles

| Variable | Rôle |
|----------|------|
| `E2E_TARGET=local\|staging` | Cible LLM (défaut `local`) |
| `E2E_STAGING_GROQ_API_KEY` | Clé cloud staging (fichier `.env.e2e.staging.local`) |
| `PLAYWRIGHT_EMAIL` / `PLAYWRIGHT_PASSWORD` | Connexion Supabase réelle |
| `PLAYWRIGHT_ALLOW_ACCOUNT_DELETE=1` | Autorise le delete réel (compte jetable) |
| `E2E_REQUIRE_OLLAMA=1` | Échoue si Ollama down (mode local) |
| `EVAL_API_KEY` | Optionnel — header API |
| `PLAYWRIGHT_BASE_URL` | Override (défaut `http://127.0.0.1:3010`) |

Par défaut le serveur e2e tourne en **local-dev** (Supabase désactivé) sur le port **3010**.
