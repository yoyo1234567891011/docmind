import { AppError } from "@/lib/errors";

export type JsonParseFailureReason =
  | "empty"
  | "strip_no_object"
  | "json_parse"
  | "truncated_unclosed";

/** Retire thinking / fences / bruit modèle avant extract JSON. */
export function stripModelNoise(raw: string): string {
  let text = typeof raw === "string" ? raw : "";
  // Blocs thinking fermés
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Thinking non fermé : couper jusqu’au premier `{` (ne pas avaler le JSON)
  text = text.replace(/<think>[\s\S]*?(?=\{)/gi, "");
  text = text.replace(/<thinking>[\s\S]*?(?=\{)/gi, "");
  text = text.replace(/<\/?think(?:ing)?>/gi, "");
  // Marqueurs raisonnement (Groq / Qwen)
  text = text.replace(
    /<\|?(?:redacted_)?reasoning\|?>[\s\S]*?<\/\|?(?:redacted_)?reasoning\|?>/gi,
    "",
  );
  text = text.replace(/<\|?(?:redacted_)?reasoning\|?>[\s\S]*?(?=\{)/gi, "");
  text = text.replace(/^\s*(?:Thinking|Reasoning)\s*:\s*/i, "");
  text = text.replace(/```(?:json)?\s*/gi, "");
  text = text.replace(/```/g, "");
  return text.trim();
}

/** Répare les erreurs JSON fréquentes des petits modèles locaux. */
export function repairJsonText(raw: string): string {
  let text = (typeof raw === "string" ? raw : "").trim();

  text = text
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Trailing commas
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Virgule orpheline avant fermeture d'objet tronqué
  text = text.replace(/,\s*$/g, "");

  // Clé partielle en fin de génération (ex. "mitigat)
  text = text.replace(/,\s*"[^"]*$/g, "");

  // Valeur string tronquée : "key": "foo → "key": "foo"
  text = text.replace(/:\s*"[^"]*$/g, ': ""');

  // Clés non quotées
  text = text.replace(
    /([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g,
    '$1"$2":',
  );

  return closeTruncatedJson(text);
}

/** Ferme guillemets / crochets / accolades si la génération a été coupée. */
export function closeTruncatedJson(raw: string): string {
  let text = raw.trim();
  if (!text) return text;

  // Compter les guillemets non échappés
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
  }
  if (inString) text += '"';

  // Retirer une virgule finale orpheline
  text = text.replace(/,\s*$/g, "");

  const opens: string[] = [];
  inString = false;
  escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") opens.push(ch);
    if (ch === "}" || ch === "]") opens.pop();
  }

  while (opens.length > 0) {
    const open = opens.pop();
    text += open === "{" ? "}" : "]";
  }

  return text;
}

/**
 * Extrait le premier objet JSON équilibré (gère les accolades imbriquées).
 */
export function extractJsonObject(raw: string): string {
  const cleaned = stripModelNoise(raw);
  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new AppError(
      "ANALYSIS_FAILED",
      "parse_error:strip_no_object — aucun objet JSON dans la réponse.",
      502,
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  // Objet tronqué → fermer ce qu'on peut
  return closeTruncatedJson(cleaned.slice(start));
}

export function diagnoseJsonParseFailure(raw: string): JsonParseFailureReason {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "empty";
  const cleaned = stripModelNoise(trimmed);
  if (!cleaned.includes("{")) return "strip_no_object";
  const start = cleaned.indexOf("{");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let closed = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        closed = true;
        break;
      }
    }
  }
  if (!closed || depth > 0) return "truncated_unclosed";
  return "json_parse";
}

export function parseJsonObject<T>(raw: string): T {
  let extracted: string;
  try {
    extracted = extractJsonObject(raw);
  } catch (error) {
    try {
      return JSON.parse(repairJsonText(stripModelNoise(raw))) as T;
    } catch {
      throw error;
    }
  }

  try {
    return JSON.parse(extracted) as T;
  } catch {
    try {
      return JSON.parse(repairJsonText(extracted)) as T;
    } catch {
      const reason = diagnoseJsonParseFailure(raw);
      throw new AppError(
        "ANALYSIS_FAILED",
        `parse_error:${reason} — Impossible d'interpréter la réponse JSON du modèle.`,
        502,
      );
    }
  }
}

/** Parse sans exception — null si impossible. */
export function tryParseJsonObject<T>(raw: string): T | null {
  try {
    return parseJsonObject<T>(raw);
  } catch {
    return null;
  }
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
