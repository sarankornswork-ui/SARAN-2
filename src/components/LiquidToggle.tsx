import { motion, useReducedMotion } from "motion/react";

interface LiquidToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  accent?: "blue" | "emerald";
}

export function LiquidToggle({
  checked,
  onChange,
  ariaLabel,
  accent = "blue",
}: LiquidToggleProps) {
  const prefersReducedMotion = useReducedMotion();

  const activeTrackClass =
    accent === "emerald"
      ? "bg-gradient-to-r from-emerald-500/90 to-[#1DB954]/95 border-emerald-300/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_4px_14px_rgba(29,185,84,0.28)]"
      : "bg-gradient-to-r from-sky-500/90 to-blue-600/95 border-sky-300/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.45),0_4px_14px_rgba(37,99,235,0.28)]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
        checked
          ? activeTrackClass
          : "bg-zinc-200/75 border-white/90 shadow-[inset_0_2px_4px_rgba(15,23,42,0.08)]"
      }`}
    >
      <motion.span
        layout
        transition={
          prefersReducedMotion
            ? { duration: 0.05 }
            : { type: "spring", stiffness: 520, damping: 32, mass: 0.7 }
        }
        className={`pointer-events-none block h-6 w-6 rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.18),inset_0_1px_1px_rgba(255,255,255,1)] ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface LiquidSegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  layoutId: string;
  ariaLabel: string;
  size?: "sm" | "md";
  isThai?: boolean;
}

export function LiquidSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  ariaLabel,
  size = "md",
  isThai = false,
}: LiquidSegmentedControlProps<T>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative inline-flex items-center gap-1 rounded-full bg-zinc-100/80 backdrop-blur-md border border-white/90 p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative z-10 rounded-full transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              size === "sm"
                ? "px-3 py-1 text-[11px] min-h-[30px]"
                : "px-3.5 py-1.5 text-xs sm:text-sm min-h-[34px]"
            } ${isThai ? "font-light" : "font-medium"} ${
              active ? "text-white" : "text-zinc-700 hover:text-zinc-950"
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={
                  prefersReducedMotion
                    ? { duration: 0.05 }
                    : { type: "spring", stiffness: 460, damping: 34, mass: 0.8 }
                }
                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_3px_12px_rgba(37,99,235,0.28),inset_0_1px_1px_rgba(255,255,255,0.4)]"
              />
            )}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
