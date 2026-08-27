import { uniqueStrings } from "@/lib/array";

const AMOUNT_PATTERN =
  /(?:€|EUR|euros?)\s*[+-]?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|(?:€|EUR|euros?)\s*[+-]?\d+(?:[.,]\d{1,2})?|[+-]?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?\s*(?:€|EUR|euros?)|[+-]?\d+(?:[.,]\d{1,2})?\s*(?:€|EUR|euros?)/gi;

export type AmountImportance = "primary" | "secondary";

export type AmountPeriod = "mensuel" | "annuel" | "unique";

export type LabeledAmount = {
  /** Texte montant normalisé (ex. « 1 050 € ») */
  value: string;
  /** Libellé métier (ex. « Loyer mensuel ») */
  label: string;
  period?: AmountPeriod;
  importance: AmountImportance;
};

type LabelRule = {
  id: string;
  /** Motifs sur le contexte autour du montant */
  patterns: RegExp[];
  label: string;
  period?: AmountPeriod;
  importance: AmountImportance;
  /** Score de priorité (plus bas = mieux) */
  priority: number;
};

/** Contexte hors sujet (stats nationales, références, etc.). */
const NOISE_AMOUNT_CONTEXT =
  /taxe\s+d['']habitation|suppression\s+(?:de\s+)?la\s+taxe|milliards?|national(?:e|es)?|collectivit[ée]s?|ensemble\s+des\s+(?:foyers|contribuables)|produit\s+(?:net\s+)?(?:de\s+la\s+)?taxe|statistiques?|budget\s+(?:de\s+)?l[''][ée]tat|france\s+enti[eè]re|nombre\s+de\s+foyers|base\s+nationale|montant\s+global\s+(?:des|de)|total\s+(?:des\s+)?recettes|r[ée]f[ée]rence\s+(?:nationale|cadastrale)|valeur\s+locative\s+(?:cadastrale|moyenne)/i;

/** Indices forts d’un montant dû / à prélever par l’usager. */
const USER_DUE_CONTEXT =
  /montant\s+[àa]\s+(?:payer|pr[ée]lever|r[ée]gler)|somme\s+[àa]\s+(?:payer|pr[ée]lever)|solde\s+[àa]\s+payer|reste\s+[àa]\s+payer|montant\s+d[ûu]|taxe\s+fonci[eè]re|imp[oô]t(?:s)?\s+(?:foncier|sur\s+le\s+revenu|locaux)|pr[ée]l[eè]vement\s+(?:automatique|SEPA|bancaire|mensuel)|avis\s+d['']imposition|cotisation\s+[àa]\s+payer|total\s+[àa]\s+payer/i;

/** Libellé explicite « dû / à prélever » — requis pour conserver un gros montant. */
const EXPLICIT_USER_DUE =
  /montant\s+[àa]\s+(?:payer|pr[ée]lever|r[ée]gler)|somme\s+[àa]\s+(?:payer|pr[ée]lever)|solde\s+[àa]\s+payer|reste\s+[àa]\s+payer|montant\s+d[ûu]|net\s+[àa]\s+payer|total\s+[àa]\s+payer|sera\s+pr[ée]lev|pr[ée]l[eè]vement\s+(?:de|d['']un\s+montant)/i;

/** Au-delà : hors échelle personnelle sauf label métier explicite. */
const HUGE_PERSONAL_CEILING = 1_000_000;
/** Au-delà sans libellé « à payer » : probablement bruit / référence. */
const LARGE_UNLABELED_CEILING = 50_000;

/** Montants jamais affichés dans `analysis.amounts` (contexte pro / stats). */
const DISPLAY_EXCLUDED_LABEL =
  /capital\s+social|garantie\s+financi|contexte\s+professionnel|valeur\s+locative\s+cadastrale|produit\s+national|total\s+national|statistiques?|r[ée]f[ée]rence\s+cadastrale/i;

/** Phrases / fragments pro ou stats à retirer du prose affiché (#1ter). */
const PROSE_NOISE_PHRASE =
  /capital\s+social|garantie\s+financi[eè]re|caisse\s+de\s+garantie|plafond\s+de\s+garantie|produit\s+(?:net\s+)?(?:de\s+la\s+)?taxe|produit\s+national|valeur\s+locative\s+cadastrale|ensemble\s+des\s+(?:foyers|contribuables)|r[ée]f[ée]rence\s+cadastrale/i;

const UNLABELED = "Montant mentionné";

function parseAmountNumber(value: string): number | null {
  const m = value.match(
    /(\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/,
  );
  if (!m) return null;
  const normalized = m[1]!.replace(/[\s\u00a0]/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function isCapitalScaleRule(rule: LabelRule | null): boolean {
  return (
    rule?.id === "capital_emprunte" ||
    rule?.id === "capital_social" ||
    rule?.id === "garantie_financiere" ||
    rule?.importance === "secondary"
  );
}

function isNoiseAmount(
  value: string,
  before: string,
  after: string,
  rule: LabelRule | null,
): boolean {
  const hay = `${before} ${after}`;
  const n = parseAmountNumber(value);
  if (n === null) return false;

  // Stats / totaux nationaux / suppression TH → jamais « montant important »
  if (NOISE_AMOUNT_CONTEXT.test(hay)) return true;

  // ≥ 1 M€ : hors échelle usager (sauf capital emprunté / social)
  if (n >= HUGE_PERSONAL_CEILING) {
    return !isCapitalScaleRule(rule);
  }

  // ≥ 50 k€ sans ancrage explicite « à payer / prélever » → bruit / référence
  if (n >= LARGE_UNLABELED_CEILING) {
    if (isCapitalScaleRule(rule)) return false;
    if (
      EXPLICIT_USER_DUE.test(hay) ||
      (rule &&
        (rule.id === "montant_prelever" ||
          rule.id === "montant_a_payer" ||
          EXPLICIT_USER_DUE.test(rule.label)))
    ) {
      return false;
    }
    return true;
  }

  return false;
}

const LABEL_RULES: LabelRule[] = [
  {
    id: "montant_prelever",
    patterns: [
      /montant\s+[àa]\s+pr[ée]lever/i,
      /somme\s+[àa]\s+pr[ée]lever/i,
      /pr[ée]l[eè]vement\s+(?:de|d['']un\s+montant\s+de)/i,
      /sera\s+pr[ée]lev[ée]/i,
    ],
    label: "Montant à prélever",
    period: "unique",
    importance: "primary",
    priority: 4,
  },
  {
    id: "montant_a_payer",
    patterns: [
      /montant\s+[àa]\s+(?:payer|r[ée]gler)/i,
      /somme\s+[àa]\s+payer/i,
      /solde\s+[àa]\s+payer/i,
      /reste\s+[àa]\s+payer/i,
      /montant\s+d[ûu]\b/i,
      /total\s+[àa]\s+payer/i,
      /net\s+[àa]\s+payer/i,
    ],
    label: "Montant à payer",
    period: "unique",
    importance: "primary",
    priority: 5,
  },
  {
    id: "taxe_fonciere",
    patterns: [
      /taxe\s+fonci[eè]re(?:\s+sur\s+les\s+propri[ée]t[ée]s\s+(?:b[âa]ties|non\s+b[âa]ties))?/i,
      /cotisation\s+(?:de\s+)?taxe\s+fonci[eè]re/i,
      /montant\s+(?:de\s+)?(?:la\s+)?taxe\s+fonci[eè]re/i,
    ],
    label: "Taxe foncière",
    period: "annuel",
    importance: "primary",
    priority: 6,
  },
  {
    id: "impot_local",
    patterns: [
      /imp[oô]t(?:s)?\s+(?:foncier|locaux|sur\s+le\s+revenu)/i,
      /avis\s+d['']imposition/i,
      /cotisation\s+[àa]\s+payer/i,
    ],
    label: "Impôt / cotisation à payer",
    period: "unique",
    importance: "primary",
    priority: 7,
  },
  {
    id: "total_ttc",
    patterns: [
      /total\s+ttc/i,
      /montant\s+total\s+ttc/i,
      /net\s+[àa]\s+payer/i,
      /total\s+facture/i,
    ],
    label: "Total TTC",
    period: "unique",
    importance: "primary",
    priority: 9,
  },
  {
    id: "loyer",
    patterns: [
      /loyer\s+mensuel(?:\s+hors\s+charges|\s+hc)?/i,
      /loyer\s+principal/i,
      /loyer(?:\s+hors\s+charges|\s+hc)?\s*[:\-]/i,
    ],
    label: "Loyer mensuel",
    period: "mensuel",
    importance: "primary",
    priority: 10,
  },
  {
    id: "charges",
    patterns: [
      /provisions?\s+(?:pour\s+)?charges/i,
      /charges\s+locatives/i,
      /charges\s+mensuelles/i,
      /charges\s+r[ée]cup[ée]rables/i,
    ],
    label: "Provision pour charges mensuelles",
    period: "mensuel",
    importance: "primary",
    priority: 20,
  },
  {
    id: "depot",
    patterns: [/d[ée]p[ôo]t\s+de\s+garantie/i, /caution\s+(?:locative|de\s+loyer)/i],
    label: "Dépôt de garantie",
    period: "unique",
    importance: "primary",
    priority: 30,
  },
  {
    id: "honoraires_locataire",
    patterns: [
      /honoraires?.{0,40}(?:[àa]\s+la\s+charge\s+du\s+)?locataire/i,
      /part\s+locataire.{0,30}honoraires?/i,
    ],
    label: "Honoraires à la charge du locataire",
    period: "unique",
    importance: "primary",
    priority: 40,
  },
  {
    id: "honoraires_bailleur",
    patterns: [
      /honoraires?.{0,40}(?:[àa]\s+la\s+charge\s+du\s+)?bailleur/i,
      /part\s+bailleur.{0,30}honoraires?/i,
    ],
    label: "Honoraires à la charge du bailleur",
    period: "unique",
    importance: "primary",
    priority: 45,
  },
  {
    id: "honoraires",
    patterns: [
      /honoraires?(?:\s+d['']agence|\s+ttc|\s+ht)?/i,
      /frais\s+de\s+(?:mise\s+en\s+)?location/i,
    ],
    label: "Honoraires d’agence",
    period: "unique",
    importance: "primary",
    priority: 50,
  },
  {
    id: "penalites_retard",
    patterns: [
      /p[ée]nalit[ée]s?\s+de\s+retard/i,
      /indemnit[ée]\s+de\s+retard/i,
      /int[ée]r[êe]ts?\s+de\s+retard/i,
    ],
    label: "Pénalités de retard",
    importance: "primary",
    priority: 55,
  },
  {
    id: "frais_recouvrement",
    patterns: [
      /frais\s+de\s+recouvrement/i,
      /indemnit[ée]\s+forfaitaire\s+(?:de\s+)?recouvrement/i,
    ],
    label: "Frais de recouvrement",
    importance: "primary",
    priority: 56,
  },
  {
    id: "total_reclame",
    patterns: [
      /somme\s+totale/i,
      /montant\s+total/i,
      /total\s+(?:r[ée]clam[ée]|d[ûu]|[àa]\s+payer)/i,
    ],
    label: "Total réclamé",
    importance: "primary",
    priority: 57,
  },
  {
    id: "franchise",
    patterns: [/\bfranchise\b/i],
    label: "Franchise",
    importance: "primary",
    priority: 60,
  },
  {
    id: "cotisation",
    patterns: [/cotisation(?:\s+mensuelle|\s+annuelle)?/i, /prime\s+(?:d['']assurance|mensuelle)/i],
    label: "Cotisation",
    importance: "primary",
    priority: 62,
  },
  {
    id: "mensualite",
    patterns: [/mensualit[ée]s?/i],
    label: "Mensualité",
    period: "mensuel",
    importance: "primary",
    priority: 63,
  },
  {
    id: "frais_dossier",
    patterns: [/frais\s+de\s+dossier/i, /commission\s+de\s+dossier/i],
    label: "Frais de dossier",
    period: "unique",
    importance: "secondary",
    priority: 120,
  },
  {
    id: "frais_resiliation",
    patterns: [/frais\s+de\s+r[ée]siliation/i, /p[ée]nalit[ée].{0,20}r[ée]siliation/i],
    label: "Frais / pénalité de résiliation",
    importance: "primary",
    priority: 66,
  },
  {
    id: "tenue_compte",
    patterns: [/frais\s+de\s+tenue\s+de\s+compte/i],
    label: "Frais de tenue de compte",
    period: "mensuel",
    importance: "primary",
    priority: 67,
  },
  {
    id: "capital_emprunte",
    patterns: [/capital\s+(?:emprunt[ée]|pr[êe]t[ée])/i],
    label: "Capital emprunté",
    importance: "primary",
    priority: 68,
  },
  {
    id: "capital_social",
    patterns: [/capital\s+social/i],
    label: "Capital social (agence)",
    importance: "secondary",
    priority: 200,
  },
  {
    id: "garantie_financiere",
    patterns: [
      /garantie\s+financi[eè]re/i,
      /caisse\s+de\s+garantie/i,
      /plafond\s+de\s+garantie/i,
    ],
    label: "Garantie financière de l’agence",
    importance: "secondary",
    priority: 210,
  },
];

function normalizeAmount(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bEUR\b/gi, "€")
    .replace(/\beuros?\b/gi, "€")
    .replace(/\s*€/g, " €")
    .trim();
}

/**
 * Libellé = préfixe local avant le montant (ligne courante / après dernier point).
 * Évite que « Loyer… » de la ligne précédente pollue le montant suivant.
 */
function contextForLabel(text: string, index: number): string {
  const slice = text.slice(Math.max(0, index - 140), index);
  const breakAt = Math.max(
    slice.lastIndexOf("\n"),
    slice.lastIndexOf("•"),
    slice.lastIndexOf(";"),
  );
  const local = breakAt >= 0 ? slice.slice(breakAt + 1) : slice;
  const cleaned = local.replace(/\s+/g, " ").trim();
  // Si la ligne est trop courte (« : » seul), élargir un peu.
  if (cleaned.length < 6) {
    return slice.replace(/\s+/g, " ").trim();
  }
  return cleaned;
}

function contextAfterAmount(
  text: string,
  index: number,
  length: number,
): string {
  return text
    .slice(index + length, Math.min(text.length, index + length + 48))
    .replace(/\s+/g, " ");
}

function enrichDepotLabel(base: string, after: string, before: string): string {
  const hay = `${before} ${after}`;
  const months = hay.match(
    /(?:[ée]quivalent\s+[àa]|soit|repr[ée]sentant)\s+(\d+)\s*mois|(?:de\s+)?(\d+)\s*mois\s+(?:de\s+)?loyer/i,
  );
  const n = months?.[1] || months?.[2];
  if (n) return `${base} (${n} mois)`;
  return base;
}

/** Le motif dont la fin est la plus proche du montant gagne. */
function matchLabel(context: string): LabelRule | null {
  let best: { rule: LabelRule; end: number } | null = null;

  for (const rule of LABEL_RULES) {
    for (const pattern of rule.patterns) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = re.exec(context)) !== null) {
        const end = m.index + m[0].length;
        if (
          !best ||
          end > best.end ||
          (end === best.end && rule.priority < best.rule.priority)
        ) {
          best = { rule, end };
        }
      }
    }
  }

  if (!best) return null;

  // Garde-fou dépôt vs loyer (« mois de loyer »)
  if (best.rule.id === "loyer") {
    const depotHit = LABEL_RULES.find((r) => r.id === "depot")?.patterns.some(
      (p) => {
        p.lastIndex = 0;
        return p.test(context);
      },
    );
    if (depotHit) {
      return LABEL_RULES.find((r) => r.id === "depot") ?? best.rule;
    }
  }

  return best.rule;
}

function numericKey(value: string): string {
  const m = value.match(
    /(\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/,
  );
  if (!m) return value.toLowerCase();
  return m[1]!.replace(/[\s\u00a0]/g, "").replace(",", ".");
}

/**
 * Extrait les montants avec libellé + importance à partir du contexte local.
 * Même valeur numérique autorisée sous des libellés différents (ex. loyer = dépôt).
 */
export function extractLabeledAmounts(text: string): LabeledAmount[] {
  const byKey = new Map<string, LabeledAmount & { priority: number }>();
  const re = new RegExp(AMOUNT_PATTERN.source, AMOUNT_PATTERN.flags);
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const value = normalizeAmount(m[0]);
    const before = contextForLabel(text, m.index);
    const after = contextAfterAmount(text, m.index, m[0].length);
    // Match aussi un peu après le montant (« … 1 178 € sera prélevé »)
    const rule =
      matchLabel(before) ?? matchLabel(`${before} ${after}`.slice(0, 180));
    if (isNoiseAmount(value, before, after, rule)) continue;

    const ruleId = rule?.id ?? "unlabeled";

    let label = rule?.label ?? UNLABELED;
    if (rule?.id === "depot") {
      label = enrichDepotLabel(label, after, before);
    }

    // Périodicité hint après le montant (ex. « par mois »)
    let period = rule?.period;
    if (!period && /\bpar\s+mois\b|\b\/\s*mois\b/i.test(after)) {
      period = "mensuel";
    }

    // Sur doc fiscal : ancrage « à prélever / à payer » sans règle stricte
    let importance = rule?.importance ?? ("primary" as const);
    let priority = rule?.priority ?? 150;
    if (
      (!rule || rule.label === UNLABELED) &&
      USER_DUE_CONTEXT.test(`${before} ${after}`)
    ) {
      label = /pr[ée]lev/i.test(`${before} ${after}`)
        ? "Montant à prélever"
        : "Montant à payer";
      importance = "primary";
      priority = 8;
    }

    const candidate = {
      value,
      label,
      period,
      importance,
      priority,
    };

    // Clé = valeur + type de libellé (pas la valeur seule).
    const key = `${numericKey(value)}::${
      label === UNLABELED ? "unlabeled" : ruleId
    }`;
    const prev = byKey.get(key);
    if (!prev || candidate.priority < prev.priority) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => {
      if (a.importance !== b.importance) {
        return a.importance === "primary" ? -1 : 1;
      }
      // Montants « à payer / prélever » avant le reste
      const aDue = /pr[ée]lever|[àa]\s+payer|taxe\s+fonci|imp[oô]t/i.test(
        a.label,
      )
        ? 0
        : 1;
      const bDue = /pr[ée]lever|[àa]\s+payer|taxe\s+fonci|imp[oô]t/i.test(
        b.label,
      )
        ? 0
        : 1;
      if (aDue !== bDue) return aDue - bDue;
      return a.priority - b.priority;
    })
    .map(({ value, label, period, importance }) => ({
      value,
      label,
      period,
      importance,
    }));
}

/** Affichage canonique : « 1 050 € — Loyer mensuel ». */
export function formatLabeledAmount(item: LabeledAmount): string {
  if (item.label === UNLABELED) return item.value;
  const suffix =
    item.importance === "secondary" ? " (contexte professionnel)" : "";
  return `${item.value} — ${item.label}${suffix}`;
}

/**
 * Liste prête pour `analysis.amounts` :
 * - primaires labelisés en tête
 * - montants non labelisés seulement en fallback
 * - hors sujet (capital agence, totaux nationaux, stats…) exclus
 */
function isPlausibleUnlabeledFallback(item: LabeledAmount): boolean {
  const n = parseAmountNumber(item.value);
  if (n === null) return false;
  // Ne jamais compléter avec des montants absurdes / hors échelle perso
  return n > 0 && n < LARGE_UNLABELED_CEILING;
}

function isUserDueAmountLabel(raw: string): boolean {
  return (
    EXPLICIT_USER_DUE.test(raw) ||
    /pr[ée]lever|[àa]\s+payer|taxe\s+fonci|imp[oô]t|loyer|charges|d[ée]p[ôo]t|mensualit|p[ée]nalit|honoraires|frais|cotisation|total\s+r[ée]clam/i.test(
      raw,
    )
  );
}

/**
 * Filtre la liste `analysis.amounts` : retire bruit pro / national / stats
 * sans toucher à l’extraction labelisée interne ni au watch.
 */
export function filterAmountsForDisplay(amounts: string[]): string[] {
  return amounts.filter((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return false;

    const { value, label } = parseAmountDisplay(trimmed);
    const hay = label ? `${value} ${label}` : trimmed;

    if (DISPLAY_EXCLUDED_LABEL.test(hay)) return false;
    if (NOISE_AMOUNT_CONTEXT.test(hay)) return false;

    const n = parseAmountNumber(value);
    if (n === null) return true;

    if (n >= HUGE_PERSONAL_CEILING) {
      return isUserDueAmountLabel(hay);
    }

    if (n >= LARGE_UNLABELED_CEILING && !isUserDueAmountLabel(hay)) {
      return false;
    }

    return true;
  });
}

export function extractAmounts(text: string): string[] {
  const labeled = extractLabeledAmounts(text);
  if (labeled.length === 0) return [];

  const primaryLabeled = labeled.filter(
    (a) =>
      a.importance === "primary" &&
      a.label !== UNLABELED &&
      !DISPLAY_EXCLUDED_LABEL.test(a.label),
  );
  const unlabeled = labeled.filter(
    (a) => a.label === UNLABELED && isPlausibleUnlabeledFallback(a),
  );

  // Primaires labelisés seuls si disponibles — ne pas polluer avec des bruts.
  const primary =
    primaryLabeled.length > 0
      ? primaryLabeled
      : unlabeled.slice(0, 4);

  const combined = uniqueStrings(primary.map(formatLabeledAmount));
  return filterAmountsForDisplay(combined).slice(0, 10);
}

/** Parse une ligne « montant — label » pour l’UI. */
export function parseAmountDisplay(raw: string): {
  value: string;
  label: string | null;
} {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf(" — ");
  if (sep === -1) {
    const alt = trimmed.indexOf(" - ");
    if (alt === -1) return { value: trimmed, label: null };
    return {
      value: trimmed.slice(0, alt).trim(),
      label: trimmed.slice(alt + 3).trim() || null,
    };
  }
  return {
    value: trimmed.slice(0, sep).trim(),
    label: trimmed.slice(sep + 3).trim() || null,
  };
}

/**
 * Retire du prose (résumé, points, findings) les montants hors sujet :
 * - ≥ 1 M€ (hors échelle personnelle)
 * - contexte stats / totaux nationaux / suppression TH (fenêtre locale)
 * - ≥ 50 k€ sans ancrage explicite « à payer / à prélever »
 * Les montants clairement dus à l’usager sont toujours conservés.
 */
export function scrubAbsurdAmountsInText(text: string): string {
  if (!text?.trim()) return text;
  const re = new RegExp(AMOUNT_PATTERN.source, AMOUNT_PATTERN.flags);
  /** Ancrage « dû » dans une fenêtre courte autour du montant. */
  const KEEP_DUE_NEAR =
    /pr[ée]l[eè]v|montant\s+[àa]\s+(?:payer|pr[ée]lever|r[ée]gler)|somme\s+[àa]\s+(?:payer|pr[ée]lever)|solde\s+[àa]\s+payer|reste\s+[àa]\s+payer|montant\s+d[ûu]|net\s+[àa]\s+payer|total\s+[àa]\s+payer|taxe\s+fonci[eè]re|imp[oô]t(?:s)?\s+(?:foncier|sur\s+le\s+revenu|locaux)|[àa]\s+payer\b|loyer|charges\s+locatives|d[ée]p[ôo]t\s+de\s+garantie|p[ée]nalit/i;

  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Fenêtre large = détection bruit ; fenêtre serrée = ancrage « dû » (évite
    // qu’un « prélever » plus haut protège un total national / VL cadastrale).
    const near = `${text.slice(Math.max(0, start - 70), start)} ${text.slice(end, Math.min(text.length, end + 70))}`;
    const nearTight = `${text.slice(Math.max(0, start - 42), start)} ${text.slice(end, Math.min(text.length, end + 28))}`;
    const value = normalizeAmount(m[0]);
    const n = parseAmountNumber(value);
    const keepDue = KEEP_DUE_NEAR.test(nearTight);

    let drop = false;
    // ≥ 1 M€ : toujours hors échelle personnelle dans le prose (stats / totaux).
    if (n !== null && n >= HUGE_PERSONAL_CEILING) {
      drop = true;
    } else if (
      !keepDue &&
      (NOISE_AMOUNT_CONTEXT.test(near) ||
        PROSE_NOISE_PHRASE.test(nearTight) ||
        DISPLAY_EXCLUDED_LABEL.test(nearTight))
    ) {
      drop = true;
    } else if (
      !keepDue &&
      n !== null &&
      n >= LARGE_UNLABELED_CEILING &&
      !EXPLICIT_USER_DUE.test(nearTight)
    ) {
      drop = true;
    }

    out += text.slice(last, start);
    if (!drop) out += m[0];
    last = end;
  }
  out += text.slice(last);
  return polishScrubbedProse(out);
}

function polishScrubbedProse(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+—\s*[.,;]?/g, " ")
    .trim();
}

/** Retire les fragments de phrase restants après suppression des montants bruit. */
function scrubNoiseProseFragments(text: string): string {
  let out = text;

  out = out.replace(
    /\s*(?:,\s*)?(?:et\s+)?(?:sa\s+)?garantie\s+financi[eè]re[^.!?;]{0,160}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:,\s*)?(?:le\s+)?capital\s+social[^.!?;]{0,160}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:le\s+)?produit\s+national(?:\s+de\s+la\s+taxe)?[^.!?;]{0,160}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:le\s+)?produit\s+(?:net\s+)?(?:de\s+la\s+)?taxe\s+s['']?[ée]l[eè]ve\s*[^.!?;]{0,140}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:information\s*:\s*)?suite\s+[àa]\s+la\s+suppression[^.!?;]{0,220}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:la\s+)?valeur\s+locative\s+cadastrale[^.!?;]{0,140}/gi,
    "",
  );
  out = out.replace(
    /\s*(?:mentionne|indique|cite|rappelle)\s+(?:[ée]galement\s+)?[^.!?;]{0,40}(?:capital\s+social|garantie\s+financi[eè]re)[^.!?;]{0,160}/gi,
    "",
  );

  const parts = out.split(/(?<=[.!?…])\s+/);
  const kept = parts.filter((part) => {
    const p = part.trim();
    if (!p) return false;
    if (!PROSE_NOISE_PHRASE.test(p)) return true;
    // Conserver si un signal « dû / utile » est présent (run-on taxe / loyer…)
    return /montant\s+[àa]\s+(?:payer|pr[ée]lever)|taxe\s+fonci[eè]re|pr[ée]l[eè]vement|loyer|d[ée]p[ôo]t|solde\s+[àa]\s+payer|mensualit|capital\s+emprunt/i.test(
      p,
    );
  });
  out = kept.join(" ");
  out = out.replace(/\s+s['']?[ée]l[eè]ve\s+[àa]\s*$/gi, "");
  out = out.replace(/\s+(?:le\s+)?produit\s+national\s*$/gi, "");

  return polishScrubbedProse(out);
}

/**
 * Prose affichable (résumé, extraits) : montants absurdes + fragments pro/stats.
 */
export function scrubDisplayProse(text: string): string {
  if (!text?.trim()) return text;
  return scrubNoiseProseFragments(scrubAbsurdAmountsInText(text));
}
