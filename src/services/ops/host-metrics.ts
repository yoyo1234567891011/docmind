import { cpus, freemem, totalmem } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import type { HostMetricsSample } from "@/types/production";

export type { HostMetricsSample };

const execFileAsync = promisify(execFile);

let prevCpu: { idle: number; total: number } | null = null;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.irq +
      cpu.times.idle;
  }
  return { idle, total };
}

function sampleCpuPercent(): number | null {
  const now = cpuTimes();
  if (!prevCpu) {
    prevCpu = now;
    return null;
  }
  const idleDelta = now.idle - prevCpu.idle;
  const totalDelta = now.total - prevCpu.total;
  prevCpu = now;
  if (totalDelta <= 0) return null;
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
}

async function sampleNvidia(): Promise<{
  gpuPercent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2_500, windowsHide: true },
    );
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) {
      return { gpuPercent: null, vramUsedMb: null, vramTotalMb: null };
    }
    const gpuPercent = Number(parts[0]);
    const vramUsedMb = Number(parts[1]);
    const vramTotalMb = Number(parts[2]);
    return {
      gpuPercent: Number.isFinite(gpuPercent) ? gpuPercent : null,
      vramUsedMb: Number.isFinite(vramUsedMb) ? vramUsedMb : null,
      vramTotalMb: Number.isFinite(vramTotalMb) ? vramTotalMb : null,
    };
  } catch {
    return { gpuPercent: null, vramUsedMb: null, vramTotalMb: null };
  }
}

/** Échantillon hôte (CPU/RAM + nvidia-smi si dispo). */
export async function sampleHostMetrics(): Promise<HostMetricsSample> {
  // Deux lectures CPU pour un % utilisable dès le premier appel dashboard.
  sampleCpuPercent();
  await new Promise((r) => setTimeout(r, 120));
  const cpuPercent = sampleCpuPercent();

  const ramTotalMb = Math.round(totalmem() / (1024 * 1024));
  const ramUsedMb = Math.round((totalmem() - freemem()) / (1024 * 1024));
  const ramPercent =
    ramTotalMb > 0 ? Math.round((ramUsedMb / ramTotalMb) * 1000) / 10 : 0;

  const gpu = await sampleNvidia();
  const vramPercent =
    gpu.vramUsedMb != null && gpu.vramTotalMb && gpu.vramTotalMb > 0
      ? Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 1000) / 10
      : null;

  return {
    at: new Date().toISOString(),
    cpuPercent,
    ramUsedMb,
    ramTotalMb,
    ramPercent,
    gpuPercent: gpu.gpuPercent,
    vramUsedMb: gpu.vramUsedMb,
    vramTotalMb: gpu.vramTotalMb,
    vramPercent,
    source: gpu.gpuPercent != null ? "nvidia-smi" : "host-only",
  };
}
