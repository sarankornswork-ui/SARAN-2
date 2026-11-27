import { motion, useReducedMotion } from "motion/react";
import type { SpokenLanguage, WorkspaceAppId } from "../types/assistant";

interface AppGridWorkspaceProps {
  language: SpokenLanguage;
  spotifyConnected: boolean;
  spotifyPlaying: boolean;
  onOpenApp: (appId: WorkspaceAppId) => void;
}

export function SpotifyLiquidGlassIcon({
  size = "lg",
}: {
  size?: "sm" | "lg";
}) {
  const isSmall = size === "sm";
  const boxClass = isSmall
    ? "w-10 h-10 rounded-[11px]"
    : "w-24 h-24 sm:w-28 sm:h-28 rounded-[26px]";

  return (
    <div
      className={`relative ${boxClass} overflow-hidden shadow-[0_18px_38px_-10px_rgba(244,63,94,0.34),0_4px_12px_rgba(15,23,42,0.08)]`}
    >
      <img
        src="/assets/aistudio/icon_music_152_2x_bed585e3.png"
        alt="Music"
        className="w-full h-full object-cover select-none pointer-events-none"
      />
      {/* Liquid Glass Specular Glare */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[44%] bg-gradient-to-b from-white/35 via-white/10 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/45"
      />
    </div>
  );
}

export function AppleSettingsLiquidGlassIcon({
  size = "lg",
}: {
  size?: "sm" | "lg";
}) {
  const isSmall = size === "sm";
  const boxClass = isSmall
    ? "w-10 h-10 rounded-[11px]"
    : "w-24 h-24 sm:w-28 sm:h-28 rounded-[26px]";

  return (
    <div
      className={`relative ${boxClass} overflow-hidden shadow-[0_18px_38px_-10px_rgba(15,23,42,0.22),0_4px_12px_rgba(15,23,42,0.08)]`}
    >
      <img
        src="/assets/aistudio/file-13qNomXqTB_cfca56f3.png"
        alt="Settings"
        className="w-full h-full object-cover select-none pointer-events-none"
      />
      {/* Liquid Glass Specular Glare */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[44%] bg-gradient-to-b from-white/35 via-white/10 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/55"
      />
    </div>
  );
}

export function AppGridWorkspace({
  language,
  spotifyConnected,
  spotifyPlaying,
  onOpenApp,
}: AppGridWorkspaceProps) {
  const prefersReducedMotion = useReducedMotion();
  const isThai = language === "th";

  const apps: Array<{
    id: WorkspaceAppId;
    title: string;
    activeState?: boolean;
    renderIcon: () => React.ReactNode;
  }> = [
    {
      id: "spotify",
      title: "Music",
      activeState: spotifyConnected || spotifyPlaying,
      renderIcon: () => <SpotifyLiquidGlassIcon size="lg" />,
    },
    {
      id: "settings",
      title: isThai ? "การตั้งค่า" : "Settings",
      renderIcon: () => <AppleSettingsLiquidGlassIcon size="lg" />,
    },
  ];

  return (
    <motion.section
      aria-label={isThai ? "หน้าจอแอปพลิเคชัน" : "Applications Grid"}
      initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: prefersReducedMotion ? 0.1 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-lg mx-auto px-4"
    >
      <div className="flex flex-wrap items-center justify-center gap-12 sm:gap-16">
        {apps.map((app, index) => (
          <motion.button
            key={app.id}
            type="button"
            onClick={() => onOpenApp(app.id)}
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0.08 : 0.32,
              delay: prefersReducedMotion ? 0 : index * 0.05,
              ease: [0.16, 1, 0.3, 1],
            }}
            whileHover={prefersReducedMotion ? undefined : { y: -4, scale: 1.05 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
            className="group flex flex-col items-center gap-3 p-2 rounded-[32px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 cursor-pointer"
          >
            <div className="relative">
              {app.renderIcon()}
              {app.activeState && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-5 h-1 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.65)]"
                />
              )}
            </div>

            <p className="text-sm sm:text-[15px] font-normal text-zinc-900 tracking-tight whitespace-nowrap">
              {app.title}
            </p>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}
