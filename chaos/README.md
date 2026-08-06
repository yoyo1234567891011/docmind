# Chaos Testing — DocMind

Objectif : sous panne, **aucune perte de données utilisateur** (PDF, historique, abonnement local).

## Lancer (une commande)

```bash
npm run chaos
```

Enchaîne :

1. Suite in-process (injection de pannes) — 12 scénarios
2. Specs Playwright transport / restart

## Scénarios

| Faute | Vérification |
|-------|----------------|
| Ollama down | Erreur propre ; PDF + historique intacts |
| Redis down | Fail-closed en env déployé ; données intacts |
| Postgres down | Query échoue ; données FS intacts |
| S3 down | Upload refusé ; historique existant intact |
| Stripe timeout | Plan local non corrompu |
| Webhook perdu | Retry idempotent |
| Disque plein | Écriture refusée ; seed intact |
| Mémoire saturée | Pas d’écrasement d’historique |
| Upload interrompu | Pas d’historique fantôme |
| Connexion coupée | Abort propre ; seed durable |
| Worker GPU crash | ECONNRESET ; preview intact |
| Restart mid-analyse | Preview + PDF survivent |

## Injection

Activée uniquement si `DOCMIND_CHAOS=1` (bloquée en `production` sauf `DOCMIND_CHAOS_ALLOW_IN_PROD=1`).

```bash
DOCMIND_CHAOS=1
DOCMIND_CHAOS_FAULTS=ollama_down,redis_down
```

Hooks : `src/lib/chaos` → Ollama, Redis RL, Postgres `query`, S3, Stripe, FS upload/history.
