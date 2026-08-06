import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { reanalyzeHistoryRecord } from "@/services/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = (await request.json()) as {
      historyId?: unknown;
      skipReadyReply?: unknown;
    };

    if (typeof body.historyId !== "string" || !body.historyId.trim()) {
      throw new AppError("BAD_REQUEST", "historyId est requis.");
    }

    const record = await reanalyzeHistoryRecord(
      user.id,
      body.historyId.trim(),
      {
        skipReadyReply: Boolean(body.skipReadyReply),
      },
    );

    return apiSuccess({ record });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
