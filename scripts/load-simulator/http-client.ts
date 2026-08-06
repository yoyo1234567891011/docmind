import { readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import type { AuthMode } from "./types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class LoadHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: AuthMode,
    private readonly evalApiKey?: string,
    private sessionAccessToken?: string,
  ) {}

  withToken(token: string): LoadHttpClient {
    return new LoadHttpClient(
      this.baseUrl,
      this.auth,
      this.evalApiKey,
      token,
    );
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    if (this.auth === "eval" && this.evalApiKey) {
      h["x-eval-api-key"] = this.evalApiKey;
    }
    if (this.auth === "supabase" && this.sessionAccessToken) {
      h.Authorization = `Bearer ${this.sessionAccessToken}`;
    }
    return h;
  }

  async health(): Promise<{ ok: boolean; status: string }> {
    const res = await fetch(`${this.baseUrl}/api/health`, {
      cache: "no-store",
    });
    const body = (await res.json()) as { status?: string };
    return { ok: res.ok, status: body.status ?? String(res.status) };
  }

  async uploadPdf(filePath: string): Promise<{
    documentId: string;
    fileName: string;
    text: string;
    pages?: string[];
    durationMs: number;
  }> {
    const started = Date.now();
    const bytes = await readFile(filePath);
    const fileName = path.basename(filePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      fileName,
    );
    const res = await fetch(`${this.baseUrl}/api/upload`, {
      method: "POST",
      headers: this.headers(false),
      body: form,
    });
    const payload = (await res.json()) as ApiEnvelope<{
      document: { id: string; fileName: string };
      extraction: { text: string; pages?: string[] };
    }>;
    if (!res.ok || !payload.success || !payload.data) {
      throw new Error(
        payload.error?.message || `Upload failed (${res.status})`,
      );
    }
    return {
      documentId: payload.data.document.id,
      fileName: payload.data.document.fileName,
      text: payload.data.extraction.text,
      pages: payload.data.extraction.pages,
      durationMs: Date.now() - started,
    };
  }

  async analyzeProgressive(input: {
    documentId: string;
    text: string;
    fileName: string;
    pages?: string[];
  }): Promise<{
    historyId?: string;
    phase?: string;
    durationMs: number;
    documentType?: string;
    resultSource?: string;
  }> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/api/analyze`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        documentId: input.documentId,
        text: input.text,
        fileName: input.fileName,
        pages: input.pages,
        skipReadyReply: true,
        mode: "progressive",
      }),
    });
    const payload = (await res.json()) as ApiEnvelope<{
      historyId?: string;
      phase?: string;
      durationMs?: number;
      resultSource?: string;
      analysis?: { document_type?: string; resultSource?: string };
    }>;
    if (!res.ok || !payload.success || !payload.data) {
      throw new Error(
        payload.error?.message || `Analyze failed (${res.status})`,
      );
    }
    return {
      historyId: payload.data.historyId,
      phase: payload.data.phase,
      durationMs: payload.data.durationMs ?? Date.now() - started,
      documentType: payload.data.analysis?.document_type,
      resultSource:
        payload.data.resultSource ??
        payload.data.analysis?.resultSource,
    };
  }

  async waitHistoryComplete(input: {
    historyId: string;
    timeoutMs: number;
    pollIntervalMs: number;
  }): Promise<{ durationMs: number; timeout: boolean; phase?: string }> {
    const started = Date.now();
    while (Date.now() - started < input.timeoutMs) {
      const res = await fetch(
        `${this.baseUrl}/api/history/${encodeURIComponent(input.historyId)}`,
        { headers: this.headers(false), cache: "no-store" },
      );
      const payload = (await res.json()) as ApiEnvelope<{
        analysisPhase?: string;
      }>;
      if (res.ok && payload.success && payload.data?.analysisPhase === "complete") {
        return {
          durationMs: Date.now() - started,
          timeout: false,
          phase: "complete",
        };
      }
      await sleep(input.pollIntervalMs);
    }
    return {
      durationMs: Date.now() - started,
      timeout: true,
      phase: "preview",
    };
  }

  async listHistory(): Promise<{ durationMs: number; count: number }> {
    const started = Date.now();
    const res = await fetch(`${this.baseUrl}/api/history`, {
      headers: this.headers(false),
      cache: "no-store",
    });
    const payload = (await res.json()) as ApiEnvelope<{
      items?: unknown[];
      records?: unknown[];
    }>;
    if (!res.ok || !payload.success) {
      throw new Error(
        payload.error?.message || `History failed (${res.status})`,
      );
    }
    const items = payload.data?.items ?? payload.data?.records ?? [];
    return {
      durationMs: Date.now() - started,
      count: Array.isArray(items) ? items.length : 0,
    };
  }
}

export async function signupSupabaseUser(input: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}): Promise<{ userId: string; accessToken: string }> {
  const res = await fetch(
    `${input.supabaseUrl.replace(/\/$/, "")}/auth/v1/signup`,
    {
      method: "POST",
      headers: {
        apikey: input.anonKey,
        Authorization: `Bearer ${input.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
      }),
    },
  );
  const body = (await res.json()) as {
    access_token?: string;
    user?: { id?: string };
    id?: string;
    msg?: string;
    error_description?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      body.msg ||
        body.error_description ||
        body.message ||
        `Signup failed (${res.status})`,
    );
  }
  // Email confirm may disable session — try login
  if (!body.access_token) {
    const login = await fetch(
      `${input.supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: input.anonKey,
          Authorization: `Bearer ${input.anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
        }),
      },
    );
    const loginBody = (await login.json()) as {
      access_token?: string;
      user?: { id?: string };
      msg?: string;
    };
    if (!login.ok || !loginBody.access_token) {
      throw new Error(
        loginBody.msg ||
          "Signup OK but no session (email confirmation required?). Use --auth eval.",
      );
    }
    return {
      userId: loginBody.user?.id || randomUUID(),
      accessToken: loginBody.access_token,
    };
  }
  return {
    userId: body.user?.id || body.id || randomUUID(),
    accessToken: body.access_token,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
