"use client";

/**
 * Lecture orale de l’analyse (Web Speech API navigateur).
 * Tout le TTS est ici — pas de flag, pas d’API cloud.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type AnalysisTtsWatchPoint = {
  title: string;
  explanation: string;
};

export type AnalysisTtsButtonProps = {
  /** Change → cancel() (changement de document). */
  documentKey?: string;
  title: string;
  summary: string;
  watchPoints: AnalysisTtsWatchPoint[];
  actions: string[];
  className?: string;
};

type PlayState = "idle" | "speaking" | "paused";

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function hasSpeechSynthesis(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/** Découpe en paragraphes / phrases courtes (évite la coupe Chrome). */
function splitIntoUtterances(text: string): string[] {
  const chunks: string[] = [];
  for (const block of text.split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 220) {
      chunks.push(trimmed);
      continue;
    }
    const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
    let buf = "";
    for (const raw of sentences) {
      const s = raw.trim();
      if (!s) continue;
      if (!buf) {
        buf = s;
      } else if (buf.length + 1 + s.length <= 220) {
        buf = `${buf} ${s}`;
      } else {
        chunks.push(buf);
        buf = s;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}

function buildScript(props: {
  title: string;
  summary: string;
  watchPoints: AnalysisTtsWatchPoint[];
  actions: string[];
}): string[] {
  const out: string[] = [];

  out.push("Résumé.");
  const title = props.title.trim();
  if (title) out.push(...splitIntoUtterances(title));
  const summary = props.summary.trim();
  if (summary) out.push(...splitIntoUtterances(summary));

  const points = props.watchPoints.filter(
    (p) => p.title.trim() || p.explanation.trim(),
  );
  if (points.length > 0) {
    out.push("Points à surveiller.");
    for (const p of points) {
      const line = [p.title.trim(), p.explanation.trim()]
        .filter(Boolean)
        .join(". ");
      if (line) out.push(...splitIntoUtterances(line));
    }
  }

  const actions = props.actions.map((a) => a.trim()).filter(Boolean);
  if (actions.length > 0) {
    out.push("Que faire ensuite.");
    for (const a of actions) {
      out.push(...splitIntoUtterances(a));
    }
  }

  return out;
}

function pickFrenchVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith("fr-fr")) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("fr")) ??
    undefined
  );
}

function cancelSpeech(): void {
  if (!hasSpeechSynthesis()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Bouton lecture orale — toujours dans le DOM (pas de return null SSR).
 * Activé après mount si speechSynthesis est dispo.
 */
export function AnalysisTtsButton({
  documentKey,
  title,
  summary,
  watchPoints,
  actions,
  className,
}: AnalysisTtsButtonProps) {
  const [canSpeak, setCanSpeak] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const indexRef = useRef(0);
  const scriptRef = useRef<string[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
  const speakingRef = useRef(false);

  const script = useMemo(
    () =>
      buildScript({
        title,
        summary,
        watchPoints,
        actions,
      }),
    [title, summary, watchPoints, actions],
  );

  const stop = useCallback(() => {
    speakingRef.current = false;
    indexRef.current = 0;
    cancelSpeech();
    setPlayState("idle");
  }, []);

  const speakFrom = useCallback((startIndex: number) => {
    if (!hasSpeechSynthesis()) return;
    const parts = scriptRef.current;
    if (startIndex >= parts.length) {
      speakingRef.current = false;
      indexRef.current = 0;
      setPlayState("idle");
      return;
    }

    speakingRef.current = true;
    setPlayState("speaking");

    const utter = new SpeechSynthesisUtterance(parts[startIndex]);
    utter.lang = "fr-FR";
    utter.rate = 0.95;
    utter.volume = 1;
    if (voiceRef.current) utter.voice = voiceRef.current;

    utter.onend = () => {
      if (!speakingRef.current) return;
      const next = startIndex + 1;
      indexRef.current = next;
      if (next >= parts.length) {
        speakingRef.current = false;
        indexRef.current = 0;
        setPlayState("idle");
        return;
      }
      speakFrom(next);
    };
    utter.onerror = () => {
      speakingRef.current = false;
      indexRef.current = 0;
      setPlayState("idle");
    };

    window.speechSynthesis.speak(utter);
  }, []);

  const start = useCallback(() => {
    if (!hasSpeechSynthesis() || script.length === 0) return;
    cancelSpeech();
    scriptRef.current = script;
    voiceRef.current = pickFrenchVoice();
    indexRef.current = 0;
    speakFrom(0);
  }, [script, speakFrom]);

  const pause = useCallback(() => {
    if (!hasSpeechSynthesis()) return;
    try {
      window.speechSynthesis.pause();
      setPlayState("paused");
    } catch {
      /* ignore */
    }
  }, []);

  const resume = useCallback(() => {
    if (!hasSpeechSynthesis()) return;
    try {
      window.speechSynthesis.resume();
      setPlayState("speaking");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const ok = hasSpeechSynthesis();
    setCanSpeak(ok);
    setUnsupported(!ok);
    // DEBUG temporaire
    console.log(`TTS mount canSpeak=${ok}`);
    if (!ok) return;
    const refresh = () => {
      voiceRef.current = pickFrenchVoice();
    };
    refresh();
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
      speakingRef.current = false;
      cancelSpeech();
    };
  }, []);

  useEffect(() => {
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on document change only
  }, [documentKey]);

  if (unsupported) {
    return (
      <p
        className={cn("text-sm text-[var(--muted)]", className)}
        data-testid="analysis-tts-unavailable"
      >
        Lecture vocale non disponible sur ce navigateur
      </p>
    );
  }

  const ready = canSpeak && script.length > 0;

  if (playState === "idle") {
    return (
      <div className={cn("flex w-full sm:w-auto", className)}>
        <Button
          type="button"
          variant="primary"
          size="md"
          data-testid="analysis-tts"
          aria-label="Écouter l’analyse"
          disabled={!ready}
          onClick={start}
          className="h-11 w-full px-5 text-sm font-semibold sm:w-auto"
        >
          <SpeakerIcon className="h-4 w-4 shrink-0" />
          Écouter l’analyse
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end",
        className,
      )}
      data-testid="analysis-tts-controls"
    >
      {playState === "speaking" ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          data-testid="analysis-tts"
          aria-label="Mettre en pause la lecture"
          onClick={pause}
          className="h-11 flex-1 px-5 text-sm font-semibold sm:flex-none"
        >
          Pause
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="md"
          data-testid="analysis-tts"
          aria-label="Reprendre la lecture"
          onClick={resume}
          className="h-11 flex-1 px-5 text-sm font-semibold sm:flex-none"
        >
          Reprendre
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        size="md"
        aria-label="Arrêter la lecture"
        onClick={stop}
        className="h-11 flex-1 px-5 text-sm font-semibold sm:flex-none"
      >
        Stop
      </Button>
    </div>
  );
}
