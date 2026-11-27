import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NolanEngineMode,
  SessionStatus,
  SpokenLanguage,
  StepGuide,
  TranscriptEntry,
} from "../types/assistant";

function float32ToInt16Resampled(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000
): Int16Array {
  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    const sample = input[idx0] * (1 - frac) + input[idx1] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function base64ToFloat32Pcm24k(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function pickPreferredMaleVoice(
  voices: SpeechSynthesisVoice[],
  language: SpokenLanguage
): { voice: SpeechSynthesisVoice | null; isExplicitMale: boolean } {
  if (!voices.length) return { voice: null, isExplicitMale: false };
  const langPrefix = language === "th" ? "th" : "en";
  const langVoices = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(langPrefix)
  );
  const pool = langVoices.length > 0 ? langVoices : voices;

  const maleRegex =
    /(niwat|pattara|male|daniel|aaron|alex|arthur|oliver|ryan|guy|george|david|mark|andrew|christopher|steffan|liam|thomas)/i;
  const femaleRegex =
    /(kanya|premwadee|narisa|female|samantha|victoria|karen|moira|tessa|fiona|aria|jenny|zira|susan)/i;

  const explicitMale = pool.find((v) => maleRegex.test(v.name));
  if (explicitMale) {
    return { voice: explicitMale, isExplicitMale: true };
  }

  const nonFemale = pool.find((v) => !femaleRegex.test(v.name));
  if (nonFemale) {
    return { voice: nonFemale, isExplicitMale: false };
  }

  return { voice: pool[0] || null, isExplicitMale: false };
}

function splitIntoExpressiveChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Split by sentence punctuation or natural Thai pause boundaries when long
  const rawParts = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const part of rawParts) {
    if (part.length <= 95) {
      chunks.push(part);
    } else {
      // Break long Thai/English sentences gently on spaces around 75 chars for natural breathing
      const words = part.split(" ");
      let buf = "";
      for (const w of words) {
        if (buf && buf.length + w.length + 1 > 85) {
          chunks.push(buf.trim());
          buf = w;
        } else {
          buf = buf ? `${buf} ${w}` : w;
        }
      }
      if (buf.trim()) chunks.push(buf.trim());
    }
  }
  return chunks.length > 0 ? chunks : [normalized];
}

function getEmotionalProsody(
  phrase: string,
  lang: SpokenLanguage,
  isExplicitMale: boolean
): { rate: number; pitch: number; volume: number } {
  const basePitch = isExplicitMale ? 0.94 : lang === "th" ? 0.78 : 0.82;
  const baseRate = lang === "th" ? 1.01 : 0.99;

  // Empathetic / gentle / apologetic
  if (
    /(ขอโทษ|ขออภัย|เสียใจ|ไม่เป็นไร|เข้าใจ|ใจเย็น|เป็นกำลังใจ|sorry|apologize|understand|gentle|calm|worry)/i.test(
      phrase
    )
  ) {
    return {
      rate: Number((baseRate * 0.91).toFixed(2)),
      pitch: Number(Math.max(0.6, basePitch - 0.05).toFixed(2)),
      volume: 0.92,
    };
  }

  // Upbeat / excited / greeting / music playing
  if (
    /(!|สวัสดี|ยินดี|สุดยอด|เยี่ยม|เจ๋ง|กำลังเปิดเพลง|เรียบร้อย|พร้อม|great|awesome|hey|happy|love|playing|ready|excited)/i.test(
      phrase
    )
  ) {
    return {
      rate: Number((baseRate * 1.07).toFixed(2)),
      pitch: Number(Math.min(1.25, basePitch + 0.07).toFixed(2)),
      volume: 1.0,
    };
  }

  // Curious / questioning inflection
  if (/(\?|ไหม|หรือเปล่า|อย่างไร|ทำไม|อะไร|เหรอ|what|why|how|would you|can i)/i.test(phrase)) {
    return {
      rate: Number((baseRate * 1.01).toFixed(2)),
      pitch: Number(Math.min(1.2, basePitch + 0.04).toFixed(2)),
      volume: 0.98,
    };
  }

  // Warm conversational baseline
  return {
    rate: baseRate,
    pitch: basePitch,
    volume: 0.98,
  };
}

export interface UseLiveVoiceSessionOptions {
  spotifySessionId?: string | null;
  spotifyPersistentToken?: string | null;
  onSpotifyState?: (playback: any, notice?: string, premiumRequired?: boolean) => void;
}

export interface UseLiveVoiceSessionReturn {
  status: SessionStatus;
  engineMode: NolanEngineMode;
  gemmaLoadPct: number;
  gemmaLoadStatus: "unloaded" | "loading" | "ready" | "error";
  isThinking: boolean;
  errorMessage: string | null;
  fallbackNotice: string | null;
  isAuthError: boolean;
  isQuotaError: boolean;
  micWarning: string | null;
  cameraError: string | null;
  isMuted: boolean;
  hasMic: boolean;
  isCameraOn: boolean;
  cameraStream: MediaStream | null;
  elapsedSeconds: number;
  transcript: TranscriptEntry[];
  stepGuide: StepGuide | null;
  inputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  outputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  startSession: (
    language: SpokenLanguage,
    engine?: NolanEngineMode,
    greetingEnabled?: boolean
  ) => Promise<void>;
  retrySession: (overrideEngine?: NolanEngineMode) => Promise<void>;
  stopSession: () => void;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
  sendTextMessage: (text: string) => void;
  sendImageFrame: (base64Data: string, mimeType: string) => void;
  clearTranscript: () => void;
  dismissFallbackNotice: () => void;
  openStepGuide: (guide: StepGuide) => void;
  dismissStepGuide: () => void;
}

export function useLiveVoiceSession(
  options?: UseLiveVoiceSessionOptions
): UseLiveVoiceSessionReturn {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [engineMode, setEngineMode] = useState<NolanEngineMode>("gemini-live");
  const [gemmaLoadPct, setGemmaLoadPct] = useState(0);
  const [gemmaLoadStatus, setGemmaLoadStatus] = useState<
    "unloaded" | "loading" | "ready" | "error"
  >("unloaded");
  const [isThinking, setIsThinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [stepGuide, setStepGuide] = useState<StepGuide | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recognitionRef = useRef<any>(null);
  const recognitionActiveRef = useRef(false);
  const speechActiveRef = useRef(false);
  const speechSeqRef = useRef(0);

  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef(false);
  const statusRef = useRef<SessionStatus>("idle");
  const engineModeRef = useRef<NolanEngineMode>("gemini-live");
  const activeUserEntryIdRef = useRef<string | null>(null);
  const activeAssistantEntryIdRef = useRef<string | null>(null);
  const lastLanguageRef = useRef<SpokenLanguage>("th");
  const onSpotifyStateRef = useRef(options?.onSpotifyState);
  const spotifySessionIdRef = useRef<string | null>(options?.spotifySessionId ?? null);
  const spotifyPersistentTokenRef = useRef<string | null>(
    options?.spotifyPersistentToken ?? null
  );

  useEffect(() => {
    onSpotifyStateRef.current = options?.onSpotifyState;
  }, [options?.onSpotifyState]);

  useEffect(() => {
    const nextId = options?.spotifySessionId ?? null;
    const nextToken = options?.spotifyPersistentToken ?? null;
    spotifySessionIdRef.current = nextId;
    spotifyPersistentTokenRef.current = nextToken;
    if ((nextId || nextToken) && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "spotify_session",
          ...(nextId ? { sessionId: nextId } : {}),
          ...(nextToken ? { persistentToken: nextToken } : {}),
        })
      );
    }
  }, [options?.spotifyPersistentToken, options?.spotifySessionId]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    engineModeRef.current = engineMode;
  }, [engineMode]);

  // Session duration timer
  useEffect(() => {
    if (status !== "listening" && status !== "speaking") {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const stopCamera = useCallback(() => {
    if (videoIntervalRef.current !== null) {
      window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
      videoElementRef.current = null;
    }
    if (cameraStreamRef.current) {
      for (const track of cameraStreamRef.current.getTracks()) {
        track.stop();
      }
      cameraStreamRef.current = null;
    }
    setCameraStream(null);
    setIsCameraOn(false);
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    recognitionActiveRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  const stopScheduledAudio = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    speechSeqRef.current += 1;
    speechActiveRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }, []);

  const teardownMediaAndSocket = useCallback(() => {
    stopScheduledAudio();
    stopSpeechRecognition();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    inputAnalyserRef.current = null;

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    outputAnalyserRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    activeUserEntryIdRef.current = null;
    activeAssistantEntryIdRef.current = null;
    setIsThinking(false);
    setHasMic(false);
  }, [stopScheduledAudio, stopSpeechRecognition]);

  const finalizeOpenEntries = useCallback(() => {
    const userId = activeUserEntryIdRef.current;
    const assistantId = activeAssistantEntryIdRef.current;
    if (!userId && !assistantId) return;

    setTranscript((prev) =>
      prev.map((entry) =>
        entry.id === userId || entry.id === assistantId
          ? { ...entry, isFinal: true }
          : entry
      )
    );
    activeUserEntryIdRef.current = null;
    activeAssistantEntryIdRef.current = null;
  }, []);

  const setInterimUserTranscript = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existingId = activeUserEntryIdRef.current;
    if (existingId) {
      setTranscript((prev) =>
        prev.map((e) => (e.id === existingId ? { ...e, text: trimmed } : e))
      );
    } else {
      const newId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      activeUserEntryIdRef.current = newId;
      setTranscript((prev) => [
        ...prev,
        {
          id: newId,
          role: "user",
          text: trimmed,
          timestamp: Date.now(),
          isFinal: false,
        },
      ]);
    }
  }, []);

  const appendTranscriptDelta = useCallback(
    (role: "user" | "assistant", delta: string) => {
      if (!delta) return;

      if (role === "user") {
        if (activeAssistantEntryIdRef.current) {
          const prevAssistantId = activeAssistantEntryIdRef.current;
          activeAssistantEntryIdRef.current = null;
          setTranscript((prev) =>
            prev.map((e) =>
              e.id === prevAssistantId ? { ...e, isFinal: true } : e
            )
          );
        }

        const existingId = activeUserEntryIdRef.current;
        if (existingId) {
          setTranscript((prev) =>
            prev.map((e) =>
              e.id === existingId ? { ...e, text: e.text + delta } : e
            )
          );
        } else {
          const newId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          activeUserEntryIdRef.current = newId;
          setTranscript((prev) => [
            ...prev,
            {
              id: newId,
              role: "user",
              text: delta.trimStart(),
              timestamp: Date.now(),
              isFinal: false,
            },
          ]);
        }
      } else {
        if (activeUserEntryIdRef.current) {
          const prevUserId = activeUserEntryIdRef.current;
          activeUserEntryIdRef.current = null;
          setTranscript((prev) =>
            prev.map((e) => (e.id === prevUserId ? { ...e, isFinal: true } : e))
          );
        }

        const existingId = activeAssistantEntryIdRef.current;
        if (existingId) {
          setTranscript((prev) =>
            prev.map((e) =>
              e.id === existingId ? { ...e, text: e.text + delta } : e
            )
          );
        } else {
          const newId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          activeAssistantEntryIdRef.current = newId;
          setTranscript((prev) => [
            ...prev,
            {
              id: newId,
              role: "assistant",
              text: delta.trimStart(),
              timestamp: Date.now(),
              isFinal: false,
            },
          ]);
        }
      }
    },
    []
  );

  const speakBrowserText = useCallback((text: string, lang: SpokenLanguage) => {
    const clean = text.trim();
    if (!clean || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    try {
      const seqId = ++speechSeqRef.current;
      window.speechSynthesis.cancel();

      const voices = window.speechSynthesis.getVoices();
      const { voice: preferredVoice, isExplicitMale } = pickPreferredMaleVoice(
        voices,
        lang
      );
      const chunks = splitIntoExpressiveChunks(clean);
      if (chunks.length === 0) return;

      const speakChunkAt = (index: number) => {
        if (seqId !== speechSeqRef.current) return;
        if (index >= chunks.length) {
          speechActiveRef.current = false;
          if (statusRef.current === "speaking") {
            setStatus("listening");
          }
          return;
        }

        const phrase = chunks[index];
        const prosody = getEmotionalProsody(phrase, lang, isExplicitMale);
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = lang === "th" ? "th-TH" : "en-US";
        utterance.rate = prosody.rate;
        utterance.pitch = prosody.pitch;
        utterance.volume = prosody.volume;
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        utterance.onstart = () => {
          if (seqId !== speechSeqRef.current) return;
          speechActiveRef.current = true;
          if (statusRef.current !== "idle" && statusRef.current !== "error") {
            setStatus("speaking");
          }
        };

        utterance.onend = () => {
          if (seqId !== speechSeqRef.current) return;
          speakChunkAt(index + 1);
        };

        utterance.onerror = () => {
          if (seqId !== speechSeqRef.current) return;
          speechActiveRef.current = false;
          if (statusRef.current === "speaking") {
            setStatus("listening");
          }
        };

        window.speechSynthesis.speak(utterance);
      };

      speakChunkAt(0);
    } catch {
      speechActiveRef.current = false;
    }
  }, []);

  const playAudioChunk = useCallback((base64Data: string) => {
    const ctx = outputCtxRef.current;
    const analyser = outputAnalyserRef.current;
    if (!ctx || !analyser) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const float32 = base64ToFloat32Pcm24k(base64Data);
    if (float32.length === 0) return;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    setStatus("speaking");

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (
        activeSourcesRef.current.size === 0 &&
        statusRef.current === "speaking"
      ) {
        setStatus("listening");
      }
    };

    source.start(startAt);
  }, []);

  const playWavAudio = useCallback(async (base64Wav: string) => {
    const ctx = outputCtxRef.current;
    const analyser = outputAnalyserRef.current;
    if (!ctx || !analyser) return;

    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    try {
      const arrayBuffer = base64ToArrayBuffer(base64Wav);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);

      const now = ctx.currentTime;
      const startAt = Math.max(now + 0.015, nextStartTimeRef.current);
      nextStartTimeRef.current = startAt + audioBuffer.duration;

      activeSourcesRef.current.add(source);
      setIsThinking(false);
      setStatus("speaking");

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (
          activeSourcesRef.current.size === 0 &&
          statusRef.current === "speaking"
        ) {
          setStatus("listening");
        }
      };

      source.start(startAt);
    } catch (err) {
      console.warn("WAV decode error:", err);
    }
  }, []);

  const startBrowserSpeechRecognition = useCallback(
    (language: SpokenLanguage) => {
      const SpeechRec =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (!SpeechRec) {
        setMicWarning(
          language === "th"
            ? "เบราว์เซอร์นี้ไม่รองรับการแปลงเสียงเป็นข้อความอัตโนมัติ สามารถพิมพ์ในปุ่ม + เพื่อคุยกับ Nolan ได้เลยครับ"
            : "This browser does not support automatic speech recognition. You can still type in the + menu to chat with Nolan."
        );
        return;
      }

      stopSpeechRecognition();
      const recognition = new SpeechRec();
      recognition.lang = language === "th" ? "th-TH" : "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionActiveRef.current = true;

      recognition.onresult = (event: any) => {
        if (isMutedRef.current || speechActiveRef.current) return;
        let interim = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const txt = res[0]?.transcript || "";
          if (res.isFinal) {
            finalText += txt;
          } else {
            interim += txt;
          }
        }

        if (interim.trim()) {
          setInterimUserTranscript(interim);
        }

        if (finalText.trim()) {
          const cleaned = finalText.trim();
          setInterimUserTranscript(cleaned);
          finalizeOpenEntries();

          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            setIsThinking(true);
            ws.send(JSON.stringify({ type: "text", text: cleaned }));
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
          recognitionActiveRef.current = false;
          setMicWarning(
            language === "th"
              ? "ไม่สามารถเข้าถึงไมโครโฟนได้ คุณยังสามารถพิมพ์ในปุ่ม + และฟังเสียง Nolan ได้ครับ"
              : "Microphone permission declined. You can still type in the + menu and hear Nolan speak."
          );
        }
      };

      recognition.onend = () => {
        if (
          recognitionActiveRef.current &&
          (statusRef.current === "listening" || statusRef.current === "speaking")
        ) {
          setTimeout(() => {
            if (!recognitionActiveRef.current) return;
            try {
              recognition.start();
            } catch {
              // ignore restart race
            }
          }, 250);
        }
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        // ignore start errors
      }
    },
    [finalizeOpenEntries, setInterimUserTranscript, stopSpeechRecognition]
  );

  const stopSession = useCallback(() => {
    finalizeOpenEntries();
    teardownMediaAndSocket();
    stopCamera();
    setStatus("idle");
    setErrorMessage(null);
    setFallbackNotice(null);
    setIsAuthError(false);
    setIsQuotaError(false);
    setMicWarning(null);
    setCameraError(null);
  }, [finalizeOpenEntries, stopCamera, teardownMediaAndSocket]);

  const startSession = useCallback(
    async (
      language: SpokenLanguage,
      requestedEngine?: NolanEngineMode,
      greetingEnabled = true
    ) => {
      const targetEngine = requestedEngine || engineModeRef.current || "gemini-live";
      setEngineMode(targetEngine);
      engineModeRef.current = targetEngine;
      lastLanguageRef.current = language;

      teardownMediaAndSocket();
      setErrorMessage(null);
      setFallbackNotice(null);
      setIsAuthError(false);
      setIsQuotaError(false);
      setMicWarning(null);
      setElapsedSeconds(0);
      setIsMuted(false);
      isMutedRef.current = false;
      setStatus("connecting");

      // Warm browser voices list early for speechSynthesis
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.getVoices();
        } catch {
          // ignore
        }
      }

      const OutputCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      let outputCtx: AudioContext;
      try {
        outputCtx = new OutputCtx({ sampleRate: 24000 });
      } catch {
        outputCtx = new OutputCtx();
      }
      void outputCtx.resume().catch(() => {});
      const outputAnalyser = outputCtx.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.smoothingTimeConstant = 0.78;
      outputAnalyser.connect(outputCtx.destination);
      outputCtxRef.current = outputCtx;
      outputAnalyserRef.current = outputAnalyser;
      nextStartTimeRef.current = outputCtx.currentTime;

      let micReady = false;
      try {
        if (navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          });
          mediaStreamRef.current = stream;

          let inputCtx: AudioContext;
          try {
            inputCtx = new OutputCtx({ sampleRate: 16000 });
          } catch {
            inputCtx = new OutputCtx();
          }
          void inputCtx.resume().catch(() => {});
          const inputAnalyser = inputCtx.createAnalyser();
          inputAnalyser.fftSize = 256;
          inputAnalyser.smoothingTimeConstant = 0.75;

          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(2048, 1, 1);

          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          source.connect(inputAnalyser);
          inputAnalyser.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          inputCtxRef.current = inputCtx;
          inputAnalyserRef.current = inputAnalyser;
          sourceNodeRef.current = source;
          processorRef.current = processor;

          processor.onaudioprocess = (event) => {
            if (isMutedRef.current) return;
            if (engineModeRef.current !== "gemini-live") return;
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            if (
              statusRef.current !== "listening" &&
              statusRef.current !== "speaking"
            ) {
              return;
            }
            const channelData = event.inputBuffer.getChannelData(0);
            const pcm16 = float32ToInt16Resampled(
              channelData,
              inputCtx.sampleRate,
              16000
            );
            const base64 = int16ToBase64(pcm16);
            ws.send(JSON.stringify({ type: "audio", data: base64 }));
          };

          micReady = true;
          setHasMic(true);
        } else {
          setMicWarning(
            language === "th"
              ? "เบราว์เซอร์นี้ไม่รองรับไมโครโฟน คุณยังสามารถพิมพ์ในปุ่ม + และฟังเสียง Nolan ได้ครับ"
              : "Microphone API unavailable in this browser. You can still type messages and hear Nolan speak."
          );
        }
      } catch {
        setMicWarning(
          language === "th"
            ? "ไม่ได้รับสิทธิ์เข้าถึงไมโครโฟน คุณยังสามารถพิมพ์ในปุ่ม + และฟังเสียง Nolan ได้ครับ"
            : "Microphone access was declined or unavailable. You can still type messages and listen to Nolan."
        );
      }

      if (!micReady) {
        setHasMic(false);
      }

      if (targetEngine === "gemma-open" && micReady) {
        startBrowserSpeechRecognition(language);
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "init",
            engine: targetEngine,
            language,
            greetingEnabled,
            ...(spotifySessionIdRef.current
              ? { sessionId: spotifySessionIdRef.current }
              : {}),
            ...(spotifyPersistentTokenRef.current
              ? { persistentToken: spotifyPersistentTokenRef.current }
              : {}),
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: {
          type?: string;
          engine?: NolanEngineMode;
          status?: "unloaded" | "loading" | "ready" | "error";
          progressPct?: number;
          data?: string;
          text?: string;
          language?: SpokenLanguage;
          message?: string;
          fallbackNotice?: string;
          guide?: StepGuide;
          gemma?: {
            status: "unloaded" | "loading" | "ready" | "error";
            progressPct: number;
          };
        };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "ready":
            if (msg.engine && msg.engine !== engineModeRef.current) {
              setEngineMode(msg.engine);
              engineModeRef.current = msg.engine;
              if (
                msg.engine === "gemma-open" &&
                mediaStreamRef.current &&
                !recognitionActiveRef.current
              ) {
                startBrowserSpeechRecognition(lastLanguageRef.current);
              }
            }
            if (msg.fallbackNotice) {
              setFallbackNotice(msg.fallbackNotice);
            }
            if (msg.gemma) {
              setGemmaLoadStatus(msg.gemma.status);
              setGemmaLoadPct(msg.gemma.progressPct);
            }
            setStatus("listening");
            break;
          case "gemma_status":
            if (msg.status) setGemmaLoadStatus(msg.status);
            if (typeof msg.progressPct === "number") setGemmaLoadPct(msg.progressPct);
            break;
          case "step_guide":
            if (msg.guide && Array.isArray(msg.guide.steps) && msg.guide.steps.length > 0) {
              setStepGuide(msg.guide);
            }
            break;
          case "spotify_state":
            if (onSpotifyStateRef.current) {
              const spMsg = msg as {
                playback?: any;
                notice?: string;
                premiumRequired?: boolean;
              };
              onSpotifyStateRef.current(
                spMsg.playback,
                spMsg.notice,
                spMsg.premiumRequired
              );
            }
            break;
          case "audio":
            if (msg.data) {
              playAudioChunk(msg.data);
            }
            break;
          case "audio_wav":
            if (msg.data) {
              void playWavAudio(msg.data);
            }
            break;
          case "speak_text":
            if (msg.text) {
              setIsThinking(false);
              speakBrowserText(msg.text, msg.language || lastLanguageRef.current);
            }
            break;
          case "input_transcript":
            if (msg.text) {
              appendTranscriptDelta("user", msg.text);
            }
            break;
          case "output_transcript":
            if (msg.text) {
              setIsThinking(false);
              appendTranscriptDelta("assistant", msg.text);
            }
            break;
          case "turn_complete":
            setIsThinking(false);
            finalizeOpenEntries();
            if (activeSourcesRef.current.size === 0 && !speechActiveRef.current) {
              setStatus("listening");
            }
            break;
          case "interrupted":
            setIsThinking(false);
            stopScheduledAudio();
            finalizeOpenEntries();
            setStatus("listening");
            break;
          case "error": {
            setIsThinking(false);
            const rawMsg = msg.message || "Voice session encountered a connection error.";
            const lower = rawMsg.toLowerCase();
            const isAuth =
              Boolean((msg as any).isAuthError) ||
              lower.includes("api key") ||
              lower.includes("unauthenticated") ||
              lower.includes("permission_denied");
            const isQuota =
              Boolean((msg as any).isQuotaError) ||
              lower.includes("prepayment credits") ||
              lower.includes("credits are depleted") ||
              lower.includes("billing") ||
              lower.includes("1011");

            setIsAuthError(isAuth);
            setIsQuotaError(isQuota);
            setErrorMessage(rawMsg);
            finalizeOpenEntries();
            teardownMediaAndSocket();
            setStatus("error");
            break;
          }
          case "closed":
            setIsThinking(false);
            finalizeOpenEntries();
            teardownMediaAndSocket();
            setStatus("idle");
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        setErrorMessage(
          "Unable to connect to the live voice server. Please try again."
        );
        teardownMediaAndSocket();
        setStatus("error");
      };

      ws.onclose = () => {
        if (statusRef.current !== "error" && statusRef.current !== "idle") {
          finalizeOpenEntries();
          teardownMediaAndSocket();
          setStatus("idle");
        }
      };
    },
    [
      appendTranscriptDelta,
      finalizeOpenEntries,
      playAudioChunk,
      speakBrowserText,
      startBrowserSpeechRecognition,
      stopScheduledAudio,
      teardownMediaAndSocket,
    ]
  );

  const toggleCamera = useCallback(async () => {
    setCameraError(null);
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not supported in this browser.");
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      cameraStreamRef.current = stream;
      setCameraStream(stream);
      setIsCameraOn(true);

      // Hidden video + canvas sampler for 1 FPS Gemini Live vision frames
      const hiddenVideo = document.createElement("video");
      hiddenVideo.playsInline = true;
      hiddenVideo.muted = true;
      hiddenVideo.srcObject = stream;
      await hiddenVideo.play().catch(() => {});
      videoElementRef.current = hiddenVideo;

      if (!videoCanvasRef.current) {
        videoCanvasRef.current = document.createElement("canvas");
      }

      videoIntervalRef.current = window.setInterval(() => {
        if (engineModeRef.current !== "gemini-live") return;
        const ws = wsRef.current;
        const vid = videoElementRef.current;
        const canvas = videoCanvasRef.current;
        if (
          !ws ||
          ws.readyState !== WebSocket.OPEN ||
          !vid ||
          !canvas ||
          vid.videoWidth === 0 ||
          vid.videoHeight === 0
        ) {
          return;
        }
        if (
          statusRef.current !== "listening" &&
          statusRef.current !== "speaking"
        ) {
          return;
        }

        const maxDim = 640;
        const scale = Math.min(1, maxDim / Math.max(vid.videoWidth, vid.videoHeight));
        const w = Math.max(1, Math.round(vid.videoWidth * scale));
        const h = Math.max(1, Math.round(vid.videoHeight * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(vid, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          ws.send(
            JSON.stringify({
              type: "video",
              data: base64,
              mimeType: "image/jpeg",
            })
          );
        }
      }, 1000);
    } catch {
      setCameraError(
        "Unable to access your camera. Please allow camera permissions and try again."
      );
      stopCamera();
    }
  }, [stopCamera]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const sendTextMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      stopScheduledAudio();
      finalizeOpenEntries();
      setTranscript((prev) => [
        ...prev,
        {
          id: `u-txt-${Date.now()}`,
          role: "user",
          text: trimmed,
          timestamp: Date.now(),
          isFinal: true,
        },
      ]);
      if (engineModeRef.current === "gemma-open") {
        setIsThinking(true);
      }
      ws.send(JSON.stringify({ type: "text", text: trimmed }));
    },
    [finalizeOpenEntries, stopScheduledAudio]
  );

  const sendImageFrame = useCallback((base64Data: string, mimeType: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "video",
        data: base64Data,
        mimeType,
        isUpload: true,
      })
    );
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    activeUserEntryIdRef.current = null;
    activeAssistantEntryIdRef.current = null;
  }, []);

  const dismissStepGuide = useCallback(() => {
    setStepGuide(null);
  }, []);

  const dismissFallbackNotice = useCallback(() => {
    setFallbackNotice(null);
  }, []);

  const openStepGuide = useCallback((guide: StepGuide) => {
    setStepGuide(guide);
  }, []);

  useEffect(() => {
    return () => {
      teardownMediaAndSocket();
      stopCamera();
    };
  }, [stopCamera, teardownMediaAndSocket]);

  const retrySession = useCallback(
    async (overrideEngine?: NolanEngineMode) => {
      setIsAuthError(false);
      setIsQuotaError(false);
      setErrorMessage(null);
      setFallbackNotice(null);
      await startSession(lastLanguageRef.current, overrideEngine);
    },
    [startSession]
  );

  return {
    status,
    engineMode,
    gemmaLoadPct,
    gemmaLoadStatus,
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
    clearTranscript,
    dismissFallbackNotice,
    openStepGuide,
    dismissStepGuide,
  };
}
