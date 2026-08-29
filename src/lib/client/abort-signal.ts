/** Timeout fetch — polyfill si AbortSignal.timeout absent (navigateurs anciens). */
export function abortSignalTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Timeout", "TimeoutError"));
  }, ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), {
    once: true,
  });
  return controller.signal;
}

/** Combine plusieurs signaux — polyfill si AbortSignal.any absent (Safari < 17.4, etc.). */
export function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
  }

  const onAbort = () => {
    const reason = signals.find((s) => s.aborted)?.reason;
    controller.abort(reason);
    for (const signal of signals) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  for (const signal of signals) {
    signal.addEventListener("abort", onAbort);
  }

  return controller.signal;
}
