import { createHash } from "crypto";

import type {
  MemoryClauseType,
  MemoryDeadlineKind,
  MemoryDeadlineStatus,
  MemoryEntityKind,
} from "@/types/memory";

const MONTH_MAP: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

/** Normalisation clé entité (slug ASCII). */
export function normalizeEntityKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9@.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyEntityKey(value: string): string {
  return normalizeEntityKey(value).replace(/\s+/g, "-");
}

/** Enrichit la clé avec SIREN / email si détectés dans le libellé. */
export function buildNormalizedEntityKey(raw: string): string {
  const base = slugifyEntityKey(raw);
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const siren = raw.replace(/\s/g, "").match(/\b\d{9}\b/)?.[0];
  if (email) return `${base}|email:${email.toLowerCase()}`;
  if (siren) return `${base}|siren:${siren}`;
  return base;
}

export function hashNormText(text: string): string {
  return createHash("sha256")
    .update(normalizeEntityKey(text), "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function parseAmountEur(raw: string): number | null {
  const cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/€|eur(os)?/gi, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Parse dates FR / ISO → YYYY-MM-DD. */
export function parseDateToIso(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const monthMatch = text.match(
    /\b(\d{1,2})\s+(?:er\s+)?(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/i,
  );
  if (monthMatch) {
    const d = Number(monthMatch[1]);
    const monthKey = monthMatch[2].toLowerCase();
    const m = MONTH_MAP[monthKey];
    const y = Number(monthMatch[3]);
    if (!m || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return null;
}

export function inferDeadlineKind(label: string): MemoryDeadlineKind {
  const t = normalizeEntityKey(label);
  if (/paiement|payer|reglement|cotisation|loyer|facture|echeance de paiement/.test(t)) {
    return "paiement";
  }
  if (/resiliation|denonciation|resilier|preavis/.test(t)) {
    return "resiliation";
  }
  if (/renouvellement|reconduction|tacite|renouveler/.test(t)) {
    return "renouvellement";
  }
  if (/declaration|declarer|impot|urssaf/.test(t)) {
    return "declaration";
  }
  return "autre";
}

export function deadlineStatusFromDue(
  dueDate: string | null,
  now = new Date(),
): MemoryDeadlineStatus {
  if (!dueDate) return "upcoming";
  const due = Date.parse(`${dueDate}T23:59:59.000Z`);
  if (!Number.isFinite(due)) return "upcoming";
  return due < now.getTime() ? "past" : "upcoming";
}

export function inferClauseType(text: string): MemoryClauseType {
  const t = normalizeEntityKey(text);
  if (/preavis|denonciation/.test(t)) return "preavis";
  if (/franchise/.test(t)) return "franchise";
  if (/tacite|reconduction automatique/.test(t)) return "tacite";
  if (/exclusion|exclu|non couvert/.test(t)) return "exclusion";
  if (/plafond|limite de garantie|montant maximum/.test(t)) return "plafond";
  if (/resiliation|resilier|rompre/.test(t)) return "resiliation";
  return "autre";
}

export function inferNormalizedClauseValue(
  text: string,
  clauseType: MemoryClauseType,
): string | number | boolean | null {
  const days = text.match(/(\d+)\s*jours?/i);
  if (days && (clauseType === "preavis" || clauseType === "resiliation")) {
    return Number(days[1]);
  }
  const months = text.match(/(\d+)\s*mois/i);
  if (months && (clauseType === "preavis" || clauseType === "resiliation")) {
    return Number(months[1]) * 30;
  }
  const amount = parseAmountEur(text);
  if (amount != null && (clauseType === "franchise" || clauseType === "plafond")) {
    return amount;
  }
  if (clauseType === "tacite") {
    if (/sans tacite|pas de reconduction|non reconduit/i.test(text)) return false;
    if (/tacite|reconduction automatique/i.test(text)) return true;
  }
  return null;
}

export function guessEntityKind(
  raw: string,
  hint: "person" | "organization",
): MemoryEntityKind {
  return hint;
}

export function inferRoleHints(
  raw: string,
  kind: MemoryEntityKind,
): string[] {
  const t = normalizeEntityKey(raw);
  const hints: string[] = [];
  if (kind === "organization") {
    if (/assur|mutuelle|axa|allianz|maaf|macif|gmf/.test(t)) hints.push("assureur");
    if (/bailleur|sci|fonciere/.test(t)) hints.push("bailleur");
    if (/banque|credit|caisse/.test(t)) hints.push("banque");
    if (/employeur|sas|sarl|sa\b/.test(t)) hints.push("employeur");
  }
  if (kind === "person") {
    if (/locataire/.test(t)) hints.push("locataire");
    if (/assure/.test(t)) hints.push("assure");
  }
  return hints;
}

export function contentHashFromText(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}
