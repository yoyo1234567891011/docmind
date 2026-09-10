import { mergeUniqueStrings } from "@/lib/array";

const PERSON_LABELS = [
  "assure",
  "assuree",
  "titulaire",
  "salarie",
  "salariee",
  "locataire",
  "bailleur",
  "allocataire",
  "client",
  "cliente",
  "destinataire",
  "contribuable",
  "emprunteur",
  "emprunteuse",
  "adherent",
  "adherente",
  "abonne",
  "abonnee",
  "souscripteur",
  "souscriptrice",
];

const ORG_LABELS = [
  "assureur",
  "assureur fictif",
  "etablissement",
  "etablissement fictif",
  "employeur",
  "emetteur",
  "preteur",
  "organisme",
  "fournisseur",
  "creancier",
  "operateur",
  "operateur fictif",
];

const HEADER_ORG_RE =
  /(?:^|\n)\s*(?:\*\*)?(?:direction\s+g[ée]n[ée]rale\s+des\s+finances\s+publiques|dgfip|finances\s+publiques|caisse\s+d['']allocations\s+familiales|service\s+recouvrement|banque\s+[A-ZÀ-Ü][\w'’-]{2,}(?:\s+[A-ZÀ-Ü][\w'’-]+){0,2}|cr[ée]dit\s+[A-ZÀ-Ü][\w'’-]{2,}(?:\s+[A-ZÀ-Ü][\w'’-]+){0,2})(?:\*\*)?/gim;

/** Marques / organismes fréquents (émetteur du document, pas le titulaire). */
const KNOWN_EMITTER_BRANDS: Array<[RegExp, string]> = [
  [/\bfree\b/i, "Free"],
  [/\borange\b/i, "Orange"],
  [/\bsfr\b/i, "SFR"],
  [/\bbouygues(?:\s+telecom)?\b/i, "Bouygues Telecom"],
  [/\bedf\b/i, "EDF"],
  [/\bengie\b/i, "Engie"],
  [/\bmaif\b/i, "MAIF"],
  [/\bmacif\b/i, "MACIF"],
  [/\baxa\b/i, "AXA"],
  [/\ballianz\b/i, "Allianz"],
  [/\bgmf\b/i, "GMF"],
  [/\bmaaf\b/i, "MAAF"],
  [/\bcaf\b/i, "CAF"],
  [/\burssaf\b/i, "URSSAF"],
];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/\(.*?ficti[fv]e?.*?\)/gi, "")
    .replace(/\bsoci[eé]t[eé] fictive\b/gi, "")
    .replace(/\bdocument fictif\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:\-–—]\s*/, "")
    .replace(/[.;,]+$/, "");
}

/** Prénom + nom (titulaire / abonné) — pas un destinataire de courrier sortant. */
export function looksLikePersonName(value: string): boolean {
  const v = cleanValue(value);
  if (v.length < 3 || v.length > 60) return false;
  if (/\d/.test(v)) return false;
  if (/[@/\\]|https?:/i.test(v)) return false;
  const parts = v.split(/\s+/).filter(Boolean);
  // Prénom + Nom (+ particule éventuelle)
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every(
    (p) =>
      /^(?:d'|de|du|des|la|le)$/i.test(p) ||
      /^[A-ZÀ-Ü][a-zà-ü'’-]+$/.test(p) ||
      /^[A-ZÀ-Ü]{2,}$/.test(p),
  );
}

const ORG_TOKEN_RE =
  /\b(sas|sarl|sa|eurl|sci|assurances?|banque|mutuelle|caisse|direction|service|cr[ée]dit|etablissement|établissement|organisme|soci[eé]t[eé]|agence|tribunal|free|orange|sfr|edf|engie)\b/i;

/**
 * Titulaire / abonné / allocataire — à exclure du destinataire courrier.
 * Ne confond pas « Banque Horizon » avec un prénom+nom.
 */
export function isSubscriberPersonName(value: string): boolean {
  const v = cleanValue(value);
  if (!v || ORG_TOKEN_RE.test(v)) return false;
  if (extractKnownEmitterBrands(v).length > 0) return false;
  return looksLikePersonName(v);
}

/** Marques connues présentes dans le texte (émetteur). */
export function extractKnownEmitterBrands(text: string): string[] {
  const haystack = (text ?? "").slice(0, 4000);
  const out: string[] = [];
  for (const [re, label] of KNOWN_EMITTER_BRANDS) {
    if (re.test(haystack)) out.push(label);
  }
  return mergeUniqueStrings(out);
}

/**
 * Libellé destinataire courrier : marque (+ service clients si mentionné).
 */
export function formatEmitterRecipient(
  brand: string,
  documentText = "",
): string {
  const b = cleanValue(brand);
  if (!b) return "";
  if (
    /^free$/i.test(b) &&
    /service\s+(?:clients?|facturation|client[eè]le)/i.test(documentText)
  ) {
    return "Free – Service clients";
  }
  return b;
}

function looksLikeOrganization(value: string): boolean {
  const v = cleanValue(value);
  if (v.length < 3 || v.length > 90) return false;
  if (/^\d+$/.test(v)) return false;
  // Ignore bare legal-form tokens / contract ids
  if (/^(sas|sarl|sa|eurl|sci|ass)$/i.test(v)) return false;
  if (/^[A-Z]{2,5}-\d+$/i.test(v)) return false;
  if (looksLikePersonName(v) && !ORG_TOKEN_RE.test(v)) {
    return false;
  }
  return true;
}

function extractLabeledValues(text: string, labels: string[]): string[] {
  const labelSet = new Set(labels.map(normalizeKey));
  const out: string[] = [];
  const re =
    /(?:^|\n)\s*(?:\*\*)?\s*([^*\n:]{2,60}?)\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*([^\n*]{2,90})/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const label = normalizeKey(m[1] || "");
    if (!labelSet.has(label)) continue;
    const value = cleanValue(m[2] || "");
    if (value) out.push(value);
  }
  return out;
}

/**
 * Extraction déterministe des personnes (labels FR courants).
 */
export function extractPeople(text: string): string[] {
  const fromLabels = extractLabeledValues(text, PERSON_LABELS).filter(
    looksLikePersonName,
  );
  return mergeUniqueStrings(fromLabels).slice(0, 8);
}

function extractOrgFromTitle(text: string): string[] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().startsWith("#"));
  if (!firstLine) return [];
  let title = firstLine.replace(/^#+\s*/, "");
  title = title
    .replace(/\s*[—–-]\s*/g, " — ")
    .replace(/\(.*?ficti[fv]e?.*?\)/gi, "")
    .replace(/\bdocument fictif\b/gi, "")
    .trim();

  // "Facture … — Fournisseur ÉnergieClaire" / "Mise en demeure — Service recouvrement"
  const afterDash = title.split("—")[1]?.trim();
  if (afterDash) {
    const brandAfterDash = extractKnownEmitterBrands(afterDash)[0];
    if (brandAfterDash) {
      return [formatEmitterRecipient(brandAfterDash, text)];
    }
    const cleaned = cleanValue(afterDash.replace(/^(fournisseur)\s+/i, ""));
    if (
      looksLikeOrganization(cleaned) &&
      !/\b[A-Z]{2,5}-\d{4,}\b/.test(cleaned) &&
      cleaned.length >= 5
    ) {
      return [cleaned];
    }
  }

  // "Facture Free" / "Abonnement Orange" / marque dans le titre
  const brandInTitle = extractKnownEmitterBrands(title)[0];
  if (brandInTitle) {
    return [formatEmitterRecipient(brandInTitle, text)];
  }

  // Ignore titres de type document + id sans org claire
  if (
    /^(contrat|facture|devis|notification|avis|releve|relevé|abonnement)\b/i.test(
      title,
    ) ||
    /\b[A-Z]{2,5}-\d{4,}\b/.test(title)
  ) {
    return [];
  }

  // "Mutuelle Santé Équilibre" / "Direction générale des Finances publiques"
  const cleanedTitle = cleanValue(title);
  if (
    /\b(mutuelle|banque|assurances?|caisse|direction|service)\b/i.test(
      cleanedTitle,
    ) &&
    looksLikeOrganization(cleanedTitle)
  ) {
    return [cleanedTitle];
  }
  return [];
}

/**
 * Extraction déterministe des organisations (labels + titre + en-tête + marques).
 */
export function extractOrganizations(text: string): string[] {
  const fromLabels = extractLabeledValues(text, ORG_LABELS)
    .map(cleanValue)
    .filter((v) => v.length >= 3 && !/^\d+$/.test(v) && !/^(sas|sarl|sa)$/i.test(v));
  const fromHeader: string[] = [];
  let m: RegExpExecArray | null;
  const headerRe = new RegExp(HEADER_ORG_RE.source, HEADER_ORG_RE.flags);
  while ((m = headerRe.exec(text.slice(0, 2500))) !== null) {
    const value = cleanValue(m[0] || "");
    if (looksLikeOrganization(value)) fromHeader.push(value);
  }
  const fromTitle =
    fromLabels.length === 0 && fromHeader.length === 0
      ? extractOrgFromTitle(text)
      : [];
  const fromBrands = extractKnownEmitterBrands(text).map((b) =>
    formatEmitterRecipient(b, text),
  );
  return mergeUniqueStrings([
    ...fromLabels,
    ...fromHeader,
    ...fromTitle,
    ...fromBrands,
  ]).slice(0, 8);
}
