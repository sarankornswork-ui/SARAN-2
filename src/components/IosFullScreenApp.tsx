import { useEffect, useRef, useState } from "react";
import {
  motion,
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "motion/react";
import { X } from "lucide-react";
import type { SpokenLanguage } from "../types/assistant";

interface IosFullScreenAppProps {
  title: string;
  language: SpokenLanguage;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "default" | "ios-settings";
}

function getViewportHeight(): number {
  if (typeof window === "undefined") return 840;
  return Math.round(window.visualViewport?.height || window.innerHeight || 840);
}

export function IosFullScreenApp({
  title,
  language,
  icon,
  onClose,
  children,
  variant = "default",
}: IosFullScreenAppProps) {
  const prefersReducedMotion = useReducedMotion();
  const isThai = language === "th";
  const dragControls = useDragControls();
  const dragY = useMotionValue(0);

  // Dynamic viewport height so dragConstraints & resistance feel weighted across all screen sizes
  const [windowHeight, setWindowHeight] = useState<number>(getViewportHeight);
  const [hapticClosing, setHapticClosing] = useState(false);
  const [isPastDismissThreshold, setIsPastDismissThreshold] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setWindowHeight(getViewportHeight());
    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("orientationchange", handleResize, { passive: true });
    window.visualViewport?.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Proportional asymmetric drag bounds calculated dynamically from viewport height:
  // shorter viewports get tighter bounds; tall desktops get deeper weighted travel
  const topDragBound = Math.round(Math.min(Math.max(windowHeight * 0.32, 130), 400));
  const bottomDragBound = Math.round(Math.min(Math.max(windowHeight * 0.42, 170), 480));
  const dismissThreshold = Math.round(Math.min(Math.max(windowHeight * 0.13, 54), 136));
  const dynamicElastic = Number(
    Math.min(0.38, Math.max(0.22, 0.18 + windowHeight / 5200)).toFixed(2)
  );

  // Track when user drags far enough to trigger dismissal for live tactile grabber feedback
  useMotionValueEvent(dragY, "change", (latest) => {
    const past = Math.abs(latest) >= dismissThreshold;
    if (past !== isPastDismissThreshold) {
      setIsPastDismissThreshold(past);
    }
  });

  // As user swipes up or down, scale down and curve corners proportionally to viewport bounds
  const dragScale = useTransform(
    dragY,
    [-topDragBound, 0, bottomDragBound],
    [0.78, 1, 0.76]
  );
  const dragRadius = useTransform(
    dragY,
    [-topDragBound * 0.7, 0, bottomDragBound * 0.7],
    [48, 0, 48]
  );
  const dragOpacity = useTransform(
    dragY,
    [-topDragBound * 1.15, 0, bottomDragBound * 1.15],
    [0.42, 1, 0.42]
  );

  const triggerTactileClose = () => {
    if (hapticClosing) return;
    setHapticClosing(true);

    // Subtle hardware vibration where supported (e.g. Android/Chrome)
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate?.(14);
      } catch {
        // ignore
      }
    }

    if (prefersReducedMotion) {
      onClose();
      return;
    }

    // Allow the tactile pulse/scale peak to register before exit transition begins
    closeTimeoutRef.current = window.setTimeout(() => {
      onClose();
    }, 145);
  };

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    setIsPastDismissThreshold(false);
    const absOffset = Math.abs(info.offset.y);
    const absVelocity = Math.abs(info.velocity.y);
    const velocityThreshold = Math.round(Math.min(Math.max(windowHeight * 0.48, 320), 460));
    if (absOffset > dismissThreshold || absVelocity > velocityThreshold) {
      triggerTactileClose();
    }
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      drag={prefersReducedMotion ? false : "y"}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: -topDragBound, bottom: bottomDragBound }}
      dragElastic={dynamicElastic}
      dragTransition={{ bounceStiffness: 420, bounceDamping: 32 }}
      dragSnapToOrigin
      onDragEnd={handleDragEnd}
      style={{
        ...(prefersReducedMotion
          ? {}
          : {
              y: dragY,
              scale: dragScale,
              borderRadius: dragRadius,
              opacity: dragOpacity,
            }),
        backdropFilter: "blur(60px) saturate(200%)",
        WebkitBackdropFilter: "blur(60px) saturate(200%)",
      }}
      initial={
        prefersReducedMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              scale: 0.38,
              y: 40,
              borderRadius: 56,
              filter: "blur(8px)",
            }
      }
      animate={
        prefersReducedMotion
          ? { opacity: 1 }
          : {
              opacity: 1,
              scale: 1,
              y: 0,
              borderRadius: 0,
              filter: "blur(0px)",
            }
      }
      exit={
        prefersReducedMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              scale: 0.45,
              y: 50,
              borderRadius: 52,
              filter: "blur(6px)",
            }
      }
      transition={
        prefersReducedMotion
          ? { duration: 0.12 }
          : {
              duration: 0.56,
              ease: [0.16, 1, 0.3, 1],
            }
      }
      className={`fixed inset-0 z-30 flex flex-col overflow-hidden shadow-2xl backdrop-blur-[60px] backdrop-saturate-[200%] ${
        variant === "ios-settings"
          ? "bg-[#EFF1F5]/85 text-[#000000]"
          : "liquid-glass-fullscreen"
      }`}
    >
      {/* Discreet Top Pull Grabber (No header bar) */}
      <div
        onPointerDown={(e) => {
          if (!prefersReducedMotion) dragControls.start(e);
        }}
        className="shrink-0 select-none touch-none pt-2.5 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
      >
        <motion.button
          type="button"
          onClick={triggerTactileClose}
          aria-label={isThai ? `ปิด ${title}` : `Close ${title}`}
          animate={
            hapticClosing
              ? {
                  scaleX: [1, 1.42, 0.92, 1.05],
                  scaleY: [1, 0.7, 1.18, 1],
                  backgroundColor: "rgba(37, 99, 235, 0.85)",
                }
              : isPastDismissThreshold
                ? {
                    scaleX: 1.24,
                    scaleY: 1.1,
                    backgroundColor: "rgba(37, 99, 235, 0.65)",
                  }
                : {
                    scaleX: 1,
                    scaleY: 1,
                    backgroundColor: "rgba(161, 161, 170, 0.45)",
                  }
          }
          className="w-10 h-1 rounded-full cursor-grab active:cursor-grabbing"
        />
      </div>

      {/* Floating Circular Close Button */}
      <div className="absolute top-3.5 right-4 sm:top-4 sm:right-6 z-40">
        <motion.button
          type="button"
          whileHover={prefersReducedMotion ? undefined : { scale: 1.08 }}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
          animate={
            hapticClosing
              ? {
                  scale: [1, 0.8, 1.18, 0.94],
                  boxShadow: [
                    "0 0 0 0 rgba(37, 99, 235, 0)",
                    "0 0 0 8px rgba(37, 99, 235, 0.32)",
                    "0 0 0 14px rgba(37, 99, 235, 0)",
                  ],
                }
              : {
                  scale: 1,
                  boxShadow: "0 0 0 0 rgba(37, 99, 235, 0)",
                }
          }
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={triggerTactileClose}
          aria-label={isThai ? `ปิด ${title}` : `Close ${title}`}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full inline-flex items-center justify-center bg-black/5 hover:bg-black/10 active:bg-black/15 text-zinc-600 hover:text-black backdrop-blur-md transition-colors cursor-pointer shadow-xs focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <X className="w-4 h-4 stroke-[2.2]" aria-hidden="true" />
        </motion.button>
      </div>

      {/* Scrollable Full-Screen App Body */}
      <div className={`flex-1 overflow-y-auto pb-48 ${variant === "ios-settings" ? "px-3 sm:px-6 pt-3" : "px-4 sm:px-8 pt-6"}`}>
        <div className={variant === "ios-settings" ? "max-w-xl mx-auto" : "max-w-3xl mx-auto"}>{children}</div>
      </div>

      {/* Apple iOS Home Bar Indicator Zone (Swipe gesture active + tactile pulse) */}
      <div
        onPointerDown={(e) => {
          if (!prefersReducedMotion) dragControls.start(e);
        }}
        className="fixed inset-x-0 bottom-[98px] sm:bottom-[104px] z-30 flex flex-col items-center justify-center py-2 select-none touch-none pointer-events-auto cursor-grab active:cursor-grabbing"
      >
        <motion.button
          type="button"
          onClick={triggerTactileClose}
          whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
          whileTap={prefersReducedMotion ? undefined : { scale: 0.94 }}
          aria-label={isThai ? "ปิดแอป" : "Close app"}
          className="group flex items-center justify-center px-10 py-3 rounded-full cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <motion.span
            animate={
              hapticClosing
                ? {
                    scaleX: [1, 1.3, 0.94, 1.04],
                    scaleY: [1, 0.72, 1.18, 1],
                    backgroundColor: "rgba(37, 99, 235, 0.85)",
                    boxShadow: [
                      "0 0 0 0 rgba(37, 99, 235, 0)",
                      "0 0 0 8px rgba(37, 99, 235, 0.28)",
                      "0 0 0 0 rgba(37, 99, 235, 0)",
                    ],
                  }
                : isPastDismissThreshold
                  ? {
                      scaleX: 1.18,
                      scaleY: 1.15,
                      backgroundColor: "rgba(37, 99, 235, 0.7)",
                    }
                  : {
                      scaleX: 1,
                      scaleY: 1,
                      backgroundColor: "rgba(24, 24, 27, 0.35)",
                      boxShadow: "0 0 0 0 rgba(37, 99, 235, 0)",
                    }
            }
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-36 sm:w-44 h-1.5 rounded-full group-hover:bg-zinc-900/60 transition-colors shadow-sm"
          />
        </motion.button>
      </div>
    </motion.div>
  );
}
