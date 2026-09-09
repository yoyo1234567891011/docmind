# Sauvegardes & restauration

## Règle d’or

| Mode | Backup production ? | Commande |
|------|---------------------|----------|
| `DOCMIND_STORAGE=persistent` | **Oui** — Postgres + PDF S3 + manifeste SHA-256 | `npm run backup:run` |
| FS local (`data/` + `uploads/`) | **Non** — outil de dev uniquement | `npm run backup:run` (émet un warning) |

Le backup FS **n’est PAS un backup production**. En persistent, `createDailyBackup` refuse explicitement ; le CLI dispatch vers le backup PG+S3.

Redis (rate-limit / cache) est **éphémère** : non inclus.

---

## Backup production (persistent)

### Contenu

Artefact : `backups/<id>/`

| Élément | Chemin | Description |
|---------|--------|-------------|
| Manifeste | `manifest.json` (`kind: "persistent"`) | Inventaire, tailles, SHA-256 |
| Postgres | `postgres/dump.json` | Export logique des tables `app_*` + webhooks + cleanup jobs |
| PDF | `pdfs/<userId>/<documentId>.pdf` | Objets S3 listés via `app_documents` |

Tables couvertes : `app_subscriptions`, `app_usage`, `app_history`, `app_documents`, `app_user_blobs`, `app_user_files`, `stripe_webhook_events`, `app_storage_cleanup_jobs`.

Pointeur : `backups/latest-persistent.json`.

### Créer une sauvegarde

Prérequis : `DOCMIND_STORAGE=persistent`, `DATABASE_URL`, credentials S3.

```bash
npm run backup:run
```

Vérifie automatiquement les SHA-256 après copie. Rétention : `BACKUP_KEEP` (défaut 14).

Copier périodiquement `backups/` **hors machine** (autre bucket / NAS / coffre).

Planification :

- **Windows** : Planificateur de tâches → `npm run backup:run` dans le répertoire projet.
- **Linux/macOS** : `0 3 * * * cd /path/to/docmind && npm run backup:run >> logs/backup.log 2>&1`

### Vérifier l’intégrité

```bash
npm run backup:verify
npm run backup:verify -- persistent-2026-08-08T22-00-00-000Z
```

Contrôles :

- présence de chaque fichier du manifeste ;
- SHA-256 dump Postgres + chaque PDF ;
- `storage_key` = `users/<userId>/<documentId>.pdf` ;
- chemins dangereux (`..`, absolus, hors `pdfs/<user>/<doc>.pdf`) → échec.

---

## Restore production → staging

### Procédure précise

1. **Préparer un environnement staging isolé**
   - Projet Supabase / Postgres de staging (pas la prod).
   - Bucket S3 de staging (vide ou jetable).
   - `.env` staging : `NEXT_PUBLIC_APP_ENV=staging`, `DOCMIND_STORAGE=persistent`, `DOCMIND_FS_FALLBACK=0`, `DATABASE_URL`, `REDIS_URL`, `S3_*` pointant vers le staging.
   - Appliquer les migrations (`supabase db push` / équivalent).

2. **Copier l’artefact backup** vers la machine qui exécute le restore  
   `backups/<backup-id>/` complet (manifeste + `postgres/` + `pdfs/`).

3. **Dry-run** (aucune écriture DB/S3) :

```bash
NEXT_PUBLIC_APP_ENV=staging npm run backup:restore -- <backup-id> --dry-run
```

4. **Restore réel** (vérifie SHA-256, refuse chemins dangereux, wipe tables app_*, réinjecte PG puis PDF S3, contrôle cohérence DB ↔ fichiers) :

```bash
NEXT_PUBLIC_APP_ENV=staging npm run backup:restore -- <backup-id>
```

5. **Contrôles post-restore**

```bash
npm run validate:persistent
npm run backup:verify -- <backup-id>
```

Smoke manuel :

- login staging ;
- ouvrir un document restauré (GET PDF) ;
- vérifier une entrée d’historique liée ;
- `/facturation` → Actualiser (réaligner Stripe si besoin).

6. **Prod uniquement en incident contrôlé**

```bash
BACKUP_RESTORE_ALLOW_PRODUCTION=1 npm run backup:restore -- <backup-id> --allow-production
```

Sans `NEXT_PUBLIC_APP_ENV=staging` **et** sans ce flag, le restore persistent est **refusé**.

### Ce que le restore garantit

| Contrôle | Comportement |
|----------|--------------|
| SHA-256 | Fail-closed si dump ou PDF altéré |
| Path traversal | Refuse `..`, chemins absolus, clés hors `pdfs/<userId>/<documentId>.pdf` |
| Cible | Staging par défaut |
| Cohérence DB ↔ fichiers | Chaque PDF du manifeste a une ligne `app_documents` + objet S3 hash-identique ; chaque `app_documents` a un PDF lisible |

---

## Backup FS (dev uniquement)

Scripts historiques sur `data/` + `uploads/` + `manifest.json` sans `kind: "persistent"`.

```bash
# seulement si DOCMIND_STORAGE ≠ persistent
npm run backup:run
npm run backup:verify -- <fs-backup-id>
npm run backup:restore -- <fs-backup-id> --dry-run
```

En mode persistent, restore FS est **interdit** (évite d’écraser un layout local vide en croyant restaurer la prod).

---

## Secrets

Les secrets (`.env`, clés Stripe/Supabase/S3) sont **hors** `backups/`. Coffre séparé.

---

## Tests

```bash
npm run test:persistent-backup
```

Couvre : restore document complet DB+PDF, détection SHA-256, chemins dangereux, refus restore prod sans flag.

---

## RPO / RTO (à renseigner par l’équipe)

| Objectif | Valeur cible |
|----------|--------------|
| RPO | _ex. 24 h (backup quotidien)_ |
| RTO staging drill | _ex. < 2 h_ |
| Dernier drill staging | _date_ |
