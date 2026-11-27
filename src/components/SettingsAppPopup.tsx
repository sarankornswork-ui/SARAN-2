import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  Globe,
  Info,
  LayoutGrid,
  Link2,
  Loader2,
  MessageSquare,
  Music,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import type { NolanEngineMode, SpokenLanguage } from "../types/assistant";
import { AppleSettingsLiquidGlassIcon } from "./AppGridWorkspace";
import { IosFullScreenApp } from "./IosFullScreenApp";

interface SettingsAppPopupProps {
  language: SpokenLanguage;
  engineMode: NolanEngineMode;
  autoGreeting: boolean;
  bottomAuraEnabled: boolean;
  spotifyCallbackUrl?: string;
  spotifySavedRedirectUri?: string | null;
  spotifyDefaultCallbackUrl?: string;
  spotifyConnected?: boolean;
  spotifyDisplayName?: string | null;
  spotifyAvatarUrl?: string | null;
  spotifyProduct?: string | null;
  isSpotifyConnecting?: boolean;
  onChangeLanguage: (lang: SpokenLanguage) => void;
  onChangeEngine: (engine: NolanEngineMode) => void;
  onToggleAutoGreeting: (enabled: boolean) => void;
  onToggleBottomAura: (enabled: boolean) => void;
  onSaveSpotifyRedirectUri: (uri: string) => Promise<{ ok: boolean; error?: string }>;
  onConnectSpotify?: () => void;
  onDisconnectSpotify?: () => void;
  onClose: () => void;
}

type SubPage = "general" | "nolan" | "apps" | null;

// Modern Apple-Style Squircle Icon
function AppleIcon({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-white shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.12)] ${bg}`}
    >
      {children}
    </div>
  );
}

// Minimalist High-Fashion Apple Switch
function MinimalSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-[30px] w-[50px] shrink-0 cursor-pointer rounded-full transition-colors duration-250 ease-out focus-visible:outline-2 focus-visible:outline-black disabled:opacity-40 ${
        checked ? "bg-black" : "bg-[#E6E8EB]"
      }`}
    >
      <motion.span
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
        className="pointer-events-none mt-[2px] inline-block h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)]"
      />
    </button>
  );
}

export function SettingsAppPopup({
  language,
  engineMode,
  autoGreeting,
  bottomAuraEnabled,
  spotifyCallbackUrl,
  spotifySavedRedirectUri,
  spotifyDefaultCallbackUrl,
  spotifyConnected = false,
  spotifyDisplayName,
  spotifyAvatarUrl,
  spotifyProduct,
  isSpotifyConnecting = false,
  onChangeLanguage,
  onChangeEngine,
  onToggleAutoGreeting,
  onToggleBottomAura,
  onSaveSpotifyRedirectUri,
  onConnectSpotify,
  onDisconnectSpotify,
  onClose,
}: SettingsAppPopupProps) {
  const prefersReducedMotion = useReducedMotion();
  const isThai = language === "th";

  // Navigation: null = Main root menu (General, Nolan, Apps)
  const [currentPage, setCurrentPage] = useState<SubPage>(null);

  // Voice Preview State
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  // Redirect URI State
  const initialUri =
    spotifySavedRedirectUri ||
    spotifyCallbackUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/spotify/callback`
      : "");
  const [uriDraft, setUriDraft] = useState<string>(initialUri);
  const [copiedUri, setCopiedUri] = useState(false);
  const [isSavingUri, setIsSavingUri] = useState(false);
  const [uriFeedback, setUriFeedback] = useState<string | null>(null);

  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    setVoiceNote(null);
    try {
      const res = await fetch("/api/tts-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.audioBase64) {
          const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
          await audio.play();
          setIsTestingVoice(false);
          setVoiceNote(isThai ? "พร้อมใช้งาน" : "Ready");
          return;
        }
      }
    } catch {
      // browser fallback
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const sample = isThai
        ? "สวัสดีครับ ผมโนแลน พร้อมช่วยคุณเสมอครับ"
        : "Hi there! I am Nolan, ready to help whenever you need.";
      const u = new SpeechSynthesisUtterance(sample);
      u.lang = isThai ? "th-TH" : "en-US";
      u.pitch = 0.85;
      u.rate = 0.96;
      u.onend = () => setIsTestingVoice(false);
      u.onerror = () => setIsTestingVoice(false);
      window.speechSynthesis.speak(u);
      setVoiceNote(isThai ? "เสียงเบราว์เซอร์" : "Browser");
      return;
    }

    setIsTestingVoice(false);
  };

  const handleCopyUri = () => {
    const uri = (uriDraft || initialUri).trim();
    if (!uri) return;
    navigator.clipboard.writeText(uri).then(() => {
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 2000);
    });
  };

  const handleSaveUri = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingUri(true);
    setUriFeedback(null);
    const res = await onSaveSpotifyRedirectUri(uriDraft);
    setIsSavingUri(false);
    if (res.ok) {
      setUriFeedback(isThai ? "บันทึกเรียบร้อย" : "Saved");
      window.setTimeout(() => setUriFeedback(null), 2500);
    } else {
      setUriFeedback(res.error || (isThai ? "ลิงก์ไม่ถูกต้อง" : "Invalid URI"));
    }
  };

  const handleResetUri = async () => {
    setIsSavingUri(true);
    setUriFeedback(null);
    const res = await onSaveSpotifyRedirectUri("");
    setIsSavingUri(false);
    if (res.ok) {
      const fallback =
        spotifyDefaultCallbackUrl ||
        (typeof window !== "undefined"
          ? `${window.location.origin}/api/auth/spotify/callback`
          : "");
      setUriDraft(fallback);
      setUriFeedback(isThai ? "รีเซ็ตแล้ว" : "Reset");
      window.setTimeout(() => setUriFeedback(null), 2200);
    }
  };

  return (
    <IosFullScreenApp
      title={isThai ? "การตั้งค่า" : "Settings"}
      language={language}
      icon={<AppleSettingsLiquidGlassIcon size="sm" />}
      onClose={onClose}
      variant="ios-settings"
    >
      <div className="text-black max-w-xl mx-auto px-1 sm:px-3 pt-2 pb-20 select-none">
        <AnimatePresence mode="wait">
          {/* ROOT SCREEN: Matches image_b995dce7.png with Modern Apple-Style Icons */}
          {!currentPage ? (
            <motion.div
              key="root-settings-icons"
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* High-Fashion Title: Settings */}
              <div className="pt-3 pb-1 px-1">
                <h1 className="text-[36px] sm:text-[40px] font-normal tracking-tight text-black font-en">
                  Settings
                </h1>
              </div>

              {/* Group 1: General & Nolan */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                {/* General Row */}
                <div
                  onClick={() => setCurrentPage("general")}
                  className="flex items-center justify-between px-6 py-4.5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <AppleIcon bg="bg-[#8E8E93]">
                      <Settings className="w-4 h-4 text-white" />
                    </AppleIcon>
                    <span className="text-[20px] sm:text-[22px] font-normal text-black font-en">
                      General
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] stroke-[1.5]" />
                </div>

                {/* Hairline Divider with Inset matching icon width */}
                <div className="border-b border-[#F0F2F5] ml-[68px] mr-6" />

                {/* Nolan Row */}
                <div
                  onClick={() => setCurrentPage("nolan")}
                  className="flex items-center justify-between px-6 py-4.5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <AppleIcon bg="bg-gradient-to-tr from-[#5856D6] to-[#7C3AED]">
                      <Sparkles className="w-4 h-4 text-white" />
                    </AppleIcon>
                    <span className="text-[20px] sm:text-[22px] font-normal text-black font-en">
                      Nolan
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] stroke-[1.5]" />
                </div>
              </div>

              {/* Group 2: Apps */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                {/* Apps Row */}
                <div
                  onClick={() => setCurrentPage("apps")}
                  className="flex items-center justify-between px-6 py-4.5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <AppleIcon bg="bg-[#007AFF]">
                      <LayoutGrid className="w-4 h-4 text-white" />
                    </AppleIcon>
                    <span className="text-[20px] sm:text-[22px] font-normal text-black font-en">
                      Apps
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] stroke-[1.5]" />
                </div>
              </div>
            </motion.div>
          ) : currentPage === "general" ? (
            /* SUBPAGE: General */
            <motion.div
              key="subpage-general-chic"
              initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Back Bar & Heading */}
              <div className="pt-1 pb-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(null)}
                  className="inline-flex items-center gap-1.5 text-[16px] text-zinc-500 hover:text-black transition-colors active:opacity-60 cursor-pointer mb-3 font-en"
                >
                  <ChevronLeft className="w-4 h-4 stroke-[2]" />
                  <span>Settings</span>
                </button>
                <h1 className="text-[34px] sm:text-[36px] font-normal tracking-tight text-black font-en">
                  General
                </h1>
              </div>

              {/* Language Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div
                  onClick={() => onChangeLanguage("th")}
                  className="flex items-center justify-between px-6 py-5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <span className="text-[19px] sm:text-[20px] text-black font-th">
                    ภาษาไทย
                  </span>
                  {language === "th" && (
                    <Check className="w-5 h-5 text-black stroke-[2.2]" />
                  )}
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div
                  onClick={() => onChangeLanguage("en")}
                  className="flex items-center justify-between px-6 py-5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <span className="text-[19px] sm:text-[20px] text-black font-en">
                    English
                  </span>
                  {language === "en" && (
                    <Check className="w-5 h-5 text-black stroke-[2.2]" />
                  )}
                </div>
              </div>

              {/* System Specs Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[17px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "โมเดล" : "Model"}
                  </span>
                  <span className="text-[16px] font-mono text-zinc-600 font-en">
                    gemini-3.8-live
                  </span>
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[17px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "ไมโครโฟน" : "Microphone"}
                  </span>
                  <span className="text-[16px] text-zinc-500 font-en">
                    16,000 Hz PCM
                  </span>
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[17px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "เสียงตอบกลับ" : "Audio Output"}
                  </span>
                  <span className="text-[16px] text-zinc-500 font-en">
                    24,000 Hz PCM
                  </span>
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[17px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "วิชันสตรีม" : "Vision Stream"}
                  </span>
                  <span className="text-[16px] text-zinc-500 font-en">
                    1 FPS Live
                  </span>
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[17px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "เวอร์ชัน" : "Version"}
                  </span>
                  <span className="text-[16px] text-zinc-500 font-en">
                    2.4.0
                  </span>
                </div>
              </div>
            </motion.div>
          ) : currentPage === "nolan" ? (
            /* SUBPAGE: Nolan */
            <motion.div
              key="subpage-nolan-chic"
              initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Back Bar & Heading */}
              <div className="pt-1 pb-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(null)}
                  className="inline-flex items-center gap-1.5 text-[16px] text-zinc-500 hover:text-black transition-colors active:opacity-60 cursor-pointer mb-3 font-en"
                >
                  <ChevronLeft className="w-4 h-4 stroke-[2]" />
                  <span>Settings</span>
                </button>
                <h1 className="text-[34px] sm:text-[36px] font-normal tracking-tight text-black font-en">
                  Nolan
                </h1>
              </div>

              {/* Voice Engine Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div
                  onClick={() => onChangeEngine("gemini-live")}
                  className="flex items-center justify-between px-6 py-5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <span className="text-[18px] sm:text-[19px] text-black font-en">
                    Gemini 3.8 Live
                  </span>
                  {engineMode === "gemini-live" && (
                    <Check className="w-5 h-5 text-black stroke-[2.2]" />
                  )}
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div
                  onClick={() => onChangeEngine("gemma-open")}
                  className="flex items-center justify-between px-6 py-5 hover:bg-black/[0.015] active:bg-black/[0.03] transition-colors cursor-pointer"
                >
                  <span className={`text-[18px] sm:text-[19px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "เสียง Nolan บนเครื่อง (Local)" : "Local Voice"}
                  </span>
                  {engineMode === "gemma-open" && (
                    <Check className="w-5 h-5 text-black stroke-[2.2]" />
                  )}
                </div>
              </div>

              {/* Voice Profile Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div className="flex items-center justify-between px-6 py-4.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px] text-black font-en">Charon</span>
                    {voiceNote && (
                      <span className={`text-[13px] text-emerald-600 font-medium ${isThai ? "font-th" : "font-en"}`}>
                        · {voiceNote}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isTestingVoice}
                    onClick={() => void handleTestVoice()}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white text-[13px] font-normal hover:bg-zinc-800 active:scale-95 disabled:opacity-50 transition-all cursor-pointer ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    {isTestingVoice ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                    <span>{isThai ? "ฟังตัวอย่าง" : "Play Sample"}</span>
                  </button>
                </div>
              </div>

              {/* Behavior Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[18px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "ทักทายอัตโนมัติ" : "Auto Greeting"}
                  </span>
                  <MinimalSwitch
                    checked={autoGreeting}
                    onChange={onToggleAutoGreeting}
                    ariaLabel="Toggle auto greeting"
                  />
                </div>
                <div className="border-b border-[#F0F2F5] mx-6" />
                <div className="flex items-center justify-between px-6 py-4.5">
                  <span className={`text-[18px] text-black ${isThai ? "font-th" : "font-en"}`}>
                    {isThai ? "แอนิเมชันแสงไฟ AI" : "Bottom AI Aura"}
                  </span>
                  <MinimalSwitch
                    checked={bottomAuraEnabled}
                    onChange={onToggleBottomAura}
                    ariaLabel="Toggle bottom AI aura"
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            /* SUBPAGE: Apps */
            <motion.div
              key="subpage-apps-chic"
              initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -16 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Back Bar & Heading */}
              <div className="pt-1 pb-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(null)}
                  className="inline-flex items-center gap-1.5 text-[16px] text-zinc-500 hover:text-black transition-colors active:opacity-60 cursor-pointer mb-3 font-en"
                >
                  <ChevronLeft className="w-4 h-4 stroke-[2]" />
                  <span>Settings</span>
                </button>
                <h1 className="text-[34px] sm:text-[36px] font-normal tracking-tight text-black font-en">
                  Apps
                </h1>
              </div>

              {/* Spotify Account Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04]">
                <div className="flex items-center justify-between px-6 py-5">
                  <div>
                    <span className="text-[19px] sm:text-[20px] text-black font-en block">
                      Spotify
                    </span>
                    <span className={`text-[13px] text-zinc-500 ${isThai ? "font-th" : "font-en"}`}>
                      {spotifyConnected
                        ? `${spotifyDisplayName || "Active"} (${spotifyProduct || "Ready"})`
                        : (isThai ? "ยังไม่เชื่อมต่อ" : "Not connected")}
                    </span>
                  </div>
                  <div>
                    {spotifyConnected ? (
                      <button
                        type="button"
                        onClick={onDisconnectSpotify}
                        className={`px-4 py-2 rounded-full bg-zinc-100 text-zinc-800 hover:bg-zinc-200 text-[13px] font-medium active:scale-95 transition-all cursor-pointer ${
                          isThai ? "font-th" : "font-en"
                        }`}
                      >
                        {isThai ? "ยกเลิก" : "Disconnect"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSpotifyConnecting}
                        onClick={onConnectSpotify}
                        className={`px-5 py-2.5 rounded-full bg-black hover:bg-zinc-800 text-white text-[13px] font-medium active:scale-95 disabled:opacity-50 transition-all cursor-pointer shadow-xs ${
                          isThai ? "font-th" : "font-en"
                        }`}
                      >
                        {isSpotifyConnecting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />
                        ) : null}
                        <span>{isThai ? "เชื่อมต่อ" : "Connect"}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Spotify Redirect URI Card */}
              <div className="bg-white rounded-[26px] sm:rounded-[30px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.02)] border border-black/[0.04] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[17px] text-black font-en">
                    Redirect URI
                  </span>
                  {spotifySavedRedirectUri && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/5 text-black text-[12px] font-medium font-en">
                      <Check className="w-3.5 h-3.5" />
                      <span>{isThai ? "บันทึกแล้ว" : "Saved"}</span>
                    </span>
                  )}
                </div>

                <input
                  type="url"
                  value={uriDraft}
                  onChange={(e) => setUriDraft(e.target.value)}
                  className="w-full font-mono text-[12px] text-black p-3 rounded-[12px] bg-[#F4F5F7] border border-black/[0.06] focus:outline-none focus:border-black"
                />

                {uriFeedback && (
                  <p className={`text-[13px] font-medium text-emerald-600 text-center ${isThai ? "font-th" : "font-en"}`}>
                    {uriFeedback}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={isSavingUri || !uriDraft.trim()}
                    onClick={() => void handleSaveUri()}
                    className={`py-2.5 px-4 rounded-full bg-black text-white text-[13px] font-medium hover:bg-zinc-800 active:scale-98 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    {isSavingUri ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{isThai ? "บันทึก" : "Save"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyUri}
                    className={`py-2.5 px-4 rounded-full bg-[#E6E8EB] text-black text-[13px] font-medium hover:bg-[#D9DCE0] active:scale-98 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    {copiedUri ? (
                      <span className="text-black flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>{isThai ? "คัดลอกแล้ว" : "Copied"}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3.5 h-3.5" />
                        <span>{isThai ? "คัดลอก" : "Copy"}</span>
                      </span>
                    )}
                  </button>
                </div>

                {spotifySavedRedirectUri && (
                  <button
                    type="button"
                    onClick={() => void handleResetUri()}
                    className={`w-full pt-1 text-[13px] text-zinc-400 hover:text-black transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                      isThai ? "font-th" : "font-en"
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isThai ? "รีเซ็ตเป็นค่าเริ่มต้น" : "Reset to Default"}</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </IosFullScreenApp>
  );
}
