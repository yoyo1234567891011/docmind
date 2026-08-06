# Mémoire documentaire

La mémoire construit un **graphe** à partir des analyses : entités, clauses, échéances, relations entre documents. Elle alimente timelines, insights Premium et la recherche contextuelle.

> À ne pas confondre avec `DOCMIND_FS_DUAL_WRITE` (double écriture stockage FS+PG). Ici « dual-write » = **history → graphe mémoire**.

## Concepts

Types : `src/types/memory.ts`.

| Concept | Description |
|---------|-------------|
| Entity | Personne, organisation, contrat, compte… |
| Clause | Clause extraite / typée |
| Deadline | Échéance (paiement, résiliation…) |
| Relation | Lien entre documents / entités (même contrepartie, suite, etc.) |
| Document node | Nœud mémoire lié à un `documentId` / history |

Phases relations : `pending` → `ready` | `failed` (champ `relationsPhase` sur l’historique).

## Flux d’écriture

```text
saveHistory(complete)
        │
        ▼
scheduleMemoryDualWrite(record)     // async, fire-and-forget
        │
        ├─ upsert entities / clauses / deadlines
        ├─ relation-engine (+ détecteurs P3/P4)
        ├─ optional LLM verify ambigu (MEMORY_RELATION_LLM_VERIFY)
        └─ update history: relationsPhase, contentHash, simhash
```

Fichiers clés :

- `src/services/memory/dual-write.ts`  
- `upsert-from-analysis.ts`  
- Stores : `entity-store`, `clause-store`, `deadline-store`, `relation-store`, `document-store`  
- `relation-engine.ts`, `timeline.ts`, `purge-document.ts`

En mode persistent, les blobs/fichiers mémoire passent par `app_user_files` / blobs (avec fallback FS si `DOCMIND_FS_FALLBACK`).

## APIs & UI

| Route | Rôle |
|-------|------|
| `GET /api/memory/timeline?documentId=` | Timeline d’un document |
| `GET /api/memory/timeline?entityId=` | Timeline d’une entité |
| `GET /api/memory/timeline?view=counterparties` | Vue contreparties |
| `GET\|PATCH /api/documents/:id/relations` | Relations pour l’UI |
| `GET /api/insights` | Vues agrégées Premium |

UI : pages insights / fiche document / gestionnaire.

## Recherche

`POST /api/search` — recherche NL sur fiches + documents (`src/services/search`).  
Les embeddings Ollama peuvent être utilisés selon config (`OLLAMA_EMBED_MODEL`).

## Migration mémoire

Anciens historiques sans graphe :

```bash
npm run migrate:memory-p0
```

Scripts de validation : `npm run test:memory` (+ `test:memory-p0` … `p4`).

## Règles métier

- Dual-write **ne bloque jamais** le retour P1/P2.  
- Échec mémoire → `relationsPhase: failed`, analyse conservée.  
- Suppression document → `purgeMemoryForDocument`.  
- Isolation stricte par `userId`.

## Suite

- Billing qui gate insights / letter → [Stripe](./04-stripe.md)  
- Events liés → [Analytics](./05-analytics.md)
