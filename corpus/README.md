# Corpus réel anonymisé — DocMind

Pipeline pour importer des **documents réels**, les **anonymiser automatiquement**, puis les brancher sur le moteur d’évaluation.

## Principes

| Conservé | Anonymisé |
|----------|-----------|
| Montants (€ / EUR) | Emails, téléphones |
| Dates et échéances | IBAN / BIC / NIR / SIRET |
| Clauses, articles, structure | Adresses postales |
| Mise en page (pages, titres, sauts de ligne) | Noms de personnes (explicites + heuristique) |
| | Organisations **si** fournies via `--orgs` |

Les originaux (PII) restent dans `corpus/inbox/` (**gitignoré**). Seuls les documents anonymisés partent dans `test-documents/real-anonymized/` pour l’évaluation.

## Import rapide

1. Déposer un PDF (couche texte) ou un `.md` / `.txt` dans `corpus/inbox/`  
   **ou** passer le chemin en argument.

2. Lancer :

```bash
# Un fichier
npm run corpus:import -- ./mon-bail.pdf --type Bail --subcategory bail --slug bail-t2-rennes

# Avec remplacements forcés
npm run corpus:import -- ./facture.pdf --type "Facture" --people "Jean Dupont=Alice Martin" --orgs "Orange=Telecom Exemple"

# Tout le dossier inbox
npm run corpus:import -- --inbox
```

3. Compléter les `TODO` dans le `*_expected.json` généré (résumé, risques, actions, score).

4. Évaluer :

```bash
npm run evaluate -- --corpus real
npm run test:docs -- --corpus real
npm run evaluate -- --corpus synthetic   # documents fictifs uniquement
npm run evaluate -- --corpus all         # défaut
```

## Sortie

```text
test-documents/real-anonymized/<sous-categorie>/
  01-slug.md
  01-slug.pdf
  01-slug_expected.json
  01-slug.replacements.json   # mapping local — gitignoré (peut contenir des PII)
corpus/manifest.json
```

## Attention

- Un PDF **scanné sans OCR** ne peut pas être importé (aucun texte) — fournissez un `.md` ou un PDF texte.
- `npm run generate:docs` **préserve** le dossier `real-anonymized` (ne l’efface plus).
- Relisez toujours l’anonymisation avant commit / partage.
