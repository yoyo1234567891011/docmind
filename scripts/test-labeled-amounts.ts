import assert from "node:assert/strict";
import {
  extractAmounts,
  extractLabeledAmounts,
  filterAmountsForDisplay,
  parseAmountDisplay,
  scrubAbsurdAmountsInText,
  scrubDisplayProse,
} from "../src/services/extraction/amounts";

const BAIL = `
BAIL D'HABITATION
Entre le bailleur et le locataire.
Loyer mensuel hors charges : 1 050 €.
Provisions pour charges : 140 € par mois.
Dépôt de garantie : 2 100 € (soit 2 mois de loyer).
Honoraires d'agence : 1 800 €.
Honoraires à la charge du locataire : 900 €.
Pénalités de retard : 40 €.
Frais de recouvrement : 23 €.
Capital social de l'agence : 50 000 €.
Garantie financière d'agence : 120 000 €.
Montant divers sans contexte : 777 €.
`;

const labeled = extractLabeledAmounts(BAIL);
const byLabel = Object.fromEntries(labeled.map((a) => [a.label, a.value]));

assert.equal(byLabel["Loyer mensuel"], "1 050 €");
assert.equal(byLabel["Provision pour charges mensuelles"], "140 €");
assert.match(byLabel["Dépôt de garantie (2 mois)"] ?? "", /2 100/);
assert.equal(byLabel["Honoraires d’agence"], "1 800 €");
assert.equal(byLabel["Honoraires à la charge du locataire"], "900 €");
assert.equal(byLabel["Pénalités de retard"], "40 €");
assert.equal(byLabel["Frais de recouvrement"], "23 €");

const capital = labeled.find((a) => a.label.includes("Capital social"));
const garantie = labeled.find((a) =>
  a.label.includes("Garantie financière"),
);
assert.ok(capital);
assert.equal(capital!.importance, "secondary");
assert.ok(garantie);
assert.equal(garantie!.importance, "secondary");

const display = extractAmounts(BAIL);
assert.ok(display.some((l) => l.includes("Loyer mensuel")));
assert.ok(display.some((l) => l.includes("charges")));
assert.ok(display.some((l) => l.includes("Dépôt")));
assert.ok(display.some((l) => l.includes("Honoraires")));
assert.ok(
  !display.some((l) =>
    /50\s*000|120\s*000|capital\s+social|garantie\s+financi|contexte\s+professionnel/i.test(
      l,
    ),
  ),
  "capital social / garantie agence exclus de l’affichage",
);
// Fallback non labelisé : pas de « — » ou libellé générique
assert.ok(
  !display.some((l) => /^777/.test(l) && l.includes("—")),
  "777 sans label métier ne doit pas polluer si assez de primaires",
);

const parsed = parseAmountDisplay("1 050 € — Loyer mensuel");
assert.equal(parsed.value, "1 050 €");
assert.equal(parsed.label, "Loyer mensuel");

// Même montant, deux rôles (loyer = dépôt 1 mois)
const SAME = `
Loyer mensuel hors charges : 679 €.
Dépôt de garantie : 679 €.
`;
const same = extractLabeledAmounts(SAME);
assert.ok(same.some((a) => a.label === "Loyer mensuel"));
assert.ok(same.some((a) => a.label.startsWith("Dépôt de garantie")));

// Avis taxe foncière : montant à prélever vs chiffre national hors sujet
const TAXE_FONCIERE = `
DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES
Avis de prélèvement — Taxe foncière 2024

Montant à prélever : 1 178,00 €
Date de prélèvement : 15 octobre 2024

Information : suite à la suppression de la taxe d'habitation,
le produit national de la taxe s'élève à 234 079 050 €
pour l'ensemble des foyers et des collectivités.
`;

const tfLabeled = extractLabeledAmounts(TAXE_FONCIERE);
const tfDisplay = extractAmounts(TAXE_FONCIERE);
const tfJoined = tfDisplay.join(" | ");

assert.ok(
  tfLabeled.some(
    (a) =>
      a.value.includes("1 178") &&
      /prélever|payer|Taxe foncière/i.test(a.label),
  ),
  "1 178 € labelisé comme dû / à prélever",
);
assert.ok(
  !tfLabeled.some((a) => /234\s*079\s*050|234079050/.test(a.value)),
  "234 079 050 € exclu de l’extraction labelisée",
);
assert.ok(tfJoined.includes("1 178"), `display doit contenir 1 178: ${tfJoined}`);
assert.ok(
  !/234\s*079\s*050|234079050/.test(tfJoined),
  `display ne doit pas contenir 234 079 050: ${tfJoined}`,
);

const scrubbed = scrubAbsurdAmountsInText(
  "Le prélèvement est de 1 178,00 €. Un total national de 234 079 050 € est cité.",
);
assert.ok(scrubbed.includes("1 178"), scrubbed);
assert.ok(!/234\s*079\s*050/.test(scrubbed), scrubbed);

// Scrub contexte bruit même sous 1 M€ (ex. valeur locative / stats)
const scrubNoise = scrubAbsurdAmountsInText(
  "Montant à prélever : 1 186 €. La valeur locative cadastrale moyenne est de 85 000 € pour l'ensemble des foyers.",
);
assert.ok(scrubNoise.includes("1 186"), scrubNoise);
assert.ok(
  !/85\s*000/.test(scrubNoise),
  `85 000 € bruit doit disparaître: ${scrubNoise}`,
);

// Gros montant sans « à payer » dans le prose → retiré
const scrubLarge = scrubAbsurdAmountsInText(
  "Le capital social mentionné hors contexte est de 75 000 €. La taxe due est de 1 200 € à payer.",
);
assert.ok(scrubLarge.includes("1 200"), scrubLarge);
assert.ok(
  !/75\s*000/.test(scrubLarge),
  `75 000 € sans ancrage dû doit disparaître: ${scrubLarge}`,
);

// Filtre display sur liste LLM brute (fallback enrich)
const llmNoise = filterAmountsForDisplay([
  "1 050 € — Loyer mensuel",
  "50 000 € — Capital social (agence) (contexte professionnel)",
  "120 000 € — Garantie financière de l’agence (contexte professionnel)",
  "234 079 050 €",
  "1 178 € — Montant à prélever",
]);
assert.ok(llmNoise.some((l) => /1 050/.test(l)), llmNoise.join(" | "));
assert.ok(llmNoise.some((l) => /1 178/.test(l)), llmNoise.join(" | "));
assert.ok(
  !llmNoise.some((l) => /50\s*000|120\s*000|234\s*079\s*050/.test(l)),
  llmNoise.join(" | "),
);

// #1ter — résumé / extrait sans bruit pro ou national
const bailSummary = scrubDisplayProse(
  "Le bail prévoit un loyer mensuel hors charges de 1 050 € et un dépôt de garantie de 2 100 €. Le contrat mentionne également le capital social de l'agence (50 000 €) et sa garantie financière (120 000 €).",
);
assert.match(bailSummary, /1\s*050/);
assert.match(bailSummary, /2\s*100/);
assert.ok(
  !/50\s*000|120\s*000|capital\s+social|garantie\s+financi/i.test(bailSummary),
  bailSummary,
);

const taxeExcerpt = scrubDisplayProse(
  "Avis de prélèvement — Taxe foncière 2024 Montant à prélever : 1 178,00 € Date de prélèvement : 27/10/2025 le produit national de la taxe s'élève à 234 079 050 €",
);
assert.match(taxeExcerpt, /1\s*178/);
assert.ok(
  !/234\s*079\s*050|produit\s+national/i.test(taxeExcerpt),
  taxeExcerpt,
);

// Mutuelle : cotisation principale vs frais de gestion (pas 2× « Cotisation »)
const MUTUELLE = `
# Mutuelle Santé Équilibre (document fictif)
**Cotisation mensuelle :** 115,12 €
**Frais cachés** : contribution aux frais de gestion de **3,03 €** / mois hors cotisation affichée.
`;
const mutLabeled = extractLabeledAmounts(MUTUELLE);
const mutCot = mutLabeled.find((a) => a.label === "Cotisation");
const mutFrais = mutLabeled.find((a) => a.label === "Frais de gestion");
assert.ok(mutCot && /115[,.]12/.test(mutCot.value), `cotisation: ${mutCot?.value}`);
assert.equal(mutCot!.importance, "primary");
assert.ok(
  mutFrais && /3[,.]03/.test(mutFrais.value),
  `frais gestion: ${mutFrais?.value}`,
);
assert.equal(mutFrais!.importance, "secondary");
assert.ok(
  !mutLabeled.some(
    (a) => a.label === "Cotisation" && /3[,.]03/.test(a.value),
  ),
  "3,03 € ne doit pas être labellisé Cotisation",
);

console.log("OK labeled amounts");
console.log(display.join("\n"));
console.log("--- taxe foncière ---");
console.log(tfDisplay.join("\n"));
