# Tests

## Vue d’ensemble

| Suite | Commande | Rôle |
|-------|----------|------|
| E2E Playwright | `npm run e2e` | Parcours utilisateur critique |
| Chaos | `npm run chaos` | Pannes simulées, no data loss |
| Scripts domaine | `npm run test:*` | Mémoire, billing, agents, … |
| Régression | `npm run test:regression` | Bundle large + `tsc` + lint |
| Evaluate | `npm run evaluate` | Qualité analyse sur corpus |
| Benchmark | `npm run benchmark` | DocMind vs ChatGPT/Claude/Gemini/Mistral |
| Load | `npm run load:sim` | Charge / GPU |

## E2E (Playwright)

Docs : [`e2e/README.md`](../e2e/README.md).

```bash
npm run e2e
```

- Port dédié **3010**, local-dev par défaut (Supabase désactivé).  
- Couverture : auth, upload/export, analyse/cache (si Ollama), alertes, mémoire/courrier, Premium/refund, RGPD/delete.  
- Sans Ollama : analyse/mémoire/courrier **skippés** (pas d’échec). Forcer : `E2E_REQUIRE_OLLAMA=1`.

UI debug : `npm run e2e:ui`.

## Chaos

Docs : [`chaos/README.md`](../chaos/README.md).

```bash
npm run chaos          # unit + e2e chaos
npm run chaos:unit     # injection in-process
npm run chaos:e2e      # transport / restart
```

Simule : Ollama/Redis/PG/S3 down, Stripe timeout, webhook perdu, disque plein, OOM, upload interrompu, connexion coupée, GPU crash, restart mid-analyse.

Injection : `src/lib/chaos` uniquement si `DOCMIND_CHAOS=1` (bloquée en production sauf drill).

## Scripts `test:*` (tsx)

| Script | Domaine |
|--------|---------|
| `test:p0` | Optimisations cache / retry |
| `test:reasoning` | Raisonnement risques |
| `test:agents` / `test:agent-eval` | Multi-agents |
| `test:citations` | Citations |
| `test:knowledge` | Knowledge inject |
| `test:memory` (+ p0–p4) | Mémoire documentaire |
| `test:insights` | Insights produit |
| `test:search` | Recherche NL |
| `test:alerts` | Moteur d’alertes |
| `test:letter` | Agent courrier |
| `test:manager` | Gestionnaire documents |
| `test:auth` | Isolation multi-users |
| `test:billing` | Facturation |
| `test:anonymize` | Anonymisation corpus |
| `test:analytics` | Analytics |
| `test:production-ops` | Export, backup, quotas, monitoring |

Exemple :

```bash
npm run test:billing
npm run test:memory-p0
```

## Evaluate (qualité)

```bash
npm run evaluate           # corpus synthétique
npm run evaluate:quick     # --limit 3
npm run evaluate:real      # corpus réel anonymisé
npm run test:docs          # eval documents
```

Nécessite app joignable (`EVAL_BASE_URL`) + souvent `EVAL_API_KEY`.  
Corpus : `test-documents/`, `corpus/` — voir leurs README.

## Load & bench

```bash
npm run load:test          # 100→10k, P50/P95/P99, infra, graphiques
npm run load:test:hybrid   # calibration live + projection
npm run load:sim:model     # alias modèle
npm run finance:sim        # MRR/ARR, coûts, marge, burn, point mort, ROI
npm run bench:p0
```

Voir [`scripts/load-simulator/README.md`](../scripts/load-simulator/README.md)  
et [`scripts/finance-simulator/README.md`](../scripts/finance-simulator/README.md).  
Rapports : `reports/load-sim-report-latest.html`, `reports/finance-sim-report-latest.html`.

## Régression avant merge

```bash
npm run test:regression
```

En CI allégé minimum recommandé :

```bash
npx tsc --noEmit
npm run lint
npm run e2e
npm run chaos:unit
```

## Fixtures

```bash
npm run e2e:prepare        # sample.pdf Playwright
npm run generate:docs      # documents de test MD
npm run generate:pdfs      # conversion PDF
npm run corpus:import      # import corpus anonymisé
```

## Comment ajouter un test

1. **Domaine isolé** → nouveau `scripts/test-….ts` + entrée `package.json`.  
2. **Parcours UI/API** → spec sous `e2e/specs/`.  
3. **Résilience** → scénario dans `chaos/scenarios/`.  
4. Toujours assert **isolation user** et absence de fuite de données.
