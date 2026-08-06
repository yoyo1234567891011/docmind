# Benchmark concurrentiel

Comparer **DocMind** à des assistants cloud grand public sur les mêmes documents ground-truth.

## Providers

| Id | Produit | Inférence |
|----|---------|-----------|
| `docmind` | DocMind | Ollama local via `/api/upload` + `/api/analyze` |
| `chatgpt` | ChatGPT (OpenAI API) | `gpt-4o` (PDF ou texte) |
| `claude` | Claude (Anthropic API) | Sonnet (PDF document) |
| `gemini` | Gemini (Google API) | Flash / Pro (PDF inline) |
| `mistral` | Mistral Le Chat (API) | `mistral-large` (**texte** — pas l’UX web) |

## Métriques

| Dimension | Définition |
|-----------|------------|
| **Qualité** | Moyenne des scores champs (`compareAnalysis`) |
| **Hallucinations** | Ratio d’éléments prédits absents du golden (extras) |
| **Vitesse** | Temps de bout en bout par document |
| **Citations** | Part d’extraits localisables dans le texte source |
| **OCR** | Recall des montants / dates / personnes / organisations |
| **Contrat / Facture / Courrier** | Qualité filtrée par catégorie corpus |

## Lancer

```bash
npm run dev                 # terminal 1
npm run benchmark           # terminal 2
npm run benchmark:quick     # 1 doc / suite
```

Rapport : `reports/benchmark-latest.html`.

Détails techniques : [`scripts/benchmark/README.md`](../scripts/benchmark/README.md).

## Interprétation des différences (typique)

Ces points guident la lecture du rapport (les chiffres exacts dépendent du run) :

1. **Qualité** — Les modèles cloud généralistes sont forts sur résumé fluide ; DocMind est calibré sur le schéma métier FR + golden `ExpectedAnalysis`.  
2. **Hallucinations** — DocMind applique un verify serveur qui **rejette** les claims sans preuve ; les chat UI cloud peuvent inventer plus librement sauf prompt strict.  
3. **Citations** — Avantage structurel DocMind (`risk_findings` + locator). Les cloud ne citent bien que si le prompt impose des extraits verbatim.  
4. **Vitesse** — Cloud API souvent plus rapide qu’un petit GPU local ; DocMind dépend d’Ollama / file d’attente.  
5. **OCR** — DocMind mesure l’extraction `unpdf` + structuration ; Gemini/Claude/ChatGPT en mode PDF testent la lecture native ; Mistral API est évalué sur **texte déjà extrait**.  
6. **Contrat** — Clauses, risques, échéances : DocMind + agents juridiques vs raisonnement généraliste.  
7. **Facture** — Montants / dates / émetteurs : stress OCR + listes.  
8. **Courrier** — Relances, admins, CAF/impôts : classification + actions.

## Variables

Voir [Variables ENV](./08-variables-env.md) section Benchmark, et `.env.example`.
