import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { listDocumentAlerts } from "@/services/alerts";
import {
  buildAlertId,
  markAlertsDismissed,
  markAlertsRead,
  markAllAlertsRead,
  pinAlert,
} from "@/services/alerts/state";
import { getHistoryRecord } from "@/services/history";
import type {
  AlertKind,
  AlertPriority,
  AlertSeverity,
  DocumentAlert,
} from "@/types";

export const runtime = "nodejs";

const KINDS: AlertKind[] = [
  "deadline_soon",
  "high_risk",
  "action_required",
  "renewal",
  "termination",
  "important_payment",
  "analysis_ready",
  "relation_duplicate",
  "relation_supersede",
  "relation_overlap_risk",
  "relation_redundant_payment",
  "relation_deadline_conflict",
  "relation_contradiction",
];

const MANUAL_KINDS = [
  "deadline_soon",
  "renewal",
  "important_payment",
  "termination",
] as const satisfies readonly AlertKind[];

type ManualKind = (typeof MANUAL_KINDS)[number];

function isManualKind(value: string): value is ManualKind {
  return (MANUAL_KINDS as readonly string[]).includes(value);
}

function severityForKind(kind: ManualKind): AlertSeverity {
  return kind === "important_payment" ? "warning" : "info";
}

function priorityForKind(kind: ManualKind): AlertPriority {
  switch (kind) {
    case "important_payment":
    case "termination":
      return "haute";
    case "renewal":
      return "moyenne";
    default:
      return "moyenne";
  }
}

/**
 * GET /api/alerts?kind=&includeDismissed=
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const kindParam = searchParams.get("kind");
    const kind =
      kindParam && (KINDS as string[]).includes(kindParam)
        ? (kindParam as AlertKind)
        : "all";
    const includeDismissed = searchParams.get("includeDismissed") === "1";

    const result = await listDocumentAlerts(user.id, {
      kind,
      includeDismissed,
    });
    return apiSuccess(result);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * POST /api/alerts — rappel manuel (préavis / renouvellement / paiement).
 * N’envoie aucun e-mail (in-app + préférences email déjà préparées).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as {
      historyId?: string;
      kind?: string;
      dueDate?: string;
      note?: string;
    };

    const historyId =
      typeof body.historyId === "string" ? body.historyId.trim() : "";
    if (!historyId) {
      throw new AppError("BAD_REQUEST", "historyId requis.");
    }
    if (!body.kind || !isManualKind(body.kind)) {
      throw new AppError(
        "BAD_REQUEST",
        "kind invalide (deadline_soon | renewal | important_payment | termination).",
      );
    }
    const dueDate =
      typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new AppError("BAD_REQUEST", "dueDate requise (YYYY-MM-DD).");
    }

    const record = await getHistoryRecord(user.id, historyId);
    const kind = body.kind;
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 280) : "";
    const titleByKind: Record<ManualKind, string> = {
      deadline_soon: "Rappel d’échéance",
      renewal: "Rappel de renouvellement",
      important_payment: "Rappel de paiement",
      termination: "Rappel de préavis / résiliation",
    };
    const recommendedByKind: Record<ManualKind, string> = {
      deadline_soon: "Vérifier l’échéance et l’action à mener.",
      renewal: "Anticiper le renouvellement ou le préavis.",
      important_payment: "Préparer le paiement ou la contestation.",
      termination: "Respecter le préavis avant la date limite.",
    };

    const alert: DocumentAlert = {
      id: buildAlertId(historyId, `manual_${kind}`, `${dueDate}:${note}`),
      kind,
      severity: severityForKind(kind),
      priority: priorityForKind(kind),
      title: titleByKind[kind],
      message:
        note ||
        `Rappel manuel pour le ${dueDate} — ${record.analysis?.title || record.fileName}.`,
      historyId,
      documentTitle: record.analysis?.title || record.fileName || "Document",
      fileName: record.fileName || "",
      evidence: note ? [note] : [],
      date: dueDate,
      dueDate,
      recommendedAction: recommendedByKind[kind],
      createdAt: new Date().toISOString(),
      read: false,
      dismissed: false,
    };

    await pinAlert(user.id, alert);
    return apiSuccess({ alert });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * PATCH /api/alerts
 * Body: { action: "read" | "dismiss" | "read_all", ids?: string[] }
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as {
      action?: "read" | "dismiss" | "read_all";
      ids?: string[];
    };

    if (!body.action) {
      throw new AppError("BAD_REQUEST", "Le champ action est requis.");
    }

    if (body.action === "read_all") {
      const current = await listDocumentAlerts(user.id, {
        includeDismissed: false,
      });
      const state = await markAllAlertsRead(
        user.id,
        current.alerts.map((a) => a.id),
      );
      return apiSuccess({ state, updated: current.alerts.length });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id) => typeof id === "string" && id.trim())
      : [];

    if (ids.length === 0) {
      throw new AppError("BAD_REQUEST", "Au moins un id d'alerte est requis.");
    }

    if (body.action === "read") {
      const state = await markAlertsRead(user.id, ids);
      return apiSuccess({ state, updated: ids.length });
    }

    if (body.action === "dismiss") {
      const state = await markAlertsDismissed(user.id, ids);
      return apiSuccess({ state, updated: ids.length });
    }

    throw new AppError("BAD_REQUEST", "Action non supportée.");
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
