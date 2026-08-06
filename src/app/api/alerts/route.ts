import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { listDocumentAlerts } from "@/services/alerts";
import {
  markAlertsDismissed,
  markAlertsRead,
  markAllAlertsRead,
} from "@/services/alerts/state";
import type { AlertKind } from "@/types";

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
