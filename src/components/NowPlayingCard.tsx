import {
  ExternalLink,
  Laptop,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import type { SpokenLanguage, SpotifyPlaybackState } from "../types/assistant";

interface NowPlayingCardProps {
  playback: SpotifyPlaybackState;
  language: SpokenLanguage;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onTransferDevice?: (deviceId: string) => void;
  onClose: () => void;
}

export function NowPlayingCard({
  playback,
  language,
  onTogglePlay,
  onNext,
  onPrevious,
  onTransferDevice,
  onClose,
}: NowPlayingCardProps) {
  const track = playback.track;
  if (!track) return null;

  const isThai = language === "th";
  const devices = playback.devices || [];

  return (
    <div
      role="region"
      aria-label={isThai ? "กำลังเล่นเพลง" : "Music Now Playing"}
      className="w-full max-w-sm sm:max-w-md liquid-glass rounded-3xl p-4 sm:p-5 shadow-xl animate-[fadeIn_220ms_ease-out] relative"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/assets/aistudio/icon_music_152_2x_bed585e3.png"
            alt="Music"
            className="w-6 h-6 rounded-[6px] object-cover shrink-0 shadow-sm"
          />
          {devices.length > 1 && onTransferDevice ? (
            <div className="inline-flex items-center gap-1 min-w-0">
              <Laptop className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
              <select
                aria-label={isThai ? "เลือกอุปกรณ์เล่นเพลง" : "Select playback device"}
                value={playback.deviceId || devices.find((d) => d.isActive)?.id || ""}
                onChange={(e) => onTransferDevice(e.target.value)}
                className={`text-xs text-zinc-700 bg-white/70 border border-zinc-200/80 rounded-lg px-2 py-0.5 max-w-[175px] truncate focus:outline-none focus:border-emerald-500 cursor-pointer ${
                  isThai ? "font-light" : "font-medium"
                }`}
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span
              className={`text-xs text-zinc-600 truncate ${
                isThai ? "font-light" : "font-medium"
              }`}
            >
              {playback.deviceName || "Spotify"}
            </span>
          )}
          {playback.isPlaying && (
            <span className="flex items-center gap-0.5 ml-1 shrink-0">
              <span className="w-1 h-3 bg-[#1DB954] rounded-full animate-pulse" />
              <span className="w-1 h-4 bg-[#1DB954] rounded-full animate-pulse [animation-delay:150ms]" />
              <span className="w-1 h-2 bg-[#1DB954] rounded-full animate-pulse [animation-delay:300ms]" />
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={isThai ? "ซ่อนการ์ดเพลง" : "Close now playing"}
          className="w-7 h-7 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-600 hover:text-zinc-950 transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        {/* Album Artwork */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-zinc-100 border border-black/5 shrink-0 shadow-sm">
          {track.albumArtUrl ? (
            <img
              src={track.albumArtUrl}
              alt={track.album || track.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-100 to-sky-100 text-zinc-500">
              <Music className="w-7 h-7" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Track Metadata */}
        <div className="flex-1 min-w-0 space-y-1">
          <h4
            className={`text-base font-semibold text-zinc-900 truncate leading-snug ${
              isThai ? "font-light" : ""
            }`}
            title={track.name}
          >
            {track.name}
          </h4>
          <p
            className={`text-xs text-zinc-600 truncate ${
              isThai ? "font-light" : ""
            }`}
            title={track.artists}
          >
            {track.artists}
          </p>
          {track.album && (
            <p
              className={`text-[11px] text-zinc-400 truncate ${
                isThai ? "font-light" : ""
              }`}
            >
              {track.album}
            </p>
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-zinc-200/60">
        {track.externalUrl ? (
          <a
            href={track.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={isThai ? "เปิดในแอป Spotify" : "Open in Spotify"}
            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-800 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            <span className={isThai ? "font-light" : "font-medium"}>
              {isThai ? "เปิด Spotify" : "Open Spotify"}
            </span>
          </a>
        ) : (
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-mono tabular-nums text-[11px]">
              {playback.volumePercent ?? 50}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevious}
            aria-label={isThai ? "เพลงก่อนหน้า" : "Previous track"}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-700 hover:text-zinc-950 transition-transform active:scale-95 cursor-pointer"
          >
            <SkipBack className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={
              playback.isPlaying
                ? isThai
                  ? "หยุดชั่วคราว"
                  : "Pause"
                : isThai
                  ? "เล่นต่อ"
                  : "Play"
            }
            className="w-10 h-10 rounded-full inline-flex items-center justify-center bg-zinc-900 text-white shadow-md hover:bg-black transition-transform active:scale-95 cursor-pointer"
          >
            {playback.isPlaying ? (
              <Pause className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4 ml-0.5 fill-current" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onNext}
            aria-label={isThai ? "เพลงถัดไป" : "Next track"}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-700 hover:text-zinc-950 transition-transform active:scale-95 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
