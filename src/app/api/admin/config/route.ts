import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { applyModelProfile, updateAdminConfig } from "@/services/admin";
import type { AdminPromptKey } from "@/types/admin";
import type { AiTask, ModelProfileId } from "@/ai/models/config";
import { MODEL_PROFILES } from "@/ai/models/config";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as {
      ollamaBaseUrl?: unknown;
      embedModel?: unknown;
      tasks?: unknown;
      activePrompts?: unknown;
      profileId?: unknown;
    };

    if (typeof body.profileId === "string" && body.profileId in MODEL_PROFILES) {
      const config = await applyModelProfile(body.profileId as ModelProfileId);
      return apiSuccess({ config });
    }

    const patch: Parameters<typeof updateAdminConfig>[0] = {};

    if (typeof body.ollamaBaseUrl === "string" && body.ollamaBaseUrl.trim()) {
      patch.ollamaBaseUrl = body.ollamaBaseUrl.trim().replace(/\/$/, "");
    }
    if (typeof body.embedModel === "string" && body.embedModel.trim()) {
      patch.embedModel = body.embedModel.trim();
    }

    if (body.tasks && typeof body.tasks === "object") {
      patch.tasks = body.tasks as Parameters<typeof updateAdminConfig>[0]["tasks"];
    }

    if (body.activePrompts && typeof body.activePrompts === "object") {
      patch.activePrompts = body.activePrompts as Partial<
        Record<AdminPromptKey, string | null>
      >;
    }

    if (
      !patch.ollamaBaseUrl &&
      !patch.embedModel &&
      !patch.tasks &&
      !patch.activePrompts
    ) {
      throw new AppError("BAD_REQUEST", "Aucune modification fournie.");
    }

    if (patch.tasks) {
      for (const key of Object.keys(patch.tasks)) {
        if (
          !["classify", "analyze", "reply", "searchIntent"].includes(key)
        ) {
          throw new AppError("BAD_REQUEST", `Tâche inconnue: ${key}`);
        }
        void (key as AiTask);
      }
    }

    const config = await updateAdminConfig(patch);
    return apiSuccess({ config });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
