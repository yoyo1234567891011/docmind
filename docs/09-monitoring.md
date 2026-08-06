# Monitoring

## Surfaces

| Surface | Accès |
|---------|--------|
| Admin → onglet **Production** | `/admin` — dashboard ops + business |
| Admin → onglet **Monitoring** | Snapshot 24h + alertes + check manuel |
| API | `GET/POST /api/admin/monitoring`, `GET /api/admin/production` |
| CLI | `npm run monitor:check` |
| Health LB | `GET /api/health` (Ollama ; pas Redis/PG/S3 live) |

## Dashboard Production

Agrégateur : `src/services/ops/production-dashboard.ts`.

Affiche notamment :

- analyses/min, succès, erreurs, cache hit  
- P50 / P95 / P99, queue  
- GPU / VRAM / CPU / RAM (`nvidia-smi` ou proxy Ollama)  
- Stripe, utilisateurs actifs, revenus estimés, MRR, churn, conversion  

UI : `src/components/admin/production-dashboard.tsx` (refresh 30s).

## Events & snapshot

Store fichiers : `data/system/monitoring/`  
(`events.json`, `alerts.json`, `latest-snapshot.json`)

| Event | Producteur |
|-------|------------|
| `analysis.ok` / `analysis.error` | `/api/analyze` |
| `queue.wait` | `generate-lock` si attente > 50 ms |
| `server.error` | 5xx / rate-limit Redis |

Snapshot (`buildMonitoringSnapshot`) : taux succès, durées, wait moyen, Ollama up, proxy GPU, erreurs 5xx, alertes ouvertes.

## Alertes

Émises par `runMonitoringCheck` (`src/services/monitoring/collect.ts`) :

| Code | Sévérité | Condition |
|------|----------|-----------|
| `OLLAMA_DOWN` | critical | Ollama injoignable |
| `LOW_SUCCESS_RATE` | critical | Taux < `MONITOR_MIN_SUCCESS_RATE` (≥ 5 analyses) |
| `SLOW_ANALYSIS` | warning | Durée moy. > seuil |
| `HIGH_QUEUE_WAIT` | warning | Wait moyen > seuil |
| `SERVER_ERRORS` | critical | Trop de 5xx / 24h |

Webhook optionnel : `MONITORING_WEBHOOK_URL` (POST JSON).

## Cron recommandé

```bash
# toutes les 5–15 min
cd /path/to/docmind && npm run monitor:check
```

Exit codes : `0` OK · `2` alerte critique (`OLLAMA_DOWN` / `LOW_SUCCESS_RATE`).

## Rate-limit metrics

Compteurs process (`getRateLimitMetrics`) exposés sur l’API monitoring : hits, blocks, redisErrors, memoryFallbacks.  
**Reset au redémarrage** de l’instance.

## Limites à connaître

- Health public ne ping **pas** Redis/PG/S3.  
- Locks analyse/Ollama sont **par process**.  
- GPU dashboard : `nvidia-smi` si dispo, sinon heuristique Ollama `/api/ps`.  
- MRR / churn : agrégats locaux + events analytics (pas un export Stripe Revenue Recognition).
