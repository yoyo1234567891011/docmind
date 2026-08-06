import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { hasEntitlement } from "@/services/billing/entitlements";
import { draftLetterForHistory } from "@/services/reply/draft";
import { suggestLetterType } from "@/services/reply/suggest-type";
import { getHistoryRecord } from "@/services/history";
import { consumeQuota } from "@/services/quotas/enforce";
import { LETTER_TYPES, type LetterType } from "@/types";

export const runtime = "nodejs";

/**
 * POST /api/letters
 * Body: { historyId: string, letterType?: LetterType | "auto", persist?: boolean }
 *
 * Agent de rédaction de courrier à partir des infos extraites du document.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    pruneRateLimitBuckets();
    const limited = await checkRateLimitAsync({
      key: `letters:${user.id}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop de courriers. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }
    const body = (await request.json()) as {
      historyId?: string;
      letterType?: LetterType | "auto";
      persist?: boolean;
    };

    if (!body?.historyId?.trim()) {
      throw new AppError("BAD_REQUEST", "historyId est requis.");
    }

    const letterType = body.letterType ?? "auto";
    if (
      letterType !== "auto" &&
      !(LETTER_TYPES as string[]).includes(letterType)
    ) {
      throw new AppError("BAD_REQUEST", "Type de courrier invalide.");
    }

    // Valide ownership avant consommation de quota
    await getHistoryRecord(user.id, body.historyId.trim());
    await consumeQuota(user.id, "letter");

    const result = await draftLetterForHistory({
      userId: user.id,
      historyId: body.historyId.trim(),
      letterType,
      persist: body.persist !== false,
    });

    return apiSuccess(result);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * GET /api/letters?historyId=
 * Suggère le type de courrier sans générer.
 * Le corps du courrier n’est renvoyé qu’aux comptes Premium.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const historyId = searchParams.get("historyId")?.trim();

    if (!historyId) {
      throw new AppError("BAD_REQUEST", "historyId est requis.");
    }

    const record = await getHistoryRecord(user.id, historyId);
    const suggestion = suggestLetterType(
      record.extractedText || "",
      record.analysis,
      record.classification,
    );
    const canLetter = await hasEntitlement(user.id, "letter_agent", {
      reconcile: true,
    });

    return apiSuccess({
      historyId,
      suggestion,
      currentLetter: canLetter ? (record.readyReply ?? null) : null,
      premiumRequired: !canLetter,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
