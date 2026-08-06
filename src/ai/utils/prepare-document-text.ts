/**
 * Limite le texte envoyé aux LLM pour une analyse rapide
 * tout en gardant début, fin, et lignes « chaudes » (montants, délais, risques).
 */
export const LLM_DOCUMENT_CHAR_BUDGET = 8_000;

const HOT_LINE =
  /(?:€|eur(?:os?)?|\bttc\b|\bht\b|\btva\b|\béchéance|\becheance|\bdélai|\bdelai|\bpréavis|\bpreavis|\brésil|\bresil|\bpénal|\bpenal|\bloyer|\bsalaire|\bprime|\bfranchise|\biban|\bfacture|\bbail|\bcontrat|\bavis\s+d)/i;

function collectHotLines(text: string, maxChars: number): string {
  const lines = text.split(/\r?\n/);
  const picked: string[] = [];
  let used = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 8 || trimmed.length > 220) continue;
    if (!HOT_LINE.test(trimmed)) continue;
    if (used + trimmed.length + 1 > maxChars) break;
    picked.push(trimmed);
    used += trimmed.length + 1;
  }

  return picked.join("\n");
}

export function prepareDocumentTextForLlm(
  text: string,
  budget = LLM_DOCUMENT_CHAR_BUDGET,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return trimmed;

  const hotBudget = Math.min(1_800, Math.floor(budget * 0.22));
  const hot = collectHotLines(trimmed, hotBudget);
  const remaining = budget - (hot ? hot.length + 60 : 0);
  const head = Math.floor(remaining * 0.68);
  const tail = Math.max(400, remaining - head - 40);

  const parts = [
    trimmed.slice(0, head).trimEnd(),
    "",
    "[… extrait intermédiaire omis …]",
  ];

  if (hot) {
    parts.push("", "[Extraits clés]", hot);
  }

  parts.push(
    "",
    "[… fin du document …]",
    "",
    trimmed.slice(-tail).trimStart(),
  );

  return parts.join("\n");
}

/** Texte court pour classification LLM (si l’heuristique échoue). */
export function prepareDocumentTextForClassify(text: string): string {
  return prepareDocumentTextForLlm(text, 2_500);
}
