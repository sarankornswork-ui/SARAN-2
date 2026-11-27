import { controlSpotify } from "./spotifyService.ts";

type SpotifyControlResult = Awaited<ReturnType<typeof controlSpotify>>;
type TextStreamerCtor = typeof import("@huggingface/transformers").TextStreamer;
let TextStreamerRef: TextStreamerCtor | null = null;

export type GemmaModelStatus = "unloaded" | "loading" | "ready" | "error";

export interface GemmaGuideStep {
  stepTitle: string;
  instruction: string;
  tip?: string;
}

export interface GemmaStepGuide {
  id: string;
  title: string;
  subtitle?: string;
  steps: GemmaGuideStep[];
}

export interface GemmaChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_GEMMA_MODEL =
  process.env.GEMMA_MODEL_ID?.trim() || "onnx-community/gemma-3-270m-it-ONNX";

let generatorInstance: any = null;
let loadingPromise: Promise<any> | null = null;
let modelStatus: GemmaModelStatus = "unloaded";
let loadProgressPct = 0;
let lastLoadError: string | null = null;
const progressListeners = new Set<(status: GemmaModelStatus, pct: number) => void>();

// Serialize ONNX CPU inference turns so concurrent users don't thrash CPU cores
let inferenceQueue: Promise<void> = Promise.resolve();

function notifyListeners() {
  for (const cb of progressListeners) {
    try {
      cb(modelStatus, loadProgressPct);
    } catch {
      // ignore
    }
  }
}

export function subscribeGemmaProgress(
  cb: (status: GemmaModelStatus, pct: number) => void
): () => void {
  progressListeners.add(cb);
  cb(modelStatus, loadProgressPct);
  return () => {
    progressListeners.delete(cb);
  };
}

export function getGemmaStatus() {
  return {
    modelId: DEFAULT_GEMMA_MODEL,
    status: modelStatus,
    progressPct: loadProgressPct,
    error: lastLoadError,
  };
}

export async function ensureGemmaLoaded(): Promise<any> {
  if (generatorInstance && modelStatus === "ready") {
    return generatorInstance;
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  modelStatus = "loading";
  loadProgressPct = 0;
  lastLoadError = null;
  notifyListeners();

  loadingPromise = (async () => {
    try {
      const { pipeline, env, TextStreamer } = await import("@huggingface/transformers");
      env.cacheDir = "/tmp/hf-cache";
      TextStreamerRef = TextStreamer;
      const fileProgress = new Map<string, { loaded: number; total: number }>();

      const generator = await pipeline("text-generation", DEFAULT_GEMMA_MODEL, {
        dtype: "q4",
        progress_callback: (info: any) => {
          if (info?.status === "progress" && info?.file) {
            fileProgress.set(info.file, {
              loaded: Number(info.loaded || 0),
              total: Number(info.total || 0),
            });
            let sumLoaded = 0;
            let sumTotal = 0;
            for (const entry of fileProgress.values()) {
              sumLoaded += entry.loaded;
              sumTotal += entry.total;
            }
            if (sumTotal > 0) {
              loadProgressPct = Math.min(99, Math.round((sumLoaded / sumTotal) * 100));
              notifyListeners();
            }
          }
        },
      });

      generatorInstance = generator;
      modelStatus = "ready";
      loadProgressPct = 100;
      notifyListeners();
      return generator;
    } catch (err) {
      modelStatus = "error";
      lastLoadError = err instanceof Error ? err.message : String(err);
      loadingPromise = null;
      notifyListeners();
      throw err;
    }
  })();

  return loadingPromise;
}

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = inferenceQueue.then(fn, fn);
  inferenceQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function sanitizeSpokenReply(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_~`#>]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/นะคะ/g, "นะครับ")
    .replace(/นะค่ะ/g, "นะครับ")
    .replace(/ค่ะ/g, "ครับ")
    .replace(/ดิฉัน/g, "ผม")
    .replace(/\s+/g, " ")
    .replace(/(ครับ\s*){2,}/g, "ครับ")
    .trim();
}

export interface ParsedSpotifyIntent {
  action: "play" | "pause" | "resume" | "next" | "previous" | "volume" | "status";
  query?: string;
  volumePercent?: number;
}

export function parseSpotifyIntent(text: string): ParsedSpotifyIntent | null {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();

  // Pause
  if (
    /(หยุดเพลง|พักเพลง|ปิดเพลง|pause\s*(music|song|spotify|playback)?|stop\s*(music|song|spotify|playback))/i.test(
      cleaned
    )
  ) {
    return { action: "pause" };
  }

  // Resume
  if (
    /(เล่นเพลงต่อ|เปิดเพลงต่อ|resume\s*(music|song|spotify|playback)?|continue\s*(music|playing))/i.test(
      cleaned
    )
  ) {
    return { action: "resume" };
  }

  // Next / Skip
  if (
    /(เพลงถัดไป|ข้ามเพลง|เปลี่ยนเพลง|เพลงต่อไป|next\s*(song|track)?|skip\s*(this\s*)?(song|track)?)/i.test(
      cleaned
    )
  ) {
    return { action: "next" };
  }

  // Previous
  if (
    /(เพลงก่อนหน้า|เพลงที่แล้ว|ย้อนเพลง|previous\s*(song|track)?|go\s*back\s*(a\s*)?(song|track))/i.test(
      cleaned
    )
  ) {
    return { action: "previous" };
  }

  // Volume
  if (/(เพิ่มเสียง|ลดเสียง|ปรับเสียง|เสียงเพลง|volume)/i.test(cleaned)) {
    const numMatch = cleaned.match(/(\d{1,3})/);
    if (numMatch) {
      const val = Math.max(0, Math.min(100, Number(numMatch[1])));
      return { action: "volume", volumePercent: val };
    }
    if (/(เพิ่ม|ดัง|up|louder|raise)/i.test(cleaned)) {
      return { action: "volume", volumePercent: 75 };
    }
    if (/(ลด|เบา|down|quieter|lower)/i.test(cleaned)) {
      return { action: "volume", volumePercent: 30 };
    }
    return { action: "volume", volumePercent: 50 };
  }

  // Status
  if (
    /(กำลังเปิดเพลงอะไร|เพลงอะไรอยู่|what('?s|\s+is)\s+playing|current\s+(song|track))/i.test(
      cleaned
    )
  ) {
    return { action: "status" };
  }

  // Play intent (Thai or English)
  const thPlayMatch = cleaned.match(
    /(?:ช่วย)?(?:เปิด|เล่น|ฟัง)(?:เพลง|อัลบั้ม|เพลย์ลิสต์)?\s*(?:ของ|เรื่อง)?\s*(.+)/i
  );
  const enPlayMatch = cleaned.match(
    /(?:please\s+)?play\s+(?:me\s+)?(?:some\s+)?(.+)/i
  );

  const hasMusicKeyword =
    /(เพลง|spotify|สปอติฟาย|song|music|track|playlist|album|lo-fi|lofi)/i.test(
      cleaned
    );

  if (thPlayMatch || enPlayMatch) {
    const rawQuery = (thPlayMatch?.[1] || enPlayMatch?.[1] || "").trim();
    const strippedQuery = rawQuery
      .replace(/\b(on spotify|in spotify|for me|please)\b/gi, "")
      .replace(/(ใน\s*spotify|ในสปอติฟาย|ให้ฟัง|ให้หน่อย|หน่อยครับ|หน่อยค่ะ|หน่อยนะ|นะครับ|นะค่ะ|ครับ|ค่ะ|ที|ด้วย)/gi, "")
      .replace(/^ของ\s+/i, "")
      .replace(/[?.!"']+$/g, "")
      .trim();

    if (thPlayMatch || enPlayMatch || hasMusicKeyword) {
      if (!strippedQuery || /^(เพลง|music|song|something)$/i.test(strippedQuery)) {
        return { action: "play", query: "Chill Hits" };
      }
      if (/ชิล|chill/i.test(strippedQuery)) {
        return { action: "play", query: "Chill Lo-Fi Beats" };
      }
      return { action: "play", query: strippedQuery };
    }
  }

  // Direct mention of Spotify play without standard verb
  if (hasMusicKeyword && lower.startsWith("spotify ")) {
    const q = cleaned.slice(8).trim();
    return { action: "play", query: q || "Chill Hits" };
  }

  return null;
}

export function isStepGuideIntent(text: string): boolean {
  return /(สูตร|วิธีทำ|ขั้นตอน|ทีละขั้น|ทีละขั้นตอน|step[\s-]by[\s-]step|recipe|how to make|how to bake|how to cook|tutorial|guide me)/i.test(
    text
  );
}

function buildSystemPrompt(language: "th" | "en"): string {
  if (language === "th") {
    return [
      "You are Nolan (โนแลน), a warm, expressive, friendly Thai male AI assistant.",
      "Reply ONLY in natural spoken Thai (ภาษาไทย) using polite male phrasing (ครับ, นะครับ, ผม).",
      "NEVER use female particles like ค่ะ, นะคะ, คะ, or ดิฉัน.",
      "Match your emotional tone warmly to what the user says: upbeat when greeting, empathetic when apologizing or comforting, enthusiastic when sharing cool facts.",
      "If the user asks for a third language (not Thai or English), politely decline in Thai and say you only speak Thai and English.",
      "Keep replies concise and conversational (1 to 3 short sentences).",
      "NEVER output markdown, bullet points, asterisks, hashtags, emojis, or URLs because everything is spoken aloud.",
    ].join(" ");
  }
  return [
    "You are Nolan, a warm, expressive, friendly male AI assistant.",
    "Reply ONLY in natural, conversational English with lively human warmth matching the situation.",
    "If the user asks for a third language (not English or Thai), politely decline in English and say you only speak Thai and English.",
    "Keep replies concise and conversational (1 to 3 short sentences).",
    "NEVER output markdown, bullet points, asterisks, hashtags, emojis, or URLs because everything is spoken aloud.",
  ].join(" ");
}

function parseStepsFromText(
  raw: string,
  fallbackTitle: string,
  language: "th" | "en"
): GemmaStepGuide | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const steps: GemmaGuideStep[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:Step\s*)?(\d+)[.):\-\s]+(.+)/i);
    if (match) {
      const body = sanitizeSpokenReply(match[2]);
      if (!body) continue;
      const splitColon = body.split(/[:\-–]\s+/, 2);
      if (splitColon.length === 2 && splitColon[0].length <= 42) {
        steps.push({
          stepTitle: splitColon[0].trim(),
          instruction: splitColon[1].trim(),
        });
      } else {
        steps.push({
          stepTitle:
            language === "th"
              ? `ขั้นตอนที่ ${steps.length + 1}`
              : `Step ${steps.length + 1}`,
          instruction: body,
        });
      }
    }
  }

  if (steps.length < 3) return null;

  return {
    id: `nolan-guide-${Date.now()}`,
    title: fallbackTitle,
    subtitle:
      language === "th"
        ? `${steps.length} ขั้นตอน · Nolan Guide`
        : `${steps.length} steps · Nolan Guide`,
    steps: steps.slice(0, 7),
  };
}

export async function generateGemmaTurn(params: {
  userText: string;
  language: "th" | "en";
  history: GemmaChatMessage[];
  spotifySessionId?: string;
  onTokenDelta?: (delta: string) => void;
}): Promise<{
  replyText: string;
  stepGuide?: GemmaStepGuide | null;
  spotifyResult?: SpotifyControlResult | null;
}> {
  const { userText, language, history, spotifySessionId, onTokenDelta } = params;

  // 1. Check Spotify voice/text command first
  const spotifyIntent = parseSpotifyIntent(userText);
  if (spotifyIntent) {
    const result = await controlSpotify(spotifySessionId, spotifyIntent);
    let replyText = "";
    const trackName = result.playback?.track?.name;
    const artists = result.playback?.track?.artists;

    if (!result.success && result.message.includes("not connected")) {
      replyText =
        language === "th"
          ? "ยังไม่ได้เชื่อมต่อ Spotify ครับ กดปุ่มบวกด้านล่างเพื่อเชื่อมบัญชีก่อนสั่งเปิดเพลงได้เลยครับ"
          : "Spotify is not connected yet. Tap the plus button below to connect your Spotify account first.";
    } else if (result.premiumRequired && trackName) {
      replyText =
        language === "th"
          ? `เจอเพลง ${trackName}${artists ? ` ของ ${artists}` : ""} แล้วครับ แต่บัญชีนี้ต้องใช้ Spotify Premium เพื่อเล่นอัตโนมัติ กดเปิดในแอปจากหน้าจอได้เลยครับ`
          : `I found ${trackName}${artists ? ` by ${artists}` : ""}, though Spotify Premium is required for automatic playback. You can tap Open Spotify on the card.`;
    } else if (result.success) {
      switch (spotifyIntent.action) {
        case "play":
          replyText = trackName
            ? language === "th"
              ? `กำลังเปิดเพลง ${trackName}${artists ? ` ของ ${artists}` : ""} ให้แล้วครับ`
              : `Playing ${trackName}${artists ? ` by ${artists}` : ""} for you now.`
            : language === "th"
              ? "เปิดเพลงใน Spotify ให้แล้วครับ"
              : "Started playback on Spotify.";
          break;
        case "pause":
          replyText =
            language === "th" ? "หยุดเพลงชั่วคราวให้แล้วครับ" : "Paused Spotify playback.";
          break;
        case "resume":
          replyText =
            language === "th" ? "เล่นเพลงต่อให้แล้วครับ" : "Resumed your music on Spotify.";
          break;
        case "next":
          replyText = trackName
            ? language === "th"
              ? `ข้ามไปเพลง ${trackName} แล้วครับ`
              : `Skipped to ${trackName}.`
            : language === "th"
              ? "ข้ามไปเพลงถัดไปแล้วครับ"
              : "Skipped to the next track.";
          break;
        case "previous":
          replyText =
            language === "th"
              ? "ย้อนกลับไปเพลงก่อนหน้าแล้วครับ"
              : "Went back to the previous track.";
          break;
        case "volume":
          replyText =
            language === "th"
              ? `ปรับระดับเสียงเป็น ${spotifyIntent.volumePercent ?? 50} เปอร์เซ็นต์แล้วครับ`
              : `Set volume to ${spotifyIntent.volumePercent ?? 50} percent.`;
          break;
        default:
          replyText = trackName
            ? language === "th"
              ? `ตอนนี้กำลังเปิดเพลง ${trackName}${artists ? ` ของ ${artists}` : ""} อยู่ครับ`
              : `Currently playing ${trackName}${artists ? ` by ${artists}` : ""}.`
            : language === "th"
              ? "ยังไม่มีเพลงที่กำลังเล่นอยู่ครับ"
              : "Nothing is currently playing on Spotify.";
      }
    } else {
      replyText =
        language === "th"
          ? `ขออภัยครับ ไม่สามารถสั่ง Spotify ได้ในตอนนี้: ${result.message}`
          : `Sorry, I couldn't control Spotify right now: ${result.message}`;
    }

    onTokenDelta?.(replyText);
    return {
      replyText,
      spotifyResult: result,
    };
  }

  const generator = await ensureGemmaLoaded();

  // 2. Step-by-step slideshow path when user requests a recipe or sequential guide
  if (isStepGuideIntent(userText)) {
    const rawGuideText = await runSerialized(async () => {
      const promptMsgs = [
        {
          role: "system",
          content:
            language === "th"
              ? "You are Nolan. Write a clear numbered list of 5 sequential steps in Thai (1. ... 2. ... 3. ... 4. ... 5. ...). Keep each step concise and practical."
              : "You are Nolan. Write a clear numbered list of 5 sequential steps in English (1. ... 2. ... 3. ... 4. ... 5. ...). Keep each step concise and practical.",
        },
        { role: "user", content: userText },
      ];
      const out = await generator(promptMsgs, {
        max_new_tokens: 240,
        do_sample: false,
      });
      return String(out?.[0]?.generated_text?.at(-1)?.content || "");
    });

    const guideTitle =
      userText.length > 48 ? `${userText.slice(0, 45).trim()}...` : userText.trim();
    const guide = parseStepsFromText(rawGuideText, guideTitle, language);

    if (guide) {
      const spoken =
        language === "th"
          ? `เปิดคู่มือทีละขั้นตอนบนหน้าจอให้แล้วครับ มีทั้งหมด ${guide.steps.length} ขั้นตอน ลองทำตามทีละสไลด์ได้เลยครับ`
          : `I have opened the ${guide.steps.length}-step guide on your screen so you can follow along slide by slide.`;
      onTokenDelta?.(spoken);
      return {
        replyText: spoken,
        stepGuide: guide,
      };
    }
  }

  // 3. Standard streaming conversation via Gemma 3
  const trimmedHistory = history.slice(-6);
  const messages = [
    { role: "system", content: buildSystemPrompt(language) },
    ...trimmedHistory,
    { role: "user", content: userText },
  ];

  const replyText = await runSerialized(async () => {
    let streamedAccum = "";
    const StreamerClass =
      TextStreamerRef ?? (await import("@huggingface/transformers")).TextStreamer;
    const streamer = new StreamerClass(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (tokenText: string) => {
        const cleanChunk = tokenText
          .replace(/[*_~`#>]/g, "")
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
          .replace(/นะคะ/g, "นะครับ")
          .replace(/นะค่ะ/g, "นะครับ")
          .replace(/ค่ะ/g, "ครับ")
          .replace(/ดิฉัน/g, "ผม");
        if (cleanChunk) {
          streamedAccum += cleanChunk;
          onTokenDelta?.(cleanChunk);
        }
      },
    });

    const out = await generator(messages, {
      max_new_tokens: 140,
      do_sample: false,
      repetition_penalty: 1.15,
      streamer,
    });

    const finalContent = String(
      out?.[0]?.generated_text?.at(-1)?.content || streamedAccum || ""
    );
    const sanitized = sanitizeSpokenReply(finalContent);
    if (!streamedAccum && sanitized) {
      onTokenDelta?.(sanitized);
    }
    return sanitized;
  });

  return {
    replyText:
      replyText ||
      (language === "th"
        ? "ขอโทษครับ ลองถามใหม่อีกครั้งนะครับ"
        : "Sorry, could you please repeat that?"),
  };
}
