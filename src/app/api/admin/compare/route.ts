import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  comparePromptOutputs,
  diffPromptLines,
  getPromptVersion,
} from "@/services/admin";
import type { AdminPromptKey } from "@/types/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as {
      versionIdA?: unknown;
      versionIdB?: unknown;
      mode?: unknown;
      sampleText?: unknown;
      key?: unknown;
    };

    if (typeof body.versionIdA !== "string" || typeof body.versionIdB !== "string") {
      throw new AppError("BAD_REQUEST", "versionIdA et versionIdB sont requis.");
    }

    const versionA = await getPromptVersion(body.versionIdA);
    const versionB = await getPromptVersion(body.versionIdB);
    if (!versionA || !versionB) {
      throw new AppError("NOT_FOUND", "Version de prompt introuvable.", 404);
    }

    const mode = body.mode === "run" ? "run" : "diff";

    if (mode === "diff") {
      return apiSuccess({
        mode: "diff",
        versionA,
        versionB,
        lines: diffPromptLines(versionA.content, versionB.content),
      });
    }

    if (typeof body.sampleText !== "string" || !body.sampleText.trim()) {
      throw new AppError(
        "BAD_REQUEST",
        "sampleText est requis pour comparer les sorties modèle.",
      );
    }

    const key = (body.key as AdminPromptKey) || versionA.key;
    const result = await comparePromptOutputs({
      key,
      versionIdA: body.versionIdA,
      versionIdB: body.versionIdB,
      sampleText: body.sampleText.trim(),
    });

    return apiSuccess({
      mode: "run",
      versionA,
      versionB,
      ...result,
      outputDiff: diffPromptLines(result.outputA, result.outputB),
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
