# Benchmark DocMind

Compare **DocMind** à **ChatGPT**, **Claude**, **Gemini** et **Mistral Le Chat** sur un corpus ground-truth.

## Dimensions

| Métrique | Mesure |
|----------|--------|
| Qualité | Score moyen `compareAnalysis` vs `*_expected.json` |
| Hallucinations | Part d’items « en trop » (extras) sur les listes |
| Citations | Extraits ancrables dans le texte source |
| Vitesse | Latence moyenne (ms) |
| OCR | Recall montants / dates / personnes / organisations |
| Contrat / Facture / Courrier | Qualité par suite thématique |

## Lancer

```bash
# Serveur DocMind requis
npm run dev

# Benchmark (2 docs / suite)
npm run benchmark

# Smoke rapide (1 doc / suite, DocMind seul si pas de clés)
npm run benchmark:quick
```

Options :

```bash
npm run benchmark -- --limit 1 --providers docmind,claude
npm run benchmark -- --base-url http://127.0.0.1:3000
```

## Clés API (optionnelles)

| Provider | Variable |
|----------|----------|
| ChatGPT | `OPENAI_API_KEY` (+ `BENCHMARK_OPENAI_MODEL`) |
| Claude | `ANTHROPIC_API_KEY` (+ `BENCHMARK_ANTHROPIC_MODEL`) |
| Gemini | `GEMINI_API_KEY` ou `GOOGLE_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |

Sans clé : le provider est **skippé** (DocMind reste exécuté).

## Rapports

- `reports/benchmark-latest.html` — tableau + résumé des différences  
- `reports/benchmark-latest.json` — données brutes  
- `reports/benchmark/<runId>/raw/<provider>/` — prédictions JSON

## Méthode

1. Sélection corpus `test-documents/` (suites contrat / facture / courrier / ocr).  
2. DocMind : `POST /api/upload` + `/api/analyze`.  
3. Cloud : prompt JSON commun ; PDF natif si API OK, sinon texte extrait.  
4. Scoring offline identique pour tous (`src/ai/comparison`).  

Voir aussi [docs/13-benchmark.md](../../docs/13-benchmark.md).
