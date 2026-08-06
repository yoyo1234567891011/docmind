/**
 * Dev launcher — empêche le double serveur (3000/3001) et vérifie Ollama.
 *
 * Usage: npm run dev
 */
import { spawn, execSync } from "child_process";
import { createServer } from "net";

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
)
  .replace(/\/$/, "")
  .replace(/^http:\/\/localhost/i, "http://127.0.0.1");

function log(message) {
  console.log(`[docmind:dev] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // Tester sur 0.0.0.0 (même bind que Next) pour détecter un conflit réel
    server.listen(port, "0.0.0.0");
  });
}

function killPortWindows(port) {
  try {
    const stdout = execSync(`netstat -ano | findstr :${port}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const pids = new Set();
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        log(`Processus ${pid} libéré (port ${port}).`);
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing listening
  }
}

async function freePort(port) {
  // Toujours tenter un kill Windows (isPortFree peut mentir selon le bind)
  if (process.platform === "win32") {
    killPortWindows(port);
    await sleep(600);
  }

  if (await isPortFree(port)) return;

  log(`Port ${port} encore occupé — 2ᵉ tentative…`);
  if (process.platform === "win32") {
    killPortWindows(port);
  } else {
    try {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore" });
    } catch {
      // ignore
    }
  }
  await sleep(1000);
  if (!(await isPortFree(port))) {
    throw new Error(
      `Impossible de libérer le port ${port}. Ferme l'autre terminal npm run dev, puis réessaie.`,
    );
  }
}

async function ollamaUp() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllama() {
  if (await ollamaUp()) {
    log(`Ollama OK (${OLLAMA_URL}).`);
    return;
  }

  log("Ollama injoignable — tentative de démarrage…");
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    if (await ollamaUp()) {
      log("Ollama démarré.");
      return;
    }
  }

  console.warn(
    `[docmind:dev] Ollama toujours injoignable sur ${OLLAMA_URL}.\n` +
      "  → Ouvrez l'application Ollama (barre des tâches), puis réessayez.",
  );
}

async function main() {
  await freePort(PORT);
  await ensureOllama();

  // 0.0.0.0 : accepte localhost (IPv4/IPv6) et 127.0.0.1
  // (sinon Failed to fetch si le navigateur résout localhost → ::1)
  log(`Démarrage Next.js sur http://localhost:${PORT}`);
  const nextBin =
    process.platform === "win32"
      ? "node_modules\\next\\dist\\bin\\next"
      : "node_modules/next/dist/bin/next";
  const next = spawn(
    process.execPath,
    [nextBin, "dev", "--turbopack", "-H", "0.0.0.0", "-p", String(PORT)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(PORT),
        OLLAMA_BASE_URL: OLLAMA_URL,
      },
      shell: false,
      windowsHide: true,
    },
  );

  next.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  const stop = () => {
    if (!next.killed) next.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(`[docmind:dev] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
