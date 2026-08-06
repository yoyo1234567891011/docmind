# Déploiement

## Prérequis production

1. Node 20+  
2. Postgres + migrations `supabase/migrations` appliquées  
3. Object storage S3-compatible  
4. Redis  
5. Ollama joignable depuis l’app (même VPC / host autorisé)  
6. Projet Supabase Auth  
7. Compte Stripe (live) + webhook HTTPS  

## Build & run

```bash
npm ci
npm run build
npm run start   # 127.0.0.1:3000 — placer derrière un reverse-proxy TLS
```

Dev local : `npm run dev` (wrapper `scripts/dev.mjs` qui vérifie Ollama).

## Assert environnement au boot

`src/instrumentation.ts` → `validateProductionEnv()` si `NEXT_PUBLIC_APP_ENV` ∈ `production|beta|staging`.

**Obligatoire** (sinon crash au démarrage) :

- Supabase URL + anon + `SUPABASE_SERVICE_ROLE_KEY`  
- `NEXT_PUBLIC_APP_URL`  
- `ADMIN_EMAILS`  
- Stripe secret + publishable + price + webhook secret  
- `DATABASE_URL`, `REDIS_URL`, S3 (`S3_BUCKET`, keys, endpoint ou region)  
- `DOCMIND_STORAGE=persistent` (fs interdit en deploy)

Bypass CI uniquement : `DOCMIND_SKIP_ENV_ASSERT=1`.

Détails : [Variables ENV](./08-variables-env.md).

## Checklist go-live

1. Appliquer migrations SQL.  
2. `DOCMIND_STORAGE=persistent` + secrets.  
3. Migrer données FS si besoin : [Migration](./11-migration.md).  
4. `npm run validate:persistent`.  
5. Configurer webhook Stripe → `https://<host>/api/stripe/webhook`.  
6. `ADMIN_EMAILS` + compte admin.  
7. Health : `GET /api/health` (Ollama) ; details avec `HEALTH_DETAILS_TOKEN`.  
8. Monitoring : seuils + `MONITORING_WEBHOOK_URL` optionnel.  
9. Backups FS **et** dumps PG / versioning S3 (voir [Sauvegardes](./10-sauvegardes-restore.md)).  
10. Smoke manuel : signup → upload → analyze → checkout test → export RGPD.  
11. `npm run e2e` / `chaos` sur staging.  

## Reverse-proxy

- Terminer TLS en amont.  
- Forward `Host`, `X-Forwarded-Proto`.  
- Ne pas bufferer indéfiniment `/api/analyze` (timeout ≥ 5 min côté proxy ; `maxDuration` route = 300s).  
- Webhook Stripe : corps brut non réécrit.

## Scaling

| Composant | Note |
|-----------|------|
| Next (multi-instance) | Redis obligatoire (rate-limit) ; locks analyse/Ollama sont **in-process** |
| Ollama | Souvent 1 worker GPU ; file via `generate-lock` par instance |
| PG / S3 | Source de vérité en mode persistent |

Pour multi-instance GPU : un service Ollama partagé + accepter la contention (ou queue externe — non fournie).

## Maintenance

```env
MAINTENANCE_MODE=1
MAINTENANCE_MESSAGE=…
MAINTENANCE_BYPASS_SECRET=…   # header pour bypass ops
```

Middleware renvoie 503 aux utilisateurs.

## Observabilité

- Dashboard Admin → onglet **Production**  
- `npm run monitor:check` (cron)  
- Logs applicatifs + events `data/system/monitoring/`  

Voir [Monitoring](./09-monitoring.md).
