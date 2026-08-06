import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { listAppEvents } from "@/services/beta";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "100");
    const entries = await listAppEvents(limit);
    return apiSuccess({ total: entries.length, entries });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
