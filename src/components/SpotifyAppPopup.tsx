import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Laptop,
  Loader2,
  LogOut,
  Music,
  Pause,
  Play,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import type {
  SpokenLanguage,
  SpotifyAuthState,
  SpotifyPlaybackState,
  SpotifySearchTrack,
} from "../types/assistant";
import { SpotifyLiquidGlassIcon } from "./AppGridWorkspace";
import { IosFullScreenApp } from "./IosFullScreenApp";

interface SpotifyAppPopupProps {
  language: SpokenLanguage;
  authState: SpotifyAuthState;
  playback: SpotifyPlaybackState | null;
  authError: string | null;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onTransferDevice: (deviceId: string) => void;
  onSearchTracks: (query: string) => Promise<SpotifySearchTrack[]>;
  onPlayTrack: (opts: { uri?: string; query?: string }) => Promise<unknown>;
  onSetVolume: (percent: number) => void;
  onSaveRedirectUri: (uri: string) => Promise<{ ok: boolean; error?: string }>;
  onClearAuthError: () => void;
  onClose: () => void;
}

const QUICK_MOODS = [
  { label: "Lo-Fi Beats", query: "Chill Lo-Fi Beats" },
  { label: "Jeff Satur", query: "Jeff Satur" },
  { label: "Acoustic Pop", query: "Acoustic Chill" },
  { label: "Deep Focus", query: "Deep Focus Instrumental" },
];

export function SpotifyAppPopup({
  language,
  authState,
  playback,
  authError,
  isConnecting,
  onConnect,
  onDisconnect,
  onTogglePlay,
  onNext,
  onPrevious,
  onTransferDevice,
  onSearchTracks,
  onPlayTrack,
  onSetVolume,
  onSaveRedirectUri,
  onClearAuthError,
  onClose,
}: SpotifyAppPopupProps) {
  const prefersReducedMotion = useReducedMotion();
  const isThai = language === "th";

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifySearchTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const activeCallbackUrl =
    authState.callbackUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/spotify/callback`
      : "");

  const [uriDraft, setUriDraft] = useState<string>(
    () => authState.savedRedirectUri || activeCallbackUrl
  );
  const [isSavingUri, setIsSavingUri] = useState(false);
  const [uriStatusMsg, setUriStatusMsg] = useState<string | null>(null);

  const handleCopyUri = () => {
    const target = (uriDraft || activeCallbackUrl).trim();
    if (!target) return;
    navigator.clipboard.writeText(target).then(() => {
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 2200);
    });
  };

  const handleSaveUri = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsSavingUri(true);
    setUriStatusMsg(null);
    const res = await onSaveRedirectUri(uriDraft);
    setIsSavingUri(false);
    if (res.ok) {
      setUriStatusMsg(isThai ? "บันทึกเรียบร้อย" : "Saved successfully");
      window.setTimeout(() => setUriStatusMsg(null), 2600);
    } else {
      setUriStatusMsg(res.error || (isThai ? "ลิงก์ไม่ถูกต้อง" : "Invalid URI"));
    }
  };

  const handleResetUri = async () => {
    setIsSavingUri(true);
    setUriStatusMsg(null);
    const res = await onSaveRedirectUri("");
    setIsSavingUri(false);
    if (res.ok) {
      const fallback =
        authState.defaultCallbackUrl ||
        (typeof window !== "undefined"
          ? `${window.location.origin}/api/auth/spotify/callback`
          : "");
      setUriDraft(fallback);
      setUriStatusMsg(isThai ? "รีเซ็ตเป็นค่าเริ่มต้นแล้ว" : "Reset to default");
      window.setTimeout(() => setUriStatusMsg(null), 2400);
    }
  };

  const runSearch = async (q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setIsSearching(true);
    try {
      const tracks = await onSearchTracks(clean);
      setSearchResults(tracks);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(searchQuery);
  };

  const devices = playback?.devices || [];
  const volume = playback?.volumePercent ?? 60;

  return (
    <IosFullScreenApp
      title="Spotify"
      language={language}
      icon={<SpotifyLiquidGlassIcon size="sm" />}
      onClose={onClose}
      variant="ios-settings"
    >
      <div className="text-black max-w-xl mx-auto px-1 sm:px-3 pt-2 pb-24 select-none">
        {/* App Title Header */}
        <div className="pt-2 pb-4 px-1 flex items-center justify-between">
          <h1 className="text-[34px] sm:text-[38px] font-normal tracking-tight text-black font-en">
            Spotify
          </h1>
          {authState.connected && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[13px] text-zinc-500 font-en">Connected</span>
            </div>
          )}
        </div>

        {/* NOT CONNECTED STATE */}
        {!authState.connected && (
          <div className="space-y-5">
            {/* Hero Card */}
            <div className="bg-white rounded-[28px] sm:rounded-[32px] p-6 sm:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04] text-center space-y-5">
              <div className="w-16 h-16 rounded-full bg-black text-white mx-auto flex items-center justify-center shadow-md">
                <Music className="w-8 h-8" />
              </div>

              <div className="space-y-1.5 max-w-md mx-auto">
                <h2 className="text-[22px] sm:text-[24px] font-normal text-black font-en">
                  Spotify Studio
                </h2>
                <p className={`text-[14px] text-zinc-500 leading-relaxed ${isThai ? "font-th" : "font-en"}`}>
                  {isThai
                    ? "เชื่อมต่อบัญชี Spotify เพื่อควบคุมการเล่นเพลง สั่งค้นหา และเล่นเพลงด้วยเสียงผ่าน Nolan"
                    : "Connect your Spotify account to command playback, search music, and enjoy high-fidelity streaming with Nolan."}
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-red-50 text-red-900 text-xs text-left border border-red-100"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <p className={`truncate ${isThai ? "font-th" : "font-en"}`}>{authError}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClearAuthError}
                    className="text-red-500 hover:text-red-900 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="pt-2 flex flex-col items-center gap-3">
                <motion.button
                  type="button"
                  disabled={isConnecting}
                  whileHover={prefersReducedMotion ? undefined : { scale: 1.02 }}
                  whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                  onClick={onConnect}
                  className={`inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-full bg-black text-white text-[15px] font-medium hover:bg-zinc-800 active:scale-98 disabled:opacity-50 transition-all cursor-pointer shadow-sm ${
                    isThai ? "font-th" : "font-en"
                  }`}
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Music className="w-4 h-4 text-emerald-400" />
                  )}
                  <span>
                    {isConnecting
                      ? isThai
                        ? "กำลังเชื่อมต่อ..."
                        : "Connecting..."
                      : isThai
                        ? "เชื่อมต่อกับ Spotify"
                        : "Connect with Spotify"}
                  </span>
                </motion.button>

                <button
                  type="button"
                  onClick={() => setShowConfig((prev) => !prev)}
                  className={`text-[13px] text-zinc-400 hover:text-black inline-flex items-center gap-1 transition-colors cursor-pointer pt-1 ${
                    isThai ? "font-th" : "font-en"
                  }`}
                >
                  <span>{isThai ? "ตั้งค่า Redirect URI" : "Redirect URI Setup"}</span>
                  {showConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Collapsible Redirect URI Setup Card */}
            {showConfig && (
              <form
                onSubmit={(e) => void handleSaveUri(e)}
                className="bg-white rounded-[26px] p-6 space-y-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-normal text-black font-en">
                    Redirect URI
                  </span>
                  {authState.savedRedirectUri && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/5 text-black text-[11px] font-en">
                      <Check className="w-3 h-3" />
                      <span>Saved</span>
                    </span>
                  )}
                </div>

                <input
                  type="url"
                  value={uriDraft}
                  onChange={(e) => setUriDraft(e.target.value)}
                  className="w-full font-mono text-xs text-black p-3 rounded-xl bg-[#F4F5F7] border border-black/[0.06] focus:outline-none focus:border-black"
                />

                {uriStatusMsg && (
                  <p className={`text-xs font-medium text-emerald-600 text-center ${isThai ? "font-th" : "font-en"}`}>
                    {uriStatusMsg}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isSavingUri || !uriDraft.trim()}
                    className={`py-2 px-3 rounded-full bg-black text-white text-xs font-medium hover:bg-zinc-800 disabled:opacity-40 transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    {isSavingUri ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    <span>{isThai ? "บันทึก" : "Save"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyUri}
                    className={`py-2 px-3 rounded-full bg-[#E6E8EB] text-black text-xs font-medium hover:bg-[#D9DCE0] transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    {copiedUri ? (
                      <Check className="w-3 h-3 text-black" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedUri ? (isThai ? "คัดลอกแล้ว" : "Copied") : (isThai ? "คัดลอก" : "Copy")}</span>
                  </button>
                </div>

                {authState.savedRedirectUri && (
                  <button
                    type="button"
                    onClick={() => void handleResetUri()}
                    className={`w-full text-center text-[12px] text-zinc-400 hover:text-black transition-colors cursor-pointer pt-1 flex items-center justify-center gap-1 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{isThai ? "รีเซ็ตเป็นค่าเริ่มต้น" : "Reset to Default"}</span>
                  </button>
                )}
              </form>
            )}
          </div>
        )}

        {/* CONNECTED STATE */}
        {authState.connected && (
          <div className="space-y-6">
            {/* Account Card (Minimalist Bar) */}
            <div className="bg-white rounded-[24px] px-5 py-3.5 flex items-center justify-between shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
              <div className="flex items-center gap-3 min-w-0">
                {authState.avatarUrl ? (
                  <img
                    src={authState.avatarUrl}
                    alt={authState.displayName || "Spotify"}
                    className="w-10 h-10 rounded-full object-cover border border-black/5"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-en">
                    {(authState.displayName || "S").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-black truncate font-en">
                    {authState.displayName || "Spotify Account"}
                  </p>
                  <p className="text-[12px] text-zinc-400 capitalize font-en">
                    {authState.product ? `Spotify ${authState.product}` : "Premium"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onDisconnect}
                title={isThai ? "ออกจากระบบ" : "Disconnect"}
                className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-black flex items-center justify-center transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Now Playing Controller (Editorial High-Fashion Card) */}
            {playback?.track && (
              <div className="bg-white rounded-[28px] sm:rounded-[32px] p-6 sm:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04] space-y-6">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  {/* Floating Album Artwork */}
                  <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-[22px] overflow-hidden bg-zinc-100 shrink-0 shadow-[0_8px_24px_rgba(0,0,0,0.08)] border border-black/[0.03]">
                    {playback.track.albumArtUrl ? (
                      <img
                        src={playback.track.albumArtUrl}
                        alt={playback.track.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400">
                        <Music className="w-10 h-10" />
                      </div>
                    )}
                  </div>

                  {/* Track Info & Main Transport */}
                  <div className="flex-1 min-w-0 text-center sm:text-left space-y-3">
                    <div>
                      <h3 className="text-[20px] sm:text-[22px] font-medium text-black truncate tracking-tight font-en">
                        {playback.track.name}
                      </h3>
                      <p className="text-[14px] text-zinc-400 truncate mt-0.5 font-en">
                        {playback.track.artists}
                      </p>
                    </div>

                    {/* Transport Controls */}
                    <div className="flex items-center justify-center sm:justify-start gap-4 pt-1">
                      <button
                        type="button"
                        onClick={onPrevious}
                        aria-label="Previous"
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-black active:scale-92 transition-all cursor-pointer"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={onTogglePlay}
                        aria-label={playback.isPlaying ? "Pause" : "Play"}
                        className="w-14 h-14 rounded-full flex items-center justify-center bg-black hover:bg-zinc-800 text-white active:scale-95 transition-all cursor-pointer shadow-sm"
                      >
                        {playback.isPlaying ? (
                          <Pause className="w-5 h-5" />
                        ) : (
                          <Play className="w-5 h-5 ml-0.5 fill-current" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={onNext}
                        aria-label="Next"
                        className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-black active:scale-92 transition-all cursor-pointer"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Device & Volume Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#F0F2F5]">
                  <div className="flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-zinc-400" />
                    {devices.length > 0 ? (
                      <select
                        aria-label="Device"
                        value={playback.deviceId || devices.find((d) => d.isActive)?.id || ""}
                        onChange={(e) => onTransferDevice(e.target.value)}
                        className="text-xs text-black bg-[#F4F5F7] rounded-full px-3 py-1 border-none focus:outline-none cursor-pointer font-en"
                      >
                        {devices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-zinc-500 font-en">
                        {playback.deviceName || "Spotify"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volume}
                      onChange={(e) => onSetVolume(Number(e.target.value))}
                      className="w-24 accent-black cursor-pointer"
                    />
                    <span className="font-mono text-[11px] text-zinc-400 w-7 text-right">
                      {volume}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Search Input Bar */}
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isThai ? "ค้นหาเพลงหรือศิลปิน..." : "Search tracks or artists..."}
                className={`w-full pl-11 pr-24 py-3.5 rounded-full bg-white text-[14px] text-black placeholder:text-zinc-400 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-black/[0.06] focus:outline-none focus:border-black ${
                  isThai ? "font-th" : "font-en"
                }`}
              />
              <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 px-4 py-2 rounded-full bg-black text-white text-[12px] font-medium hover:bg-zinc-800 disabled:opacity-40 transition-all cursor-pointer ${
                  isThai ? "font-th" : "font-en"
                }`}
              >
                {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : (isThai ? "ค้นหา" : "Search")}
              </button>
            </form>

            {/* Curated Mood Pills */}
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_MOODS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => {
                    setSearchQuery(m.query);
                    void runSearch(m.query);
                  }}
                  className="px-4 py-1.5 rounded-full bg-white hover:bg-black hover:text-white text-zinc-600 text-[13px] font-normal border border-black/[0.04] shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all cursor-pointer font-en"
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Track Results List */}
            {searchResults.length > 0 && (
              <div className="bg-white rounded-[26px] p-2 shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04] divide-y divide-[#F0F2F5]">
                {searchResults.map((track) => (
                  <div
                    key={track.id}
                    className="p-3 sm:p-3.5 flex items-center justify-between gap-3 hover:bg-black/[0.015] rounded-[18px] transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {track.albumArtUrl ? (
                        <img
                          src={track.albumArtUrl}
                          alt={track.name}
                          className="w-12 h-12 rounded-[14px] object-cover shrink-0 border border-black/5"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-[14px] bg-zinc-100 flex items-center justify-center shrink-0">
                          <Music className="w-4 h-4 text-zinc-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-black truncate font-en">
                          {track.name}
                        </p>
                        <p className="text-[12px] text-zinc-400 truncate mt-0.5 font-en">
                          {track.artists}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <motion.button
                        type="button"
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
                        onClick={() => void onPlayTrack({ uri: track.uri })}
                        aria-label={`Play ${track.name}`}
                        className="w-9 h-9 rounded-full flex items-center justify-center bg-black hover:bg-zinc-800 text-white transition-all cursor-pointer shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                      </motion.button>
                      {track.externalUrl && (
                        <a
                          href={track.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-100 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </IosFullScreenApp>
  );
}
