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

function looksLikePersonName(value: string): boolean {
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

function looksLikeOrganization(value: string): boolean {
  const v = cleanValue(value);
  if (v.length < 3 || v.length > 90) return false;
  if (/^\d+$/.test(v)) return false;
  // Ignore bare legal-form tokens / contract ids
  if (/^(sas|sarl|sa|eurl|sci|ass)$/i.test(v)) return false;
  if (/^[A-Z]{2,5}-\d+$/i.test(v)) return false;
  if (looksLikePersonName(v) && !/\b(sas|sarl|sa|assurances?|banque|mutuelle|caisse|direction)\b/i.test(v)) {
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
    const cleaned = cleanValue(afterDash.replace(/^(fournisseur)\s+/i, ""));
    if (
      looksLikeOrganization(cleaned) &&
      !/\b[A-Z]{2,5}-\d{4,}\b/.test(cleaned) &&
      cleaned.length >= 5
    ) {
      return [cleaned];
    }
  }

  // Ignore titres de type document + id sans org claire
  if (
    /^(contrat|facture|devis|notification|avis|releve|relevé)\b/i.test(title) ||
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
 * Extraction déterministe des organisations (labels + titre).
 */
export function extractOrganizations(text: string): string[] {
  const fromLabels = extractLabeledValues(text, ORG_LABELS)
    .map(cleanValue)
    .filter((v) => v.length >= 3 && !/^\d+$/.test(v) && !/^(sas|sarl|sa)$/i.test(v));
  const fromTitle = fromLabels.length === 0 ? extractOrgFromTitle(text) : [];
  return mergeUniqueStrings([...fromLabels, ...fromTitle]).slice(0, 8);
}
