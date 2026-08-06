import { cpus, freemem, totalmem } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import type { SystemSample } from "./types";

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

function cpuPercent(): number | null {
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

async function gpuSample(): Promise<{
  gpuPercent: number | null;
  gpuMemUsedMb: number | null;
  gpuMemTotalMb: number | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 2500, windowsHide: true },
    );
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) {
      return { gpuPercent: null, gpuMemUsedMb: null, gpuMemTotalMb: null };
    }
    return {
      gpuPercent: Number(parts[0]),
      gpuMemUsedMb: Number(parts[1]),
      gpuMemTotalMb: Number(parts[2]),
    };
  } catch {
    return { gpuPercent: null, gpuMemUsedMb: null, gpuMemTotalMb: null };
  }
}

export async function sampleSystem(): Promise<SystemSample> {
  const cpu = cpuPercent();
  const ramTotalMb = Math.round(totalmem() / (1024 * 1024));
  const ramUsedMb = Math.round((totalmem() - freemem()) / (1024 * 1024));
  const gpu = await gpuSample();
  return {
    at: new Date().toISOString(),
    cpuPercent: cpu,
    ramUsedMb,
    ramTotalMb,
    gpuPercent: gpu.gpuPercent,
    gpuMemUsedMb: gpu.gpuMemUsedMb,
    gpuMemTotalMb: gpu.gpuMemTotalMb,
  };
}

export function startSystemMonitor(intervalMs = 2000): {
  stop: () => SystemSample[];
} {
  const samples: SystemSample[] = [];
  const timer = setInterval(() => {
    void sampleSystem().then((s) => samples.push(s));
  }, intervalMs);
  // kick first sample
  void sampleSystem().then((s) => samples.push(s));
  return {
    stop: () => {
      clearInterval(timer);
      return samples;
    },
  };
}

export function summarizeSystemSamples(samples: SystemSample[]) {
  const avg = (vals: Array<number | null>) => {
    const n = vals.filter((v): v is number => typeof v === "number");
    if (n.length === 0) return null;
    return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10;
  };
  const max = (vals: Array<number | null>) => {
    const n = vals.filter((v): v is number => typeof v === "number");
    if (n.length === 0) return null;
    return Math.max(...n);
  };
  const ramPct = samples.map((s) =>
    s.ramUsedMb != null && s.ramTotalMb
      ? (s.ramUsedMb / s.ramTotalMb) * 100
      : null,
  );
  return {
    avgCpuPercent: avg(samples.map((s) => s.cpuPercent)),
    maxCpuPercent: max(samples.map((s) => s.cpuPercent)),
    avgRamPercent: avg(ramPct),
    maxRamPercent: max(ramPct),
    avgGpuPercent: avg(samples.map((s) => s.gpuPercent)),
    maxGpuPercent: max(samples.map((s) => s.gpuPercent)),
  };
}
