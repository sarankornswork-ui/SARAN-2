import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SessionStatus } from "../types/assistant";

interface BottomAiAuraProps {
  visible: boolean;
  status: SessionStatus;
  hasOpenApp: boolean;
}

export function BottomAiAura({
  visible,
  status,
  hasOpenApp,
}: BottomAiAuraProps) {
  const prefersReducedMotion = useReducedMotion();
  const isSpeaking = status === "speaking";
  const isConnecting = status === "connecting";

  const intensityScale = hasOpenApp ? 1.08 : 0.92;
  const baseOpacity = isSpeaking ? 0.95 : isConnecting ? 0.78 : 0.85;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="bottom-ai-aura"
          aria-hidden="true"
          initial={{ opacity: 0, y: 36 }}
          animate={{
            opacity: baseOpacity,
            y: 0,
            scale: prefersReducedMotion ? 1 : intensityScale,
          }}
          exit={{ opacity: 0, y: 40 }}
          transition={{
            duration: prefersReducedMotion ? 0.12 : 0.48,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="fixed inset-x-0 bottom-0 h-56 sm:h-64 pointer-events-none z-[35] overflow-hidden"
        >
          {/* Ambient Luminous Base Mist */}
          <div
            className="absolute inset-x-0 bottom-0 h-full"
            style={{
              background:
                "linear-gradient(to top, rgba(59,130,246,0.16) 0%, rgba(56,189,248,0.08) 42%, rgba(255,255,255,0) 100%)",
            }}
          />

          {/* Flowing Left-to-Right Cyan/Blue Aurora */}
          <div
            className="ai-aura-drift absolute -bottom-16 left-[8%] w-[58%] h-52 rounded-full blur-3xl"
            style={{
              background: isSpeaking
                ? "radial-gradient(ellipse at center, rgba(56,189,248,0.48) 0%, rgba(37,99,235,0.28) 48%, rgba(139,92,246,0) 76%)"
                : "radial-gradient(ellipse at center, rgba(56,189,248,0.34) 0%, rgba(59,130,246,0.22) 50%, rgba(59,130,246,0) 76%)",
            }}
          />

          {/* Flowing Right-to-Left Indigo/Violet/Emerald Harmonic Glow */}
          <div
            className="ai-aura-sweep absolute -bottom-20 right-[6%] w-[56%] h-56 rounded-full blur-3xl"
            style={{
              background: isSpeaking
                ? "radial-gradient(ellipse at center, rgba(99,102,241,0.42) 0%, rgba(168,85,247,0.26) 46%, rgba(59,130,246,0) 76%)"
                : "radial-gradient(ellipse at center, rgba(96,165,250,0.34) 0%, rgba(129,140,248,0.22) 48%, rgba(59,130,246,0) 76%)",
            }}
          />

          {/* Center Bottom Luminous Horizon Edge */}
          <motion.div
            animate={
              prefersReducedMotion
                ? undefined
                : {
                    opacity: isSpeaking ? [0.65, 1, 0.65] : [0.45, 0.72, 0.45],
                    scaleX: isSpeaking ? [0.96, 1.06, 0.96] : [0.98, 1.03, 0.98],
                  }
            }
            transition={{
              duration: isSpeaking ? 1.8 : 3.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[88%] max-w-3xl h-20 rounded-t-full blur-2xl"
            style={{
              background:
                "linear-gradient(90deg, rgba(56,189,248,0.18) 0%, rgba(59,130,246,0.42) 32%, rgba(99,102,241,0.42) 68%, rgba(16,185,129,0.22) 100%)",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
