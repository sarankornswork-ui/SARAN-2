import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SpokenLanguage, StepGuide } from "../types/assistant";

interface StepSlideshowPopupProps {
  guide: StepGuide;
  language: SpokenLanguage;
  onClose: () => void;
}

export function StepSlideshowPopup({
  guide,
  language,
  onClose,
}: StepSlideshowPopupProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    setStepIndex(0);
    setDirection(1);
  }, [guide.id]);

  const totalSteps = guide.steps.length;
  const currentStep = guide.steps[stepIndex] ?? guide.steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isThai = language === "th";

  const handlePrev = useCallback(() => {
    if (isFirst) return;
    setDirection(-1);
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, [isFirst]);

  const handleNext = useCallback(() => {
    if (isLast) {
      onClose();
      return;
    }
    setDirection(1);
    setStepIndex((prev) => Math.min(totalSteps - 1, prev + 1));
  }, [isLast, onClose, totalSteps]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNext, handlePrev, onClose]);

  const progressPct = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 100;

  return (
    <motion.div
      role="dialog"
      aria-label={guide.title}
      initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.93, y: prefersReducedMotion ? 0 : 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.94, y: prefersReducedMotion ? 0 : 14 }}
      transition={{ duration: prefersReducedMotion ? 0.08 : 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-xl liquid-glass rounded-[32px] p-6 sm:p-7 space-y-5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2
            className={`text-xl sm:text-2xl tracking-tight text-zinc-900 text-balance ${
              isThai ? "font-light" : "font-semibold"
            }`}
          >
            {guide.title}
          </h2>
          <div
            className={`flex flex-wrap items-center gap-2 text-xs text-zinc-600 ${
              isThai ? "font-light" : "font-normal"
            }`}
          >
            <span className="font-mono tabular-nums">
              {isThai
                ? `ขั้นตอนที่ ${stepIndex + 1} จาก ${totalSteps}`
                : `Step ${stepIndex + 1} of ${totalSteps}`}
            </span>
            {guide.subtitle && (
              <>
                <span aria-hidden="true">·</span>
                <span>{guide.subtitle}</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={isThai ? "ปิดหน้าต่างขั้นตอน" : "Close guide"}
          className="w-9 h-9 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-700 hover:text-zinc-950 shrink-0 transition-transform hover:scale-105 cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Progress Track */}
      <div className="w-full h-1 rounded-full bg-white/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Animated Slide Content */}
      <div className="relative min-h-[176px] overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={`${guide.id}-${stepIndex}`}
            custom={direction}
            initial={{
              opacity: 0,
              x: prefersReducedMotion ? 0 : direction > 0 ? 28 : -28,
            }}
            animate={{ opacity: 1, x: 0 }}
            exit={{
              opacity: 0,
              x: prefersReducedMotion ? 0 : direction > 0 ? -28 : 28,
            }}
            transition={{
              duration: prefersReducedMotion ? 0.08 : 0.22,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="space-y-3"
          >
            <p
              className={`text-xs text-blue-700 ${
                isThai ? "font-light" : "font-semibold"
              }`}
            >
              {isThai
                ? `ขั้นตอนที่ ${stepIndex + 1}`
                : `Step ${String(stepIndex + 1).padStart(2, "0")}`}
            </p>

            <h3
              className={`text-lg sm:text-xl text-zinc-900 ${
                isThai ? "font-light" : "font-semibold"
              }`}
            >
              {currentStep.stepTitle}
            </h3>

            <p
              className={`text-base sm:text-[17px] leading-relaxed text-zinc-800 ${
                isThai ? "font-light" : "font-normal"
              }`}
            >
              {currentStep.instruction}
            </p>

            {currentStep.tip && (
              <div className="pt-3 mt-3 border-t border-zinc-200/60">
                <p
                  className={`text-xs sm:text-sm leading-relaxed text-zinc-600 ${
                    isThai ? "font-light" : "font-normal"
                  }`}
                >
                  <span
                    className={`text-zinc-800 mr-1.5 ${
                      isThai ? "font-light" : "font-medium"
                    }`}
                  >
                    {isThai ? "เคล็ดลับ:" : "Tip:"}
                  </span>
                  <span>{currentStep.tip}</span>
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Liquid Glass Slideshow Navigation Arrows */}
      <div className="pt-2 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={handlePrev}
          disabled={isFirst}
          aria-label={isThai ? "ขั้นตอนก่อนหน้า" : "Previous step"}
          className="w-12 h-12 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-800 hover:scale-105 hover:text-zinc-950 disabled:opacity-35 disabled:pointer-events-none transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Step Dots */}
        <div
          className="flex items-center gap-1.5"
          aria-label={isThai ? "ตัวชี้ตำแหน่งขั้นตอน" : "Slide indicators"}
        >
          {guide.steps.map((_, idx) => {
            const active = idx === stepIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setDirection(idx > stepIndex ? 1 : -1);
                  setStepIndex(idx);
                }}
                aria-label={
                  isThai ? `ไปขั้นตอนที่ ${idx + 1}` : `Go to step ${idx + 1}`
                }
                className={`h-2 rounded-full transition-all duration-200 cursor-pointer ${
                  active
                    ? "w-6 bg-blue-600"
                    : "w-2 bg-zinc-400/50 hover:bg-zinc-500/70"
                }`}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleNext}
          aria-label={
            isLast
              ? isThai
                ? "เสร็จสิ้น"
                : "Finish guide"
              : isThai
                ? "ขั้นตอนถัดไป"
                : "Next step"
          }
          className={`h-12 rounded-full inline-flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
            isLast
              ? "px-5 bg-blue-600 text-white shadow-md shadow-blue-600/25 hover:bg-blue-700 hover:scale-[1.03]"
              : "w-12 liquid-glass-button text-zinc-800 hover:scale-105 hover:text-blue-700"
          }`}
        >
          {isLast ? (
            <>
              <span className={`text-sm ${isThai ? "font-light" : "font-medium"}`}>
                {isThai ? "เสร็จสิ้น" : "Finish"}
              </span>
              <Check className="w-4 h-4" aria-hidden="true" />
            </>
          ) : (
            <ChevronRight className="w-5 h-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
