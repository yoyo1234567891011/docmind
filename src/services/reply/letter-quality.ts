import type { WatchDocFamily } from "@/ai/post-processing/watch-ranking";
import type {
  DocumentAnalysis,
  DocumentSheet,
  LetterType,
} from "@/types";

import {
  filterDeadlinesForLetter,
  isRecipientObligation,
} from "./letter-intents";

export const MIN_LETTER_WORDS = 80;
export const MIN_LETTER_CHARS = 350;

const NOISE_FACT_RE =
  /traiter\s+(?:les\s+)?r[ée]clamations|r[ée]clamation\s+sous\s+\d+|pdf\/a|mentions?\s+l[ée]gales|d[ée]finitions?\b|clause\s+g[ée]n[ée]rale|www\.|https?:\/\/|journal\s+technique|signaler\s+(?:tout\s+)?changement|changement\s+d['']adresse|mettre\s+[àa]\s+jour\s+vos\s+coordonn|obligation\s+du\s+(?:client|titulaire)|vous\s+devez\s+(?:nous\s+)?informer|service\s+client\s+au|conservez\s+ce\s+document/i;

const STREET_RE =
  /\d{1,4}\s+(?:rue|avenue|av\.|bd|boulevard|place|all[ée]e|impasse|chemin)\s+[^,\n]{3,60}/i;

const POSTAL_RE = /\b\d{5}\s+[A-Za-zÀ-ÿ\-'\s]{2,40}\b/;

export interface LetterFact {
  /** Libellé affiché dans « Infos extraites utilisées » */
  label: string;
  /** Valeur recherchable dans le corps */
  needle: string;
}

/** Bruit mémoire / boilerplate — exclu du corps et des preuves. */
export function isLetterNoiseFact(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (isRecipientObligation(t)) return true;
  return NOISE_FACT_RE.test(t);
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

/** Montants / frais repérés dans le texte source (complète l’analyse). */
export function extractAmountsFromText(text: string): string[] {
  const found: string[] = [];
  const feeLineRe =
    /(?:(?:commission|frais|tenue|d[ée]couvert|int[ée]r[êe]ts?|rejet|mouvement|agios|p[ée]nalit[ée])s?[^.\n]{0,55}(\d+[,.]\d{2}\s*€|\d+\s*€))/gi;
  let match: RegExpExecArray | null;
  while ((match = feeLineRe.exec(text)) !== null) {
    const line = match[0].replace(/\s+/g, " ").trim();
    if (!isLetterNoiseFact(line)) found.push(line);
  }

  const amountRe = /\d+[,.]\d{2}\s*€/g;
  while ((match = amountRe.exec(text)) !== null) {
    const amount = match[0];
    const start = Math.max(0, match.index - 40);
    const context = text.slice(start, match.index + amount.length);
    if (!isLetterNoiseFact(context)) {
      found.push(context.replace(/\s+/g, " ").trim());
    }
  }

  return uniqueStrings(found);
}

function filterAmounts(amounts: string[]): string[] {
  return uniqueStrings(
    amounts.filter((a) => /\d/.test(a) && !isLetterNoiseFact(a)),
  );
}

/**
 * Faits autorisés pour la rédaction — source unique pour prompt + preuves UI.
 */
export function collectAllowedLetterFacts(input: {
  documentText: string;
  analysis: DocumentAnalysis;
  sheet?: DocumentSheet | null;
  letterType: LetterType;
  family: WatchDocFamily;
}): LetterFact[] {
  const { documentText, analysis, sheet, letterType, family } = input;
  const facts: LetterFact[] = [];

  const orgs = uniqueStrings([
    ...(sheet?.organizations ?? []),
    ...analysis.organizations,
  ]);
  for (const org of orgs.slice(0, 2)) {
    if (!isLetterNoiseFact(org)) {
      facts.push({ label: `Organisme : ${org}`, needle: org });
    }
  }

  const people = uniqueStrings([
    ...(sheet?.people ?? []),
    ...analysis.people,
  ]);
  for (const person of people.slice(0, 2)) {
    if (!isLetterNoiseFact(person)) {
      facts.push({ label: `Titulaire : ${person}`, needle: person });
    }
  }

  if (analysis.date && !isLetterNoiseFact(analysis.date)) {
    facts.push({ label: `Date : ${analysis.date}`, needle: analysis.date });
  }

  const amounts = filterAmounts([
    ...(sheet?.amounts ?? []),
    ...analysis.amounts,
    ...extractAmountsFromText(documentText),
  ]);

  const maxAmounts =
    letterType === "contestation" && family === "banque"
      ? Math.max(amounts.length, 8)
      : 6;

  for (const amount of amounts.slice(0, maxAmounts)) {
    facts.push({ label: `Montant : ${amount}`, needle: amount });
  }

  const deadlines = filterDeadlinesForLetter(
    sheet?.deadlines?.length ? sheet.deadlines : analysis.deadlines,
  );
  for (const deadline of deadlines.slice(0, 2)) {
    facts.push({ label: `Échéance : ${deadline}`, needle: deadline });
  }

  const refs = uniqueStrings([
    analysis.title,
    analysis.document_type,
    ...(analysis.important_points ?? []).slice(0, 2),
  ]).filter((r) => r && !isLetterNoiseFact(r) && !/^relev[ée]/i.test(r));

  for (const ref of refs.slice(0, 2)) {
    facts.push({ label: `Référence : ${ref}`, needle: ref });
  }

  if (
    letterType === "contestation" &&
    family === "recouvrement" &&
    analysis.amounts[0]
  ) {
    const claimed = analysis.amounts[0];
    if (!facts.some((f) => f.needle.includes(claimed))) {
      facts.push({
        label: `Montant réclamé : ${claimed}`,
        needle: claimed,
      });
    }
  }

  return facts.slice(0, 12);
}

/** Corps complet : longueur, structure, pas de phrase coupée. */
export function validateLetterBody(body: string): {
  valid: boolean;
  reason?: string;
} {
  const text = body.trim();
  if (!text) return { valid: false, reason: "corps vide" };

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_LETTER_WORDS && text.length < MIN_LETTER_CHARS) {
    return {
      valid: false,
      reason: `corps trop court (${words.length} mots)`,
    };
  }

  if (!/Madame|Monsieur/i.test(text)) {
    return { valid: false, reason: "formule d’appel manquante" };
  }

  if (
    !/salutations distingu[ée]es|Veuillez agr[ée]er|Cordialement/i.test(text)
  ) {
    return { valid: false, reason: "formule de politesse manquante" };
  }

  const tail = text.slice(-40).trim();
  if (/\bJe\s*$/i.test(tail) || /\bJe[,.\s]*$/i.test(text.trim())) {
    return { valid: false, reason: "phrase tronquée (fin en « Je »)" };
  }

  if (/[,;:]\s*$/.test(text) && words.length < MIN_LETTER_WORDS + 20) {
    return { valid: false, reason: "phrase inachevée en fin de courrier" };
  }

  return { valid: true };
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/€/g, "€")
    .trim();
}

/** Preuves affichées : uniquement les faits autorisés réellement présents dans le corps. */
export function deriveFactsUsedInLetter(
  body: string,
  allowedFacts: LetterFact[],
): string[] {
  const corpus = normalizeForMatch(body);
  const matched: string[] = [];

  for (const fact of allowedFacts) {
    const needle = normalizeForMatch(fact.needle);
    if (needle.length < 3) continue;
    if (corpus.includes(needle) || corpus.includes(needle.replace(/\s/g, ""))) {
      matched.push(fact.label);
      continue;
    }
    const amountMatch = needle.match(/\d+[,.]\d{2}/);
    if (amountMatch && corpus.includes(amountMatch[0])) {
      matched.push(fact.label);
    }
  }

  return uniqueStrings(matched).slice(0, 8);
}

/** Supprime adresse inventée si absente du document / analyse. */
export function sanitizeRecipient(
  raw: string,
  organizations: string[],
  documentText: string,
  analysisCorpus: string,
): string {
  const source = `${documentText}\n${analysisCorpus}`.toLowerCase();
  let recipient = raw.trim();

  if (!recipient) {
    return organizations[0] ?? "";
  }

  const street = recipient.match(STREET_RE)?.[0];
  if (street && !source.includes(street.toLowerCase().slice(0, 12))) {
    recipient = organizations[0] ?? recipient.replace(STREET_RE, "").trim();
  }

  const postal = recipient.match(POSTAL_RE)?.[0];
  if (postal && !source.includes(postal.toLowerCase().slice(0, 5))) {
    recipient = organizations[0] ?? "";
  }

  if (recipient.length > 80 && organizations[0]) {
    return organizations[0];
  }

  return recipient;
}

/** Retire adresses inventées du corps si le modèle les a ajoutées. */
export function stripInventedAddressesFromBody(
  body: string,
  documentText: string,
  analysisCorpus: string,
): string {
  const source = `${documentText}\n${analysisCorpus}`.toLowerCase();
  let out = body;

  const streetMatches = body.match(new RegExp(STREET_RE.source, "gi")) ?? [];
  for (const street of streetMatches) {
    if (!source.includes(street.toLowerCase().slice(0, 12))) {
      out = out.replace(street, "[Adresse de l’établissement]");
    }
  }

  return out;
}

export function formatFactsForPrompt(facts: LetterFact[]): string[] {
  return facts.map((f) => f.label);
}
