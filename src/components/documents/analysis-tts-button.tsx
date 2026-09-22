"use client";

/**
 * Lecture orale de l’analyse (Web Speech API) — feature flag NEXT_PUBLIC_TTS_ENABLED=1.
 * Tout le TTS est ici pour pouvoir supprimer le fichier + l’import unique.
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

function isTtsFlagEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TTS_ENABLED === "1";
}

function hasSpeechSynthesis(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
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

function useAnalysisTts(props: {
  documentKey?: string;
  title: string;
  summary: string;
  watchPoints: AnalysisTtsWatchPoint[];
  actions: string[];
}) {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [supported, setSupported] = useState<boolean | null>(null);
  const indexRef = useRef(0);
  const scriptRef = useRef<string[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
  const speakingRef = useRef(false);

  const script = useMemo(
    () =>
      buildScript({
        title: props.title,
        summary: props.summary,
        watchPoints: props.watchPoints,
        actions: props.actions,
      }),
    [props.title, props.summary, props.watchPoints, props.actions],
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
    if (!hasSpeechSynthesis()) return;
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
    setSupported(hasSpeechSynthesis());
    if (!hasSpeechSynthesis()) return;
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
  }, [props.documentKey]);

  return {
    supported,
    playState,
    canSpeak: script.length > 0,
    start,
    pause,
    resume,
    stop,
  };
}

/**
 * Bouton lecture orale — rendu uniquement si NEXT_PUBLIC_TTS_ENABLED=1.
 */
export function AnalysisTtsButton({
  documentKey,
  title,
  summary,
  watchPoints,
  actions,
  className,
}: AnalysisTtsButtonProps) {
  if (!isTtsFlagEnabled()) {
    return null;
  }

  return (
    <AnalysisTtsButtonInner
      documentKey={documentKey}
      title={title}
      summary={summary}
      watchPoints={watchPoints}
      actions={actions}
      className={className}
    />
  );
}

function AnalysisTtsButtonInner({
  documentKey,
  title,
  summary,
  watchPoints,
  actions,
  className,
}: AnalysisTtsButtonProps) {
  const { supported, playState, canSpeak, start, pause, resume, stop } =
    useAnalysisTts({
      documentKey,
      title,
      summary,
      watchPoints,
      actions,
    });

  if (supported === false) {
    return (
      <p
        className={cn(
          "text-sm text-[var(--muted)]",
          className,
        )}
      >
        Lecture vocale non disponible sur ce navigateur
      </p>
    );
  }

  if (supported === null || !canSpeak) {
    return null;
  }

  if (playState === "idle") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Écouter l’analyse"
          onClick={start}
        >
          Écouter l’analyse
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {playState === "speaking" ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Mettre en pause la lecture"
          onClick={pause}
        >
          Pause
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Reprendre la lecture"
          onClick={resume}
        >
          Reprendre
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Arrêter la lecture"
        onClick={stop}
      >
        Stop
      </Button>
    </div>
  );
}
