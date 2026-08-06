# Sauvegardes & restauration

> Runbook FS détaillé historique aussi référencé sous [`BACKUP-RESTORE.md`](./BACKUP-RESTORE.md) (redirection).

## Ce qui est sauvegardé (mode FS)

Scripts : `npm run backup:run|verify|restore`  
Service : `src/services/backup/`

| Chemin | Contenu |
|--------|---------|
| `data/` | users, history, abonnements, cache, logs, admin, analytics, monitoring |
| `uploads/` | PDF par utilisateur |

Chaque backup : `backups/<backup-id>/` + `manifest.json` (tailles + SHA-256).  
Rétention : `BACKUP_KEEP` (défaut 14).

## Sauvegarde

```bash
npm run backup:run
```

Planification :

- **Windows** : Planificateur de tâches → `npm run backup:run` dans le répertoire projet.  
- **Linux/macOS** : cron, ex. `0 3 * * * cd /path/to/docmind && npm run backup:run >> logs/backup.log 2>&1`

Copier périodiquement `backups/` hors machine (NAS, autre bucket).

## Vérification

```bash
npm run backup:verify
npm run backup:verify -- backup-2026-07-30T01-00-00-000Z
```

Compare présence + hash SHA-256. Divergence → exit 1.

## Restauration (FS)

1. **Arrêter** l’application.  
2. Dry-run :

```bash
npm run backup:restore -- <backup-id> --dry-run
```

3. Restauration réelle (**écrase** `data/` et `uploads/`) :

```bash
npm run backup:restore -- <backup-id>
```

4. Relancer l’app → `/api/health` + login.  
5. Facturation : sync Stripe (`/facturation` → Actualiser) pour réaligner les abonnements.

## Mode persistent (Postgres + S3)

Les scripts `backup:*` couvrent surtout le **layout FS**. En production persistent, prévoir en plus :

| Donnée | Outil recommandé |
|--------|------------------|
| Postgres | `pg_dump` / PITR managed |
| S3 / MinIO | Versioning bucket + réplication |
| Redis | Éphémère (rate-limit / cache) — pas de restore user data |

Après restore PG+S3 :

1. Vérifier `npm run validate:persistent`.  
2. Sync billing.  
3. Smoke analyse + export RGPD.

## Bonnes pratiques

- Ne jamais restaurer une sauvegarde non vérifiée.  
- Tester un restore sur staging avant incident.  
- Documenter le RPO/RTO de l’équipe.  
- Secrets (`.env`) : sauvegarde séparée / coffre, **pas** dans `backups/` git.
