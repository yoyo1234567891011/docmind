/**
 * Nettoyage d’affichage (extraits / prose / actions / dédup).
 * Objectif : aucun texte visible ne finit au milieu d’un mot ou d’une phrase.
 */

const LEADING_STOP =
  /^(le|la|les|un|une|des|du|de|d|et|ou|en|au|aux|ce|ces|se|si|sur|sous|par|pour|dans|avec|sans|son|sa|ses|il|elle|ils|elles|nous|vous|a|à|y|n|l|qu|que|qui|dont|où|mais|donc|or|ni|car)\b/i;

/** Mots seuls en fin de texte = phrase ouverte / tronquée. */
const HANGING_LAST_TOKEN =
  /^(en|le|la|les|du|de|des|un|une|et|ou|si|au|aux|ce|ces|se|sa|son|ses|par|pour|dans|avec|sans|sur|sous|que|qui|dont|car|mais|donc|ni|or|à|a|y|d|l|n|qu|aux|auxquels|auxquelles|desquels|desquelles|duquel|dequelle|auquel|à laquelle|entre|vers|chez|selon|après|avant|pendant|depuis|malgré|sauf|hormis|comme|quand|lorsque|puisque|quoique|afin|parce)$/i;

/** Fins de clause clairement coupées. */
const INCOMPLETE_CLAUSE_TAIL =
  /\b(si le d[ée]lai entre|si le|si la|si les|si l['’]|lorsque le|lorsque la|lorsque l['’]|faisant l['’]objet|du cr[ée]dit|entre le|entre la|avant le|avant la|dans un d[ée]lai|sous r[ée]serve|conform[ée]ment [àa]|au titre de|en cas de|en ca|sans avoir|sans indiquer|afin de|ainsi que|ainsi qu|c['’]est[- ][àa]-dire|par exemple|selon les|dans les conditions|le montant de|le taux de|les frais de|la date de|le relev)\s*[-–—:]?\s*$/i;

/** Début d’extrait coupé au milieu d’un mot (suffixes orphelins). */
const BROKEN_WORD_PREFIX =
  /^(?:ion|tions?|ments?|ements?|ences?|ances?|aires?|iques?|ilit[ée]s?|euses?|ev[ée]s?|ités?|ures?|oire|oires)\b/i;

/**
 * Terminaisons fréquentes d’un mot français « fini ».
 * Un token 4+ lettres hors de cette liste en fin de texte = souvent une coupe (ex. « relev »).
 */
const FRENCH_COMPLETE_WORD_END =
  /(?:ments?|tions?|sions?|ences?|ances?|iques?|ables?|ibles?|aires?|eurs?|euses?|ères?|ées?|eux|euse|ois|aise?|aux|ales?|els?|ives?|ifs?|ants?|ents?|ons|ait|ais|ées?|ues?|ure|ier|ière|oir|[éeèêëïîôùûüy]|er|ir|re|is|ie|in|on|an|en|or|ur|al|il|el|et|es|os|us|as|ts|ns|rs|ls|ms|ps|cs|gs|ds|bs|fs|hs|[aeiouyàâäéèêëïîôùûü])$/i;

const LEADING_STOP_TOKEN =
  /^(?:le|la|les|un|une|des|du|de|d'|l'|et|ou|en|au|aux|ce|ces|se|si|sur|sous|par|pour|dans|avec|sans|son|sa|ses)\s+/i;

const WORD_CHARS = /^[\p{L}\p{N}'’\-]+$/u;

/** Normalise pour comparer deux libellés (dédup soft). */
export function normalizeDisplayKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpaces(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function lastSentenceEndIndex(text: string): number {
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…" && ch !== ";") {
      continue;
    }
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next) || next === "»" || next === '"') {
      best = i;
    }
  }
  return best;
}

/** Dernier token probablement coupé au milieu (ex. « relev », « pénalit »). */
export function looksLikeTruncatedWord(token: string): boolean {
  const t = token
    .normalize("NFC")
    .replace(/^["«(\[]+/, "")
    .replace(/[)"»\],:;…]+$/, "");
  if (!t || /[\d€%]/.test(t)) return false;
  if (!/^[\p{L}'’\-]+$/u.test(t)) return false;
  if (t.length < 4) return false;
  return !FRENCH_COMPLETE_WORD_END.test(t.toLowerCase());
}

/**
 * True si le texte commence au milieu d’un mot / d’une clause
 * (ex. « evé bancaire », « tion de remboursement »).
 */
export function startsWithBrokenFragment(text: string): boolean {
  const t = normalizeSpaces(text);
  if (!t) return true;
  if (/^['’]/.test(t)) return true;
  if (BROKEN_WORD_PREFIX.test(t)) return true;
  if (/^[.,;:!?…]/.test(t)) return true;

  const first = (t.split(/\s+/)[0] ?? "")
    .replace(/^["«(\[]+/, "")
    .replace(/[)"»\],:;…]+$/, "");
  if (!first) return true;
  // Minuscule + token tronqué (ex. « relev » en tête)
  if (
    /^[a-zàâäéèêëïîôùûüç]/u.test(first) &&
    looksLikeTruncatedWord(first) &&
    !LEADING_STOP.test(first)
  ) {
    return true;
  }
  return false;
}

/**
 * True si la chaîne semble finir au milieu d’un mot / d’une clause.
 */
export function endsWithIncompleteToken(text: string): boolean {
  const t = normalizeSpaces(text);
  if (!t) return true;
  if (/[.!?…»"')\]]$/.test(t)) return false;
  if (INCOMPLETE_CLAUSE_TAIL.test(t)) return true;

  // Nouvelle phrase amorcée puis coupée : « … raison. En ca »
  if (/\.\s+[\p{L}][\p{L}\p{N}'’\-]{0,12}$/u.test(t)) {
    const afterDot = t.slice(t.lastIndexOf(".") + 1).trim();
    if (afterDot && !/[.!?…]$/.test(afterDot)) {
      const tokens = afterDot.split(/\s+/);
      if (tokens.length <= 3) return true;
    }
  }

  const last = t.split(/\s+/).pop() ?? "";
  if (!last) return true;
  if (HANGING_LAST_TOKEN.test(last)) return true;
  // Fragment 1–2 lettres hors mots français courts légitimes (ex. « ca », pas « an »)
  if (
    last.length <= 2 &&
    WORD_CHARS.test(last) &&
    !/^(an|en|un|or|eu|à|y|ok|ht)$/i.test(last)
  ) {
    return true;
  }
  // Mot qui finit par une apostrophe ouverte (l', d', qu')
  if (/['’]$/.test(last)) return true;
  if (looksLikeTruncatedWord(last)) return true;
  return false;
}

/** Retire les fragments orphelins en tête jusqu’à un début propre. */
function stripBrokenLeadingFragments(raw: string): string {
  let t = normalizeSpaces(raw);
  for (let i = 0; i < 10; i++) {
    if (!startsWithBrokenFragment(t)) break;
    const sp = t.indexOf(" ");
    if (sp < 0) return "";
    t = t.slice(sp + 1).trim();
  }
  return t;
}

function stripMidSentenceLead(raw: string): string {
  let t = raw;
  for (let i = 0; i < 8; i++) {
    if (!/^[a-zàâäéèêëïîôùûüç]/u.test(t)) break;
    const m = t.match(LEADING_STOP_TOKEN);
    if (!m) break;
    t = t.slice(m[0].length).trim();
  }
  if (/^[a-zàâäéèêëïîôùûüç]/u.test(t)) {
    const nextCap = t.search(/\s+[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ0-9«"]/);
    if (nextCap > 0 && nextCap < 64) {
      t = t.slice(nextCap).trim();
    }
  }
  return t;
}

function stripLeadingJunk(raw: string): string {
  let t = normalizeSpaces(raw);
  t = t.replace(/^[•\-–—:,.;…«"']+\s*/, "").trim();
  t = stripMidSentenceLead(t);
  t = stripBrokenLeadingFragments(t);

  if (
    /^[a-zàâäéèêëïîôùûüç]{2,10}\b/i.test(t) &&
    !LEADING_STOP.test(t) &&
    t[0] === t[0]!.toLowerCase()
  ) {
    const nextBoundary = t.search(
      /\s+(?:[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ0-9«"]|[a-zàâäéèêëïîôùûüç]{4,}\b)/,
    );
    if (nextBoundary > 0 && nextBoundary < 48) {
      t = t.slice(nextBoundary).trim();
      t = t.replace(/^[•\-–—:,.;…]+\s*/, "").trim();
    } else {
      const sp = t.indexOf(" ");
      if (sp > 0 && sp <= 10) t = t.slice(sp + 1).trim();
    }
  }

  if (/^[a-zàâäéèêëïîôùûüç]\s+/i.test(t)) {
    t = t.slice(2).trim();
  }

  if (/^(ion|ment|tions?|ences?|aires?|exes?)\b/i.test(t)) {
    const sp = t.indexOf(" ");
    t = sp > 0 ? t.slice(sp + 1).trim() : "";
  }

  return t.replace(/\.\s*[•·]\s*/g, ". ").trim();
}

/**
 * Recadre une prose pour l’UI : phrases complètes, jamais de fin « En ca ».
 * Retourne null si trop abîmé / trop court (à masquer).
 */
export function cleanProseForDisplay(
  raw: string | undefined | null,
  options: { minLength?: number } = {},
): string | null {
  const minLength = options.minLength ?? 14;
  if (!raw) return null;
  let t = stripLeadingJunk(raw);
  if (!t) return null;

  for (let i = 0; i < 14; i++) {
    if (!endsWithIncompleteToken(t) && !INCOMPLETE_CLAUSE_TAIL.test(t)) break;

    const se = lastSentenceEndIndex(t);
    if (se >= minLength) {
      const after = t.slice(se + 1).trim();
      // Queue après une phrase complète = fragment → on garde la phrase
      if (after.length > 0 && after.length < 80) {
        t = t.slice(0, se + 1).trim();
        break;
      }
    }

    const sp = t.lastIndexOf(" ");
    if (sp < minLength) {
      t = "";
      break;
    }
    t = t.slice(0, sp).trim();
  }

  if (!t || t.length < minLength) return null;
  if (endsWithIncompleteToken(t) || INCOMPLETE_CLAUSE_TAIL.test(t)) {
    const se = lastSentenceEndIndex(t);
    if (se >= minLength) t = t.slice(0, se + 1).trim();
    else return null;
  }

  if (!t || t.length < minLength) return null;
  if (endsWithIncompleteToken(t)) return null;
  if (startsWithBrokenFragment(t)) return null;
  // Début encore en minuscule = extrait/phrase cassée (sauf phrase longue déjà propre)
  if (/^[a-zàâäéèêëïîôùûüç]/u.test(t) && t.length < 90) return null;
  return t;
}

/**
 * Résumé affichable : phrases complètes uniquement.
 * Jamais un fragment du type « Le relev ».
 */
export function cleanSummaryForDisplay(
  raw: string | undefined | null,
): string | null {
  if (!raw?.trim()) return null;
  // Fragment ultra-court type « Le relev » → masquer
  if (
    endsWithIncompleteToken(raw) &&
    normalizeSpaces(raw).length < 40 &&
    lastSentenceEndIndex(raw) < 0
  ) {
    return null;
  }
  const cleaned = cleanProseForDisplay(raw, { minLength: 28 });
  if (!cleaned) return null;
  if (startsWithBrokenFragment(cleaned) || endsWithIncompleteToken(cleaned)) {
    return null;
  }

  const se = lastSentenceEndIndex(cleaned);
  if (se >= 28) {
    const sentences = cleaned.slice(0, se + 1).trim();
    return endsWithIncompleteToken(sentences) ? null : sentences;
  }

  // Sans ponctuation de fin : trop risqué (souvent coupe LLM)
  if (cleaned.length < 72 || endsWithIncompleteToken(cleaned)) {
    return null;
  }
  return cleaned;
}

/** Après une coupe brute : retire les fins / débuts de mot cassés. */
function polishTruncatedSlice(
  slice: string,
  max: number,
  options: { fromEnd?: boolean } = {},
): string {
  let t = options.fromEnd
    ? slice.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim()
    : normalizeSpaces(slice);

  if (options.fromEnd) {
    t = stripBrokenLeadingFragments(t);
    while (t && startsWithBrokenFragment(t)) {
      const sp = t.search(/\s/);
      if (sp < 0 || sp > max * 0.45) {
        t = "";
        break;
      }
      t = t.slice(sp + 1).trimStart();
    }
  }

  for (let i = 0; i < 12; i++) {
    if (!t || !endsWithIncompleteToken(t)) break;
    const sp = t.lastIndexOf(" ");
    if (sp < Math.max(8, max * 0.35)) {
      if (sp > 0 && looksLikeTruncatedWord(t.slice(sp + 1))) {
        t = t.slice(0, sp).trimEnd();
      } else {
        t = "";
      }
      break;
    }
    t = t.slice(0, sp).trimEnd();
  }

  if (t && looksLikeTruncatedWord(t.split(/\s+/).pop() ?? "")) {
    const sp = t.lastIndexOf(" ");
    t = sp > 0 ? t.slice(0, sp).trimEnd() : "";
  }

  return t;
}

/**
 * Tronque à max caractères sur une frontière propre
 * (fin de phrase > puce/ligne > espace), jamais au milieu d’un mot.
 */
export function truncateAtTextBoundary(
  text: string,
  max: number,
  options: { fromEnd?: boolean } = {},
): string {
  const raw = text.replace(/\r\n/g, "\n");
  if (raw.length <= max) {
    // Même sous max : ne jamais renvoyer une fin de mot cassée
    if (endsWithIncompleteToken(raw) && lastSentenceEndIndex(raw) < 0) {
      return polishTruncatedSlice(raw, max, options);
    }
    return raw;
  }

  if (options.fromEnd) {
    const cut = raw.slice(-max);
    const candidates = [
      cut.search(/(?<=[.!?…])\s+\S/),
      cut.indexOf("\n"),
      cut.search(/\s[•\-–—]\s/),
      cut.search(/\s/),
    ].filter((i) => i >= 0);
    const start = candidates.length > 0 ? Math.min(...candidates) + 1 : 0;
    const slice = start > 0 && start < max * 0.45 ? cut.slice(start) : cut;
    return polishTruncatedSlice(slice.replace(/^\s+\S{0,2}(?=\s)/, ""), max, {
      fromEnd: true,
    });
  }

  const cut = raw.slice(0, max);
  const sentenceEnds = [
    cut.lastIndexOf(". "),
    cut.lastIndexOf(".\n"),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
    cut.lastIndexOf("… "),
    cut.lastIndexOf(";\n"),
  ];
  const bestSentence = Math.max(...sentenceEnds);
  if (bestSentence > max * 0.5) {
    return polishTruncatedSlice(cut.slice(0, bestSentence + 1), max);
  }

  const lineBreak = Math.max(
    cut.lastIndexOf("\n"),
    cut.lastIndexOf(" • "),
    cut.lastIndexOf(" - "),
  );
  if (lineBreak > max * 0.5) {
    return polishTruncatedSlice(cut.slice(0, lineBreak), max);
  }

  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.4) {
    return polishTruncatedSlice(cut.slice(0, sp), max);
  }
  // Pas d’espace sûr → mieux vaut raccourcir qu’une coupe mid-mot
  return polishTruncatedSlice(cut, max);
}

/** Extrait / citation : phrase complète ou masqué. */
export function cleanExcerptForDisplay(
  raw: string | undefined | null,
): string | null {
  const cleaned = cleanProseForDisplay(raw, { minLength: 18 });
  if (!cleaned) return null;
  if (startsWithBrokenFragment(cleaned)) return null;
  if (/^[a-zàâäéèêëïîôùûüç]/u.test(cleaned)) return null;
  const se = lastSentenceEndIndex(cleaned);
  if (se >= 18) {
    const sentence = cleaned.slice(0, se + 1).trim();
    if (endsWithIncompleteToken(sentence) || startsWithBrokenFragment(sentence)) {
      return null;
    }
    return sentence;
  }
  if (endsWithIncompleteToken(cleaned)) return null;
  if (cleaned.length > 160) {
    const cut = truncateAtTextBoundary(cleaned, 160);
    const again = cleanProseForDisplay(cut, { minLength: 18 });
    if (!again || endsWithIncompleteToken(again) || startsWithBrokenFragment(again)) {
      return null;
    }
    return again;
  }
  return cleaned;
}

/** Titre d’affichage : nettoie coupures + borne sur espace. */
export function cleanTitleForDisplay(raw: string, max = 90): string {
  const prose = cleanProseForDisplay(raw, { minLength: 8 });
  let t = prose ?? "";
  if (!t) {
    const junk = stripLeadingJunk(raw);
    if (
      junk &&
      !endsWithIncompleteToken(junk) &&
      !startsWithBrokenFragment(junk) &&
      junk.length >= 8
    ) {
      t = junk;
    }
  }
  if (!t) return "";
  if (t.length <= max) {
    return endsWithIncompleteToken(t) ? "" : t;
  }
  const cut = truncateAtTextBoundary(t, max);
  if (!cut || endsWithIncompleteToken(cut) || startsWithBrokenFragment(cut)) {
    const se = lastSentenceEndIndex(t);
    if (se >= 20 && se <= max) return t.slice(0, se + 1).trim();
    const sp = cut.lastIndexOf(" ");
    if (sp > 20) {
      const shorter = cut.slice(0, sp).trim();
      if (!endsWithIncompleteToken(shorter) && !startsWithBrokenFragment(shorter)) {
        return `${shorter}…`;
      }
    }
    return "";
  }
  return cut.endsWith(".") || cut.endsWith("!") || cut.endsWith("?")
    ? cut
    : `${cut}…`;
}

/**
 * Déduplique en gardant le premier : clé exacte + inclusion soft (≥ 24 car.).
 */
export function dedupeDisplayItems<T>(
  items: T[],
  textOf: (item: T) => string,
): T[] {
  const out: T[] = [];
  const keys: string[] = [];

  for (const item of items) {
    const key = normalizeDisplayKey(textOf(item));
    if (key.length < 8) continue;

    let dup = false;
    for (const prev of keys) {
      if (prev === key) {
        dup = true;
        break;
      }
      if (
        key.length >= 24 &&
        prev.length >= 24 &&
        (prev.includes(key) || key.includes(prev))
      ) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    keys.push(key);
    out.push(item);
  }
  return out;
}

export function dedupeStringList(items: string[]): string[] {
  return dedupeDisplayItems(items, (s) => s);
}

const ANTICIPER_PREFIX =
  /^\s*anticiper\s+l['’]?[ée]ch[ée]ance\s*:\s*/i;

const VERIFIER_RISQUE_PREFIX =
  /^\s*v[ée]rifier\s+et\s+traiter\s+le\s+risque\s*:\s*/i;

function stripActionPrefix(raw: string): string {
  return raw
    .replace(ANTICIPER_PREFIX, "")
    .replace(VERIFIER_RISQUE_PREFIX, "")
    .replace(/^[•\-–—]+\s*/, "")
    .trim();
}

function looksLikeRealDeadline(body: string): boolean {
  if (
    /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(body)
  ) {
    return true;
  }
  if (
    /\b(r[ée]tractation|pr[ée]avis|date\s+limite|au\s+plus\s+tard|avant\s+le|sous\s+\d+\s+jours?|dans\s+\d+\s+jours?)\b/i.test(
      body,
    )
  ) {
    return true;
  }
  if (
    /\b\d+\s*(jours?|mois)\b/i.test(body) &&
    !/remboursement|p[ée]nalit|indemnit|%\s*du\s+montant/i.test(body)
  ) {
    return true;
  }
  return false;
}

/**
 * Reformule les patterns prêts / pénalités courants en action courte.
 */
export function reformulateActionSnippet(raw: string): string | null {
  const body = stripActionPrefix(normalizeSpaces(raw));
  if (!body) return null;

  const pctMatch = body.match(
    /(?:^|[^0-9])(0\s*[,.]?\s*5|1(?:[.,]0)?)\s*%/i,
  );
  if (
    pctMatch &&
    /remboursement\s+anticip|indemnit[ée].{0,60}anticip|cr[ée]dit\s+faisant\s+l['’]objet/i.test(
      body,
    )
  ) {
    const rawPct = pctMatch[1]!.replace(/\s/g, "").replace(".", ",");
    const isHalf = rawPct.startsWith("0");
    if (isHalf) {
      return "Remboursement anticipé : pénalité de 0,5 % s’il reste moins d’un an.";
    }
    return "Remboursement anticipé : pénalité de 1 % s’il reste plus d’un an.";
  }

  const retractDays = body.match(
    /r[ée]tractation[^0-9]{0,40}?(\d+)\s*jours?|(\d+)\s*jours?[^.]{0,40}r[ée]tractation/i,
  );
  if (retractDays || /^d[ée]lai\s+de\s+r[ée]tractation/i.test(body)) {
    const days = retractDays?.[1] || retractDays?.[2] || "14";
    return `Délai de rétractation : ${days} jours.`;
  }

  return null;
}

/**
 * Action affichable : reformule, nettoie, ou masque si tronquée.
 */
export function cleanActionForDisplay(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  const t = normalizeSpaces(raw);
  if (!t) return null;

  // Reformuler d’abord (sauve l’info utile même si la queue est coupée).
  const reformulated = reformulateActionSnippet(t);
  if (reformulated) {
    return endsWithIncompleteToken(reformulated) ? null : reformulated;
  }

  // Action déjà clairement cassée (ex. « si le délai entre »)
  if (
    INCOMPLETE_CLAUSE_TAIL.test(t) &&
    t.length < 80 &&
    lastSentenceEndIndex(t) < 0
  ) {
    return null;
  }

  const hadAnticiper = ANTICIPER_PREFIX.test(t);
  const body = stripActionPrefix(t);

  const cleanedBody = cleanProseForDisplay(body, { minLength: 12 });
  if (!cleanedBody) return null;
  if (endsWithIncompleteToken(cleanedBody) || startsWithBrokenFragment(cleanedBody)) {
    return null;
  }

  const finalize = (action: string): string | null => {
    if (action.length <= 160) {
      return endsWithIncompleteToken(action) ? null : action;
    }
    const short = truncateAtTextBoundary(action, 157);
    const again = cleanProseForDisplay(short, { minLength: 12 });
    if (!again || endsWithIncompleteToken(again) || startsWithBrokenFragment(again)) {
      return null;
    }
    return again;
  };

  if (hadAnticiper) {
    if (!looksLikeRealDeadline(cleanedBody)) {
      if (
        /^(v[ée]rifier|adresser|contester|n[ée]gocier|demander|noter|consulter|comparer|calculer|lire)\b/i.test(
          cleanedBody,
        )
      ) {
        return finalize(cleanedBody);
      }
      if (cleanedBody.length > 90 || /^[-–—0-9]/.test(cleanedBody)) {
        return null;
      }
      return finalize(cleanedBody);
    }
    return finalize(`Anticiper l'échéance : ${cleanedBody}`);
  }

  return finalize(cleanedBody);
}

/** Liste d’actions prête pour l’UI / le stockage post-enrich. */
export function cleanActionsForDisplay(items: string[]): string[] {
  const cleaned = items
    .map((item) => cleanActionForDisplay(item))
    .filter((item): item is string => Boolean(item));
  return dedupeStringList(cleaned).slice(0, 8);
}
