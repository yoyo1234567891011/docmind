import { access, readFile } from "fs/promises";

import { usePersistentStorage } from "@/config/persistence";
import { assertSafeResourceId } from "@/config/paths";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { apiFromUnknownError } from "@/lib/api-response";
import { getPdfObject } from "@/lib/storage/s3";
import {
  getHistoryRecord,
  getUserPdfAbsolutePath,
  listHistoryRecords,
} from "@/services/history";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

async function readOwnedPdfBytes(
  userId: string,
  documentId: string,
): Promise<Buffer> {
  if (usePersistentStorage()) {
    return getPdfObject(userId, documentId);
  }
  const absolutePath = getUserPdfAbsolutePath(userId, documentId);
  try {
    await access(absolutePath);
  } catch {
    throw new AppError(
      "NOT_FOUND",
      "Fichier PDF introuvable sur le serveur.",
      404,
    );
  }
  return readFile(absolutePath);
}

/**
 * GET /api/documents/:documentId/file
 * Streams the owner's PDF for preview/download.
 * Ownership: history record when present, otherwise PDF key scoped to userId.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { documentId } = await context.params;
    if (!documentId?.trim()) {
      throw new AppError("BAD_REQUEST", "documentId requis.");
    }
    const id = assertSafeResourceId(documentId, "documentId");

    const records = await listHistoryRecords(user.id);
    const owned = records.find((record) => record.documentId === id);
    if (owned) {
      await getHistoryRecord(user.id, owned.id);
    }

    // Upload seul (pas encore d’historique) : le chemin storage est déjà scoped user.
    let bytes: Buffer;
    try {
      bytes = await readOwnedPdfBytes(user.id, id);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") {
        throw new AppError("NOT_FOUND", "Document introuvable.", 404);
      }
      throw error;
    }

    const rawName = owned?.fileName || `${id}.pdf`;
    const safeName =
      rawName
        .replace(/[^\w.\- ()àâäéèêëïîôùûüçŒœ]+/gi, "_")
        .replace(/["\r\n\\]/g, "")
        .slice(0, 120) || `${id}.pdf`;
    const encoded = encodeURIComponent(safeName);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
