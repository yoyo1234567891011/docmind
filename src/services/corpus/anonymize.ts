/**
 * Anonymisation déterministe pour corpus d’évaluation.
 * Conserve : montants, dates, structure / clauses / mise en page (sauts de ligne, titres).
 * Remplace : emails, téléphones, IBAN/BIC, NIR, SIRET/SIREN, adresses, noms (explicites + heuristique).
 */

export type AnonymizeReplacement = {
  kind:
    | "email"
    | "phone"
    | "iban"
    | "bic"
    | "nir"
    | "siret"
    | "siren"
    | "address"
    | "person"
    | "organization"
    | "custom";
  original: string;
  replacement: string;
};

export type AnonymizeOptions = {
  /** Remplacements forcés « original=pseudonyme » (personnes). */
  people?: Array<{ from: string; to: string }>;
  /** Remplacements forcés organisations. */
  organizations?: Array<{ from: string; to: string }>;
  /** Remplacements libres additionnels. */
  custom?: Array<{ from: string; to: string }>;
  /** Désactive la détection heuristique de noms (Prénom Nom). Défaut: false */
  disableNameHeuristic?: boolean;
};

export type AnonymizeResult = {
  text: string;
  replacements: AnonymizeReplacement[];
  stats: {
    emails: number;
    phones: number;
    ibans: number;
    bics: number;
    nirs: number;
    sirets: number;
    addresses: number;
    people: number;
    organizations: number;
    custom: number;
  };
};

const FR_FIRST_NAMES = new Set(
  [
    "camille", "lucas", "léa", "lea", "hugo", "chloé", "chloe", "nathan", "manon",
    "louis", "emma", "gabriel", "inès", "ines", "arthur", "jade", "raphaël", "raphael",
    "sarah", "adam", "nina", "théo", "theo", "clara", "maxime", "pauline", "julien",
    "sophie", "antoine", "jean", "marie", "pierre", "michel", "alain", "philippe",
    "nicolas", "françois", "francois", "christine", "isabelle", "nathalie", "sylvie",
    "catherine", "valérie", "valerie", "stéphane", "stephane", "olivier", "laurent",
    "david", "thomas", "juliette", "claire", "alice", "paul", "lucie", "elise",
    "mathilde", "hugo", "enzo", "léo", "leo", "lola", "zoé", "zoe", "anaïs", "anais",
    "yann", "éric", "eric", "bernard", "jacques", "daniel", "patrick", "andre", "andré",
    "monique", "françoise", "francoise", "martine", "nicole", "sandrine", "céline",
    "celine", "aurore", "mélanie", "melanie", "vincent", "guillaume", "alexandre",
    "sébastien", "sebastien", "christophe", "fabrice", "karine", "laetitia", "emilie",
    "émilie", "julie", "anne", "caroline", "charlotte", "hélène", "helene", "odile",
  ].map((n) => n.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()),
);

const PSEUDO_FIRST = [
  "Alice", "Bruno", "Chloé", "Diego", "Elena", "Félix", "Greta", "Hugo",
  "Iris", "Jonas", "Klara", "Liam", "Maya", "Noah", "Olga", "Paul",
];
const PSEUDO_LAST = [
  "Martin", "Bernard", "Dupont", "Leroy", "Moreau", "Garcia", "Roux", "Blanc",
  "Simon", "Laurent", "Michel", "Lefevre", "Garcia", "David", "Bertrand", "Girard",
];

type Span = { start: number; end: number; token: string };

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Protège montants et dates pour qu’aucune substitution PII ne les altère.
 */
function protectKeepSpans(text: string): { masked: string; spans: Span[] } {
  const spans: Span[] = [];
  let masked = text;
  let counter = 0;

  const patterns: RegExp[] = [
    // Montants : 1 234,56 € | 1234.56 EUR | 45€
    /\b\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?\s*(?:€|eur(?:os?)?)\b/gi,
    /\b(?:€|eur(?:os?)?)\s*\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?\b/gi,
    // Dates FR / ISO
    /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{2,4}\b/gi,
  ];

  for (const pattern of patterns) {
    masked = masked.replace(pattern, (match) => {
      const token = `⟦KEEP_${counter++}⟧`;
      spans.push({ start: 0, end: 0, token: match });
      // store mapping via token index in spans by rewriting token payload
      spans[spans.length - 1] = {
        start: 0,
        end: 0,
        token: `${token}:::${match}`,
      };
      return token;
    });
  }

  return { masked, spans };
}

function restoreKeepSpans(text: string, spans: Span[]): string {
  let out = text;
  for (const span of spans) {
    const sep = span.token.indexOf(":::");
    if (sep < 0) continue;
    const token = span.token.slice(0, sep);
    const original = span.token.slice(sep + 3);
    out = out.split(token).join(original);
  }
  return out;
}

function applyMap(
  text: string,
  from: string,
  to: string,
  kind: AnonymizeReplacement["kind"],
  replacements: AnonymizeReplacement[],
  seen: Map<string, string>,
): string {
  const key = normalizeKey(from);
  if (!key || key.length < 2) return text;
  if (seen.has(key)) {
    const existing = seen.get(key)!;
    const re = new RegExp(escapeRegExp(from), "gi");
    return text.replace(re, existing);
  }
  seen.set(key, to);
  replacements.push({ kind, original: from, replacement: to });
  const re = new RegExp(escapeRegExp(from), "gi");
  return text.replace(re, to);
}

function nextPseudoPerson(index: number): string {
  const first = PSEUDO_FIRST[index % PSEUDO_FIRST.length];
  const last = PSEUDO_LAST[Math.floor(index / PSEUDO_FIRST.length) % PSEUDO_LAST.length];
  return `${first} ${last}`;
}

function detectPersonNames(text: string): string[] {
  const found = new Set<string>();
  const re =
    /\b([A-ZÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ][a-zéèêëàâäîïôöùûüç'’-]+)\s+([A-ZÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ][a-zéèêëàâäîïôöùûüç'’-]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const first = match[1];
    const last = match[2];
    const firstKey = normalizeKey(first);
    // Évite titres / mois / articles juridiques
    if (
      /^(article|annexe|page|monsieur|madame|mademoiselle|contrat|facture|bail|sir|mme|mlle|dr|me)$/i.test(
        first,
      )
    ) {
      continue;
    }
    if (!FR_FIRST_NAMES.has(firstKey)) continue;
    if (last.length < 2) continue;
    found.add(`${first} ${last}`);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/**
 * Anonymise un texte documentaire tout en préservant montants, dates et mise en page.
 */
export function anonymizeDocumentText(
  input: string,
  options: AnonymizeOptions = {},
): AnonymizeResult {
  const replacements: AnonymizeReplacement[] = [];
  const seen = new Map<string, string>();
  const stats = {
    emails: 0,
    phones: 0,
    ibans: 0,
    bics: 0,
    nirs: 0,
    sirets: 0,
    addresses: 0,
    people: 0,
    organizations: 0,
    custom: 0,
  };

  const { masked, spans } = protectKeepSpans(input);
  let text = masked;

  // Emails
  text = text.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    (match) => {
      const key = normalizeKey(match);
      if (seen.has(key)) return seen.get(key)!;
      const replacement = `contact.${stats.emails + 1}@exemple.fr`;
      stats.emails += 1;
      seen.set(key, replacement);
      replacements.push({ kind: "email", original: match, replacement });
      return replacement;
    },
  );

  // IBAN → tokens temporaires (évite faux positifs téléphone sur le faux IBAN)
  const ibanTokens: Array<{ token: string; replacement: string }> = [];
  text = text.replace(
    /\bFR\d{2}(?:\s?\d{4}){5}\s?\d{1,3}\b/gi,
    (match) => {
      const key = normalizeKey(match);
      if (seen.has(key)) {
        const existing = seen.get(key)!;
        const known = ibanTokens.find((t) => t.replacement === existing);
        return known?.token ?? existing;
      }
      const token = `⟦IBAN_${ibanTokens.length}⟧`;
      const replacement = `FR76 1111 2222 3333 4444 5555 ${String(111 + stats.ibans)}`;
      stats.ibans += 1;
      seen.set(key, replacement);
      replacements.push({ kind: "iban", original: match, replacement });
      ibanTokens.push({ token, replacement });
      return token;
    },
  );

  // BIC
  text = text.replace(/\b[A-Z]{4}FR[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, (match) => {
    if (/^(SEPA|IBAN|EUR|TTC|HTA)$/i.test(match)) return match;
    const key = normalizeKey(match);
    if (seen.has(key)) return seen.get(key)!;
    const replacement = `BNPAFRPPXXX`;
    stats.bics += 1;
    seen.set(key, replacement);
    replacements.push({ kind: "bic", original: match, replacement });
    return replacement;
  });

  // Téléphones FR
  text = text.replace(
    /(?:\+33|0)\s*[1-9](?:[\s.\-]?\d{2}){4}\b/g,
    (match) => {
      const key = normalizeKey(match);
      if (seen.has(key)) return seen.get(key)!;
      const n = String(10 + stats.phones);
      const replacement = `06 11 22 33 ${n}`;
      stats.phones += 1;
      seen.set(key, replacement);
      replacements.push({ kind: "phone", original: match, replacement });
      return replacement;
    },
  );

  for (const { token, replacement } of ibanTokens) {
    text = text.split(token).join(replacement);
  }

  // NIR (approx)
  text = text.replace(
    /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
    (match) => {
      const key = normalizeKey(match);
      if (seen.has(key)) return seen.get(key)!;
      const replacement = `1 85 01 99 999 999 ${String(stats.nirs + 1).padStart(2, "0")}`;
      stats.nirs += 1;
      seen.set(key, replacement);
      replacements.push({ kind: "nir", original: match, replacement });
      return replacement;
    },
  );

  // SIRET (14) puis SIREN (9)
  text = text.replace(/\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b/g, (match) => {
    const key = normalizeKey(match);
    if (seen.has(key)) return seen.get(key)!;
    const replacement = `123 456 789 000${String(stats.sirets + 1).padStart(2, "0")}`;
    stats.sirets += 1;
    seen.set(key, replacement);
    replacements.push({ kind: "siret", original: match, replacement });
    return replacement;
  });
  text = text.replace(/\b\d{3}\s?\d{3}\s?\d{3}\b/g, (match) => {
    // Évite de retoucher des montants déjà protégés / années isolées
    if (match.includes("⟦KEEP_")) return match;
    const digits = match.replace(/\s/g, "");
    if (digits.length !== 9) return match;
    const key = normalizeKey(match);
    if (seen.has(key)) return seen.get(key)!;
    const replacement = `123 456 ${String(700 + stats.sirets).padStart(3, "0")}`;
    stats.sirets += 1;
    seen.set(key, replacement);
    replacements.push({ kind: "siren", original: match, replacement });
    return replacement;
  });

  // Adresses FR simples
  text = text.replace(
    /\b\d{1,4}\s+(?:bis|ter)?\s*(?:rue|avenue|av\.|bd|boulevard|chemin|impasse|place|allée|allee|route|résidence|residence)\s+[^\n,]{3,60}/gi,
    (match) => {
      const key = normalizeKey(match);
      if (seen.has(key)) return seen.get(key)!;
      const replacement = `${10 + stats.addresses} rue des Exemples`;
      stats.addresses += 1;
      seen.set(key, replacement);
      replacements.push({ kind: "address", original: match, replacement });
      return replacement;
    },
  );

  // Overrides explicites (plus longs d’abord)
  const explicitPeople = [...(options.people ?? [])].sort(
    (a, b) => b.from.length - a.from.length,
  );
  for (const pair of explicitPeople) {
    const before = text;
    text = applyMap(text, pair.from, pair.to, "person", replacements, seen);
    if (text !== before) stats.people += 1;
  }

  const explicitOrgs = [...(options.organizations ?? [])].sort(
    (a, b) => b.from.length - a.from.length,
  );
  for (const pair of explicitOrgs) {
    const before = text;
    text = applyMap(
      text,
      pair.from,
      pair.to,
      "organization",
      replacements,
      seen,
    );
    if (text !== before) stats.organizations += 1;
  }

  const customs = [...(options.custom ?? [])].sort(
    (a, b) => b.from.length - a.from.length,
  );
  for (const pair of customs) {
    const before = text;
    text = applyMap(text, pair.from, pair.to, "custom", replacements, seen);
    if (text !== before) stats.custom += 1;
  }

  if (!options.disableNameHeuristic) {
    const names = detectPersonNames(text);
    let personIndex = 0;
    for (const name of names) {
      if (seen.has(normalizeKey(name))) continue;
      const replacement = nextPseudoPerson(personIndex++);
      text = applyMap(text, name, replacement, "person", replacements, seen);
      stats.people += 1;
    }
  }

  text = restoreKeepSpans(text, spans);

  return { text, replacements, stats };
}

/** Construit un markdown multi-pages en conservant la structure des pages. */
export function pagesToMarkdown(pages: string[], title?: string): string {
  const header = [
    "<!-- Document anonymisé — corpus DocMind (réel anonymisé) -->",
    title ? `# ${title}` : "# Document anonymisé",
    "",
    "> Document issu d’un original réel, anonymisé automatiquement. Montants, dates et clauses conservés.",
    "",
  ];

  const body =
    pages.length === 0
      ? ["_(aucun texte extractible)_"]
      : pages.flatMap((page, index) => [
          `## Page ${index + 1}`,
          "",
          `<<<PAGE ${index + 1}>>>`,
          "",
          page.trim(),
          "",
          `<<<FIN_PAGE ${index + 1}>>>`,
          "",
        ]);

  return [...header, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
}

export function parsePairList(
  raw: string | undefined,
): Array<{ from: string; to: string }> {
  if (!raw?.trim()) return [];
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) {
        throw new Error(
          `Remplacement invalide « ${part} » — attendu: Original=Pseudonyme`,
        );
      }
      return {
        from: part.slice(0, eq).trim(),
        to: part.slice(eq + 1).trim(),
      };
    })
    .filter((p) => p.from && p.to);
}
