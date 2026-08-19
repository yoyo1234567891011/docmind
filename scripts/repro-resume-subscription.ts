import { loadEnvFiles } from "./lib/load-env-files";
loadEnvFiles(process.cwd(), { override: true });

import {
  cancelPremiumSubscription,
  resumePremiumSubscription,
} from "../src/services/billing/cancel";
import { getUserSubscription } from "../src/services/billing/store";

const userId = process.argv[2] || "70ca281b-6195-4145-afab-d8969f0da46c";

async function main() {
  await cancelPremiumSubscription({ userId, immediately: false });
  let sub = await getUserSubscription(userId);
  console.log("after cancel:", { cancelAtPeriodEnd: sub.cancelAtPeriodEnd });

  await resumePremiumSubscription(userId);
  sub = await getUserSubscription(userId);
  console.log("after resume:", { cancelAtPeriodEnd: sub.cancelAtPeriodEnd, plan: sub.plan });
  console.log("OK resume cycle");
}

main().catch((e) => {
  console.error("FAIL:", e?.message ?? e);
  if (e?.raw?.message) console.error("stripe:", e.raw.message);
  process.exit(1);
});
