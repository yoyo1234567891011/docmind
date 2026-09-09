/**
 * Dev contre cloud bêta (opt-in) — charge .env.cloud-beta.local
 * Usage: npm run dev:cloud-beta
 */
process.env.DOCMIND_CLOUD_BETA = "1";
await import("./dev.mjs");
