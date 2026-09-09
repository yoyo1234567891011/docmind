import assert from "node:assert/strict";
import {
  MIN_EXTRACTABLE_TEXT_CHARS,
  countExtractableChars,
  hasSufficientExtractableText,
  NO_EXTRACTABLE_TEXT_MESSAGE,
} from "../src/services/pdf/text-sufficiency";

assert.equal(hasSufficientExtractableText(""), false);
assert.equal(hasSufficientExtractableText("   \n\t  "), false);
assert.equal(hasSufficientExtractableText("<<<PAGE 1>>>\n\n"), false);
assert.equal(
  hasSufficientExtractableText("abc"),
  false,
  "below threshold",
);
assert.ok(
  hasSufficientExtractableText("a".repeat(MIN_EXTRACTABLE_TEXT_CHARS)),
);
assert.ok(
  hasSufficientExtractableText(
    `<<<PAGE 1>>>\n${"Contrat d'abonnement fibre engagement 24 mois.".repeat(2)}`,
  ),
);
assert.equal(countExtractableChars("a b\nc"), 3);
assert.ok(NO_EXTRACTABLE_TEXT_MESSAGE.includes("scannée"));

console.log("OK text-sufficiency");
