# Simulation financière DocMind

Calcule automatiquement pour **100 · 500 · 1 000 · 5 000 · 10 000** utilisateurs :

| Indicateur | Définition |
|------------|------------|
| **MRR** | Premium × 19 € |
| **ARR** | MRR × 12 |
| **GPU** | max(usage analyses, flotte instances) |
| **Redis / S3 / Postgres** | base + palier volume |
| **Stripe** | 1,5 % + 0,25 € / paiement |
| **Emails** | volume × coût unitaire |
| **Bénéfice** | MRR − coûts totaux |
| **Marge** | bénéfice / MRR |
| **Burn rate** | perte mensuelle si &lt; 0 |
| **Point mort** | users où profit ≥ 0 |
| **ROI** | bénéfice annuel / investissement |

## Lancer

```bash
npm run finance:sim
npm run finance:sim -- --conversion 0.15 --fixed-opex 5000
```

Rapports :

- `reports/finance-sim-report-latest.html` (graphiques)
- `reports/finance-sim-report-latest.json`

## Options

`--price` · `--conversion` · `--fixed-opex` · `--investment` · `--gpu-instance` · `--users-per-gpu` · `--analyses` · `--users` · `--out`
