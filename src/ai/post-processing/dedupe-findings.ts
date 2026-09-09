/**
 * Déduplication déterministe des findings / risques / montants affichés.
 * Critère + similarité titre/extrait (inclusion ou Jaccard).
 */
import type { RiskFinding } from "@/types";

const TOKEN_RE = /[a-z0-9]+/g;

export function normalizeFindingText(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  const norm = normalizeFindingText(text);
  for (const m of norm.matchAll(TOKEN_RE)) {
    const t = m[0]!;
    if (t.length >= 3) out.add(t);
  }
  return out;
}

export function jaccardSimilarity(a: string, b: string): number {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/** Signaux de précision : montant, %, date, label chiffré. */
export function findingPrecisionScore(finding: RiskFinding): number {
  const description =
    typeof finding.description === "string" ? finding.description : "";
  const blob = `${description} ${finding.excerpt ?? ""}`;
  let score = description.length;
  if (/\d/.test(blob)) score += 40;
  if (/€|euro|%\s*$|\/mois/i.test(blob)) score += 30;
  if (/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(blob)) score += 25;
  if (finding.status === "confirmed") score += 15;
  score += Math.round((finding.confidence ?? 0) * 20);
  // Titres trop génériques « Menace de… » perdants vs libellés concrets.
  if (/^menace\s+de\b/i.test(description)) score -= 40;
  if (/^risque\s+de\b/i.test(description) && !/\d/.test(blob)) {
    score -= 20;
  }
  return score;
}

/** True si `candidate` est plus précis que `current`. */
export function isMorePreciseFinding(
  candidate: RiskFinding,
  current: RiskFinding,
): boolean {
  return findingPrecisionScore(candidate) > findingPrecisionScore(current);
}

/**
 * Deux findings sont doublons s’ils partagent le même critère (ou les deux
 * sanctions/délais proches) et titres/extraits très similaires.
 */
export function areFindingsNearDuplicates(
  a: RiskFinding,
  b: RiskFinding,
): boolean {
  const idA = a.criterion_id ?? "";
  const idB = b.criterion_id ?? "";
  if (idA && idB && idA !== idB) {
    // Autoriser fusion sanctions↔sanctions uniquement (même id requis).
    return false;
  }

  const descA = normalizeFindingText(a.description);
  const descB = normalizeFindingText(b.description);
  if (!descA || !descB) return false;
  if (descA === descB) return true;

  if (
    descA.length >= 16 &&
    descB.length >= 16 &&
    (descA.includes(descB) || descB.includes(descA))
  ) {
    return true;
  }

  const jDesc = jaccardSimilarity(a.description, b.description);
  if (jDesc >= 0.55) return true;

  const exA = normalizeFindingText(a.excerpt ?? "");
  const exB = normalizeFindingText(b.excerpt ?? "");
  if (exA.length >= 24 && exB.length >= 24) {
    if (exA === exB || exA.includes(exB) || exB.includes(exA)) return true;
    if (jaccardSimilarity(a.excerpt ?? "", b.excerpt ?? "") >= 0.7) return true;
  }

  // Synonymes fréquents sanctions
  if (
    idA === "sanctions" &&
    idB === "sanctions" &&
    /recouvrement|poursuite|huissier/.test(descA) &&
    /recouvrement|poursuite|huissier/.test(descB)
  ) {
    return jDesc >= 0.35;
  }

  return false;
}

/**
 * Garde le finding le plus précis ; ordre d’entrée = priorité de ranking
 * (premier = mieux classé) en cas d’égalité de précision.
 */
export function dedupeRiskFindings(findings: RiskFinding[]): RiskFinding[] {
  const out: RiskFinding[] = [];
  for (const candidate of findings) {
    let dupIdx = -1;
    for (let i = 0; i < out.length; i += 1) {
      if (areFindingsNearDuplicates(out[i]!, candidate)) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) {
      out.push(candidate);
      continue;
    }
    const prev = out[dupIdx]!;
    if (findingPrecisionScore(candidate) > findingPrecisionScore(prev)) {
      out[dupIdx] = candidate;
    }
  }
  return out;
}

/** Déduplique montants labellisés (ex. majoration 19 % ×3). */
export function dedupeLabeledAmounts(amounts: string[]): string[] {
  const out: string[] = [];
  const keys: string[] = [];

  for (const raw of amounts) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || !/\d/.test(t)) continue;
    const key = normalizeFindingText(t);
    // Clé montant : chiffres + label court
    const digits = t.replace(/[^\d,.%]/g, "");
    const label = key
      .replace(/\d+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    // Famille de libellé (majoration / principal / total…) pour fusionner synonymes.
    const familyLabel = (() => {
      if (/majoration|retard|penalit/.test(label)) return "majoration";
      if (/principal|du\b|d[uû]\b/.test(label)) return "principal";
      if (/total|regler|payer|reclam/.test(label)) return "total";
      if (/relance|frais\s+de\s+relance/.test(label)) return "relance";
      if (/loyer/.test(label)) return "loyer";
      if (/commission|tenue|frais/.test(label) && digits) {
        return `frais:${digits}`;
      }
      return label || key;
    })();
    const amountKey = `${familyLabel}::${digits}`;

    let dup = false;
    for (let i = 0; i < keys.length; i += 1) {
      const prev = keys[i]!;
      if (prev === amountKey || prev === key) {
        dup = true;
        // Garder la version la plus longue / labellisée
        if (t.length > out[i]!.length) {
          out[i] = t;
          keys[i] = amountKey;
        }
        break;
      }
      const prevDigits = out[i]!.replace(/[^\d,.%]/g, "");
      const j = jaccardSimilarity(t, out[i]!);
      if (j >= 0.55 && digits && prevDigits === digits) {
        dup = true;
        if (t.length > out[i]!.length) {
          out[i] = t;
          keys[i] = amountKey;
        }
        break;
      }
    }
    if (dup) continue;
    keys.push(amountKey);
    out.push(t);
  }
  return out;
}

/** Déduplique lignes de risques / points texte libres. */
export function dedupeRiskStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 8) continue;
    const isDup = out.some((prev) => {
      const na = normalizeFindingText(prev);
      const nb = normalizeFindingText(t);
      if (na === nb) return true;
      if (na.length >= 20 && nb.length >= 20 && (na.includes(nb) || nb.includes(na))) {
        return true;
      }
      return jaccardSimilarity(prev, t) >= 0.6;
    });
    if (isDup) {
      // Remplacer si plus précis
      const idx = out.findIndex((prev) => {
        const na = normalizeFindingText(prev);
        const nb = normalizeFindingText(t);
        return (
          na === nb ||
          (na.length >= 20 && nb.length >= 20 && (na.includes(nb) || nb.includes(na))) ||
          jaccardSimilarity(prev, t) >= 0.6
        );
      });
      if (idx >= 0 && t.length > out[idx]!.length) out[idx] = t;
      continue;
    }
    out.push(t);
  }
  return out;
}
