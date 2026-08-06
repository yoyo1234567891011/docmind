import type { ApiResponse } from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";

export async function deleteAccount(): Promise<{
  deleted: boolean;
  dataRemoved: boolean;
  uploadsRemoved: boolean;
  stripeCanceled: boolean;
  authDeleted: boolean;
  message: string;
}> {
  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ confirm: "DELETE" }),
    credentials: "same-origin",
  });
  const payload = (await response.json()) as ApiResponse<{
    deleted: boolean;
    dataRemoved: boolean;
    uploadsRemoved: boolean;
    stripeCanceled: boolean;
    authDeleted: boolean;
    message: string;
  }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

/** Télécharge l’export ZIP RGPD (Art. 20). */
export async function downloadAccountExport(): Promise<void> {
  const response = await fetch("/api/account/export", {
    cache: "no-store",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = "Export impossible.";
    try {
      const payload = (await response.json()) as ApiResponse<unknown>;
      if (!payload.success) message = payload.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match?.[1] || "docmind-export.zip";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
