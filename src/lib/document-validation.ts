import {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
} from "@/config/constants";
import { AppError } from "@/lib/errors";
import { formatBytes } from "@/lib/utils";
import type { ApiErrorCode } from "@/types";

export type PdfValidationResult =
  | { ok: true; file: File }
  | { ok: false; code: Extract<ApiErrorCode, "BAD_REQUEST" | "UNSUPPORTED_FILE">; message: string };

function isPdfFile(file: File): boolean {
  const mimeOk =
    !file.type ||
    (ACCEPTED_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type);
  const extensionOk = file.name.toLowerCase().endsWith(".pdf");
  // Extension obligatoire ; MIME accepté s'il est vide (certains OS) ou PDF
  return extensionOk && mimeOk;
}

export function validatePdfFile(
  file: File | null | undefined,
): PdfValidationResult {
  if (!file) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "Aucun fichier sélectionné.",
    };
  }

  if (!isPdfFile(file)) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE",
      message: "Seuls les fichiers PDF sont acceptés.",
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: `Le fichier dépasse la taille maximale (${formatBytes(MAX_UPLOAD_SIZE_BYTES)}).`,
    };
  }

  if (file.size === 0) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "Le fichier PDF est vide.",
    };
  }

  return { ok: true, file };
}

async function hasPdfSignature(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const signature = String.fromCharCode(...header);

  return signature.startsWith("%PDF");
}

export async function assertValidPdfUpload(file: File | null | undefined): Promise<File> {
  const result = validatePdfFile(file);

  if (!result.ok) {
    throw new AppError(result.code, result.message);
  }

  if (!(await hasPdfSignature(result.file))) {
    throw new AppError(
      "UNSUPPORTED_FILE",
      "Le fichier ne semble pas être un PDF valide.",
    );
  }

  return result.file;
}
