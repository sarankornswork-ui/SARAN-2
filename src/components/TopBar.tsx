import {
  AlertCircle,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Volume2,
} from "lucide-react";
import type { SessionStatus, SpokenLanguage } from "../types/assistant";
import { LiquidSegmentedControl } from "./LiquidToggle";

interface TopBarProps {
  language: SpokenLanguage;
  status: SessionStatus;
  isMuted: boolean;
  elapsedSeconds: number;
  onSelectLanguage: (lang: SpokenLanguage) => void;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function StatusReadout({
  language,
  status,
  isMuted,
}: {
  language: SpokenLanguage;
  status: SessionStatus;
  isMuted: boolean;
}) {
  const isThai = language === "th";
  switch (status) {
    case "connecting":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-zinc-700 whitespace-nowrap ${
            isThai ? "font-light" : "font-medium"
          }`}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          <span>{isThai ? "กำลังเชื่อมต่อ" : "Connecting"}</span>
        </span>
      );
    case "speaking":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-blue-700 whitespace-nowrap ${
            isThai ? "font-light" : "font-medium"
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isThai ? "กำลังพูด" : "Speaking"}</span>
        </span>
      );
    case "listening":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-emerald-700 whitespace-nowrap ${
            isThai ? "font-light" : "font-medium"
          }`}
        >
          {isMuted ? (
            <MicOff className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
          ) : (
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          <span className={isMuted ? "text-amber-700" : "text-emerald-700"}>
            {isMuted
              ? isThai
                ? "ปิดไมค์"
                : "Muted"
              : isThai
                ? "กำลังฟัง"
                : "Listening"}
          </span>
        </span>
      );
    case "error":
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-red-700 whitespace-nowrap ${
            isThai ? "font-light" : "font-medium"
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isThai ? "ขัดข้อง" : "Error"}</span>
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 text-xs text-zinc-500 whitespace-nowrap ${
            isThai ? "font-light" : "font-medium"
          }`}
        >
          <Mic className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isThai ? "พร้อม" : "Ready"}</span>
        </span>
      );
  }
}

export function TopBar({
  language,
  status,
  isMuted,
  elapsedSeconds,
  onSelectLanguage,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 px-4 sm:px-6 pt-3">
      <div className="max-w-5xl mx-auto px-4 sm:px-5 h-14 rounded-2xl liquid-glass flex items-center justify-between gap-4">
        {/* Zone 1: Brand Wordmark */}
        <span className="text-base sm:text-lg font-semibold tracking-tight text-zinc-900 whitespace-nowrap shrink-0">
          Nolan
        </span>

        {/* Zone 2: Animated Sliding Language Switcher */}
        <LiquidSegmentedControl
          layoutId="topbar-language-pill"
          ariaLabel="Select spoken language"
          value={language}
          isThai={language === "th"}
          onChange={onSelectLanguage}
          options={[
            { value: "th", label: "พูดภาษาไทย" },
            { value: "en", label: "Speak English" },
          ]}
        />

        {/* Zone 3: Live Status & Duration */}
        <div className="flex items-center gap-2.5 shrink-0">
          <StatusReadout
            language={language}
            status={status}
            isMuted={isMuted}
          />
          <span
            className="hidden sm:inline-block font-mono tabular-nums text-xs font-medium text-zinc-700 bg-white/65 border border-white/80 px-2.5 py-1 rounded-full"
            aria-label="Session duration"
          >
            {formatDuration(elapsedSeconds)}
          </span>
        </div>
      </div>
    </header>
  );
}
