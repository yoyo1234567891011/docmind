/**
 * Child worker pour test crash-process — claim puis sleep infini.
 * Args: --marker <path> --lease-ms <n>
 */
async function main() {
  process.env.DOCMIND_STORAGE = process.env.DOCMIND_STORAGE || "fs";
  process.env.DOCMIND_FS_FALLBACK = process.env.DOCMIND_FS_FALLBACK || "0";

  const argv = process.argv.slice(2);
  let marker = "";
  let leaseMs = 2500;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--marker") marker = argv[++i] || "";
    else if (argv[i] === "--lease-ms") leaseMs = Number(argv[++i]) || 2500;
  }
  if (!marker) {
    console.error("marker requis");
    process.exit(2);
  }

  const { claimNextAnalysisJob } = await import(
    "../src/services/analysis-jobs"
  );
  const claimed = await claimNextAnalysisJob("child-worker", leaseMs);
  if (!claimed) {
    console.error("NO_CLAIM");
    process.exit(2);
  }
  const { writeFile } = await import("fs/promises");
  await writeFile(
    marker,
    JSON.stringify({
      id: claimed.id,
      claimedBy: claimed.claimedBy,
      leaseExpiresAt: claimed.leaseExpiresAt,
    }),
    "utf8",
  );
  await new Promise(() => {
    /* hang until killed */
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
