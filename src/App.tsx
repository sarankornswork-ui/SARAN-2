import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ExternalLink, ImagePlus, MicOff, RefreshCw, Send, X } from "lucide-react";
import { AppGridWorkspace, SpotifyLiquidGlassIcon } from "./components/AppGridWorkspace";
import { BottomAiAura } from "./components/BottomAiAura";
import { CameraPopup } from "./components/CameraPopup";
import { LiquidSegmentedControl } from "./components/LiquidToggle";
import { NowPlayingCard } from "./components/NowPlayingCard";
import { SettingsAppPopup } from "./components/SettingsAppPopup";
import { SpotifyAppPopup } from "./components/SpotifyAppPopup";
import { StepSlideshowPopup } from "./components/StepSlideshowPopup";
import { TopBar } from "./components/TopBar";
import { VoiceControlDock } from "./components/VoiceControlDock";
import { useLiveVoiceSession } from "./hooks/useLiveVoiceSession";
import { useSpotify } from "./hooks/useSpotify";
import {
  SAMPLE_PROMPTS_BY_LANGUAGE,
  type NolanEngineMode,
  type SpokenLanguage,
  type WorkspaceAppId,
} from "./types/assistant";

function formatMovieSubtitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 200) return normalized;

  const tail = normalized.slice(-200);
  const sentenceBreak = tail.search(/[.!?]\s+/);
  if (sentenceBreak > 0 && sentenceBreak < 105) {
    return tail.slice(sentenceBreak + 2).trim();
  }
  const firstSpace = tail.indexOf(" ");
  if (firstSpace > 0 && firstSpace < 30) {
    return `…${tail.slice(firstSpace + 1).trim()}`;
  }
  return `…${tail.trim()}`;
}

export default function App() {
  const prefersReducedMotion = useReducedMotion();
  const [language, setLanguage] = useState<SpokenLanguage>("th");
  const [selectedEngine, setSelectedEngine] = useState<NolanEngineMode>("gemini-live");
  const [autoGreeting, setAutoGreeting] = useState(true);
  const [bottomAuraEnabled, setBottomAuraEnabled] = useState(true);
  const [openModalApp, setOpenModalApp] = useState<"spotify" | "settings" | null>(null);
  const [draft, setDraft] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [attachedNotice, setAttachedNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Spotify voice, search, OAuth, and Web Playback hook
  const {
    authState: spotifyAuth,
    playback: spotifyPlayback,
    playerNotice: spotifyNotice,
    authError: spotifyAuthError,
    isConnecting: isSpotifyConnecting,
    spotifySessionId,
    persistentToken,
    connectSpotify,
    disconnectSpotify,
    saveRedirectUri,
    togglePlayPause: toggleSpotifyPlay,
    nextTrack: nextSpotifyTrack,
    previousTrack: prevSpotifyTrack,
    transferDevice: transferSpotifyDevice,
    searchTracks: searchSpotifyTracks,
    playTrack: playSpotifyTrack,
    setVolume: setSpotifyVolume,
    handleSpotifyStateFromWs,
    dismissNowPlaying,
    clearAuthError: clearSpotifyAuthError,
  } = useSpotify();

  // Live Voice & Nolan Session hook
  const {
    status,
    engineMode,
    isThinking,
    errorMessage,
    fallbackNotice,
    isAuthError,
    isQuotaError,
    micWarning,
    cameraError,
    isMuted,
    hasMic,
    isCameraOn,
    cameraStream,
    elapsedSeconds,
    transcript,
    stepGuide,
    inputAnalyserRef,
    outputAnalyserRef,
    startSession,
    retrySession,
    stopSession,
    toggleMute,
    toggleCamera,
    sendTextMessage,
    sendImageFrame,
    dismissFallbackNotice,
    dismissStepGuide,
  } = useLiveVoiceSession({
    spotifySessionId,
    spotifyPersistentToken: persistentToken,
    onSpotifyState: handleSpotifyStateFromWs,
  });

  useEffect(() => {
    setSelectedEngine(engineMode);
  }, [engineMode]);

  const isActive =
    status === "connecting" || status === "listening" || status === "speaking";
  const isLive = status === "listening" || status === "speaking";

  // Automatically close Spotify popup? No — keep it open until user dismisses,
  // unless user opens camera/guide/settings.
  const hasAnyOpenWindow = Boolean(
    openModalApp || isCameraOn || stepGuide || spotifyPlayback?.track
  );

  // Close openModalApp with Escape key for snappy keyboard accessibility
  useEffect(() => {
    if (!openModalApp) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenModalApp(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openModalApp]);

  const handleSelectLanguageAndTalk = (nextLang: SpokenLanguage) => {
    setLanguage(nextLang);
    if (isActive && nextLang !== language) {
      stopSession();
      window.setTimeout(() => {
        void startSession(nextLang, selectedEngine, autoGreeting);
      }, 120);
    }
  };

  const handleSwitchEngine = (nextEngine: NolanEngineMode) => {
    setSelectedEngine(nextEngine);
    if (isActive) {
      stopSession();
      window.setTimeout(() => {
        void startSession(language, nextEngine, autoGreeting);
      }, 120);
    }
  };

  const handleOpenWorkspaceApp = (appId: WorkspaceAppId) => {
    setOpenModalApp(appId);
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !isLive) return;
    sendTextMessage(draft);
    setDraft("");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const [header, base64] = result.split(",");
      if (!base64) return;
      const mimeMatch = header.match(/data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      sendImageFrame(base64, mimeType);
      setAttachedNotice(
        language === "th"
          ? `ส่งรูป "${file.name}" ให้โนแลนดูแล้ว พูดถามได้เลยครับ`
          : `Sent "${file.name}" to Nolan — ask anything about it.`
      );
      window.setTimeout(() => setAttachedNotice(null), 4000);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const activeSubtitle =
    transcript.length > 0 ? transcript[transcript.length - 1] : null;

  const subtitleText = useMemo(() => {
    if (!activeSubtitle?.text) return "";
    return formatMovieSubtitle(activeSubtitle.text);
  }, [activeSubtitle]);

  const samplePrompts = SAMPLE_PROMPTS_BY_LANGUAGE[language];

  return (
    <div className="min-h-screen flex flex-col bg-white text-zinc-900 relative overflow-x-hidden">
      {/* Subtle Liquid Glass Ambient Grid Background Accent on Pure White Canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.22) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Top Bar: Appears smoothly when user starts Nolan AI */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            key="nolan-topbar"
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -14 }}
            transition={{ duration: prefersReducedMotion ? 0.08 : 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-30"
          >
            <TopBar
              language={language}
              status={status}
              isMuted={isMuted}
              elapsedSeconds={elapsedSeconds}
              onSelectLanguage={handleSelectLanguageAndTalk}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace: App Grid + Full-Screen Zoom App Transitions */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-48 pt-8 gap-6">
        <AnimatePresence mode="wait">
          {openModalApp === "spotify" ? (
            <SpotifyAppPopup
              key="app-popup-spotify"
              language={language}
              authState={spotifyAuth}
              playback={spotifyPlayback}
              authError={spotifyAuthError}
              isConnecting={isSpotifyConnecting}
              onConnect={() => void connectSpotify()}
              onDisconnect={() => void disconnectSpotify()}
              onTogglePlay={() => void toggleSpotifyPlay()}
              onNext={() => void nextSpotifyTrack()}
              onPrevious={() => void prevSpotifyTrack()}
              onTransferDevice={(id) => void transferSpotifyDevice(id)}
              onSearchTracks={searchSpotifyTracks}
              onPlayTrack={playSpotifyTrack}
              onSetVolume={(v) => void setSpotifyVolume(v)}
              onSaveRedirectUri={saveRedirectUri}
              onClearAuthError={clearSpotifyAuthError}
              onClose={() => setOpenModalApp(null)}
            />
          ) : openModalApp === "settings" ? (
            <SettingsAppPopup
              key="app-popup-settings"
              language={language}
              engineMode={selectedEngine}
              autoGreeting={autoGreeting}
              bottomAuraEnabled={bottomAuraEnabled}
              spotifyCallbackUrl={spotifyAuth.callbackUrl}
              spotifySavedRedirectUri={spotifyAuth.savedRedirectUri}
              spotifyDefaultCallbackUrl={spotifyAuth.defaultCallbackUrl}
              spotifyConnected={spotifyAuth.connected}
              spotifyDisplayName={spotifyAuth.displayName}
              spotifyAvatarUrl={spotifyAuth.avatarUrl}
              spotifyProduct={spotifyAuth.product}
              isSpotifyConnecting={isSpotifyConnecting}
              onChangeLanguage={handleSelectLanguageAndTalk}
              onChangeEngine={handleSwitchEngine}
              onToggleAutoGreeting={setAutoGreeting}
              onToggleBottomAura={setBottomAuraEnabled}
              onSaveSpotifyRedirectUri={saveRedirectUri}
              onConnectSpotify={() => void connectSpotify()}
              onDisconnectSpotify={() => void disconnectSpotify()}
              onClose={() => setOpenModalApp(null)}
            />
          ) : isCameraOn || stepGuide ? (
            <motion.div
              key="app-popup-media-guide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-5xl flex flex-col lg:flex-row items-center justify-center gap-6"
            >
              <AnimatePresence>
                {isCameraOn && (
                  <CameraPopup
                    key="camera-popup"
                    language={language}
                    cameraStream={cameraStream}
                    onClose={() => void toggleCamera()}
                  />
                )}
              </AnimatePresence>
              <AnimatePresence>
                {stepGuide && (
                  <StepSlideshowPopup
                    key="guide-popup"
                    guide={stepGuide}
                    language={language}
                    onClose={dismissStepGuide}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <div key="app-grid-home" className="w-full flex flex-col items-center gap-8">
              <AppGridWorkspace
                language={language}
                spotifyConnected={spotifyAuth.connected}
                spotifyPlaying={Boolean(spotifyPlayback?.isPlaying)}
                onOpenApp={handleOpenWorkspaceApp}
              />

              {/* Floating Spotify Now Playing Card on Grid Home when playing */}
              <AnimatePresence>
                {spotifyPlayback?.track && (
                  <motion.div
                    key="home-now-playing"
                    initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 10, scale: 0.96 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full flex justify-center"
                  >
                    <NowPlayingCard
                      playback={spotifyPlayback}
                      language={language}
                      onTogglePlay={toggleSpotifyPlay}
                      onNext={nextSpotifyTrack}
                      onPrevious={prevSpotifyTrack}
                      onTransferDevice={transferSpotifyDevice}
                      onClose={dismissNowPlaying}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom AI Gradient Glow Animation (active when Nolan is running, enhanced over open apps) */}
      <BottomAiAura
        visible={bottomAuraEnabled && isActive}
        status={status}
        hasOpenApp={hasAnyOpenWindow}
      />

      {/* Persistent Bottom Stack: Movie Subtitles + Extras Drawer + Liquid Glass AI Dock */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2.5 w-full max-w-xl px-4 pointer-events-none">
        {/* Subtitle Strip */}
        <AnimatePresence>
          {isActive && (subtitleText || status === "connecting" || isThinking) && (
            <motion.div
              key="nolan-subtitle"
              aria-live="polite"
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 8, scale: 0.97 }}
              transition={{ duration: prefersReducedMotion ? 0.08 : 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full liquid-glass rounded-2xl px-5 py-3 text-center pointer-events-auto"
            >
              {isThinking ? (
                <p
                  className={`text-sm sm:text-base text-zinc-500 ${
                    language === "th" ? "font-light" : "font-medium"
                  }`}
                >
                  {language === "th"
                    ? "โนแลนกำลังคิดคำตอบ..."
                    : "Nolan is thinking..."}
                </p>
              ) : subtitleText ? (
                <p
                  className={`text-base sm:text-lg leading-relaxed text-zinc-900 text-balance ${
                    language === "th" ? "font-light" : "font-medium"
                  }`}
                >
                  <span
                    className={
                      activeSubtitle?.role === "user"
                        ? `text-sky-700 mr-2 ${language === "th" ? "font-light" : "font-semibold"}`
                        : "text-blue-700 font-semibold mr-2"
                    }
                  >
                    {activeSubtitle?.role === "user"
                      ? language === "th"
                        ? "คุณ:"
                        : "You:"
                      : "Nolan:"}
                  </span>
                  <span>{subtitleText}</span>
                </p>
              ) : (
                <p
                  className={`text-sm sm:text-base text-zinc-500 ${
                    language === "th" ? "font-light" : "font-medium"
                  }`}
                >
                  {language === "th"
                    ? "กำลังเชื่อมต่อกับโนแลน..."
                    : "Connecting to Nolan..."}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notices & Error Banners */}
        {(errorMessage || fallbackNotice || cameraError || micWarning || attachedNotice || spotifyNotice) && (
          <div className="w-full space-y-2 pointer-events-auto">
            {fallbackNotice && !errorMessage && (
              <div
                role="status"
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs sm:text-sm text-amber-950 liquid-glass rounded-2xl border border-amber-200/80"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle
                    className="w-4 h-4 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <span className="leading-snug">{fallbackNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissFallbackNotice}
                  aria-label="Dismiss notice"
                  className="text-amber-700 hover:text-amber-950 shrink-0 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {errorMessage && (
              <div
                role="alert"
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 text-xs sm:text-sm text-red-950 bg-red-50/90 backdrop-blur-xl border border-red-200/80 rounded-2xl shadow-md"
              >
                <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                  <AlertCircle
                    className="w-4 h-4 shrink-0 text-red-600 mt-0.5 sm:mt-0"
                    aria-hidden="true"
                  />
                  <div className="space-y-0.5 min-w-0">
                    <p className={`text-red-900 ${language === "th" ? "font-light" : "font-semibold"}`}>
                      {isQuotaError
                        ? language === "th"
                          ? "เครดิตของโปรเจกต์หมดลง (Credits Depleted)"
                          : "Gemini Prepayment Credits Depleted"
                        : isAuthError
                          ? language === "th"
                            ? "คีย์ API ไม่ถูกต้อง (Invalid API Key)"
                            : "API Key Not Valid"
                          : language === "th"
                            ? "การเชื่อมต่อขัดข้อง"
                            : "Connection Error"}
                    </p>
                    <p className={`text-xs text-red-800 leading-relaxed ${language === "th" ? "font-light" : ""}`}>
                      {isQuotaError ? (
                        <>
                          {language === "th"
                            ? "กรุณาตรวจสอบ Billing ที่ "
                            : "Please check billing at "}
                          <a
                            href="https://ai.studio/projects"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline font-semibold hover:text-red-950 inline-flex items-center gap-0.5"
                          >
                            ai.studio/projects
                            <ExternalLink className="w-3 h-3 inline" />
                          </a>
                          {language === "th"
                            ? " หรือใช้โหมดเสียงปกติได้ทันทีครับ"
                            : " or switch to standard mode immediately."}
                        </>
                      ) : isAuthError ? (
                        language === "th"
                          ? "กรุณาตรวจสอบ GEMINI_API_KEY หรือใช้โหมดเสียงปกติได้ทันทีครับ"
                          : "Please verify your GEMINI_API_KEY or switch to standard mode."
                      ) : (
                        errorMessage
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {(isQuotaError || isAuthError) && engineMode !== "gemma-open" && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEngine("gemma-open");
                        void retrySession("gemma-open");
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-transform active:scale-95 shrink-0 cursor-pointer shadow-sm ${
                        language === "th" ? "font-light" : "font-medium"
                      }`}
                    >
                      <span>{language === "th" ? "ใช้โหมดปกติ" : "Use Standard Mode"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void retrySession()}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-xl transition-transform active:scale-95 shrink-0 cursor-pointer shadow-sm ${
                      language === "th" ? "font-light" : "font-medium"
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{language === "th" ? "ลองใหม่" : "Retry"}</span>
                  </button>
                </div>
              </div>
            )}

            {cameraError && !errorMessage && (
              <div
                role="alert"
                className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm text-red-800 liquid-glass rounded-xl"
              >
                <AlertCircle
                  className="w-4 h-4 shrink-0 text-red-600"
                  aria-hidden="true"
                />
                <span>{cameraError}</span>
              </div>
            )}

            {micWarning && !errorMessage && (
              <div
                role="status"
                className="flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm text-amber-900 liquid-glass rounded-xl"
              >
                <MicOff
                  className="w-4 h-4 shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                <span>{micWarning}</span>
              </div>
            )}

            {attachedNotice && (
              <div
                role="status"
                className="px-4 py-2 text-xs font-medium text-blue-900 liquid-glass rounded-xl text-center"
              >
                {attachedNotice}
              </div>
            )}

            {spotifyNotice && (
              <div
                role="status"
                className="px-4 py-2 text-xs font-medium text-emerald-900 liquid-glass rounded-xl text-center"
              >
                {spotifyNotice}
              </div>
            )}
          </div>
        )}

        {/* Extras Drawer: Liquid Glass Animated Panel */}
        <AnimatePresence>
          {showExtras && (
            <motion.div
              key="nolan-extras-drawer"
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: 0.96 }}
              transition={{ duration: prefersReducedMotion ? 0.08 : 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="w-full liquid-glass rounded-[28px] p-4 space-y-3 pointer-events-auto"
            >
              {/* Voice Profile & Engine Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl liquid-glass-card">
                <div className="min-w-0">
                  <p className={`text-xs text-zinc-900 ${language === "th" ? "font-light" : "font-semibold"}`}>
                    {language === "th" ? "เสียง Nolan (Gemini 3.8 Live)" : "Nolan Voice Engine"}
                  </p>
                  <p className={`text-[11px] text-zinc-500 truncate ${language === "th" ? "font-light" : ""}`}>
                    {selectedEngine === "gemini-live"
                      ? language === "th"
                        ? "Gemini 3.8 Live · ตอบทันทีแบบเรียลไทม์ + สั่ง Spotify"
                        : "Gemini 3.8 Live · Instant Live Audio & Vision"
                      : language === "th"
                        ? "โหมดประมวลผลบนเครื่อง (ตอบช้ากว่า)"
                        : "Local CPU mode (slower response)"}
                  </p>
                </div>
                <LiquidSegmentedControl
                  layoutId="extras-engine-pill"
                  ariaLabel="Voice engine mode"
                  size="sm"
                  value={selectedEngine}
                  isThai={language === "th"}
                  onChange={handleSwitchEngine}
                  options={[
                    { value: "gemini-live", label: "Gemini Live" },
                    { value: "gemma-open", label: language === "th" ? "เสียง Nolan" : "Local Voice" },
                  ]}
                />
              </div>

              {/* Spotify Quick Card */}
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-2xl liquid-glass-card">
                <div className="flex items-center gap-2.5 min-w-0">
                  <SpotifyLiquidGlassIcon size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-900 truncate">
                      {spotifyAuth.connected
                        ? spotifyAuth.displayName || "Music Connected"
                        : "Music"}
                    </p>
                    <p className={`text-[11px] text-zinc-500 truncate ${language === "th" ? "font-light" : ""}`}>
                      {spotifyAuth.connected
                        ? language === "th"
                          ? "เชื่อมต่อแล้ว สั่งเปิดเพลงด้วยเสียงได้ทันที"
                          : "Connected — ask Nolan to play music"
                        : language === "th"
                          ? "เปิดหน้าต่าง Music เพื่อเชื่อมต่อและเลือกเพลง"
                          : "Open Music app to connect & search music"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOpenModalApp("spotify");
                    setShowExtras(false);
                  }}
                  className={`px-3.5 py-1.5 min-h-[36px] text-xs rounded-full liquid-glass-button text-zinc-800 hover:text-emerald-700 shrink-0 cursor-pointer transition-colors ${
                    language === "th" ? "font-light" : "font-medium"
                  }`}
                >
                  {spotifyAuth.connected
                    ? language === "th"
                      ? "เปิดแอป"
                      : "Open App"
                    : language === "th"
                      ? "เชื่อมต่อ"
                      : "Connect"}
                </button>
              </div>

              {/* Sample Prompts */}
              {isLive && samplePrompts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {samplePrompts.map((promptText) => (
                    <button
                      key={promptText}
                      type="button"
                      onClick={() => sendTextMessage(promptText)}
                      className={`text-xs text-zinc-700 liquid-glass-button hover:bg-white/90 px-3 py-1.5 rounded-full transition-colors cursor-pointer text-left ${
                        language === "th" ? "font-light" : ""
                      }`}
                    >
                      {promptText}
                    </button>
                  ))}
                </div>
              )}

              {/* Input Form */}
              <form onSubmit={handleSendText} className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={!isLive}
                  onClick={() => fileInputRef.current?.click()}
                  title={
                    language === "th"
                      ? "ส่งรูปภาพให้โนแลนดู"
                      : "Send image for Nolan to see"
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[42px] text-xs font-medium text-zinc-800 liquid-glass-button hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none rounded-2xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ImagePlus className="w-4 h-4" aria-hidden="true" />
                  <span>{language === "th" ? "รูปภาพ" : "Image"}</span>
                </button>

                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={!isLive}
                  placeholder={
                    isLive
                      ? language === "th"
                        ? "พิมพ์คำถามหรือสั่งเพลง เช่น 'เปิดเพลงชิลๆ'..."
                        : "Type a question or music command..."
                      : language === "th"
                        ? "กดเริ่มคุยก่อนพิมพ์หรือส่งรูปภาพ"
                        : "Start talking first to send text or images"
                  }
                  className="flex-1 min-w-0 px-3.5 py-2 min-h-[42px] text-sm liquid-glass-input rounded-2xl text-zinc-900 placeholder:text-zinc-500 focus:bg-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!isLive || !draft.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[42px] text-xs sm:text-sm font-medium bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{language === "th" ? "ส่ง" : "Send"}</span>
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Liquid Glass Bottom AI Dock (Always Present) */}
        <div className="pointer-events-auto">
          <VoiceControlDock
            language={language}
            status={status}
            isMuted={isMuted}
            isCameraOn={isCameraOn}
            hasMic={hasMic}
            showExtras={showExtras}
            inputAnalyserRef={inputAnalyserRef}
            outputAnalyserRef={outputAnalyserRef}
            onStartSession={() => void startSession(language, selectedEngine, autoGreeting)}
            onEndSession={stopSession}
            onToggleMute={toggleMute}
            onToggleCamera={toggleCamera}
            onToggleExtras={() => setShowExtras((prev) => !prev)}
          />
        </div>
      </div>
    </div>
  );
}
