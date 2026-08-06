import { readFile } from "fs/promises";

import {
  buildBenchmarkSystemPrompt,
  buildBenchmarkUserPrompt,
  emptyPrediction,
  parseModelJson,
} from "../prompt";
import type { BenchmarkDoc, BenchmarkProviderId, ProviderPrediction } from "../types";

export interface CloudProviderConfig {
  id: BenchmarkProviderId;
  label: string;
  envKey: string;
  defaultModel: string;
  modelEnv?: string;
}

export const CLOUD_PROVIDERS: CloudProviderConfig[] = [
  {
    id: "chatgpt",
    label: "ChatGPT (OpenAI)",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    modelEnv: "BENCHMARK_OPENAI_MODEL",
  },
  {
    id: "claude",
    label: "Claude (Anthropic)",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    modelEnv: "BENCHMARK_ANTHROPIC_MODEL",
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    modelEnv: "BENCHMARK_GEMINI_MODEL",
  },
  {
    id: "mistral",
    label: "Mistral Le Chat",
    envKey: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
    modelEnv: "BENCHMARK_MISTRAL_MODEL",
  },
];

export function isCloudEnabled(cfg: CloudProviderConfig): boolean {
  // GEMINI also accepts GOOGLE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
  if (cfg.id === "gemini") {
    return Boolean(
      process.env.GEMINI_API_KEY?.trim() ||
        process.env.GOOGLE_API_KEY?.trim() ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
    );
  }
  return Boolean(process.env[cfg.envKey]?.trim());
}

export function cloudSkipReason(cfg: CloudProviderConfig): string {
  if (cfg.id === "gemini") {
    return "Définir GEMINI_API_KEY (ou GOOGLE_API_KEY)";
  }
  return `Définir ${cfg.envKey}`;
}

function modelFor(cfg: CloudProviderConfig): string {
  const fromEnv = cfg.modelEnv
    ? process.env[cfg.modelEnv]?.trim()
    : undefined;
  return fromEnv || cfg.defaultModel;
}

async function callOpenAI(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  pdfBase64?: string;
  fileName: string;
}): Promise<string> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: input.user },
  ];
  if (input.pdfBase64) {
    content.push({
      type: "file",
      file: {
        filename: input.fileName,
        file_data: `data:application/pdf;base64,${input.pdfBase64}`,
      },
    });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content },
      ],
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `OpenAI HTTP ${res.status}`);
  }
  return json.choices?.[0]?.message?.content || "";
}

async function callAnthropic(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  pdfBase64?: string;
}): Promise<string> {
  const content: Array<Record<string, unknown>> = [];
  if (input.pdfBase64) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: input.pdfBase64,
      },
    });
  }
  content.push({ type: "text", text: input.user });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 4096,
      temperature: 0,
      system: input.system,
      messages: [{ role: "user", content }],
    }),
  });
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);
  }
  return json.content?.find((c) => c.type === "text")?.text || "";
}

async function callGemini(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  pdfBase64?: string;
}): Promise<string> {
  const parts: Array<Record<string, unknown>> = [
    { text: `${input.system}\n\n${input.user}` },
  ];
  if (input.pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: "application/pdf",
        data: input.pdfBase64,
      },
    });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  }
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callMistral(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  documentText: string;
}): Promise<string> {
  // API chat : texte (Le Chat web upload n’est pas exposé de la même façon).
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: `${input.user}\n\n--- DOCUMENT ---\n${input.documentText.slice(0, 120_000)}`,
        },
      ],
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || `Mistral HTTP ${res.status}`);
  }
  return json.choices?.[0]?.message?.content || "";
}

function apiKeyFor(cfg: CloudProviderConfig): string {
  if (cfg.id === "gemini") {
    return (
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      ""
    );
  }
  return process.env[cfg.envKey]?.trim() || "";
}

/**
 * Appelle un provider cloud. Préfère PDF si supporté ; sinon texte extrait DocMind.
 */
export async function runCloudProvider(input: {
  cfg: CloudProviderConfig;
  doc: BenchmarkDoc;
  sourceText: string;
}): Promise<ProviderPrediction> {
  const { cfg, doc, sourceText } = input;
  const started = Date.now();
  const model = modelFor(cfg);
  const system = buildBenchmarkSystemPrompt();
  const user = buildBenchmarkUserPrompt(doc.fileName);

  try {
    const apiKey = apiKeyFor(cfg);
    if (!apiKey) throw new Error(cloudSkipReason(cfg));

    let raw = "";
    let inputMode: "pdf" | "text" = "text";
    const pdfBase64 = (await readFile(doc.pdfPath)).toString("base64");

    if (cfg.id === "chatgpt") {
      try {
        raw = await callOpenAI({
          apiKey,
          model,
          system,
          user,
          pdfBase64,
          fileName: doc.fileName,
        });
        inputMode = "pdf";
      } catch {
        raw = await callOpenAI({
          apiKey,
          model,
          system,
          user: `${user}\n\n--- DOCUMENT ---\n${sourceText.slice(0, 120_000)}`,
          fileName: doc.fileName,
        });
        inputMode = "text";
      }
    } else if (cfg.id === "claude") {
      raw = await callAnthropic({
        apiKey,
        model,
        system,
        user,
        pdfBase64,
      });
      inputMode = "pdf";
    } else if (cfg.id === "gemini") {
      raw = await callGemini({
        apiKey,
        model,
        system,
        user,
        pdfBase64,
      });
      inputMode = "pdf";
    } else if (cfg.id === "mistral") {
      raw = await callMistral({
        apiKey,
        model,
        system,
        user,
        documentText: sourceText,
      });
      inputMode = "text";
    }

    const { predicted, citations } = parseModelJson(raw);
    return {
      provider: cfg.id,
      predicted,
      citations,
      durationMs: Date.now() - started,
      model,
      inputMode,
    };
  } catch (error) {
    return {
      provider: cfg.id,
      predicted: emptyPrediction(),
      durationMs: Date.now() - started,
      model,
      inputMode: "text",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
