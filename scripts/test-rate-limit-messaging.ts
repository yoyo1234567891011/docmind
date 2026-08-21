import assert from "node:assert/strict";
import { sanitizeAnalysisFailureMessage } from "../src/lib/sanitize";

const groqRaw = `{"error":{"message":"Rate limit reached for model \`openai/gpt-oss-120b\` in organization \`org_x\` service tier \`on_demand\` on tokens per minute (TPM): Limit 8000, Used 7642, Requested 7536. Please try again in 53.835s.","type":"tokens","code":"rate_limit_exceeded"}}`;

const msg = sanitizeAnalysisFailureMessage(groqRaw);
assert.match(msg, /saturé|minute/i);
assert.doesNotMatch(msg, /gpt-oss|7536|org_/);

const friendly = sanitizeAnalysisFailureMessage(
  "Le service d’analyse est temporairement saturé (limite de débit). Réessayez dans environ une minute — le document uploadé est conservé.",
);
assert.match(friendly, /saturé/);

console.log("OK rate-limit user messaging");
