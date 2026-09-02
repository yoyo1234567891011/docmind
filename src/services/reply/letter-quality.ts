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
export const MAX_BANK_FEE_LINES = 8;

const FICTITIOUS_AMOUNT_RE =
  /\bfictif(?:s|ve|ves)?\b|illustr(?:ent|ation|atif)?|exemple[\s-]fictif|montants?\s+de\s+r[ée]f[ée]rence\s+compl[ée]mentaires/i;

const NOISE_FACT_RE =
  /traiter\s+(?:les\s+)?r[ée]clamations|r[ée]clamation\s+sous\s+\d+|pdf\/a|mentions?\s+l[ée]gales|d[ée]finitions?\b|clause\s+g[ée]n[ée]rale|www\.|https?:\/\/|journal\s+technique|signaler\s+(?:sans\s+d[eé]lai\s+)?(?:tout\s+)?changement|sans\s+d[eé]lai\s+tout\s+changement|changement\s+d['']adresse|mettre\s+[àa]\s+jour\s+vos\s+coordonn|obligation\s+du\s+(?:client|titulaire)|vous\s+devez\s+(?:nous\s+)?informer|service\s+client\s+au|conservez\s+ce\s+document|situation\s*•/i;

/** Lignes relevé bancaire à ne jamais traiter comme frais contestables. */
const BANK_NON_FEE_RE =
  /d[ée]couvert\s+autoris[ée]|plafond\s+(?:de\s+)?d[ée]couvert|solde\s+arr[eê]t[eé]|solde\s+(?:au|du|cr[ée]diteur|d[ée]biteur)|situation\s*•|^\s*[a-z]\s+\d{2}\/\d{2}\/\d{4}/i;

const BANK_GENERIC_MOVEMENT_RE =
  /^(?:salaire|loyer|virement|pr[eé]l[eè]vement\s+sepa|remise\s+ch[eè]que|retrait\s+dab)\b/i;

const BANK_FEE_KEYWORD_RE =
  /(?:commission|frais|tenue\s+de\s+compte|agios|int[ée]r[êe]ts?\s+d[ée]biteurs?|rejet|intervention|mouvement|p[ée]nalit[ée])/i;

const STREET_RE =
  /\d{1,4}\s+(?:rue|avenue|av\.|bd|boulevard|place|all[ée]e|impasse|chemin)\s+[^,\n]{3,60}/i;

const POSTAL_RE = /\b\d{5}\s+[A-Za-zÀ-ÿ\-'\s]{2,40}\b/;

const FRAGMENT_LINE_RE =
  /^[a-zàâçéèêëîïôùûü]\s+\d{2}\/\d{2}\/\d{4}|situation\s*•|^\W{0,3}\d{2}\/\d{2}\/\d{4}\s+situation/i;

export interface LetterFact {
  label: string;
  needle: string;
}

/** Bruit mémoire / boilerplate — exclu du corps et des preuves. */
export function isLetterNoiseFact(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (isRecipientObligation(t)) return true;
  if (FICTITIOUS_AMOUNT_RE.test(t)) return true;
  if (FRAGMENT_LINE_RE.test(t)) return true;
  return NOISE_FACT_RE.test(t);
}

/** Ligne relevé qui n'est pas un frais/commission débité contestable. */
export function isBankNonFeeLine(text: string): boolean {
  const t = cleanRawLine(text);
  if (!t) return true;
  if (isLetterNoiseFact(t)) return true;
  if (BANK_NON_FEE_RE.test(t)) return true;
  if (BANK_GENERIC_MOVEMENT_RE.test(t)) return true;
  if (/d[ée]couvert\s+autoris/i.test(t)) return true;
  return false;
}

function cleanRawLine(raw: string): string {
  return raw
    .replace(/\|/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAmountKey(amount: string): string {
  return amount.replace(",", ".").replace(/\s/g, "");
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

/**
 * Transforme une ligne brute en libellé de frais propre, ou null si invalide.
 * Ex. « Frais de découvert | -26,23 € » → « Frais de découvert : 26,23 € »
 */
export function normalizeBankFeeLine(raw: string): string | null {
  const t = cleanRawLine(raw);
  if (!t || t.length < 6 || t.length > 140) return null;
  if (FRAGMENT_LINE_RE.test(t)) return null;
  if (isBankNonFeeLine(t)) return null;

  const rateOnly = t.match(
    /^(.*int[ée]r[êe]ts?\s+d[ée]biteurs?[^0-9]{0,20})(\d+[,.]?\d*\s*%)\s*$/i,
  );
  if (rateOnly && BANK_FEE_KEYWORD_RE.test(rateOnly[1])) {
    return `${rateOnly[1].trim()} : ${rateOnly[2].trim()}`;
  }

  const amountMatch = t.match(/[-−]?\s*(\d+(?:[,.]\d{2})?)\s*€/);
  if (!amountMatch) return null;

  const amount = amountMatch[1].replace(".", ",");
  let label = t
    .replace(/[-−]?\s*\d+[,.]\d{2}\s*€.*$/, "")
    .replace(/^montant\s*:\s*/i, "")
    .replace(/[-−]\s*$/, "")
    .trim();

  if (!label || isBankNonFeeLine(label)) return null;

  const debited =
    /[-−]\s*\d+[,.]\d{2}\s*€/.test(t) || BANK_FEE_KEYWORD_RE.test(label);
  if (!debited) return null;

  label = label
    .replace(/\s*:\s*$/, "")
    .replace(/\s*-\s*$/, "")
    .trim();

  return `${label} : ${amount} €`;
}

function dedupeBankFeeLines(lines: string[]): string[] {
  const byAmount = new Map<string, string>();

  for (const raw of lines) {
    const cleaned = normalizeBankFeeLine(raw);
    if (!cleaned) continue;

    const amountKey =
      cleaned.match(/(\d+[,.]\d{2})\s*€/)?.[1] ?? cleaned.toLowerCase();
    const key = normalizeAmountKey(amountKey);
    const existing = byAmount.get(key);

    if (!existing || cleaned.length > existing.length) {
      byAmount.set(key, cleaned);
    }
  }

  return [...byAmount.values()].slice(0, MAX_BANK_FEE_LINES);
}

/** Extrait les frais/commissions débités d'un relevé bancaire. */
export function extractBankFeeLines(
  documentText: string,
  analysis: DocumentAnalysis,
  sheet?: DocumentSheet | null,
): string[] {
  const candidates: string[] = [];

  const feeLineRe =
    /(?:^|\n)[^\n]{0,120}(?:commission|frais|tenue|agios|int[ée]r[êe]ts?\s+d[ée]biteurs?|rejet|intervention|mouvement|p[ée]nalit[ée])[^\n]{0,80}(?:\d+(?:[,.]\d{2})?\s*€|\d+[,.]?\d*\s*%)/gim;

  const feeBulletRe =
    /(?:^|\n)\s*[-•*]\s*\*\*[^*\n]+\*\*[^\n]{0,80}(?:\d+(?:[,.]\d{2})?\s*€|\d+[,.]?\d*\s*%)/gim;

  let match: RegExpExecArray | null;
  while ((match = feeLineRe.exec(documentText)) !== null) {
    const line = cleanRawLine(match[0]);
    if (!FICTITIOUS_AMOUNT_RE.test(line)) {
      candidates.push(line);
    }
  }
  while ((match = feeBulletRe.exec(documentText)) !== null) {
    const line = cleanRawLine(match[0]);
    if (!FICTITIOUS_AMOUNT_RE.test(line)) {
      candidates.push(line);
    }
  }

  for (const amount of [
    ...(sheet?.amounts ?? []),
    ...analysis.amounts,
    ...(analysis.important_points ?? []),
    ...(analysis.risks ?? []),
  ]) {
    const line = cleanRawLine(amount);
    if (!FICTITIOUS_AMOUNT_RE.test(line)) {
      candidates.push(line);
    }
  }

  return dedupeBankFeeLines(candidates);
}

function filterGenericAmounts(amounts: string[]): string[] {
  return uniqueStrings(
    amounts
      .map(cleanRawLine)
      .filter((a) => /\d/.test(a) && !isLetterNoiseFact(a) && !FRAGMENT_LINE_RE.test(a)),
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

  if (family === "banque" && letterType === "contestation") {
    const feeLines = extractBankFeeLines(documentText, analysis, sheet);
    for (const fee of feeLines) {
      facts.push({ label: `Frais : ${fee}`, needle: fee });
    }
  } else {
    const amounts = filterGenericAmounts([
      ...(sheet?.amounts ?? []),
      ...analysis.amounts,
    ]);
    for (const amount of amounts.slice(0, 6)) {
      facts.push({ label: `Montant : ${amount}`, needle: amount });
    }
  }

  const skipDeadlines =
    family === "banque" &&
    (letterType === "contestation" || letterType === "autre");

  if (!skipDeadlines) {
    const deadlines = filterDeadlinesForLetter(
      sheet?.deadlines?.length ? sheet.deadlines : analysis.deadlines,
    );
    for (const deadline of deadlines.slice(0, 2)) {
      if (!isLetterNoiseFact(deadline)) {
        facts.push({ label: `Échéance : ${deadline}`, needle: deadline });
      }
    }
  }

  const refs = uniqueStrings([
    analysis.document_type,
    ...(analysis.important_points ?? []).slice(0, 2),
  ]).filter(
    (r) =>
      r &&
      !isLetterNoiseFact(r) &&
      !/^relev[ée]/i.test(r) &&
      !isBankNonFeeLine(r),
  );

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

  if (/je\s+prends\s+note\s+de\s+l['']?[ée]ch[ée]ance/i.test(text)) {
    if (/changement\s+d['']adresse|signaler\s+sans\s+d[eé]lai/i.test(text)) {
      return { valid: false, reason: "échéance obligation client dans le corps" };
    }
  }

  return { valid: true };
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
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
    if (isLetterNoiseFact(fact.label) || isBankNonFeeLine(fact.needle)) continue;

    const needle = normalizeForMatch(fact.needle);
    if (needle.length < 3) continue;
    if (corpus.includes(needle)) {
      matched.push(fact.label);
      continue;
    }
    const amountMatch = needle.match(/\d+[,.]\d{2}/);
    if (amountMatch && corpus.includes(amountMatch[0])) {
      const labelPart = needle.replace(amountMatch[0], "").trim();
      if (labelPart.length < 4 || corpus.includes(labelPart.slice(0, 12))) {
        matched.push(fact.label);
      }
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

/** Retire adresses inventées et phrases d'échéance client du corps. */
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

  out = out
    .split("\n")
    .filter(
      (line) =>
        !/je\s+prends\s+note\s+de\s+l['']?[ée]ch[ée]ance/i.test(line) ||
        !/changement\s+d['']adresse|signaler\s+sans\s+d[eé]lai/i.test(line),
    )
    .join("\n");

  return out;
}

export function formatFactsForPrompt(facts: LetterFact[]): string[] {
  return facts.map((f) => f.label);
}

/** Lignes prêtes pour liste à puces dans le courrier (frais banque). */
export function formatBankFeeBulletLines(
  documentText: string,
  analysis: DocumentAnalysis,
  sheet?: DocumentSheet | null,
): string[] {
  return extractBankFeeLines(documentText, analysis, sheet).map(
    (fee) => `- ${fee}`,
  );
}
