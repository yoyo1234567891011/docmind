/**
 * Retire tous les éléments des listes Radar Stripe de type "block"
 * (emails, customer IDs, fingerprints, etc.).
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/unblock-stripe-radar-lists.ts
 *        npx tsx ... --dry-run   (liste sans supprimer)
 */
import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });

import { getStripe } from "../src/lib/stripe";

const dryRun = process.argv.includes("--dry-run");

function mask(value: string): string {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

async function listAllBlockLists() {
  const stripe = getStripe();
  const lists: Array<{
    id: string;
    name: string;
    alias: string;
    itemType: string;
    listType: string;
  }> = [];

  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.radar.valueLists.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const list of page.data) {
      const isBlock = /block/i.test(list.alias);
      if (isBlock) {
        lists.push({
          id: list.id,
          name: list.name,
          alias: list.alias,
          itemType: list.item_type,
          listType: "block",
        });
      }
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
  return lists;
}

async function listItems(valueListId: string) {
  const stripe = getStripe();
  const items: Array<{ id: string; value: string }> = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.radar.valueListItems.list({
      value_list: valueListId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const item of page.data) {
      items.push({ id: item.id, value: item.value });
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
  return items;
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.error("STRIPE_SECRET_KEY manquant (.env.local).");
    process.exit(1);
  }
  const mode = key.startsWith("sk_live_") ? "live" : "test";
  console.log(`Mode Stripe: ${mode}${dryRun ? " (dry-run)" : ""}`);

  const blockLists = await listAllBlockLists();
  if (blockLists.length === 0) {
    console.log("Aucune liste Radar de type block trouvée.");
    return;
  }

  let totalRemoved = 0;
  for (const list of blockLists) {
    const items = await listItems(list.id);
    console.log(
      `\nListe block: ${list.name} (${list.alias}, type=${list.itemType}) — ${items.length} entrée(s)`,
    );
    for (const item of items) {
      console.log(`  - ${mask(item.value)}`);
      if (!dryRun) {
        const stripe = getStripe();
        await stripe.radar.valueListItems.del(item.id);
        totalRemoved += 1;
      }
    }
  }

  if (dryRun) {
    console.log("\nDry-run terminé — rien supprimé.");
  } else {
    console.log(`\nOK — ${totalRemoved} entrée(s) retirée(s) des listes block.`);
  }
}

main().catch((err) => {
  console.error("Échec:", err instanceof Error ? err.message : err);
  process.exit(1);
});
