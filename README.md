# DocMind

SaaS d’analyse de documents PDF avec une IA locale (**Ollama**).  
Next.js 15 · TypeScript · Supabase Auth · Stripe · Postgres/S3/Redis (prod).

## Documentation

**Nouveau développeur → commencer ici :**

### [📚 docs/README.md](./docs/README.md)

| Sujet | Lien |
|-------|------|
| Architecture | [docs/01-architecture.md](./docs/01-architecture.md) |
| Pipeline d’analyse | [docs/02-pipeline.md](./docs/02-pipeline.md) |
| Mémoire documentaire | [docs/03-memoire.md](./docs/03-memoire.md) |
| Stripe & billing | [docs/04-stripe.md](./docs/04-stripe.md) |
| Analytics | [docs/05-analytics.md](./docs/05-analytics.md) |
| API | [docs/06-api.md](./docs/06-api.md) |
| Déploiement | [docs/07-deploiement.md](./docs/07-deploiement.md) |
| Variables ENV | [docs/08-variables-env.md](./docs/08-variables-env.md) |
| Monitoring | [docs/09-monitoring.md](./docs/09-monitoring.md) |
| Sauvegardes & restore | [docs/10-sauvegardes-restore.md](./docs/10-sauvegardes-restore.md) |
| Migration FS → PG/S3 | [docs/11-migration.md](./docs/11-migration.md) |
| Tests | [docs/12-tests.md](./docs/12-tests.md) |
| Benchmark | [docs/13-benchmark.md](./docs/13-benchmark.md) |

## Démarrage rapide

```bash
cp .env.example .env.local
npm install
ollama serve          # autre terminal
ollama pull qwen3
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

Sans Supabase dans `.env.local`, l’app tourne en **local-dev** (pas de login).  
Référence des variables : [docs/08-variables-env.md](./docs/08-variables-env.md) et [`.env.example`](./.env.example).

## Commandes utiles

| Commande | Rôle |
|----------|------|
| `npm run dev` | Développement |
| `npm run build` / `start` | Production |
| `npm run e2e` | Tests Playwright |
| `npm run chaos` | Chaos testing |
| `npm run evaluate` | Éval qualité corpus |
| `npm run benchmark` | DocMind vs ChatGPT / Claude / Gemini / Mistral |
| `npm run backup:run` | Sauvegarde FS |
| `npm run monitor:check` | Check monitoring |
| `npm run migrate:persistent` | Migration FS → PG/S3 |

## Architecture (aperçu)

```text
PDF → upload/extract → analyze (P1 local + P2 agents Ollama)
                         → history + mémoire + alertes
                         → billing Stripe (Premium)
```

Détails : [docs/01-architecture.md](./docs/01-architecture.md) · [docs/02-pipeline.md](./docs/02-pipeline.md).
