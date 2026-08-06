# Base de connaissances DocMind

Fiches Markdown **indépendantes du modèle**. Elles sont chargées automatiquement selon le type de document et injectées dans l’analyse.

## Ajouter une fiche (sans toucher au code)

1. Créez `knowledge/mon_domaine.md` avec les sections standards (définitions, risques, délais…).
2. Ajoutez une entrée dans `manifest.json` :

```json
{
  "id": "mon_domaine",
  "file": "mon_domaine.md",
  "label": "Mon domaine",
  "categories": ["contrat"],
  "aliases": ["libellé alternatif"],
  "keywords": ["mot1", "mot2"]
}
```

3. Relancez une analyse : le moteur sélectionne les fiches pertinentes.

## Règles de sélection

- `general` est toujours inclus (`alwaysInclude`).
- Priorité aux fiches dont `categories` matchent la classification.
- Bonus si des `keywords` apparaissent dans le texte du document.
- Limite de taille : `maxInjectChars` / `maxFiles` dans le manifest.

## Sections recommandées

Définitions · Clauses courantes · Risques fréquents · Obligations · Pénalités · Délais · Pièges · Éléments à vérifier · Bonnes pratiques · Critères d’évaluation · Exemples
