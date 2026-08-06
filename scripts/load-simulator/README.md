# Test de charge DocMind

Outil **autonome** : aucune modification du code applicatif.

## Niveaux (défaut)

`100 · 500 · 1 000 · 5 000 · 10 000` utilisateurs simultanés.

## Mesures

| Catégorie | Détail |
|-----------|--------|
| Latence | **P50 / P95 / P99** (parcours, P2, upload, file) |
| Hôte | CPU, RAM, GPU (`nvidia-smi`) |
| Infra | Redis (PING), Postgres (`SELECT 1`), S3 (`HeadBucket`) |
| Cache | `resultSource=cache` (live) ou modèle fingerprint |
| Queue | attente + longueur moy/max |
| Timeout | budget poll P2 (défaut 8 min) |

## Graphiques

Le rapport HTML génère automatiquement 8 graphiques (Chart.js) :

- Latence parcours P50/P95/P99
- Latence P2 P50/P95/P99
- Attente file P50/P95/P99
- Timeouts %
- CPU / RAM / GPU
- Redis / Postgres / S3
- Cache hit rate
- Longueur max de file

Fichiers :

- `reports/load-sim-report-latest.html`
- `reports/load-sim-report-latest.json`

## Modes

| Mode | Comportement |
|------|----------------|
| `model` | Projection file GPU M/D/1 + probes infra. **Rapide, sûr.** |
| `hybrid` | Calibration live (petit N) puis projection 100→10k. |
| `live` | Vrais HTTP. Au-delà de 50 users : refuse sans `--force-live`. |

## Lancer

```bash
# Recommandé : modèle 100→10k + graphiques
npm run load:test

# Hybride (serveur + Ollama + EVAL_API_KEY)
npm run load:test:hybrid -- --calibrate 3

# Live (dangereux au-delà de 50 sans --force-live)
npm run load:test:live -- --force-live --users 10

# Alias historiques
npm run load:sim -- --mode model
npm run load:sim:model
```

## Auth

- **`eval` (recommandé)** : header `x-eval-api-key`
- **`none`** : local-dev si Supabase absent
- **`supabase`** : signup Auth ; parcours API via eval/none

## Prérequis infra (optionnel)

Pour mesurer Redis / Postgres / S3, définir dans `.env.local` :

- `REDIS_URL`
- `DATABASE_URL`
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (+ endpoint/region)

Absents → colonnes « N/C » (le reste du rapport reste valide).
