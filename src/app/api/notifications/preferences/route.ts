import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  readNotificationPreferences,
  updateNotificationPreferences,
} from "@/services/notifications";
import type { NotificationKind, NotificationPreferences } from "@/types/notification";

export const runtime = "nodejs";

const KINDS: NotificationKind[] = [
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

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const preferences = await readNotificationPreferences(user.id);
    return apiSuccess({
      preferences: {
        ...preferences,
        emailAddress: preferences.emailAddress || user.email,
      },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as Partial<NotificationPreferences> & {
      kinds?: Partial<Record<NotificationKind, boolean>>;
    };

    const kindsPatch: Partial<Record<NotificationKind, boolean>> = {};
    if (body.kinds && typeof body.kinds === "object") {
      for (const kind of KINDS) {
        if (typeof body.kinds[kind] === "boolean") {
          kindsPatch[kind] = body.kinds[kind];
        }
      }
    }

    const preferences = await updateNotificationPreferences(user.id, {
      inAppEnabled:
        typeof body.inAppEnabled === "boolean" ? body.inAppEnabled : undefined,
      emailEnabled:
        typeof body.emailEnabled === "boolean" ? body.emailEnabled : undefined,
      emailAddress:
        body.emailAddress === undefined
          ? undefined
          : body.emailAddress === null
            ? null
            : String(body.emailAddress),
      kinds: Object.keys(kindsPatch).length > 0 ? kindsPatch : undefined,
    });

    if (
      body.emailEnabled === true &&
      !preferences.emailAddress &&
      !user.email
    ) {
      throw new AppError(
        "BAD_REQUEST",
        "Indiquez une adresse email pour activer les notifications email.",
      );
    }

    return apiSuccess({ preferences });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
