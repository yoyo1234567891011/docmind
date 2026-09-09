/**
 * Smoke test : nettoyage d’extraits + résumé tronqué + actions.
 * npx tsx scripts/test-display-cleanup.ts
 */
import {
  cleanActionForDisplay,
  cleanActionsForDisplay,
  cleanExcerptForDisplay,
  cleanProseForDisplay,
  cleanSummaryForDisplay,
  cleanTitleForDisplay,
  endsWithIncompleteToken,
  looksLikeTruncatedWord,
  startsWithBrokenFragment,
  truncateAtTextBoundary,
} from "../src/ai/post-processing/display-cleanup";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(looksLikeTruncatedWord("relev") === true, "relev should be truncated");
assert(looksLikeTruncatedWord("relevé") === false, "relevé should be complete");
assert(endsWithIncompleteToken("Le relev") === true, "Le relev incomplete");
assert(
  startsWithBrokenFragment("tion de remboursement anticipé") === true,
  "broken prefix",
);
assert(
  startsWithBrokenFragment("Commission d’intervention de 15 €") === false,
  "good start",
);

const badSummary = cleanSummaryForDisplay("Le relev");
assert(badSummary === null, `summary « Le relev » must be null, got « ${badSummary} »`);

const goodSummary = cleanSummaryForDisplay(
  "Le relevé bancaire présente des frais de commission d’intervention et des intérêts débiteurs.",
);
assert(goodSummary !== null, "good summary expected");
assert(!endsWithIncompleteToken(goodSummary!), `still incomplete: ${goodSummary}`);

const midStart = cleanExcerptForDisplay(
  "de mouvement de 2,76 € hors forfait appliqué sur le compte.",
);
assert(
  midStart === null || !/^de\b/i.test(midStart),
  `mid-start excerpt bad: « ${midStart} »`,
);
assert(
  midStart === null || !startsWithBrokenFragment(midStart),
  `mid-start still broken: « ${midStart} »`,
);

const cutTail = cleanExcerptForDisplay(
  "Commission d’intervention de 15 €. Pénalités : intérêts débiteurs",
);
assert(
  cutTail === null || /\.$/.test(cutTail),
  `cut tail must end sentence or null: « ${cutTail} »`,
);
assert(
  cutTail === null || !/intérêts débiteurs$/i.test(cutTail || ""),
  `should not keep hanging clause: « ${cutTail} »`,
);

const retractCut =
  "Vous avez le droit de vous rétracter sans payer de pénalités et sans avoir à indiquer de raison. En ca";
const cleanedRetract = cleanProseForDisplay(retractCut);
assert(cleanedRetract !== null, "retract should clean");
assert(!/En ca|En$/i.test(cleanedRetract!), `still incomplete: « ${cleanedRetract} »`);

// Correctif #4 — actions tronquées
const badAction = cleanActionForDisplay("si le délai entre");
assert(badAction === null, `action « si le délai entre » must be null, got « ${badAction} »`);

const cutAction = cleanActionForDisplay(
  "Vérifier le TAEG et la pénalité de remboursement anticipé si le délai entre",
);
assert(
  cutAction === null || !/si le d[ée]lai entre$/i.test(cutAction),
  `cut action still hanging: « ${cutAction} »`,
);

const goodAction = cleanActionForDisplay(
  "Comparer le TAEG et la pénalité de remboursement anticipé avant de signer.",
);
assert(goodAction !== null, "good action expected");

const actions = cleanActionsForDisplay([
  "Le relev",
  "si le délai entre",
  "Noter la date de prélèvement sur le relevé bancaire.",
  "Anticiper l'échéance : si le",
]);
assert(
  actions.every((a) => !endsWithIncompleteToken(a) && !startsWithBrokenFragment(a)),
  `actions still incomplete: ${JSON.stringify(actions)}`,
);
assert(
  actions.some((a) => /pr[ée]l[eè]vement|relev[ée]/i.test(a)),
  `useful bank action lost: ${JSON.stringify(actions)}`,
);

// Banque : résumé / extrait
const bankExcerpt = cleanExcerptForDisplay(
  "levé bancaire du 12/03. Commission d’intervention de 8,00 € appliquée deux fois.",
);
assert(
  bankExcerpt === null ||
    (!startsWithBrokenFragment(bankExcerpt) &&
      !endsWithIncompleteToken(bankExcerpt)),
  `bank excerpt bad: « ${bankExcerpt} »`,
);

// Offre de prêt : action reformulée
const loanAction = cleanActionForDisplay(
  "Anticiper l'échéance : remboursement anticipé faisant l'objet d'une indemnité de 1 % du capital restant dû si le délai entre",
);
assert(loanAction !== null, "loan action should be reformulated");
assert(
  /remboursement anticip|p[ée]nalit/i.test(loanAction!),
  `loan action bad: « ${loanAction} »`,
);
assert(
  !/si le d[ée]lai entre/i.test(loanAction!),
  `loan action still cut: « ${loanAction} »`,
);

// Doc long : truncate sans coupe mid-mot
const long =
  "Le contrat de prêt immobilier fixe un capital de 220 000 €, un TAEG de 3,45 %, une mensualité de 1 120 € et une pénalité de remboursement anticipé. " +
  "Le emprunteur dispose d'un délai de rétractation de 14 jours. " +
  "Les frais de dossier s'élèvent à 500 €. " +
  "L'assurance emprunteur est obligatoire pendant toute la durée du crédit.";
const truncated = truncateAtTextBoundary(long, 120);
assert(truncated.length <= 120, `truncate too long: ${truncated.length}`);
assert(
  !endsWithIncompleteToken(truncated),
  `long truncate incomplete: « ${truncated} »`,
);
assert(
  !looksLikeTruncatedWord(truncated.split(/\s+/).pop() ?? ""),
  `long truncate mid-word: « ${truncated} »`,
);

const midWordCut = truncateAtTextBoundary("CommissionInterventionSansEspace", 12);
assert(
  midWordCut === "" || !endsWithIncompleteToken(midWordCut) || midWordCut.length < 12,
  `mid-word hard cut leaked: « ${midWordCut} »`,
);

const titleOk = cleanTitleForDisplay("Commission d’intervention : 15 €");
assert(titleOk.length > 0, "title should survive");
const titleBad = cleanTitleForDisplay("Le relev");
assert(titleBad === "" || !endsWithIncompleteToken(titleBad), `bad title: « ${titleBad} »`);

console.log("OK display-cleanup truncate", {
  badSummary,
  goodSummary,
  midStart,
  cutTail,
  cleanedRetract,
  badAction,
  cutAction,
  goodAction,
  actions,
  bankExcerpt,
  loanAction,
  truncated,
  titleOk,
});
