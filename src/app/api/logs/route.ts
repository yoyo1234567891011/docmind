import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { toPublicAnalysisLog } from "@/services/beta";
import { readAnalysisLogs } from "@/services/logs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 100;
    const onlyErrors = searchParams.get("errors") === "1";
    const category = searchParams.get("category");
    // raw=1 réservé admin local / debug — sinon vue sanitizée bêta
    const raw = searchParams.get("raw") === "1" && user.isLocalDev;

    const file = await readAnalysisLogs(user.id);
    let entries = file.entries;
    if (onlyErrors) {
      entries = entries.filter((e) => !e.ok);
    }
    if (category && category !== "all") {
      entries = entries.filter((e) => e.category === category);
    }

    const sliced = entries.slice(0, limit);

    return apiSuccess({
      total: entries.length,
      entries: raw ? sliced : sliced.map(toPublicAnalysisLog),
      sanitized: !raw,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
