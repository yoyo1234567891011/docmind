# Pipeline d’analyse

## Vue d’ensemble

```text
Client                API                         Services / AI
  │                    │
  │  POST /api/upload  │
  ├───────────────────►│  validate PDF
  │                    │  savePdfToUploads (FS ou S3)
  │                    │  extractTextFromPdf (unpdf)
  │◄───────────────────┤  { document.id, extraction.text }
  │                    │
  │  POST /api/analyze │
  ├───────────────────►│  quota + rate-limit
  │                    │
  │   mode=progressive │── P1 quickAnalyze (local, sync)
  │◄── preview ────────┤   saveHistory(phase=preview)
  │                    │── after() → P2 analyzeDocumentText
  │                    │   updateHistory(complete|failed)
  │                    │
  │   mode=full        │── P2 sync (scripts / evaluate)
  │◄── complete ───────┤   saveHistory
```

Fichiers pivots :

- Upload : `src/app/api/upload/route.ts` → `src/services/documents/upload.ts`  
- Analyze : `src/app/api/analyze/route.ts`  
- P1 : `src/ai/pipelines/quick-analyze.ts`  
- P2 : `src/ai/pipelines/analyze.ts` + `src/ai/agents/orchestrator.ts`

## 1. Upload

1. Auth + rate-limit + quota `upload`.  
2. Validation PDF (`assertValidPdfUpload`).  
3. Écriture bytes **avant** extraction (si extract échoue → PDF orphelin possible, pas d’historique).  
4. Extraction `unpdf` → texte + pages.  
5. Event analytics `extraction.completed`.

Réponse typique : `{ document: { id, fileName, … }, extraction: { text, pageCount } }`.

## 2. Modes d’analyse

| Mode | Usage | Comportement |
|------|-------|--------------|
| `progressive` | UI (`/analyser`) | P1 sync (pas d’Ollama) → historique `preview` → P2 async |
| `full` (défaut scripts) | evaluate, API scripts | P2 sync complet |

P1 donne un aperçu immédiat (classification heuristique + faits locaux).  
P2 produit l’analyse juridique structurée (agents + Ollama).

## 3. Chaîne agents (P2)

Orchestrateur : `src/ai/agents/orchestrator.ts`

```text
classify → facts → legal → risks → score → actions → verify
```

- Knowledge métier injectée depuis `knowledge/` (`load-knowledge.ts`).  
- Post-traitement risques / citations / scoring dans `src/ai/`.  
- En échec partiel : **salvage** possible (`resultSource: "salvage"`).

## 4. Cache & locks

| Mécanisme | Fichier | Effet |
|-----------|---------|--------|
| Cache résultat | `src/ai/optimizations/analysis-cache.ts` | Hit si même texte + fingerprint prompts + `ANALYSIS_PIPELINE_VERSION` |
| Single-flight document | `document-analysis-lock.ts` | Évite 2 LLM pour le même `documentId` (processus) |
| Lock GPU Ollama | `generate-lock.ts` | Une génération à la fois ; file d’attente ; timeout `OLLAMA_LOCK_MAX_WAIT_MS` |

Toggles : `OPT_ANALYSIS_CACHE`, `OPT_CONDITIONAL_JSON_RETRY`, `OPT_OLLAMA_KEEP_ALIVE` (`src/config/optimizations.ts`).

`resultSource` possible : `agents` | `cache` | `salvage` (utile analytics / monitoring).

## 5. Persistance après analyse

- `saveHistoryRecord` → JSON FS ou `app_history` PG.  
- Index fiche / recherche (async).  
- `scheduleMemoryDualWrite` → graphe mémoire (async, ne bloque pas l’API).  
- Events monitoring `analysis.ok` / `analysis.error` (+ `queue.wait` si attente lock).

## 6. Garanties & pièges

| Situation | Comportement attendu |
|-----------|----------------------|
| Ollama down pendant P2 | Erreur / salvage ; preview progressive **conservé** si déjà sauvé |
| Kill process mid-`after()` | Historique peut rester `preview` (pas de watchdog auto) |
| Analyse OK mais save history échoue | API peut renvoyer le résultat **sans** `historyId` — perte côté UI |
| Cache hit | Latence faible ; `resultSource=cache` |

## Suite

- Graphe post-analyse → [Mémoire](./03-memoire.md)  
- Tester le flux → [Tests](./12-tests.md) · `e2e/specs/02-document-lifecycle.spec.ts`
