/**
 * Vérifie que le prompt core-bundle contient les garde-fous correctif #5
 * sans casser les priorités bail / MED / taxe.
 * npx tsx scripts/test-core-bundle-prompt.ts
 */
import assert from "node:assert/strict";
import { buildCoreBundlePrompt } from "../src/ai/agents/prompts/core-bundle";

const prompt = buildCoreBundlePrompt({
  categoryLabel: "Bail",
  documentText: "BAIL D'HABITATION\nLoyer mensuel : 1 050 €.\n",
  localFacts: {
    date: "",
    dates: [],
    people: [],
    organizations: [],
    amounts: ["1 050 € — Loyer mensuel"],
    deadlines: [],
    clauses: [],
  },
});

assert.match(prompt, /FACTUEL UNIQUEMENT/);
assert.match(prompt, /INTERDIT D['’]INVENTER/);
assert.match(prompt, /ANTI-VAGUE/);
assert.match(prompt, /Omettre plutôt qu['’]inventer/);
assert.match(prompt, /bail\/location/);
assert.match(prompt, /loyer/);
assert.match(prompt, /d[ée]p[ôo]t/);
assert.match(prompt, /mise en demeure/);
assert.match(prompt, /taxe fonci[eè]re/i);
assert.match(prompt, /JAMAIS produit national|totaux nationaux/i);
assert.match(prompt, /obligation de payer/);
assert.match(prompt, /FAITS_LOCAUX/);
assert.match(prompt, /1 050 € — Loyer mensuel/);
assert.doesNotMatch(prompt, /change(?:r)?\s+de\s+mod[eè]le/i);

console.log("OK core-bundle prompt guards", {
  length: prompt.length,
  hasBail: /bail\/location/.test(prompt),
  hasMed: /mise en demeure/.test(prompt),
  hasTaxe: /taxe fonci/i.test(prompt),
});
