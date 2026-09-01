/**
 * Insights abonnements / finance / économies / digests / courriers.
 * Consomme uniquement les APIs lecture mémoire — aucun write engine.
 */
import { listDeadlinesForDoc } from "@/services/memory/deadline-store";
import { getMemoryDocument } from "@/services/memory/document-store";
import { listEntities } from "@/services/memory/entity-store";
import { getDocsByEntity, getCorpusSize } from "@/services/memory/indexes";
import { listClausesForDoc } from "@/services/memory/clause-store";
import { listAllRelations } from "@/services/memory/relation-store";
import {
  loadRelationSignals,
  type DocRelationSignals,
} from "@/services/memory/relation-signals";
import { listCounterpartyAggregates } from "@/services/memory/timeline";
import {
  buildDocSpendSnapshot,
  clusterSubscriptionDocs,
  pickPrimarySubscriptionDoc,
  resolveComponentProduct,
} from "@/services/insights/subscription-dedup";
import {
  inferRecurringPeriod,
  pickRecurringAmountEur,
  subscriptionAggregateId,
  subscriptionDisplayName,
  type ProductSignal,
} from "@/services/insights/subscription-identity";
import type {
  FinanceCategoryBucket,
  FinanceInsight,
  FinanceMonthPoint,
  MemoryDigest,
  PremiumMemoryDashboard,
  RelationLetterIntent,
  SavingsOpportunity,
  SubscriptionInsight,
} from "@/types/insights";
import type {
  MemoryDeadline,
  MemoryDocumentNode,
  MemoryRelation,
} from "@/types/memory";

const SUB_CATEGORIES = new Set([
  "assurance",
  "contrat",
  "facture",
  "banque",
  "bail",
]);

const CATEGORY_LABELS: Record<string, string> = {
  assurance: "Assurances",
  contrat: "Abonnements / contrats",
  facture: "Factures",
  banque: "Banque",
  bail: "Logement",
  autre: "Autre",
};

const RECURRING_PERIODS = new Set([
  "mensuel",
  "annuel",
  "trimestriel",
  "hebdomadaire",
]);

/**
 * Convertit un montant en équivalent mensuel UNIQUEMENT si la périodicité
 * est explicite. Fréquence inconnue / facture ponctuelle → null (jamais d’hypothèse).
 */
export function toMonthlySpendEur(
  amount: number | null,
  period: string | null,
): number | null {
  if (amount == null || amount <= 0) return null;
  if (!period || !RECURRING_PERIODS.has(period)) return null;
  if (period === "mensuel") return Math.round(amount * 100) / 100;
  if (period === "annuel") return Math.round((amount / 12) * 100) / 100;
  if (period === "trimestriel") return Math.round((amount / 3) * 100) / 100;
  if (period === "hebdomadaire") return Math.round(amount * 4.33 * 100) / 100;
  return null;
}

function toAnnual(monthly: number | null): number | null {
  if (monthly == null) return null;
  return Math.round(monthly * 12 * 100) / 100;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

async function loadDocsForEntity(
  userId: string,
  entityId: string,
): Promise<MemoryDocumentNode[]> {
  const ids = await getDocsByEntity(userId, entityId);
  const docs: MemoryDocumentNode[] = [];
  for (const id of ids.slice(0, 40)) {
    const d = await getMemoryDocument(userId, id);
    if (d) docs.push(d);
  }
  return docs;
}

function isDocSpendEligible(
  doc: MemoryDocumentNode,
  deadlines: MemoryDeadline[],
): boolean {
  if (doc.status === "possibly_replaced" || doc.status === "archived") {
    return false;
  }
  if (
    deadlines.some((d) => d.kind === "resiliation" && d.status === "past")
  ) {
    return false;
  }
  return true;
}

type SubGroup = {
  orgId: string;
  orgName: string;
  product: ProductSignal;
  docs: MemoryDocumentNode[];
};

function amountContextText(
  signals: DocRelationSignals | null,
  doc: MemoryDocumentNode,
): string {
  return [
    signals?.productHints ?? "",
    signals?.title ?? "",
    doc.displayName ?? "",
    doc.fileName ?? "",
  ].join(" ");
}

function resolveSubscriptionSpend(
  signals: DocRelationSignals | null,
  doc: MemoryDocumentNode,
): {
  picked: number | null;
  monthly: number | null;
  period: string | null;
} {
  const amountText = amountContextText(signals, doc);
  const period = signals?.period ?? inferRecurringPeriod(amountText);
  const picked = pickRecurringAmountEur(
    signals?.amounts ?? [],
    period,
    amountText,
  );
  const monthly = toMonthlySpendEur(picked, period);
  return { picked, monthly, period };
}

async function buildSubscriptionFromDocs(
  userId: string,
  group: SubGroup,
  docs: MemoryDocumentNode[],
  loadDl: (documentId: string) => Promise<MemoryDeadline[]>,
): Promise<SubscriptionInsight | null> {
  if (docs.length === 0) return null;

  const eligibility = new Map<string, boolean>();
  for (const doc of docs) {
    const dls = await loadDl(doc.documentId);
    eligibility.set(doc.documentId, isDocSpendEligible(doc, dls));
  }

  const primary = pickPrimarySubscriptionDoc(
    docs,
    (doc) => eligibility.get(doc.documentId) ?? false,
  );
  const eligible = eligibility.get(primary.documentId) ?? false;
  const primarySignals = await loadRelationSignals(userId, primary.documentId);
  const spend = resolveSubscriptionSpend(primarySignals, primary);
  const picked = spend.picked;
  const monthly = spend.monthly;
  const billingPeriod = spend.period;

  let nextDeadline: SubscriptionInsight["nextDeadline"] = null;
  let terminationHint: string | null = null;
  for (const doc of docs) {
    const deadlines = await loadDl(doc.documentId);
    for (const d of deadlines) {
      if (!d.dueDate) continue;
      if (d.status === "past") continue;
      if (!nextDeadline || d.dueDate < nextDeadline.date) {
        nextDeadline = {
          date: d.dueDate,
          label: d.label,
          kind: d.kind,
        };
      }
      if (d.kind === "resiliation" && !terminationHint) {
        terminationHint = d.label;
      }
    }
    const clauses = await listClausesForDoc(userId, doc.documentId);
    const preavis = clauses.find((c) => c.clauseType === "preavis");
    if (preavis && !terminationHint) {
      terminationHint =
        preavis.normalizedValue != null
          ? `Préavis : ${preavis.normalizedValue} jours`
          : preavis.textSpan.slice(0, 80);
    }
  }

  const status: SubscriptionInsight["status"] = !eligible
    ? "possibly_replaced"
    : primary.status === "possibly_replaced"
      ? "possibly_replaced"
      : primary.status === "active"
        ? "active"
        : "unknown";

  return {
    id: subscriptionAggregateId(group.orgId, group.product.key),
    entityId: group.orgId,
    name: subscriptionDisplayName(group.orgName, group.product),
    category: primary.category,
    productKey: group.product.key,
    monthlyEur: eligible ? monthly : null,
    annualEur: eligible ? toAnnual(monthly) : null,
    billingPeriod,
    extractedAmountEur: picked,
    nextDeadline,
    terminationHint,
    documentCount: docs.length,
    primaryHistoryId: primary.historyId,
    primaryDocumentId: primary.documentId,
    status,
  };
}

export async function listSubscriptionInsights(
  userId: string,
): Promise<SubscriptionInsight[]> {
  const orgs = (await listEntities(userId)).filter(
    (e) => e.kind === "organization",
  );
  const allRelations = await listAllRelations(userId);
  const out: SubscriptionInsight[] = [];

  for (const org of orgs.slice(0, 60)) {
    const rawDocs = await loadDocsForEntity(userId, org.id);
    const docs: MemoryDocumentNode[] = [];
    for (const doc of rawDocs) {
      if (!SUB_CATEGORIES.has(doc.category)) continue;
      const signals = await loadRelationSignals(userId, doc.documentId);
      if (doc.category === "facture" && !signals?.period) continue;
      docs.push(doc);
    }
    if (docs.length === 0) continue;

    const deadlineCache = new Map<string, MemoryDeadline[]>();
    const loadDl = async (documentId: string) => {
      if (!deadlineCache.has(documentId)) {
        deadlineCache.set(
          documentId,
          await listDeadlinesForDoc(userId, documentId),
        );
      }
      return deadlineCache.get(documentId)!;
    };

    const snapshots = new Map<string, ReturnType<typeof buildDocSpendSnapshot>>();
    for (const doc of docs) {
      const signals = await loadRelationSignals(userId, doc.documentId);
      const spend = resolveSubscriptionSpend(signals, doc);
      snapshots.set(
        doc.documentId,
        buildDocSpendSnapshot(
          doc,
          signals,
          org.canonicalName,
          spend.monthly,
          spend.period,
        ),
      );
    }

    const components = clusterSubscriptionDocs({
      docs,
      relations: allRelations,
      snapshots,
    });

    for (const componentDocs of components) {
      const eligibility = new Map<string, boolean>();
      for (const doc of componentDocs) {
        const dls = await loadDl(doc.documentId);
        eligibility.set(doc.documentId, isDocSpendEligible(doc, dls));
      }
      const primary = pickPrimarySubscriptionDoc(
        componentDocs,
        (doc) => eligibility.get(doc.documentId) ?? false,
      );
      const product = resolveComponentProduct(
        componentDocs,
        snapshots,
        org.canonicalName,
        primary,
      );
      const group: SubGroup = {
        orgId: org.id,
        orgName: org.canonicalName,
        product,
        docs: componentDocs,
      };
      const insight = await buildSubscriptionFromDocs(
        userId,
        group,
        componentDocs,
        loadDl,
      );
      if (insight) out.push(insight);
    }
  }

  return out.sort((a, b) => (b.monthlyEur ?? 0) - (a.monthlyEur ?? 0));
}

export async function buildFinanceInsight(
  userId: string,
): Promise<FinanceInsight> {
  const subs = await listSubscriptionInsights(userId);
  const byCat = new Map<string, FinanceCategoryBucket>();

  let monthlyTotal: number | null = null;
  for (const s of subs) {
    const m = s.monthlyEur;
    if (m == null || m <= 0) continue;
    monthlyTotal = (monthlyTotal ?? 0) + m;
    const cur = byCat.get(s.category) ?? {
      category: s.category,
      label: CATEGORY_LABELS[s.category] || s.category,
      monthlyEur: 0,
      annualEur: 0,
      count: 0,
    };
    cur.monthlyEur += m;
    cur.annualEur += s.annualEur ?? m * 12;
    cur.count += 1;
    byCat.set(s.category, cur);
  }

  const roundedMonthly =
    monthlyTotal != null ? Math.round(monthlyTotal * 100) / 100 : null;

  // Série : un point par abonnement actif (évite double-compte multi-docs).
  const seriesMap = new Map<string, FinanceMonthPoint>();
  for (const s of subs) {
    if (s.monthlyEur == null || s.monthlyEur <= 0) continue;
    if (!s.primaryDocumentId) continue;
    const doc = await getMemoryDocument(userId, s.primaryDocumentId);
    if (!doc) continue;
    const key = monthKey(doc.analyzedAt);
    const cur = seriesMap.get(key) ?? {
      month: key,
      totalEur: 0,
      documentCount: 0,
    };
    cur.totalEur += s.monthlyEur;
    cur.documentCount += 1;
    seriesMap.set(key, cur);
  }

  const series = [...seriesMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  return {
    monthlyTotalEur: roundedMonthly,
    annualTotalEur:
      roundedMonthly != null
        ? Math.round(roundedMonthly * 12 * 100) / 100
        : null,
    byCategory: [...byCat.values()]
      .map((c) => ({
        ...c,
        monthlyEur: Math.round(c.monthlyEur * 100) / 100,
        annualEur: Math.round(c.annualEur * 100) / 100,
      }))
      .sort((a, b) => b.monthlyEur - a.monthlyEur),
    series,
  };
}

function estimateSaving(rel: MemoryRelation): number | null {
  const amount = rel.evidence.find((e) => e.field === "amount_eur");
  if (amount?.left) {
    const n = Number(amount.left.replace(",", "."));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

export async function listSavingsOpportunities(
  userId: string,
): Promise<SavingsOpportunity[]> {
  const relations = await listAllRelations(userId);
  const seen = new Set<string>();
  const out: SavingsOpportunity[] = [];

  const map: Partial<
    Record<
      MemoryRelation["type"],
      { kind: SavingsOpportunity["kind"]; title: string }
    >
  > = {
    duplicate_of: {
      kind: "duplicate",
      title: "Opportunité potentielle — document en doublon",
    },
    covers_same_risk: {
      kind: "redundant_insurance",
      title: "Opportunité potentielle — assurance / risque redondant",
    },
    same_guarantee: {
      kind: "redundant_insurance",
      title: "Opportunité potentielle — garantie déjà couverte",
    },
    redundant_payment: {
      kind: "redundant_payment",
      title: "Opportunité potentielle — paiement en double",
    },
    contradicts_clause: {
      kind: "contradiction",
      title: "Contradiction potentielle (preuves textuelles)",
    },
    obsoletes_fact: {
      kind: "obsolete_fact",
      title: "Information potentiellement obsolète",
    },
  };

  for (const rel of relations) {
    if (rel.status === "user_dismissed" || rel.status === "user_snoozed") {
      continue;
    }
    if (rel.score < 0.72) continue;
    const meta = map[rel.type];
    if (!meta) continue;

    const pairKey = [rel.type, ...[rel.fromDocId, rel.toDocId].sort()].join("|");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const fromDoc = await getMemoryDocument(userId, rel.fromDocId);
    const toDoc = await getMemoryDocument(userId, rel.toDocId);
    // Les deux documents doivent encore exister (pas de piste fantôme).
    if (!fromDoc || !toDoc) continue;

    const peer = toDoc.displayName || toDoc.fileName || "autre document";
    const estimated = estimateSaving(rel);
    out.push({
      id: `save:${pairKey}`,
      kind: meta.kind,
      title: meta.title,
      message: `Relation proposée « ${rel.type} » avec « ${peer} » (score ${Math.round(rel.score * 100)} %). À vérifier — ce n’est pas une économie/contradiction certaine.${estimated != null ? ` Montant lié aux preuves : ${estimated} €.` : ""}`,
      estimatedMonthlySavingEur: estimated,
      certainty: "potential",
      relationType: rel.type,
      relationId: rel.id,
      score: rel.score,
      historyId: fromDoc.historyId,
      secondaryHistoryId: toDoc.historyId,
      documentId: fromDoc.documentId,
      documentTitle: fromDoc.displayName || fromDoc.fileName,
      evidence: rel.evidence,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

export async function buildMemoryDigest(
  userId: string,
  period: "week" | "month",
): Promise<MemoryDigest> {
  const now = new Date();
  const ms = period === "week" ? 7 * 86400_000 : 30 * 86400_000;
  const fromDate = new Date(now.getTime() - ms);
  const from = fromDate.toISOString();
  const to = now.toISOString();

  const orgs = (await listEntities(userId)).filter(
    (e) => e.kind === "organization",
  );
  let newDocuments = 0;
  let upcomingDeadlines = 0;
  const highlights: MemoryDigest["relationHighlights"] = [];

  for (const org of orgs.slice(0, 50)) {
    for (const doc of await loadDocsForEntity(userId, org.id)) {
      if (doc.analyzedAt >= from) newDocuments += 1;
      for (const d of await listDeadlinesForDoc(userId, doc.documentId)) {
        if (!d.dueDate || d.status === "past") continue;
        const due = Date.parse(`${d.dueDate}T12:00:00.000Z`);
        if (Number.isFinite(due) && due >= now.getTime() && due <= now.getTime() + ms) {
          upcomingDeadlines += 1;
        }
      }
    }
  }

  const savings = await listSavingsOpportunities(userId);
  for (const s of savings.slice(0, 5)) {
    highlights.push({ kind: s.kind, text: `${s.title} — ${s.documentTitle}` });
  }

  const counterparties = await listCounterpartyAggregates(userId, {
    limit: 5,
  });

  const summary =
    newDocuments === 0 && savings.length === 0
      ? `Aucun nouvel événement mémoire sur la période (${period === "week" ? "7 jours" : "30 jours"}).`
      : `Sur ${period === "week" ? "7 jours" : "30 jours"} : ${newDocuments} document(s), ${upcomingDeadlines} échéance(s), ${savings.length} piste(s) d’économie.`;

  return {
    period,
    from: from.slice(0, 10),
    to: to.slice(0, 10),
    newDocuments,
    upcomingDeadlines,
    savingsCount: savings.length,
    relationHighlights: highlights,
    topCounterparties: counterparties.map((c) => ({
      name: c.name,
      documentCount: c.documentCount,
    })),
    summary,
  };
}

export async function listRelationLetterIntents(
  userId: string,
): Promise<RelationLetterIntent[]> {
  const savings = await listSavingsOpportunities(userId);
  const out: RelationLetterIntent[] = [];

  for (const s of savings) {
    let letterType: RelationLetterIntent["letterType"] = "autre";
    let title = "Courrier recommandé";
    let reason = s.message;

    switch (s.kind) {
      case "duplicate":
      case "redundant_insurance":
        letterType = "resiliation";
        title = "Résilier un contrat potentiellement redondant";
        reason =
          "La mémoire a détecté une couverture ou un document potentiellement en doublon (à vérifier).";
        break;
      case "redundant_payment":
        letterType = "remboursement";
        title = "Demander un remboursement / régularisation";
        reason = "Paiement potentiellement en double détecté (à vérifier).";
        break;
      case "contradiction":
        letterType = "contestation";
        title = "Contester une clause potentiellement contradictoire";
        reason =
          "Deux documents présentent des preuves textuelles de clauses incompatibles (à vérifier).";
        break;
      case "obsolete_fact":
        letterType = "reponse_administrative";
        title = "Signaler un changement (adresse / tarif)";
        reason =
          "Un fait potentiellement obsolète (adresse, tarif…) a été détecté entre documents.";
        break;
      default:
        break;
    }

    const recipient =
      s.documentTitle.split(/\s+/).slice(0, 3).join(" ") || "Destinataire";

    out.push({
      id: `letter:${s.id}`,
      letterType,
      title,
      reason,
      recipient,
      historyId: s.historyId,
      documentId: s.documentId,
      relationType: s.relationType,
      relationId: s.relationId,
    });
  }

  return out.slice(0, 12);
}

export async function buildPremiumMemoryDashboard(
  userId: string,
): Promise<PremiumMemoryDashboard> {
  const [subs, finance, savings, digest, letters] = await Promise.all([
    listSubscriptionInsights(userId),
    buildFinanceInsight(userId),
    listSavingsOpportunities(userId),
    buildMemoryDigest(userId, "week"),
    listRelationLetterIntents(userId),
  ]);

  const estimatedMonthlySavingsEur = savings.reduce(
    (sum, s) => sum + (s.estimatedMonthlySavingEur ?? 0),
    0,
  );

  const contradictionCount = savings.filter(
    (s) => s.kind === "contradiction",
  ).length;

  const corpus = await getCorpusSize(userId);

  return {
    monthlySpendEur: finance.monthlyTotalEur,
    annualSpendEur: finance.annualTotalEur,
    subscriptionCount: subs.length,
    savingsCount: savings.length,
    estimatedMonthlySavingsEur:
      Math.round(estimatedMonthlySavingsEur * 100) / 100,
    upcomingDeadlines: digest.upcomingDeadlines,
    contradictionCount,
    topSubscriptions: subs.slice(0, 5),
    topSavings: savings.slice(0, 5),
    digest,
    letterIntents: letters.slice(0, 5),
    uniqueValuePoints: [
      `${subs.length} ligne(s) d’abonnement reconstruite(s) depuis vos PDF`,
      `${savings.length} piste(s) d’économie potentielle(s) (relations à vérifier)`,
      `${contradictionCount} contradiction(s) potentielle(s) basée(s) sur des preuves textuelles`,
      `Timeline et contreparties sur ${corpus} document(s) indexés`,
      digest.summary,
    ],
  };
}
