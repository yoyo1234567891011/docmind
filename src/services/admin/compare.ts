import { generateWithOllama } from "@/ai/models/client";
import { resolveTaskConfig } from "@/services/admin/config-store";
import {
  getPromptVersion,
  renderPromptTemplate,
} from "@/services/admin/prompts-store";
import type { AdminPromptKey } from "@/types/admin";

export interface PromptDiffLine {
  type: "same" | "added" | "removed";
  text: string;
  lineNoA?: number;
  lineNoB?: number;
}

/**
 * Simple line diff for Admin prompt comparison (no external deps).
 */
export function diffPromptLines(a: string, b: string): PromptDiffLine[] {
  const left = a.replace(/\r\n/g, "\n").split("\n");
  const right = b.replace(/\r\n/g, "\n").split("\n");
  const rows: PromptDiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({
        type: "same",
        text: left[i],
        lineNoA: i + 1,
        lineNoB: j + 1,
      });
      i += 1;
      j += 1;
      continue;
    }

    const lookAhead = 8;
    let matched = false;
    for (let d = 1; d <= lookAhead; d += 1) {
      if (j + d < right.length && i < left.length && left[i] === right[j + d]) {
        for (let k = 0; k < d; k += 1) {
          rows.push({ type: "added", text: right[j + k], lineNoB: j + k + 1 });
        }
        j += d;
        matched = true;
        break;
      }
      if (i + d < left.length && j < right.length && left[i + d] === right[j]) {
        for (let k = 0; k < d; k += 1) {
          rows.push({ type: "removed", text: left[i + k], lineNoA: i + k + 1 });
        }
        i += d;
        matched = true;
        break;
      }
    }

    if (matched) continue;

    if (i < left.length) {
      rows.push({ type: "removed", text: left[i], lineNoA: i + 1 });
      i += 1;
    }
    if (j < right.length) {
      rows.push({ type: "added", text: right[j], lineNoB: j + 1 });
      j += 1;
    }
  }

  return rows;
}

export async function comparePromptOutputs(input: {
  key: AdminPromptKey;
  versionIdA: string;
  versionIdB: string;
  sampleText: string;
  vars?: Record<string, string>;
}): Promise<{
  promptA: string;
  promptB: string;
  outputA: string;
  outputB: string;
  durationAMs: number;
  durationBMs: number;
  model: string;
}> {
  const versionA = await getPromptVersion(input.versionIdA);
  const versionB = await getPromptVersion(input.versionIdB);
  if (!versionA || !versionB) {
    throw new Error("Une des versions de prompt est introuvable.");
  }

  const baseVars = {
    documentText: input.sampleText,
    query: input.sampleText,
    categoriesList: "",
    schema: "{}",
    checklist: "",
    focusList: "",
    categoryLabel: "Document",
    analysisContext: "{}",
    ...(input.vars ?? {}),
  };

  const promptA = renderPromptTemplate(versionA.content, baseVars);
  const promptB = renderPromptTemplate(versionB.content, baseVars);

  const task =
    input.key === "classification"
      ? "classify"
      : input.key === "reply"
        ? "reply"
        : input.key === "searchIntent"
          ? "searchIntent"
          : "analyze";

  const config = await resolveTaskConfig(task);

  const startedA = Date.now();
  const generatedA = await generateWithOllama({
    prompt: promptA,
    model: config.model,
    temperature: config.temperature,
    baseUrl: config.ollamaBaseUrl,
  });
  const outputA = generatedA.text;
  const durationAMs = Date.now() - startedA;

  const startedB = Date.now();
  const generatedB = await generateWithOllama({
    prompt: promptB,
    model: config.model,
    temperature: config.temperature,
    baseUrl: config.ollamaBaseUrl,
  });
  const outputB = generatedB.text;
  const durationBMs = Date.now() - startedB;

  return {
    promptA,
    promptB,
    outputA,
    outputB,
    durationAMs,
    durationBMs,
    model: config.model,
  };
}
