import { AppError } from "@/lib/errors";

export function stripModelNoise(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
}

/** Répare les erreurs JSON fréquentes des petits modèles locaux. */
export function repairJsonText(raw: string): string {
  let text = raw.trim();

  text = text
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Trailing commas
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Virgule orpheline avant fermeture d'objet tronqué
  text = text.replace(/,\s*$/g, "");

  // Clé partielle en fin de génération (ex. "mitigat)
  text = text.replace(/,\s*"[^"]*$/g, "");

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
      "La réponse du modèle n'est pas un JSON valide.",
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
      throw new AppError(
        "ANALYSIS_FAILED",
        "Impossible d'interpréter la réponse JSON du modèle. Réessaie — le modèle a renvoyé un format invalide.",
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
