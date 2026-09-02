import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { hasEntitlement } from "@/services/billing/entitlements";
import { draftLetterForHistory } from "@/services/reply/draft";
import { suggestLetterType } from "@/services/reply/suggest-type";
import { getHistoryRecord } from "@/services/history";
import {
  assertQuotaAvailable,
  consumeQuota,
  getQuotaStatus,
  pickQuotaItem,
  refundQuota,
} from "@/services/quotas/enforce";
import { LETTER_TYPES, type LetterType } from "@/types";

export const runtime = "nodejs";

/**
 * POST /api/letters
 * Body: { historyId: string, letterType?: LetterType | "auto", persist?: boolean }
 *
 * Plans payants uniquement — 1 courrier réussi = 1 unité du quota analyses.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const canLetter = await hasEntitlement(user.id, "letter_agent", {
      reconcile: true,
    });
    if (!canLetter) {
      throw new AppError(
        "FORBIDDEN",
        "L’agent courrier est inclus à partir d’un plan payant. Choisissez une offre depuis Facturation.",
        403,
      );
    }

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

    const historyId = body.historyId.trim();
    await getHistoryRecord(user.id, historyId);
    await assertQuotaAvailable(user.id, "analyze");
    await consumeQuota(user.id, "analyze");

    try {
      const result = await draftLetterForHistory({
        userId: user.id,
        historyId,
        letterType,
        persist: body.persist !== false,
      });
      return apiSuccess(result);
    } catch (error) {
      await refundQuota(user.id, "analyze").catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * GET /api/letters?historyId=
 * Suggère le type de courrier sans générer ni consommer de quota.
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
    const quotas = await getQuotaStatus(user.id);
    const analyze = pickQuotaItem(quotas, "analyze");
    const canGenerate =
      canLetter &&
      analyze != null &&
      (analyze.unlimited || analyze.remaining > 0);

    return apiSuccess({
      historyId,
      suggestion,
      currentLetter: canLetter ? (record.readyReply ?? null) : null,
      premiumRequired: !canLetter,
      canGenerate,
      analyzeQuota: canLetter
        ? analyze
          ? {
              used: analyze.used,
              limit: analyze.limit,
              remaining: analyze.unlimited ? null : analyze.remaining,
            }
          : null
        : null,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
