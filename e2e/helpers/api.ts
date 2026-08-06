import fs from "fs";
import path from "path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { evalApiKey } from "./env";

const SAMPLE_PDF = path.join(__dirname, "..", "fixtures", "sample.pdf");

export async function ensureSamplePdf(): Promise<string> {
  if (!fs.existsSync(SAMPLE_PDF)) {
    throw new Error(
      "sample.pdf manquant — lancer npm run e2e:prepare avant les tests.",
    );
  }
  return SAMPLE_PDF;
}

/** CSRF + cookies navigateur (session local-dev ou Supabase). */
export async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const res = await page.request.get("/api/csrf");
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as {
    success: boolean;
    data?: { token?: string; headerName?: string };
  };
  expect(json.success).toBe(true);
  const token = json.data?.token;
  expect(token).toBeTruthy();
  const headerName = json.data?.headerName || "x-csrf-token";
  return { [headerName]: token! };
}

export function evalHeaders(): Record<string, string> {
  const key = evalApiKey();
  return key ? { "x-eval-api-key": key } : {};
}

export async function apiJson<T>(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  options?: {
    headers?: Record<string, string>;
    data?: unknown;
    multipart?: Record<string, unknown>;
  },
): Promise<{ status: number; body: T }> {
  const res = await request.fetch(url, {
    method,
    headers: options?.headers,
    data: options?.data as never,
    multipart: options?.multipart as never,
  });
  const body = (await res.json()) as T;
  return { status: res.status(), body };
}

export async function uploadPdf(
  page: Page,
  filePath?: string,
): Promise<{ documentId: string; text: string; fileName: string }> {
  const pdf = filePath || (await ensureSamplePdf());
  const headers = {
    ...(await csrfHeaders(page)),
    ...evalHeaders(),
  };
  const res = await page.request.post("/api/upload", {
    headers,
    multipart: {
      file: {
        name: path.basename(pdf),
        mimeType: "application/pdf",
        buffer: fs.readFileSync(pdf),
      },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as {
    success: boolean;
    data?: {
      document?: { id?: string; fileName?: string };
      extraction?: { text?: string };
      documentId?: string;
      text?: string;
      fileName?: string;
    };
    error?: { message?: string };
  };
  expect(json.success, json.error?.message).toBe(true);
  const documentId = json.data?.document?.id || json.data?.documentId;
  const text = json.data?.extraction?.text || json.data?.text || "";
  const fileName =
    json.data?.document?.fileName || json.data?.fileName || "sample.pdf";
  expect(documentId).toBeTruthy();
  return { documentId: documentId!, text, fileName };
}

export async function analyzeDocument(
  page: Page,
  input: {
    documentId: string;
    text: string;
    fileName?: string;
    mode?: "full" | "progressive";
  },
): Promise<{
  resultSource?: string;
  historyId?: string;
  classification?: { category?: string };
  analysis?: { document_type?: string; summary?: string };
  durationMs?: number;
}> {
  const headers = {
    "Content-Type": "application/json",
    ...(await csrfHeaders(page)),
    ...evalHeaders(),
  };
  const res = await page.request.post("/api/analyze", {
    headers,
    data: {
      documentId: input.documentId,
      text: input.text,
      fileName: input.fileName,
      mode: input.mode ?? "full",
      skipReadyReply: true,
    },
    timeout: 300_000,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as {
    success: boolean;
    data?: {
      resultSource?: string;
      historyId?: string;
      classification?: { category?: string };
      analysis?: { document_type?: string; summary?: string };
      durationMs?: number;
    };
    error?: { message?: string };
  };
  expect(json.success, json.error?.message).toBe(true);
  return json.data!;
}

export async function healthOllamaOk(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/health");
  if (!res.ok()) return false;
  const json = (await res.json()) as { status?: string; ok?: boolean };
  return json.status === "ok" || json.ok === true;
}
