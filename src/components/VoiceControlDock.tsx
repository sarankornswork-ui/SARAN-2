import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Mic, MicOff, Plus, Video, VideoOff, X } from "lucide-react";
import type { SessionStatus, SpokenLanguage } from "../types/assistant";

interface VoiceControlDockProps {
  language: SpokenLanguage;
  status: SessionStatus;
  isMuted: boolean;
  isCameraOn: boolean;
  hasMic: boolean;
  showExtras: boolean;
  inputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  outputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  onStartSession: () => void;
  onEndSession: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleExtras: () => void;
}

export function VoiceControlDock({
  language,
  status,
  isMuted,
  isCameraOn,
  hasMic,
  showExtras,
  inputAnalyserRef,
  outputAnalyserRef,
  onStartSession,
  onEndSession,
  onToggleMute,
  onToggleCamera,
  onToggleExtras,
}: VoiceControlDockProps) {
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isActive =
    status === "connecting" || status === "listening" || status === "speaking";

  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let rafId = 0;
    const freqBuffer = new Uint8Array(64);
    let smoothedLevel = 0.08;
    let smoothedSpeed = 1.0;
    let phase = 0;
    let lastTime = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const drawSmoothRibbon = (
      width: number,
      height: number,
      baseY: number,
      amp1: number,
      amp2: number,
      freq1: number,
      freq2: number,
      phaseOffset1: number,
      phaseOffset2: number,
      topColor: string,
      midColor: string,
      bottomColor: string
    ) => {
      const steps = 28;
      const pts: Array<{ x: number; y: number }> = [];

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = t * width;
        // Smooth raised-cosine envelope so edges blend seamlessly
        const edgeFade = 0.25 + 0.75 * Math.pow(Math.sin(t * Math.PI), 0.7);
        const y =
          baseY +
          (Math.sin(t * Math.PI * freq1 + phaseOffset1) * amp1 +
            Math.cos(t * Math.PI * freq2 + phaseOffset2) * amp2) *
            edgeFade;
        pts.push({ x, y });
      }

      ctx.beginPath();
      ctx.moveTo(0, height + 2);
      ctx.lineTo(pts[0].x, pts[0].y);

      for (let i = 0; i < pts.length - 1; i++) {
        const curr = pts[i];
        const next = pts[i + 1];
        const midX = (curr.x + next.x) * 0.5;
        const midY = (curr.y + next.y) * 0.5;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }

      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.lineTo(width, height + 2);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, baseY - amp1 - amp2 - 4, 0, height);
      grad.addColorStop(0, topColor);
      grad.addColorStop(0.55, midColor);
      grad.addColorStop(1, bottomColor);
      ctx.fillStyle = grad;
      ctx.fill();
    };

    const render = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // Compute live acoustic energy smoothly
      const analyser =
        status === "speaking"
          ? outputAnalyserRef.current
          : status === "listening" && !isMuted
            ? inputAnalyserRef.current
            : null;

      let targetLevel = 0.1;
      let targetSpeed = 0.85;

      if (status === "connecting") {
        targetLevel = 0.28;
        targetSpeed = 1.7;
      } else if (analyser) {
        analyser.getByteFrequencyData(freqBuffer);
        let sum = 0;
        const bins = 24;
        for (let i = 0; i < bins; i++) {
          sum += freqBuffer[i];
        }
        const avg = sum / (bins * 255);
        targetLevel = Math.max(0.14, Math.min(1, avg * 2.4));
        targetSpeed =
          status === "speaking" ? 2.4 + targetLevel * 2.2 : 1.4 + targetLevel * 1.4;
      } else if (status === "speaking") {
        targetLevel = 0.52;
        targetSpeed = 2.6;
      } else if (status === "listening" && !isMuted) {
        targetLevel = 0.22;
        targetSpeed = 1.35;
      }

      // Exponential smoothing prevents any sudden jumps or stutter
      const smoothFactor = 1 - Math.exp(-8 * dt);
      smoothedLevel += (targetLevel - smoothedLevel) * smoothFactor;
      smoothedSpeed += (targetSpeed - smoothedSpeed) * (1 - Math.exp(-5 * dt));

      if (!prefersReducedMotion) {
        phase += dt * smoothedSpeed * 2.1;
      }

      // Soft frosted translucent interior
      const glassBg = ctx.createLinearGradient(0, 0, 0, height);
      glassBg.addColorStop(0, "rgba(255, 255, 255, 0.72)");
      glassBg.addColorStop(0.55, "rgba(232, 242, 255, 0.55)");
      glassBg.addColorStop(1, "rgba(219, 234, 254, 0.68)");
      ctx.fillStyle = glassBg;
      ctx.fillRect(0, 0, width, height);

      const baseLine = height * (0.66 - smoothedLevel * 0.24);
      const ampPrimary = 3.5 + smoothedLevel * 9.5;
      const ampSecondary = 1.8 + smoothedLevel * 4.5;

      // Ambient luminous blue aura underneath
      const aura = ctx.createRadialGradient(
        width * 0.5,
        height * 0.9,
        4,
        width * 0.5,
        height * 0.85,
        width * 0.55
      );
      aura.addColorStop(
        0,
        `rgba(59, 130, 246, ${0.18 + smoothedLevel * 0.28})`
      );
      aura.addColorStop(1, "rgba(59, 130, 246, 0)");
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);

      // Layer 1: Soft sky-cyan back silk wave
      drawSmoothRibbon(
        width,
        height,
        baseLine - 3,
        ampPrimary * 0.85,
        ampSecondary * 0.9,
        1.8,
        3.1,
        phase * 0.75,
        -phase * 0.55 + 1.1,
        "rgba(125, 211, 252, 0.52)",
        "rgba(96, 165, 250, 0.62)",
        "rgba(59, 130, 246, 0.78)"
      );

      // Layer 2: Luminous cobalt middle wave
      drawSmoothRibbon(
        width,
        height,
        baseLine + 1,
        ampPrimary,
        ampSecondary,
        2.2,
        3.7,
        -phase * 1.05 + 2.2,
        phase * 0.8,
        "rgba(96, 165, 250, 0.65)",
        "rgba(59, 130, 246, 0.84)",
        "rgba(37, 99, 235, 0.92)"
      );

      // Layer 3: Deep sapphire foreground wave with soft luminous crest
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      drawSmoothRibbon(
        width,
        height,
        baseLine + 5,
        ampPrimary * 0.72,
        ampSecondary * 0.7,
        2.7,
        4.3,
        phase * 1.3 + 4.1,
        -phase * 0.95 + 0.6,
        "rgba(56, 189, 248, 0.45)",
        "rgba(37, 99, 235, 0.85)",
        "rgba(29, 78, 216, 0.95)"
      );
      ctx.restore();

      // Top liquid-glass specular sheen inside capsule
      const sheen = ctx.createLinearGradient(0, 0, 0, height * 0.48);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.75)");
      sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, width, height * 0.48);

      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [status, isMuted, inputAnalyserRef, outputAnalyserRef]);

  return (
    <motion.div
      layout
      className={`inline-flex items-center gap-3 sm:gap-3.5 px-3.5 py-2.5 rounded-full liquid-glass transition-shadow duration-500 ${
        isActive
          ? "shadow-[0_18px_50px_-8px_rgba(37,99,235,0.34),0_4px_16px_rgba(56,189,248,0.2),inset_0_1.5px_2px_rgba(255,255,255,0.98)]"
          : ""
      }`}
    >
      {/* + Button: Attach photo, Spotify, or type message */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        onClick={onToggleExtras}
        aria-label={
          language === "th"
            ? "แนบรูปภาพหรือพิมพ์ข้อความ"
            : "Attach image or type message"
        }
        title={
          language === "th"
            ? "แนบรูปภาพหรือพิมพ์ข้อความ"
            : "Attach image or type message"
        }
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full inline-flex items-center justify-center transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          showExtras
            ? "bg-zinc-900 text-white shadow-sm"
            : "liquid-glass-button text-zinc-700 hover:text-zinc-950"
        }`}
      >
        <motion.span
          animate={{ rotate: showExtras ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 26 }}
          className="inline-flex"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
        </motion.span>
      </motion.button>

      {/* Camera Button: Opens live camera popup */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => void onToggleCamera()}
        aria-label={
          isCameraOn
            ? language === "th"
              ? "ปิดกล้อง"
              : "Turn off camera"
            : language === "th"
              ? "เปิดกล้องให้โนแลนดู"
              : "Turn on camera"
        }
        title={
          isCameraOn
            ? language === "th"
              ? "ปิดกล้อง"
              : "Turn off camera"
            : language === "th"
              ? "เปิดกล้องให้โนแลนดู"
              : "Turn on camera"
        }
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full inline-flex items-center justify-center transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          isCameraOn
            ? "bg-blue-600 text-white shadow-md shadow-blue-600/25 hover:bg-blue-700"
            : "liquid-glass-button text-zinc-700 hover:text-zinc-950"
        }`}
      >
        {isCameraOn ? (
          <Video className="w-5 h-5" aria-hidden="true" />
        ) : (
          <VideoOff className="w-5 h-5" aria-hidden="true" />
        )}
      </motion.button>

      {/* Center Seamless Liquid Blue Wave Capsule */}
      <motion.button
        type="button"
        whileHover={{ scale: isActive ? 1.01 : 1.03 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => {
          if (!isActive) {
            onStartSession();
          }
        }}
        aria-label={
          isActive
            ? language === "th"
              ? "กำลังสนทนากับโนแลน"
              : "Voice session active"
            : language === "th"
              ? "เริ่มคุยกับโนแลน"
              : "Start talking to Nolan"
        }
        className={`relative w-36 sm:w-44 h-12 sm:h-14 rounded-full overflow-hidden border transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          isActive
            ? "border-white/95 shadow-[0_8px_28px_rgba(37,99,235,0.28),inset_0_1px_2px_rgba(255,255,255,0.95)] cursor-default"
            : "border-white/85 shadow-[0_4px_16px_rgba(15,23,42,0.08),inset_0_1px_2px_rgba(255,255,255,0.9)] cursor-pointer"
        }`}
      >
        <canvas
          ref={waveCanvasRef}
          className="w-full h-full block"
          aria-hidden="true"
        />
      </motion.button>

      {/* Microphone Mute / Start Button */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => {
          if (!isActive) {
            onStartSession();
          } else if (hasMic) {
            onToggleMute();
          }
        }}
        aria-label={
          !isActive
            ? language === "th"
              ? "กดเพื่อพูด"
              : "Start microphone"
            : isMuted
              ? language === "th"
                ? "เปิดไมโครโฟน"
                : "Unmute microphone"
              : language === "th"
                ? "ปิดไมโครโฟน"
                : "Mute microphone"
        }
        title={
          !isActive
            ? language === "th"
              ? "กดเพื่อพูด"
              : "Start microphone"
            : isMuted
              ? language === "th"
                ? "เปิดไมโครโฟน"
                : "Unmute microphone"
              : language === "th"
                ? "ปิดไมโครโฟน"
                : "Mute microphone"
        }
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full inline-flex items-center justify-center transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          isActive && isMuted
            ? "bg-amber-100/90 text-amber-800 border border-amber-300/90 hover:bg-amber-200/90"
            : isActive
              ? "bg-zinc-900/90 text-white shadow-md hover:bg-zinc-950"
              : "liquid-glass-button text-zinc-700 hover:text-zinc-950"
        }`}
      >
        {isActive && isMuted ? (
          <MicOff className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Mic className="w-5 h-5" aria-hidden="true" />
        )}
      </motion.button>

      {/* Close (X) Button */}
      <motion.button
        type="button"
        whileHover={!isActive && !isCameraOn ? undefined : { scale: 1.06 }}
        whileTap={!isActive && !isCameraOn ? undefined : { scale: 0.92 }}
        onClick={onEndSession}
        disabled={!isActive && !isCameraOn}
        aria-label={language === "th" ? "ปิดการสนทนา" : "End session"}
        title={language === "th" ? "ปิดการสนทนา" : "End session"}
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full inline-flex items-center justify-center liquid-glass-button text-zinc-700 hover:bg-red-50/90 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </motion.button>
    </motion.div>
  );
}
