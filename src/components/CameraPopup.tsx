import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Video, X } from "lucide-react";
import type { SpokenLanguage } from "../types/assistant";

interface CameraPopupProps {
  language: SpokenLanguage;
  cameraStream: MediaStream | null;
  onClose: () => void;
}

export function CameraPopup({
  language,
  cameraStream,
  onClose,
}: CameraPopupProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !cameraStream) return;
    videoEl.srcObject = cameraStream;
    videoEl.play().catch(() => {});
    return () => {
      videoEl.srcObject = null;
    };
  }, [cameraStream]);

  return (
    <motion.div
      role="dialog"
      aria-label={
        language === "th" ? "หน้าต่างกล้องสำหรับโนแลน" : "Nolan live camera view"
      }
      initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.93, y: prefersReducedMotion ? 0 : 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.94, y: prefersReducedMotion ? 0 : 14 }}
      transition={{ duration: prefersReducedMotion ? 0.08 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md sm:max-w-lg liquid-glass rounded-[32px] p-3"
    >
      <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-zinc-900/95">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/20 text-xs text-white ${
              language === "th" ? "font-light" : "font-medium"
            }`}
          >
            <Video className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            <span>
              {language === "th"
                ? "เปิดกล้องอยู่ · โนแลนมองเห็นได้"
                : "Camera live · Nolan can see"}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={language === "th" ? "ปิดกล้อง" : "Close camera"}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center bg-black/45 backdrop-blur-md border border-white/20 text-white hover:bg-black/65 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
