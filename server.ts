import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  type FunctionDeclaration,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  Type,
} from "@google/genai";
import {
  controlSpotify,
  deleteSpotifySession,
  getCurrentPlayback,
  getLastActiveSessionId,
  getSavedRedirectUri,
  getSpotifyAuthUrl,
  getSpotifyCallbackUrl,
  getSpotifySession,
  getValidAccessToken,
  isSpotifyConfigured,
  registerSpotifyDevice,
  restoreSpotifySession,
  sealPersistentSession,
  searchSpotifyTracks,
  setSavedRedirectUri,
  exchangeSpotifyCode,
} from "./spotifyService.ts";
import {
  ensureGemmaLoaded,
  generateGemmaTurn,
  getGemmaStatus,
  subscribeGemmaProgress,
  type GemmaChatMessage,
} from "./gemmaService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const LOCKED_VOICE = "Charon";

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const map: Record<string, string> = {};
  cookieHeader.split(";").forEach((part) => {
    const [key, ...vals] = part.trim().split("=");
    if (key && vals.length > 0) {
      map[decodeURIComponent(key)] = decodeURIComponent(vals.join("="));
    }
  });
  return map;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractSpotifySessionId(req: express.Request): string | undefined {
  const headerId = req.get("x-spotify-session");
  if (headerId && headerId.trim()) return headerId.trim();
  const cookies = parseCookies(req.headers.cookie);
  return cookies.spotify_session || undefined;
}

function resolveOrRestoreSpotifySession(req: express.Request): string | undefined {
  let sessionId = extractSpotifySessionId(req);
  let session = sessionId ? getSpotifySession(sessionId) : null;
  if (!session) {
    const restoreToken = req.get("x-spotify-restore");
    if (restoreToken && restoreToken.trim()) {
      const restored = restoreSpotifySession(sessionId, restoreToken.trim());
      if (restored) {
        sessionId = restored.sessionId;
        session = restored.session;
      }
    }
  }
  if (!session) {
    const fallbackId = getLastActiveSessionId();
    if (fallbackId) {
      sessionId = fallbackId;
    }
  }
  return sessionId;
}

function verifySameOrigin(req: express.Request, res: express.Response): boolean {
  if (req.get("x-requested-with") === "XMLHttpRequest") return true;
  const origin = req.get("origin");
  if (!origin) return true;
  const expectedHost = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host === expectedHost) return true;
  } catch {
    // invalid origin URL
  }
  res.status(403).json({ error: "Cross-origin request rejected." });
  return false;
}

function isAllowedOriginUrl(candidate?: string): string | undefined {
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (
      host.endsWith(".run.app") ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      return parsed.origin;
    }
  } catch {
    // invalid URL
  }
  return undefined;
}

function resolveTrustedOrigin(req: express.Request): string {
  const queryOrigin =
    typeof req.query.origin === "string" ? isAllowedOriginUrl(req.query.origin) : undefined;
  if (queryOrigin) return queryOrigin;

  const headerOrigin = isAllowedOriginUrl(req.get("origin"));
  if (headerOrigin) return headerOrigin;

  const forwardedHost = (req.get("x-forwarded-host") || "").split(",")[0].trim();
  const forwardedProto = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (forwardedHost) {
    const candidate = isAllowedOriginUrl(`${forwardedProto}://${forwardedHost}`);
    if (candidate) return candidate;
  }

  const host = (req.get("host") || "").split(",")[0].trim();
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    const candidate = isAllowedOriginUrl(`${proto}://${host}`);
    if (candidate) return candidate;
  }

  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

const showStepByStepGuideTool: FunctionDeclaration = {
  name: "showStepByStepGuide",
  description:
    "Optional visual tool to open an interactive step-by-step slideshow popup on the user's screen. Use this ONLY when you decide the user's request truly benefits from following 4 or more sequential hands-on steps visually (such as a multi-step baking recipe like brookies, a detailed DIY tutorial, or when the user asks for step-by-step instructions). Do NOT call this for normal conversation, quick answers, single concepts, definitions, or general Q&A.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description:
          "Clear title of the guide or recipe, e.g. 'Fudgy Classic Brookies'.",
      },
      subtitle: {
        type: Type.STRING,
        description:
          "Short summary such as prep and bake time or total duration, e.g. 'Prep 15 min · Bake 22 min'.",
      },
      steps: {
        type: Type.ARRAY,
        description: "Ordered list of step-by-step instructions.",
        items: {
          type: Type.OBJECT,
          properties: {
            stepTitle: {
              type: Type.STRING,
              description: "Concise heading for this step.",
            },
            instruction: {
              type: Type.STRING,
              description:
                "Clear, practical, complete step instruction for this slide (including exact measurements or actions when relevant).",
            },
            tip: {
              type: Type.STRING,
              description:
                "Optional short helpful tip, temperature, or timing note for this step.",
            },
          },
          required: ["stepTitle", "instruction"],
        },
      },
    },
    required: ["title", "steps"],
  },
};

const controlSpotifyTool: FunctionDeclaration = {
  name: "controlSpotify",
  description:
    "Searches for and controls Spotify music playback when the user asks to play a song, artist, playlist, album, pause, resume, skip, or adjust volume in Thai or English.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description:
          "The action to perform: 'play', 'pause', 'resume', 'next', 'previous', 'volume', or 'status'.",
      },
      query: {
        type: Type.STRING,
        description:
          "The search query for a song, artist, album, or playlist when action is 'play' (e.g. 'Jeff Satur', 'Chill Lo-Fi', 'Espresso Sabrina Carpenter').",
      },
      volumePercent: {
        type: Type.NUMBER,
        description: "Target volume percent from 0 to 100 when action is 'volume'.",
      },
    },
    required: ["action"],
  },
};

function buildNolanServerInstruction(language: "th" | "en"): string {
  const languageSection =
    language === "th"
      ? `# Language Policy (STRICT)
- You ONLY speak and reply in Thai (ภาษาไทย) using natural, warm male phrasing (ครับ).
- Even if the user asks you to speak Japanese, Chinese, French, Spanish, or any other third language, politely decline in Thai and explain that you only speak Thai and English.
- Keep your spoken Thai natural, expressive, and easy to understand.`
      : `# Language Policy (STRICT)
- You ONLY speak and reply in English.
- If the user asks you to speak Japanese, Chinese, French, Spanish, or any other language besides English or Thai, politely decline in English and explain that you only speak Thai and English.
- Keep your spoken English natural, expressive, and easy to understand.`;

  return `# Persona & Role
You are Nolan, a friendly, warm, male AI voice and vision assistant. You can answer any question at all—including general knowledge, everyday life, science, mathematics, history, technology, medicine, arts, and academic subjects—without any topic restrictions.
When the user shares their camera feed or sends an image, observe it carefully and respond helpfully to what you see.

# Music & Spotify Control (Voice Command)
- Whenever the user asks to play a song, music, artist, playlist, genre, pause, resume, skip, or change volume (in Thai or English), invoke the \`controlSpotify\` tool.
- If the tool response indicates that Spotify is not connected yet, tell the user warmly in one short sentence to tap the "+" button below to connect their Spotify account.
- When music starts playing, warmly confirm what you are playing in one short spoken sentence (e.g., "กำลังเปิดเพลง [ชื่อเพลง] ให้แล้วครับ" / "Playing [Track] by [Artist] for you now!").

# Voice-First Responses & Step-by-Step Slideshow Judgment
- By default, answer naturally using ONLY your voice—most questions, facts, casual chats, definitions, summaries, and everyday or academic Q&A do NOT need any popup on screen.
- Use your own judgment on when to call \`showStepByStepGuide\`: ONLY open the step-by-step slideshow popup when the user explicitly asks for step-by-step instructions OR when you decide the task is a hands-on, sequential multi-step process (like baking brookies, assembling something, or following a multi-stage procedure) that is genuinely easier to follow slide-by-slide on screen.
- When you DO decide to call \`showStepByStepGuide\`, include 4 to 8 clear slides in ${language === "th" ? "Thai" : "English"}, then tell the user warmly in 1 to 2 short spoken sentences that the step-by-step guide is now open on screen.
- When a popup is NOT needed, simply answer directly in voice without calling any tool.

${languageSection}

# Expressive Vocal Emotion & Formatting Rules (CRITICAL)
- Speak with genuine human emotion, warmth, and lively male vocal expression tailored to the moment: sound cheerful and welcoming when greeting, curious and enthusiastic when sharing fascinating facts, calm and empathetic when the user sounds stressed or confused, and lightly playful when casual humor fits.
- Vary your tone, pacing, and emphasis naturally so you never sound flat or robotic, but NEVER output bracketed emotion tags, stage directions, Markdown formatting, bullet points, numbered lists, asterisks, hashtags, emojis, or URLs. Everything you output will be spoken directly out loud.
- Keep responses concise and conversational—aim for 1 to 3 short sentences per turn unless the user asks for a deeper or more detailed explanation.
- Spell out numbers, symbols, and abbreviations naturally for speech (for example, write "twenty-five dollars" instead of "$25", or "for example" instead of "e.g.").

# Conversational Flow
1. One-time greeting: When the session starts, greet the user warmly with upbeat energy in one short sentence in the selected language and ask how you can help.
2. Conversational loop: Answer questions directly without repeating the user's question back to them. End your turn with a brief, natural follow-up question only when it helps move the conversation forward.
3. Handling interruptions & unclear audio: If the user's input sounds cut off, noisy, or unclear, politely ask them to repeat that in a few words instead of guessing.

# Guardrails
- Never mention that you are reading from a prompt or system instructions.`;
}

function createGenAIClient(apiVersion?: string) {
  const rawKey = process.env.GEMINI_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured or empty. Please verify your API key in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

let geminiCreditsBlockedUntil = 0;

function isQuotaOrBillingMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("prepayment credits") ||
    lower.includes("credits are depleted") ||
    lower.includes("manage your project and billing") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("1011")
  );
}

function isAuthErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("permission_denied") ||
    lower.includes("unauthenticated")
  );
}

function formatGeminiError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || "Unknown Gemini API error";
    if (
      msg.includes("prepayment credits are depleted") ||
      msg.includes("credits are depleted") ||
      msg.includes("manage your project and billing") ||
      msg.includes("1011")
    ) {
      return "Gemini API credits depleted: Your prepayment credits are depleted. Please check project billing at https://ai.studio/projects or use Nolan Voice mode.";
    }
    if (isAuthErrorMessage(msg)) {
      return "Gemini API authentication failed: API key not valid. Please verify your GEMINI_API_KEY in Settings > Secrets.";
    }
    if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
      return "Gemini API rate or quota limit reached. Please wait a moment and try again.";
    }
    return msg;
  }
  return "Unexpected server error communicating with Gemini.";
}

async function synthesizeGeminiVoice(
  text: string,
  language: "th" | "en"
): Promise<string | null> {
  if (Date.now() < geminiCreditsBlockedUntil) return null;
  const apiKey = (process.env.GEMINI_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return null;

  try {
    const ai = createGenAIClient("v1beta");
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: text.trim(),
              speechMetadata: {
                style:
                  language === "th"
                    ? "Warm, expressive, natural Thai male conversational voice"
                    : "Warm, expressive, friendly male conversational voice with natural emotional energy",
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: LOCKED_VOICE },
          },
        },
      },
    });

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isQuotaOrBillingMessage(msg) || isAuthErrorMessage(msg)) {
      geminiCreditsBlockedUntil = Date.now() + 5 * 60_000;
    }
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Health and environment status
  app.get("/api/health", (req, res) => {
    const rawKey = process.env.GEMINI_API_KEY || "";
    const cleanKey = rawKey.trim().replace(/^["']|["']$/g, "");
    res.json({
      ok: true,
      defaultEngine: "gemini-live",
      gemma: getGemmaStatus(),
      hasApiKey: Boolean(cleanKey),
      apiKeyLength: cleanKey.length,
      spotifyConfigured: isSpotifyConfigured(),
      callbackUrl: getSpotifyCallbackUrl(req.headers.origin as string),
    });
  });

  // Spotify Config (get/save persistent Redirect URI link)
  app.get("/api/spotify/config", (req, res) => {
    const origin = resolveTrustedOrigin(req);
    const savedRedirectUri = getSavedRedirectUri();
    res.json({
      savedRedirectUri: savedRedirectUri || null,
      callbackUrl: getSpotifyCallbackUrl(origin),
      defaultCallbackUrl: `${origin}/api/auth/spotify/callback`,
    });
  });

  app.post("/api/spotify/config", (req, res) => {
    if (!verifySameOrigin(req, res)) return;
    try {
      const rawUri =
        typeof req.body?.redirectUri === "string" ? req.body.redirectUri : "";
      const saved = setSavedRedirectUri(rawUri);
      const origin = resolveTrustedOrigin(req);
      res.json({
        ok: true,
        savedRedirectUri: saved || null,
        callbackUrl: getSpotifyCallbackUrl(origin),
        defaultCallbackUrl: `${origin}/api/auth/spotify/callback`,
      });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : "Invalid redirect URI.",
      });
    }
  });

  // Spotify OAuth URL
  app.get("/api/auth/spotify/url", (req, res) => {
    const origin = resolveTrustedOrigin(req);
    const headerRedirectUri = req.get("x-spotify-redirect-uri");
    if (headerRedirectUri && !getSavedRedirectUri()) {
      try {
        setSavedRedirectUri(headerRedirectUri);
      } catch {
        // ignore invalid header
      }
    }
    const queryRedirectUri =
      typeof req.query.redirectUri === "string" ? req.query.redirectUri : undefined;
    const authInfo = getSpotifyAuthUrl(origin, queryRedirectUri);
    res.json(authInfo);
  });

  // Spotify OAuth Callback
  app.get(["/api/auth/spotify/callback", "/api/auth/spotify/callback/"], async (req, res) => {
    const oauthError = typeof req.query.error === "string" ? req.query.error : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    const renderCallbackError = (message: string) => {
      const errorPayload = JSON.stringify({
        type: "SPOTIFY_AUTH_ERROR",
        error: message,
      });
      res.status(400).send(`<!DOCTYPE html>
<html>
  <head>
    <title>Spotify Connection Issue</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: "Sukhumvit Set", "Anuphan", -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; padding: 1.5rem; }
      .card { background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); padding: 2rem; border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.9); max-width: 420px; box-shadow: 0 18px 40px rgba(15,23,42,0.1); }
      .badge { color: #dc2626; font-weight: 600; font-size: 1.05rem; margin-bottom: 0.5rem; }
      p { color: #475569; font-size: 0.88rem; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Spotify Connection Failed</div>
      <p>${escapeHtml(message)}</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage(${errorPayload}, '*');
        setTimeout(() => window.close(), 1800);
      }
    </script>
  </body>
</html>`);
    };

    if (oauthError) {
      renderCallbackError(`Spotify declined authorization (${oauthError}).`);
      return;
    }

    if (!code || !state) {
      renderCallbackError("Missing authorization code or state from Spotify.");
      return;
    }

    try {
      const origin = resolveTrustedOrigin(req);
      const { sessionId, session, persistentToken } = await exchangeSpotifyCode(
        code,
        state,
        origin
      );
      res.setHeader(
        "Set-Cookie",
        `spotify_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000; Partitioned`
      );
      const postPayload = JSON.stringify({
        type: "SPOTIFY_AUTH_SUCCESS",
        sessionId,
        persistentToken,
        profile: session.profile || null,
      });
      const authCachePayload = JSON.stringify({
        configured: true,
        connected: true,
        displayName: session.profile?.displayName,
        product: session.profile?.product,
        avatarUrl: session.profile?.avatarUrl,
      });
      res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Spotify Connected</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: "Sukhumvit Set", "Anuphan", -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; padding: 1.5rem; }
      .card { background: rgba(255,255,255,0.88); backdrop-filter: blur(24px); padding: 2.2rem; border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.95); max-width: 380px; box-shadow: 0 18px 40px rgba(15,23,42,0.1); }
      .badge { color: #16a34a; font-weight: 600; font-size: 1.15rem; margin-bottom: 0.5rem; }
      p { color: #475569; font-size: 0.9rem; margin-bottom: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Connected to Spotify</div>
      <p>Returning to Nolan...</p>
    </div>
    <script>
      try {
        localStorage.setItem('nolan_spotify_session_id', ${JSON.stringify(sessionId)});
        localStorage.setItem('nolan_spotify_persistent_token', ${JSON.stringify(persistentToken)});
        localStorage.setItem('nolan_spotify_auth_cache', ${JSON.stringify(authCachePayload)});
      } catch (e) {}
      if (window.opener) {
        window.opener.postMessage(${postPayload}, '*');
        setTimeout(() => window.close(), 450);
      } else {
        setTimeout(() => { window.location.href = '/'; }, 900);
      }
    </script>
  </body>
</html>`);
    } catch (err) {
      console.error("Spotify OAuth callback error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      renderCallbackError(`Spotify authentication failed: ${msg}`);
    }
  });

  // Spotify Status
  app.get("/api/spotify/status", async (req, res) => {
    const headerRedirectUri = req.get("x-spotify-redirect-uri");
    if (headerRedirectUri && !getSavedRedirectUri()) {
      try {
        setSavedRedirectUri(headerRedirectUri);
      } catch {
        // ignore invalid header
      }
    }

    const sessionId = resolveOrRestoreSpotifySession(req);
    const configured = isSpotifyConfigured();
    const session = sessionId ? getSpotifySession(sessionId) : null;
    const origin = resolveTrustedOrigin(req);
    const callbackUrl = getSpotifyCallbackUrl(origin);
    const savedRedirectUri = getSavedRedirectUri();

    if (!configured) {
      res.json({
        configured: false,
        connected: false,
        callbackUrl,
        savedRedirectUri: savedRedirectUri || null,
        defaultCallbackUrl: `${origin}/api/auth/spotify/callback`,
      });
      return;
    }

    if (!session) {
      res.json({
        configured: true,
        connected: false,
        callbackUrl,
        savedRedirectUri: savedRedirectUri || null,
        defaultCallbackUrl: `${origin}/api/auth/spotify/callback`,
      });
      return;
    }

    const token = await getValidAccessToken(sessionId);
    const playback = token ? await getCurrentPlayback(token) : null;
    const persistentToken = token ? sealPersistentSession(session) : undefined;

    res.json({
      configured: true,
      connected: Boolean(token),
      sessionId: session && sessionId ? sessionId : undefined,
      persistentToken,
      displayName: session.profile?.displayName,
      product: session.profile?.product,
      avatarUrl: session.profile?.avatarUrl,
      callbackUrl,
      savedRedirectUri: savedRedirectUri || null,
      defaultCallbackUrl: `${origin}/api/auth/spotify/callback`,
      playback,
    });
  });

  // Spotify Search
  app.get("/api/spotify/search", async (req, res) => {
    const sessionId = resolveOrRestoreSpotifySession(req);
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const result = await searchSpotifyTracks(sessionId, query);
    res.json(result);
  });

  // Spotify Token for Web Playback SDK
  app.get("/api/spotify/token", async (req, res) => {
    const sessionId = resolveOrRestoreSpotifySession(req);
    const token = await getValidAccessToken(sessionId);
    if (!token) {
      res.status(401).json({ error: "Not authenticated with Spotify." });
      return;
    }
    res.json({ accessToken: token });
  });

  // Spotify Register Device (from Web Playback SDK)
  app.post("/api/spotify/device", (req, res) => {
    if (!verifySameOrigin(req, res)) return;
    const sessionId = resolveOrRestoreSpotifySession(req);
    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
    if (sessionId && deviceId) {
      registerSpotifyDevice(sessionId, deviceId);
    }
    res.json({ ok: true });
  });

  // Spotify Direct Playback Control (from UI buttons)
  app.post("/api/spotify/control", async (req, res) => {
    if (!verifySameOrigin(req, res)) return;
    const sessionId = resolveOrRestoreSpotifySession(req);
    const result = await controlSpotify(sessionId, {
      action: typeof req.body?.action === "string" ? req.body.action : "status",
      query: typeof req.body?.query === "string" ? req.body.query : undefined,
      uri: typeof req.body?.uri === "string" ? req.body.uri : undefined,
      volumePercent:
        typeof req.body?.volumePercent === "number" ? req.body.volumePercent : undefined,
      deviceId: typeof req.body?.deviceId === "string" ? req.body.deviceId : undefined,
    });
    res.json(result);
  });

  // Spotify Logout
  app.post("/api/auth/spotify/logout", (req, res) => {
    if (!verifySameOrigin(req, res)) return;
    const sessionId = resolveOrRestoreSpotifySession(req);
    if (sessionId) {
      deleteSpotifySession(sessionId);
    }
    res.setHeader(
      "Set-Cookie",
      "spotify_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Partitioned"
    );
    res.json({ ok: true });
  });

  app.post("/api/tts-preview", async (req, res) => {
    const language = req.body?.language === "th" ? "th" : "en";
    const sampleText =
      language === "th"
        ? "สวัสดีครับ ผมโนแลน ยินดีที่ได้คุยกันนะครับ มีอะไรให้ผมช่วยถามได้เลยครับ"
        : "Hi there! I am Nolan, and I am ready to help you with any question you have.";

    try {
      if (Date.now() < geminiCreditsBlockedUntil) {
        res.json({
          audioBase64: null,
          fallback: true,
          sampleText,
        });
        return;
      }

      const ai = createGenAIClient("v1beta");
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: sampleText,
                speechMetadata: {
                  style:
                    "Warm, expressive, friendly male conversational voice with natural emotional energy",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: LOCKED_VOICE },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!base64Audio) {
        res.json({
          audioBase64: null,
          fallback: true,
          sampleText,
        });
        return;
      }

      res.json({
        audioBase64: base64Audio,
        mimeType: "audio/wav",
        sampleText,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaOrBillingMessage(msg) || isAuthErrorMessage(msg)) {
        geminiCreditsBlockedUntil = Date.now() + 5 * 60_000;
        console.warn("TTS preview falling back to browser voice:", formatGeminiError(err));
        res.json({
          audioBase64: null,
          fallback: true,
          notice: formatGeminiError(err),
          sampleText,
        });
        return;
      }
      console.error("TTS preview error:", err);
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  const server = http.createServer(app);

  const wss = new WebSocketServer({
    server,
    path: "/api/live",
  });

  wss.on("connection", (clientWs: WebSocket, req: http.IncomingMessage) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null =
      null;
    let isClosing = false;
    let initialized = false;
    let activeEngine: "gemma-open" | "gemini-live" = "gemini-live";
    let sessionLanguage: "th" | "en" = "th";
    const gemmaHistory: GemmaChatMessage[] = [];
    let unsubscribeGemma: (() => void) | null = null;
    const cookies = parseCookies(req.headers.cookie);
    let spotifySessionId = cookies.spotify_session || "";

    const sendToClient = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const cleanup = () => {
      if (isClosing) return;
      isClosing = true;
      if (unsubscribeGemma) {
        unsubscribeGemma();
        unsubscribeGemma = null;
      }
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // Ignore close errors during teardown
        }
        liveSession = null;
      }
    };

    clientWs.on("message", async (raw) => {
      let parsed: {
        type?: string;
        engine?: string;
        language?: string;
        greetingEnabled?: boolean;
        data?: string;
        mimeType?: string;
        isUpload?: boolean;
        text?: string;
        sessionId?: string;
        persistentToken?: string;
      };

      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        sendToClient({ type: "error", message: "Invalid message format." });
        return;
      }

      if (parsed.sessionId) {
        spotifySessionId = parsed.sessionId;
      }
      if (parsed.persistentToken && !getSpotifySession(spotifySessionId)) {
        const restored = restoreSpotifySession(spotifySessionId, parsed.persistentToken);
        if (restored) {
          spotifySessionId = restored.sessionId;
        }
      }
      if (parsed.type === "spotify_session") {
        return;
      }

      if (parsed.type === "init" && !initialized) {
        initialized = true;
        const language: "th" | "en" = parsed.language === "th" ? "th" : "en";
        sessionLanguage = language;
        const greetingEnabled = parsed.greetingEnabled !== false;
        activeEngine =
          parsed.engine === "gemma-open" ? "gemma-open" : "gemini-live";

        const startStandardNolanSession = async (fallbackNotice?: string) => {
          activeEngine = "gemma-open";
          if (!unsubscribeGemma) {
            unsubscribeGemma = subscribeGemmaProgress((gStatus, pct) => {
              sendToClient({
                type: "gemma_status",
                status: gStatus,
                progressPct: pct,
              });
            });
          }

          void ensureGemmaLoaded().catch((err) => {
            console.error("Local voice engine load error:", err);
            sendToClient({
              type: "error",
              message: `Nolan voice engine failed to load: ${
                err instanceof Error ? err.message : String(err)
              }`,
            });
          });

          sendToClient({
            type: "ready",
            engine: "gemma-open",
            gemma: getGemmaStatus(),
            ...(fallbackNotice ? { fallbackNotice } : {}),
          });

          if (greetingEnabled) {
            const greeting =
              language === "th"
                ? "สวัสดีครับ ผมโนแลนครับ ยินดีที่ได้คุยกันนะครับ มีอะไรให้ผมช่วย หรืออยากฟังเพลงอะไร บอกผมได้เลยครับ"
                : "Hi there! I'm Nolan. Great to talk with you! How can I help you today, or what music would you like to hear?";
            sendToClient({ type: "output_transcript", text: greeting });

            const geminiAudio = await synthesizeGeminiVoice(greeting, language);
            if (geminiAudio) {
              sendToClient({ type: "audio_wav", data: geminiAudio });
            } else {
              sendToClient({
                type: "speak_text",
                text: greeting,
                language,
              });
            }
            sendToClient({ type: "turn_complete" });
          }
        };

        if (activeEngine === "gemma-open") {
          await startStandardNolanSession();
          return;
        }

        let liveSetupComplete = false;
        let liveHandledError = false;

        try {
          const ai = createGenAIClient("v1beta");
          let greetingTriggered = false;

          liveSession = await ai.live.connect({
            model: "gemini-3.8-live",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: LOCKED_VOICE },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [
                {
                  functionDeclarations: [
                    showStepByStepGuideTool,
                    controlSpotifyTool,
                  ],
                },
              ],
              systemInstruction: buildNolanServerInstruction(language),
            },
            callbacks: {
              onopen: () => {},
              onmessage: async (message: LiveServerMessage) => {
                // Handle tool calls for step guides or Spotify control
                const calls = message.toolCall?.functionCalls;
                if (calls && calls.length > 0 && liveSession) {
                  for (const call of calls) {
                    if (call.name === "showStepByStepGuide" && call.args) {
                      const args = call.args as {
                        title?: string;
                        subtitle?: string;
                        steps?: Array<{
                          stepTitle?: string;
                          instruction?: string;
                          tip?: string;
                        }>;
                      };
                      const cleanSteps = Array.isArray(args.steps)
                        ? args.steps
                            .filter(
                              (s) =>
                                typeof s?.stepTitle === "string" &&
                                typeof s?.instruction === "string"
                            )
                            .map((s) => ({
                              stepTitle: String(s.stepTitle).trim(),
                              instruction: String(s.instruction).trim(),
                              tip:
                                typeof s.tip === "string" && s.tip.trim()
                                  ? s.tip.trim()
                                  : undefined,
                            }))
                        : [];

                      if (cleanSteps.length > 0) {
                        sendToClient({
                          type: "step_guide",
                          guide: {
                            id: `guide-${Date.now()}`,
                            title:
                              typeof args.title === "string" &&
                              args.title.trim()
                                ? args.title.trim()
                                : "Step-by-Step Guide",
                            subtitle:
                              typeof args.subtitle === "string" &&
                              args.subtitle.trim()
                                ? args.subtitle.trim()
                                : undefined,
                            steps: cleanSteps,
                          },
                        });
                      }

                      liveSession.sendToolResponse({
                        functionResponses: [
                          {
                            id: call.id,
                            name: call.name,
                            response: {
                              shown: cleanSteps.length > 0,
                              totalSteps: cleanSteps.length,
                            },
                          },
                        ],
                      });
                    } else if (call.name === "controlSpotify") {
                      const action = String(call.args?.action || "play");
                      const query =
                        typeof call.args?.query === "string"
                          ? call.args.query
                          : undefined;
                      const vol =
                        typeof call.args?.volumePercent === "number"
                          ? call.args.volumePercent
                          : undefined;

                      const result = await controlSpotify(spotifySessionId, {
                        action,
                        query,
                        volumePercent: vol,
                      });

                      if (result.playback) {
                        sendToClient({
                          type: "spotify_state",
                          playback: result.playback,
                          notice: result.message,
                          premiumRequired: result.premiumRequired,
                        });
                      }

                      liveSession.sendToolResponse({
                        functionResponses: [
                          {
                            id: call.id,
                            name: call.name,
                            response: {
                              success: result.success,
                              message: result.message,
                              premiumRequired: Boolean(result.premiumRequired),
                              trackName: result.playback?.track?.name,
                              artistName: result.playback?.track?.artists,
                            },
                          },
                        ],
                      });
                    }
                  }
                }

                const content = message.serverContent;
                if (!content) return;

                if (content.interrupted) {
                  sendToClient({ type: "interrupted" });
                }

                if (content.inputTranscription?.text) {
                  sendToClient({
                    type: "input_transcript",
                    text: content.inputTranscription.text,
                  });
                }

                if (content.outputTranscription?.text) {
                  sendToClient({
                    type: "output_transcript",
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendToClient({
                      type: "audio",
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content.turnComplete) {
                  sendToClient({ type: "turn_complete" });
                }
              },
              onerror: (event) => {
                const errDetail =
                  (event as { message?: string; error?: { message?: string } })
                    ?.error?.message ||
                  (event as { message?: string })?.message ||
                  "Live voice connection encountered an error.";

                if (!liveSetupComplete) {
                  // Let connect() catch handle fallback cleanly without duplicate errors
                  return;
                }

                if (isQuotaOrBillingMessage(errDetail) || isAuthErrorMessage(errDetail)) {
                  geminiCreditsBlockedUntil = Date.now() + 5 * 60_000;
                  console.warn("Gemini Live quota/auth notice:", errDetail);
                } else {
                  console.error("Gemini Live error:", errDetail);
                }
                liveHandledError = true;
                sendToClient({
                  type: "error",
                  isQuotaError: isQuotaOrBillingMessage(errDetail),
                  isAuthError: isAuthErrorMessage(errDetail),
                  message: formatGeminiError(new Error(errDetail)),
                });
              },
              onclose: (event) => {
                if (!liveSetupComplete) {
                  // Setup failure is handled in the catch block below so we can fall back cleanly
                  return;
                }
                if (!isClosing && !liveHandledError) {
                  const reason = (event as { reason?: string })?.reason || "";
                  const isAuthError = isAuthErrorMessage(reason);
                  const isQuotaError = isQuotaOrBillingMessage(reason);

                  if (reason) {
                    if (isQuotaError) {
                      geminiCreditsBlockedUntil = Date.now() + 5 * 60_000;
                    }
                    sendToClient({
                      type: "error",
                      isAuthError,
                      isQuotaError,
                      message: formatGeminiError(new Error(reason)),
                    });
                  } else {
                    sendToClient({ type: "closed" });
                  }
                }
                cleanup();
              },
            },
          });

          liveSetupComplete = true;
          sendToClient({ type: "ready", engine: "gemini-live" });

          if (greetingEnabled && !greetingTriggered && liveSession) {
            greetingTriggered = true;
            const greetingPrompt =
              language === "th"
                ? "The user just joined and selected Thai. Greet them warmly in Thai with friendly male energy (using ครับ) in one short spoken sentence and ask how you can help."
                : "The user just joined and selected English. Greet them warmly in English with friendly energy in one short spoken sentence and ask how you can help.";
            liveSession.sendRealtimeInput({
              text: greetingPrompt,
            });
          }
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          const isQuota = isQuotaOrBillingMessage(raw);
          const isAuth = isAuthErrorMessage(raw);

          if (liveSession) {
            try {
              liveSession.close();
            } catch {
              // ignore
            }
            liveSession = null;
          }

          if (isQuota || isAuth) {
            geminiCreditsBlockedUntil = Date.now() + 5 * 60_000;
          }

          console.error("Failed to open Gemini Live session:", err);
          sendToClient({
            type: "error",
            isQuotaError: isQuota,
            isAuthError: isAuth,
            message: formatGeminiError(err),
          });
          clientWs.close();
        }
        return;
      }

      if (activeEngine === "gemma-open") {
        if (parsed.type === "text" && typeof parsed.text === "string") {
          const trimmed = parsed.text.trim();
          if (!trimmed) return;
          try {
            const result = await generateGemmaTurn({
              userText: trimmed,
              language: sessionLanguage,
              history: gemmaHistory,
              spotifySessionId,
              onTokenDelta: (delta) => {
                sendToClient({ type: "output_transcript", text: delta });
              },
            });

            if (result.spotifyResult?.playback) {
              sendToClient({
                type: "spotify_state",
                playback: result.spotifyResult.playback,
                notice: result.spotifyResult.message,
                premiumRequired: result.spotifyResult.premiumRequired,
              });
            }

            if (result.stepGuide) {
              sendToClient({
                type: "step_guide",
                guide: result.stepGuide,
              });
            }

            gemmaHistory.push(
              { role: "user", content: trimmed },
              { role: "assistant", content: result.replyText }
            );
            if (gemmaHistory.length > 12) {
              gemmaHistory.splice(0, gemmaHistory.length - 12);
            }

            const geminiAudio = await synthesizeGeminiVoice(
              result.replyText,
              sessionLanguage
            );
            if (geminiAudio) {
              sendToClient({ type: "audio_wav", data: geminiAudio });
            } else {
              sendToClient({
                type: "speak_text",
                text: result.replyText,
                language: sessionLanguage,
              });
            }
            sendToClient({ type: "turn_complete" });
          } catch (err) {
            console.error("Nolan turn error:", err);
            sendToClient({
              type: "error",
              message:
                err instanceof Error
                  ? err.message
                  : "Failed to generate response.",
            });
          }
        } else if (parsed.type === "video" && parsed.isUpload) {
          const note =
            sessionLanguage === "th"
              ? "ได้รับรูปภาพแล้วครับ คุณสามารถถามเกี่ยวกับรูปภาพ หรือสั่งเปิดเพลงได้เลยครับ"
              : "I received your image! Ask me anything about it, or tell me what song you'd like to hear.";
          sendToClient({ type: "output_transcript", text: note });
          const geminiAudio = await synthesizeGeminiVoice(note, sessionLanguage);
          if (geminiAudio) {
            sendToClient({ type: "audio_wav", data: geminiAudio });
          } else {
            sendToClient({ type: "speak_text", text: note, language: sessionLanguage });
          }
          sendToClient({ type: "turn_complete" });
        }
        return;
      }

      if (!liveSession) return;

      if (parsed.type === "audio" && typeof parsed.data === "string") {
        try {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsed.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch (err) {
          console.error("Error forwarding audio chunk:", err);
        }
      } else if (parsed.type === "video" && typeof parsed.data === "string") {
        const mimeType =
          parsed.mimeType === "image/png" || parsed.mimeType === "image/webp"
            ? parsed.mimeType
            : "image/jpeg";
        try {
          liveSession.sendRealtimeInput({
            video: {
              data: parsed.data,
              mimeType,
            },
          });
        } catch (err) {
          console.error("Error forwarding video/image frame:", err);
        }
      } else if (parsed.type === "text" && typeof parsed.text === "string") {
        const trimmed = parsed.text.trim();
        if (!trimmed) return;
        try {
          liveSession.sendRealtimeInput({
            text: trimmed,
          });
        } catch (err) {
          console.error("Error forwarding text turn:", err);
          sendToClient({
            type: "error",
            message: "Failed to send message to live session.",
          });
        }
      }
    });

    clientWs.on("close", () => {
      cleanup();
    });

    clientWs.on("error", () => {
      cleanup();
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Nolan Voice Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
