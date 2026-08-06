# Migration FS → persistent

Objectif : passer de `data/` + `uploads/` locaux à **Postgres + S3** (+ Redis) sans perte utilisateur.

## Prérequis

1. Postgres accessible (`DATABASE_URL`).  
2. Migrations SQL appliquées (`supabase/migrations`, notamment `20260801000005_*` et suivantes).  
3. Bucket S3 configuré (`S3_*`).  
4. Redis prêt (`REDIS_URL`) pour le runtime prod.  
5. Snapshot backup FS : `npm run backup:run` **avant** toute migration.

## Étapes

### 1. Configurer les secrets (sans basculer encore le trafic)

Renseigner dans l’env de migration :

```env
DATABASE_URL=postgresql://…
S3_BUCKET=…
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_ENDPOINT=…   # ou AWS_REGION
REDIS_URL=redis://…
```

### 2. Lancer la migration (lecture FS)

Le script lit le FS même si les cibles PG/S3 sont configurées :

```bash
# Important : lire depuis FS
DOCMIND_STORAGE=fs npm run migrate:persistent
```

Script : `scripts/migrate-fs-to-persistent.ts`  
Migre (idempotent) : subscriptions, usage, history, métadonnées documents, PDF → S3.

### 3. Valider

```bash
npm run validate:persistent
```

Corriger toute divergence avant bascule.

### 4. Bascule progressive

```env
DOCMIND_STORAGE=persistent
DOCMIND_FS_FALLBACK=1          # lit FS si miss PG/Redis + promote lazy
# DOCMIND_FS_DUAL_WRITE=1      # optionnel : écrit les deux pendant la fenêtre rollback
```

Redémarrer l’app. Smoke tests multi-instance / multi-user.

### 5. Durcir

Quand la confiance est OK :

```env
DOCMIND_FS_FALLBACK=0
DOCMIND_FS_DUAL_WRITE=0
```

Conserver une archive froide de `data/` + `uploads/` hors machine.

## Flags runtime

| Variable | Rôle |
|----------|------|
| `DOCMIND_STORAGE` | `fs` \| `persistent` |
| `DOCMIND_FS_FALLBACK` | Miss PG → lecture FS + promote (défaut on si persistent) |
| `DOCMIND_FS_DUAL_WRITE` | Écrit PG **et** FS (rollback) |

Code : `src/config/persistence.ts`, `src/lib/user-files.ts`.

## Migration mémoire (indépendante)

Anciens historiques sans graphe :

```bash
npm run migrate:memory-p0
```

Voir [Mémoire](./03-memoire.md).

## Rollback

1. Remettre `DOCMIND_STORAGE=fs` (si dual-write / FS encore à jour).  
2. Ou restore backup FS : [Sauvegardes](./10-sauvegardes-restore.md).  
3. Investiguer logs PG/S3 avant nouvelle tentative.

## Pièges

- Migrer **avec** `DOCMIND_STORAGE=persistent` peut faire lire PG vide au lieu du FS.  
- PDF déjà en S3 : le script est idempotent mais vérifie les tailles.  
- Webhooks Stripe : table `stripe_webhook_events` doit exister avant prod traffic.  
- Quotas : RMW non transactionnel SQL — acceptable, pas bloquant migration.
