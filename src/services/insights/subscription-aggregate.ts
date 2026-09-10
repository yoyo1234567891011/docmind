/**
 * Agrégation « Mes abonnements » — déterministe, lecture mémoire seule, 0 LLM.
 * Filtre d’éligibilité + montants labellisés + typage crédit/prêt.
 */
import { isSubscriberPersonName } from "@/services/extraction/people-orgs";
import type { DocRelationSignals } from "@/services/memory/relation-signals";
import {
  inferRecurringPeriod,
  pickRecurringAmountEur,
  resolveProductSignal,
  subscriptionDisplayName,
  toMonthlyFromPeriod,
  type ProductSignal,
} from "@/services/insights/subscription-identity";
import type { MemoryDocumentNode } from "@/types/memory";

const CANDIDATE_CATEGORIES = new Set([
  "assurance",
  "contrat",
  "facture",
  "banque",
  "bail",
]);

/** Docs administratifs / one-shot / recouvrement — jamais une ligne abo. */
const EXCLUDE_DOC_RE =
  /\b(caisse\s+d['']allocations|allocations\s+familiales|\bcaf\b|mise\s+en\s+demeure|relance\s+de\s+paiement|impay[eé]|recouvrement|huissier|avis\s+(?:d['']?\s*)?imp[oô]t|imp[oô]ts?\b|dgfip|finances\s+publiques|taxe\s+fonci[eè]re|amende)\b/i;

const RECURRING_AMOUNT_LABEL_RE =
  /\b(abonnement|cotisation|loyer|forfait|mensualit[eé]|prime\s+(?:mensuelle|annuelle)|redevance|frais\s+de\s+tenue)\b/i;

const MONTHLY_AMOUNT_RE =
  /(?:abonnement|cotisation|loyer|forfait|mensualit[eé]|redevance|frais\s+de\s+tenue(?:\s+de\s+compte)?|prime)\s*(?:mensuel(?:le)?s?)?\s*[:=]?\s*(?:\*\*)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?/gi;

const ANNUAL_AMOUNT_RE =
  /(?:cotisation|prime|abonnement|redevance)\s*(?:annuel(?:le)?s?)?\s*[:=]?\s*(?:\*\*)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?|(?:par\s+an|\/\s*an)\s*[:=]?\s*(?:\*\*)?\s*(\d+(?:[.,]\d+)?)/gi;

const CREDIT_RE =
  /\b(pr[eê]t|cr[eé]dit\s+(?:immobilier|consommation|personnel|serein)?|emprunteur|taeg|mensualit[eé]\s+de\s+(?:cr[eé]dit|pr[eê]t)|offre\s+de\s+pr[eê]t|capital\s+emprunt)\b/i;

const BANK_FEE_RE =
  /\b(tenue\s+de\s+compte|frais\s+(?:mensuels|de\s+tenue|bancaires\s+mensuels)|cotisation\s+(?:carte|compte)|abonnement\s+(?:bancaire|compte))\b/i;

const BANK_SOLDE_ONLY_RE =
  /\b(solde\s+(?:arr[eê]t[eé]|cr[eé]diteur|d[eé]biteur)|d[eé]couvert\s+autoris)/i;

function corpus(signals: DocRelationSignals | null, doc: MemoryDocumentNode): string {
  return [
    signals?.productHints ?? "",
    signals?.title ?? "",
    doc.displayName ?? "",
    doc.fileName ?? "",
    ...(signals?.riskLabels ?? []),
    ...(signals?.guaranteeLabels ?? []),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEur(raw: string): number | null {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Contrepartie = organisation émettrice, jamais une personne physique. */
export function isValidSubscriptionOrgName(name: string): boolean {
  const n = (name ?? "").trim();
  if (n.length < 2) return false;
  if (isSubscriberPersonName(n)) return false;
  return true;
}

export function isCreditOrLoanDoc(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
): boolean {
  return CREDIT_RE.test(corpus(signals, doc));
}

/**
 * Signal clair d’engagement récurrent (sinon la ligne est exclue).
 */
export function isRecurringSubscriptionCandidate(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
): boolean {
  if (!CANDIDATE_CATEGORIES.has(doc.category)) return false;
  if (doc.status === "archived") return false;

  const text = corpus(signals, doc);
  if (EXCLUDE_DOC_RE.test(text)) return false;

  if (isCreditOrLoanDoc(doc, signals)) {
    // Prêt : mensualité de crédit uniquement (pas un abo telecom).
    return (
      /\bmensualit/i.test(text) ||
      Boolean(signals?.period) ||
      RECURRING_AMOUNT_LABEL_RE.test(text)
    );
  }

  if (doc.category === "banque") {
    if (!BANK_FEE_RE.test(text)) return false;
    // Solde seul sans frais récurrents déjà filtré par BANK_FEE_RE.
    void BANK_SOLDE_ONLY_RE;
    return true;
  }

  if (doc.category === "bail") {
    return /\bloyer\b/i.test(text) || RECURRING_AMOUNT_LABEL_RE.test(text);
  }

  if (doc.category === "assurance") {
    return (
      RECURRING_AMOUNT_LABEL_RE.test(text) ||
      Boolean(signals?.period) ||
      /\b(cotisation|prime|mutuelle)\b/i.test(text)
    );
  }

  if (doc.category === "facture") {
    return (
      Boolean(signals?.period) ||
      RECURRING_AMOUNT_LABEL_RE.test(text) ||
      /\babonnement|forfait|mensuel/i.test(text)
    );
  }

  // contrat / abo
  return (
    Boolean(signals?.period) ||
    RECURRING_AMOUNT_LABEL_RE.test(text) ||
    /\b(abonnement|forfait|engagement|tacite\s+reconduction|renouvellement\s+automatique)\b/i.test(
      text,
    )
  );
}

export type ResolvedSubscriptionSpend = {
  picked: number | null;
  monthly: number | null;
  annual: number | null;
  period: string | null;
};

/**
 * Montant /mois et /an depuis labels (abonnement, cotisation…) + période stockée.
 * Sans ancrage fiable → null (affichage « — »), jamais un faux 0.
 */
export function resolveSubscriptionSpendFromMemory(
  signals: DocRelationSignals | null,
  doc: MemoryDocumentNode,
): ResolvedSubscriptionSpend {
  const text = corpus(signals, doc);
  const amounts = signals?.amounts ?? [];

  let period =
    signals?.period ??
    inferRecurringPeriod(text) ??
    null;

  // Labels « abonnement / cotisation / loyer » → mensuel par défaut si pas annuel.
  if (!period && RECURRING_AMOUNT_LABEL_RE.test(text)) {
    period = /\b(annuel|par\s+an|\/\s*an|prime\s+annuelle|cotisation\s+annuelle)\b/i.test(
      text,
    )
      ? "annuel"
      : "mensuel";
  }

  let picked: number | null = null;

  if (period === "annuel" || /\b(annuel|par\s+an|\/\s*an|prime\s+annuelle)\b/i.test(text)) {
    for (const m of text.matchAll(ANNUAL_AMOUNT_RE)) {
      const raw = m[1] || m[2];
      if (!raw) continue;
      const n = parseEur(raw);
      if (n != null && (amounts.length === 0 || amounts.some((a) => Math.abs(a - n) < 0.05))) {
        picked = n;
        period = "annuel";
        break;
      }
      if (n != null && amounts.length === 0) {
        picked = n;
        period = "annuel";
        break;
      }
    }
  }

  if (picked == null) {
    for (const m of text.matchAll(MONTHLY_AMOUNT_RE)) {
      const n = parseEur(m[1] || "");
      if (n == null) continue;
      // Accepte le montant labellisé même s’il n’est pas encore dans signals.amounts.
      picked = n;
      if (!period) period = "mensuel";
      break;
    }
  }

  if (picked == null) {
    picked = pickRecurringAmountEur(amounts, period, text);
  }

  // Un seul montant + période connue → fiable.
  if (picked == null && period && amounts.length === 1) {
    picked = amounts[0]!;
  }

  const monthly = toMonthlyFromPeriod(picked, period);
  let annual: number | null = null;
  if (monthly != null) {
    annual =
      period === "annuel" && picked != null
        ? picked
        : Math.round(monthly * 12 * 100) / 100;
  }

  return { picked, monthly, annual, period };
}

/**
 * Produit / libellé court — crédit séparé des abos telecom / assurance.
 */
export function resolveSubscriptionProductForDoc(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
  orgName: string,
): ProductSignal {
  if (isCreditOrLoanDoc(doc, signals)) {
    return { key: "credit", label: "Mensualité de crédit" };
  }
  return resolveProductSignal(doc, signals, orgName);
}

export function subscriptionInsightCategory(
  doc: MemoryDocumentNode,
  product: ProductSignal,
): string {
  if (product.key === "credit") return "pret";
  return doc.category;
}

export function formatSubscriptionLineName(
  orgName: string,
  product: ProductSignal,
): string {
  return subscriptionDisplayName(orgName, product);
}
