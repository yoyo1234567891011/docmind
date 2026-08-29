import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type RiskLevel,
  type SmartSearchIntent,
} from "@/types";
import { normalizeText } from "@/services/search/parse-values";

function currentYear(): number {
  return new Date().getFullYear();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const STOP = new Set([
  "retrouve",
  "montre",
  "trouve",
  "cherche",
  "documents",
  "document",
  "mon",
  "ma",
  "mes",
  "les",
  "des",
  "une",
  "un",
  "ou",
  "où",
  "je",
  "paie",
  "plus",
  "de",
  "que",
  "qui",
  "quels",
  "quelles",
  "quelle",
  "quel",
  "cette",
  "cet",
  "ces",
  "annee",
  "année",
  "euros",
  "euro",
  "toutes",
  "tous",
  "tout",
  "toute",
  "contiennent",
  "contient",
  "avec",
  "dans",
  "pour",
  "sur",
  "par",
  "est",
  "sont",
  "ont",
  "avoir",
  "être",
  "etre",
  "fais",
  "fait",
  "donne",
  "liste",
  "lister",
  "affiche",
  "afficher",
]);

/**
 * Deterministic French NL → intent fallback (no LLM required).
 * Couvre les exemples produit : échéances, EDF, montants, clauses.
 */
export function parseIntentHeuristic(query: string): SmartSearchIntent {
  const raw = query.trim();
  const lower = raw.toLowerCase();
  const keywords: string[] = [];
  const organizations: string[] = [];
  const documentTypes: string[] = [];
  const categories: DocumentCategory[] = [];
  let interpretedAs = "Recherche textuelle dans vos fiches documentaires";
  let amount: SmartSearchIntent["amount"] = null;
  let date: SmartSearchIntent["date"] = null;
  let riskLevels: RiskLevel[] = [];
  let needsAction: boolean | null = null;

  // Organizations / brands frequently searched
  const orgPatterns: Array<[RegExp, string]> = [
    [/\bedf\b/i, "EDF"],
    [/\borange\b/i, "Orange"],
    [/\bfree\b/i, "Free"],
    [/\bsfr\b/i, "SFR"],
    [/\bcaf\b/i, "CAF"],
    [/\burssaf\b/i, "URSSAF"],
    [/\bengie\b/i, "Engie"],
    [/\bbouygues\b/i, "Bouygues"],
  ];
  for (const [pattern, name] of orgPatterns) {
    if (pattern.test(raw)) organizations.push(name);
  }

  if (/\bcontrats?\b/i.test(raw)) {
    documentTypes.push("contrat");
    keywords.push("contrat");
  }
  if (/\bfactures?\b/i.test(raw)) {
    documentTypes.push("facture");
    keywords.push("facture");
  }
  if (/\babonnements?\b/i.test(raw)) {
    documentTypes.push("abonnement");
    keywords.push("abonnement");
    interpretedAs = "Abonnements dans vos fiches";
  }
  if (/\bbail|location\b/i.test(raw)) {
    documentTypes.push("bail");
    categories.push("bail");
    keywords.push("bail");
  }
  if (/\bassurance|mutuelle\b/i.test(raw)) {
    keywords.push("assurance");
    categories.push("assurance");
  }
  if (/\bbanque|relev[ée]\b/i.test(raw)) {
    categories.push("banque");
    keywords.push("banque");
  }
  if (/\bimp[oô]ts?|fiscal\b/i.test(raw)) {
    categories.push("impots");
    keywords.push("impôt");
  }
  if (/\btravail|cdi|cdd\b/i.test(raw)) {
    categories.push("contrat-de-travail");
    keywords.push("travail");
  }

  // Clause / contenu spécifique
  if (/renouvellement\s+automatique/i.test(raw)) {
    keywords.push("renouvellement automatique", "renouvellement", "tacite");
    interpretedAs =
      "Documents mentionnant une clause de renouvellement automatique";
  } else if (/\bclause\b/i.test(raw)) {
    keywords.push("clause");
  }

  // Risque élevé / critique (ASCII normalisé : \b JS ne marche pas après « é »)
  const normalized = normalizeText(raw);
  if (
    /(?:^|[^a-z0-9])risque\s+(?:eleve|elevee|critique)(?:[^a-z0-9]|$)/.test(
      normalized,
    ) ||
    /(?:^|[^a-z0-9])(?:eleve|critique)\s+(?:risque|niveau)(?:[^a-z0-9]|$)/.test(
      normalized,
    ) ||
    /(?:^|[^a-z0-9])documents?\s+a\s+risque\s+(?:eleve|critique)(?:[^a-z0-9]|$)/.test(
      normalized,
    )
  ) {
    riskLevels = ["eleve", "critique"];
    interpretedAs = "Documents à risque élevé ou critique";
  }

  // Documents nécessitant une action
  if (
    /(?:^|[^a-z0-9])necessitant\s+une\s+action(?:[^a-z0-9]|$)/.test(
      normalized,
    ) ||
    /(?:^|[^a-z0-9])documents?\s+a\s+traiter(?:[^a-z0-9]|$)/.test(
      normalized,
    ) ||
    /(?:^|[^a-z0-9])a\s+traiter(?:[^a-z0-9]|$)/.test(normalized) ||
    /(?:^|[^a-z0-9])relance(?:[^a-z0-9]|$)/.test(normalized) ||
    /(?:^|[^a-z0-9])mise\s+en\s+demeure(?:[^a-z0-9]|$)/.test(normalized)
  ) {
    needsAction = true;
    interpretedAs = "Documents nécessitant une action";
  }

  // Amount: "plus de 50 €", "dépassent 40 €", "> 50 euros"
  const amountGt = lower.match(
    /(?:plus\s+de|sup[eé]rieur(?:e)?\s+[àa]|au[- ]dessus\s+de|au[- ]del[àa]\s+de|d[eé]pass(?:e|ent|é)|>\s*)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?)?/,
  );
  const amountLt = lower.match(
    /(?:moins\s+de|inf[eé]rieur(?:e)?\s+[àa]|au[- ]dessous\s+de|<\s*)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?)?/,
  );
  const amountGte = lower.match(
    /(?:au\s+moins|minimum|≥\s*|>=\s*)\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?)?/,
  );

  if (amountGt) {
    amount = {
      operator: "gt",
      value: Number(amountGt[1].replace(",", ".")),
    };
    interpretedAs = documentTypes.includes("abonnement")
      ? `Abonnements dépassant ${amount.value} €`
      : `Documents avec un montant supérieur à ${amount.value} €`;
  } else if (amountGte) {
    amount = {
      operator: "gte",
      value: Number(amountGte[1].replace(",", ".")),
    };
    interpretedAs = `Documents avec un montant ≥ ${amount.value} €`;
  } else if (amountLt) {
    amount = {
      operator: "lt",
      value: Number(amountLt[1].replace(",", ".")),
    };
    interpretedAs = `Documents avec un montant inférieur à ${amount.value} €`;
  }

  // Expiry this year / next year
  if (
    /expir|échéance|echeance|délai|delai|prennent\s+fin|expire/i.test(raw)
  ) {
    const year = /cette\s+ann[ée]e/i.test(raw)
      ? currentYear()
      : /l['’]ann[ée]e\s+prochaine/i.test(raw)
        ? currentYear() + 1
        : currentYear();
    date = { field: "deadline", year };
    interpretedAs = /\bcontrats?\b/i.test(raw)
      ? `Contrats qui expirent en ${year}`
      : `Documents avec une échéance en ${year}`;
    if (!documentTypes.includes("contrat") && /\bcontrats?\b/i.test(raw)) {
      documentTypes.push("contrat");
    }
  }

  if (organizations.length && documentTypes.length) {
    interpretedAs = `${documentTypes[0][0].toUpperCase()}${documentTypes[0].slice(1)}s ${organizations.join(", ")}`;
    if (documentTypes[0] === "facture") {
      interpretedAs = `Factures ${organizations.join(", ")}`;
    } else if (documentTypes[0] === "contrat") {
      interpretedAs = `Contrats ${organizations.join(", ")}`;
    }
  } else if (organizations.length && !amount && !date) {
    interpretedAs = `Documents liés à ${organizations.join(", ")}`;
  }

  // Generic leftover tokens as keywords (skip stopwords)
  for (const token of raw.split(/[^a-zA-Z0-9àâäéèêëïîôùûüç€]+/i)) {
    const t = token.trim();
    if (t.length < 3) continue;
    if (STOP.has(t.toLowerCase())) continue;
    if (/^\d+([.,]\d+)?$/.test(t)) continue;
    // Skip verbs already used as amount operators
    if (/^d[eé]pass/i.test(t) || /^expir/i.test(t)) continue;
    keywords.push(t);
  }

  const validCategories = categories.filter((category) =>
    (DOCUMENT_CATEGORIES as readonly string[]).includes(category),
  );

  return {
    rawQuery: raw,
    interpretedAs,
    keywords: unique(keywords),
    organizations: unique(organizations),
    people: [],
    documentTypes: unique(documentTypes),
    categories: validCategories,
    amount,
    date,
    riskLevels,
    needsAction,
    limit: 20,
    source: "heuristic",
  };
}
