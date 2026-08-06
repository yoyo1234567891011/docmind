import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT || 3010);
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/report" }],
  ],
  outputDir: "e2e/test-results",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "fr-FR",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run e2e:prepare && npx next dev --turbopack -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // Toujours démarrer un serveur dédié e2e (évite un .env.local Supabase sans session)
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 180_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_ENV: "development",
      DOCMIND_SKIP_ENV_ASSERT: "1",
      // Mode local-dev déterministe sauf PLAYWRIGHT_USE_SUPABASE=1
      ...(process.env.PLAYWRIGHT_USE_SUPABASE === "1"
        ? {}
        : {
            NEXT_PUBLIC_SUPABASE_URL: "",
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
          }),
    },
  },
});
