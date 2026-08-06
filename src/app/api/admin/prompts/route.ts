import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  createPromptVersion,
  deletePromptVersion,
  readAdminPrompts,
  rollbackToPromptVersion,
} from "@/services/admin";
import type { AdminPromptKey } from "@/types/admin";

export const runtime = "nodejs";

const KEYS: AdminPromptKey[] = [
  "classification",
  "analysis",
  "reply",
  "searchIntent",
];

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const prompts = await readAdminPrompts();
    return apiSuccess(prompts);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * Create a NEW immutable version (never overwrites).
 * Body: { key, label, content, note?, parentId?, activate? }
 * Or rollback: { action: "rollback", versionId }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const body = (await request.json()) as {
      action?: unknown;
      versionId?: unknown;
      id?: unknown;
      key?: unknown;
      label?: unknown;
      content?: unknown;
      note?: unknown;
      parentId?: unknown;
      activate?: unknown;
    };

    if (body.action === "rollback") {
      if (typeof body.versionId !== "string" || !body.versionId.trim()) {
        throw new AppError("BAD_REQUEST", "versionId requis pour le rollback.");
      }
      const version = await rollbackToPromptVersion(body.versionId.trim());
      return apiSuccess({ version, rolledBack: true });
    }

    if (typeof body.key !== "string" || !KEYS.includes(body.key as AdminPromptKey)) {
      throw new AppError("BAD_REQUEST", "Clé de prompt invalide.");
    }
    if (typeof body.label !== "string" || !body.label.trim()) {
      throw new AppError("BAD_REQUEST", "Le label est requis.");
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      throw new AppError("BAD_REQUEST", "Le contenu du prompt est requis.");
    }

    const parentId =
      typeof body.parentId === "string"
        ? body.parentId
        : typeof body.id === "string"
          ? body.id
          : null;

    const version = await createPromptVersion({
      key: body.key as AdminPromptKey,
      label: body.label.trim(),
      content: body.content,
      note: typeof body.note === "string" ? body.note : undefined,
      parentId,
      activate: body.activate !== false,
    });

    return apiSuccess({ version });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      throw new AppError("BAD_REQUEST", "Paramètre id requis.");
    }
    await deletePromptVersion(id);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
