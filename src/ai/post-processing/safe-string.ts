/**
 * Helpers anti-crash : string attendue absente → '' ou TypeError nommé.
 */
export function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Pour chaînes .replace — ne throw jamais. */
export function safeReplace(
  value: unknown,
  searchValue: string | RegExp,
  replaceValue: string,
): string {
  return asStr(value).replace(searchValue, replaceValue);
}

/**
 * Snapshot des champs string critiques (debug last_error / logs).
 */
export function snapshotAnalysisStringFields(analysis: {
  title?: unknown;
  summary?: unknown;
  document_type?: unknown;
  date?: unknown;
  organizations?: unknown;
  amounts?: unknown;
  deadlines?: unknown;
  important_points?: unknown;
  risks?: unknown;
  actions?: unknown;
  risk_findings?: Array<{
    description?: unknown;
    excerpt?: unknown;
    why?: unknown;
    implication?: unknown;
  }>;
}): Record<string, unknown> {
  const findings = analysis.risk_findings ?? [];
  return {
    title: typeof analysis.title,
    summary: typeof analysis.summary,
    document_type: typeof analysis.document_type,
    date: typeof analysis.date,
    organizations_isArray: Array.isArray(analysis.organizations),
    amounts_isArray: Array.isArray(analysis.amounts),
    deadlines_isArray: Array.isArray(analysis.deadlines),
    important_points_isArray: Array.isArray(analysis.important_points),
    risks_isArray: Array.isArray(analysis.risks),
    actions_isArray: Array.isArray(analysis.actions),
    finding0_description: typeof findings[0]?.description,
    finding0_excerpt: typeof findings[0]?.excerpt,
    finding0_why: typeof findings[0]?.why,
    finding_count: findings.length,
  };
}

/** Annote un TypeError avec le contexte de champ pour last_error lisible. */
export function annotateReplaceTypeError(
  error: unknown,
  scope: string,
  fields: Record<string, unknown>,
): Error {
  const base =
    error instanceof Error ? error.message : "unknown TypeError";
  const undefKeys = Object.entries(fields)
    .filter(([, v]) => v === "undefined" || v === false || v === 0)
    .map(([k]) => k)
    .slice(0, 8);
  const hint =
    undefKeys.length > 0
      ? `replace on undefined field: ${undefKeys.join(",")}`
      : `replace on undefined field: (see ${scope})`;
  const err = new TypeError(`${hint} | ${base} | scope=${scope}`);
  if (error instanceof Error && error.stack) {
    err.stack = `${err.message}\n${error.stack}`;
  }
  return err;
}
