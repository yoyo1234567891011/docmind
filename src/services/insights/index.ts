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
import { loadRelationSignals } from "@/services/memory/relation-signals";
import { listCounterpartyAggregates } from "@/services/memory/timeline";
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
import type { MemoryDocumentNode, MemoryRelation } from "@/types/memory";

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

function toMonthly(
  amount: number | null,
  period: string | null,
): number | null {
  if (amount == null || amount <= 0) return null;
  if (period === "annuel") return Math.round((amount / 12) * 100) / 100;
  if (period === "trimestriel") return Math.round((amount / 3) * 100) / 100;
  if (period === "hebdomadaire") return Math.round(amount * 4.33 * 100) / 100;
  return amount; // mensuel ou inconnu → traiter comme mensuel
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

export async function listSubscriptionInsights(
  userId: string,
): Promise<SubscriptionInsight[]> {
  const orgs = (await listEntities(userId)).filter(
    (e) => e.kind === "organization",
  );
  const out: SubscriptionInsight[] = [];

  for (const org of orgs.slice(0, 60)) {
    const docs = await loadDocsForEntity(userId, org.id);
    const relevant = docs.filter((d) => SUB_CATEGORIES.has(d.category));
    if (relevant.length === 0) continue;

    const newest = [...relevant].sort((a, b) =>
      b.analyzedAt.localeCompare(a.analyzedAt),
    )[0];
    const signals = await loadRelationSignals(userId, newest.documentId);
    const monthly = toMonthly(
      signals?.amounts?.[0] ?? null,
      signals?.period ?? null,
    );

    let nextDeadline: SubscriptionInsight["nextDeadline"] = null;
    let terminationHint: string | null = null;
    for (const doc of relevant) {
      const deadlines = await listDeadlinesForDoc(userId, doc.documentId);
      for (const d of deadlines) {
        if (!d.dueDate) continue;
        if (d.status === "past") continue;
        if (
          !nextDeadline ||
          d.dueDate < nextDeadline.date
        ) {
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

    const status: SubscriptionInsight["status"] =
      newest.status === "possibly_replaced"
        ? "possibly_replaced"
        : newest.status === "active"
          ? "active"
          : "unknown";

    out.push({
      id: org.id,
      entityId: org.id,
      name: org.canonicalName,
      category: newest.category,
      monthlyEur: monthly,
      annualEur: toAnnual(monthly),
      nextDeadline,
      terminationHint,
      documentCount: relevant.length,
      primaryHistoryId: newest.historyId,
      primaryDocumentId: newest.documentId,
      status,
    });
  }

  return out.sort((a, b) => (b.monthlyEur ?? 0) - (a.monthlyEur ?? 0));
}

export async function buildFinanceInsight(
  userId: string,
): Promise<FinanceInsight> {
  const subs = await listSubscriptionInsights(userId);
  const byCat = new Map<string, FinanceCategoryBucket>();

  let monthlyTotal = 0;
  for (const s of subs) {
    const m = s.monthlyEur ?? 0;
    monthlyTotal += m;
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

  // Série temporelle : montants signalés à la date d'analyse
  const seriesMap = new Map<string, FinanceMonthPoint>();
  const orgs = (await listEntities(userId)).filter(
    (e) => e.kind === "organization",
  );
  for (const org of orgs.slice(0, 40)) {
    for (const doc of await loadDocsForEntity(userId, org.id)) {
      const sig = await loadRelationSignals(userId, doc.documentId);
      const monthly = toMonthly(sig?.amounts?.[0] ?? null, sig?.period ?? null);
      if (monthly == null) continue;
      const key = monthKey(doc.analyzedAt);
      const cur = seriesMap.get(key) ?? {
        month: key,
        totalEur: 0,
        documentCount: 0,
      };
      cur.totalEur += monthly;
      cur.documentCount += 1;
      seriesMap.set(key, cur);
    }
  }

  const series = [...seriesMap.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  return {
    monthlyTotalEur: Math.round(monthlyTotal * 100) / 100,
    annualTotalEur: Math.round(monthlyTotal * 12 * 100) / 100,
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
  if (rel.type === "covers_same_risk" || rel.type === "same_guarantee") {
    return null; // inconnu sans montant
  }
  if (rel.type === "duplicate_of") return null;
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
    duplicate_of: { kind: "duplicate", title: "Document en doublon" },
    covers_same_risk: {
      kind: "redundant_insurance",
      title: "Assurance / risque redondant",
    },
    same_guarantee: {
      kind: "redundant_insurance",
      title: "Garantie déjà couverte",
    },
    redundant_payment: {
      kind: "redundant_payment",
      title: "Paiement potentiellement en double",
    },
    contradicts_clause: {
      kind: "contradiction",
      title: "Contradiction contractuelle",
    },
    obsoletes_fact: {
      kind: "obsolete_fact",
      title: "Information obsolète à mettre à jour",
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
    if (!fromDoc) continue;

    const peer = toDoc?.displayName || toDoc?.fileName || "autre document";
    out.push({
      id: `save:${pairKey}`,
      kind: meta.kind,
      title: meta.title,
      message: `Lien « ${rel.type} » avec « ${peer} » (score ${Math.round(rel.score * 100)}%).`,
      estimatedMonthlySavingEur: estimateSaving(rel),
      relationType: rel.type,
      relationId: rel.id,
      score: rel.score,
      historyId: fromDoc.historyId,
      secondaryHistoryId: toDoc?.historyId ?? null,
      documentId: fromDoc.documentId,
      documentTitle: fromDoc.displayName || fromDoc.fileName,
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
        title = "Résilier un contrat redondant";
        reason =
          "La mémoire a détecté une couverture ou un document en doublon.";
        break;
      case "redundant_payment":
        letterType = "remboursement";
        title = "Demander un remboursement / régularisation";
        reason = "Paiement potentiellement en double détecté.";
        break;
      case "contradiction":
        letterType = "contestation";
        title = "Contester une clause contradictoire";
        reason = "Deux documents présentent des clauses incompatibles.";
        break;
      case "obsolete_fact":
        letterType = "reponse_administrative";
        title = "Signaler un changement (adresse / tarif)";
        reason =
          "Un fait obsolète (adresse, tarif…) a été détecté entre documents.";
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
      `${subs.length} abonnement(s) reconstruits depuis vos PDF — pas une estimation chat`,
      `${savings.length} piste(s) d’économie issues de relations entre documents`,
      `${contradictionCount} contradiction(s) clause-à-clause détectée(s)`,
      `Timeline et contreparties sur ${corpus} document(s) indexés`,
      digest.summary,
    ],
  };
}
