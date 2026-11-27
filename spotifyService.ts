import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface SpotifySession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  profile?: {
    id: string;
    displayName: string;
    product: string;
    email?: string;
    avatarUrl?: string;
  };
  deviceId?: string;
}

export interface SpotifyDeviceInfo {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  track?: {
    id: string;
    name: string;
    artists: string;
    album: string;
    albumArtUrl?: string;
    externalUrl?: string;
    durationMs: number;
  };
  progressMs: number;
  durationMs: number;
  deviceName?: string;
  deviceId?: string;
  volumePercent?: number;
  devices?: SpotifyDeviceInfo[];
}

// Persistent session & config store on disk so logins and saved links survive server restarts and browser re-entries
const SESSIONS_DIR = path.resolve(process.cwd(), ".data");
const SESSIONS_FILE = path.join(SESSIONS_DIR, "spotify-sessions.json");
const CONFIG_FILE = path.join(SESSIONS_DIR, "spotify-config.json");

const sessions = new Map<string, SpotifySession>();
let lastActiveSessionId: string | undefined = undefined;
let savedRedirectUri: string | undefined = undefined;

function getSealingKey(): Buffer {
  const secretSeed =
    process.env.SPOTIFY_CLIENT_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "nolan-spotify-persistent-session-key";
  return crypto
    .createHash("sha256")
    .update(`nolan-spotify-v1:${secretSeed}`)
    .digest();
}

export function sealPersistentSession(session: SpotifySession): string {
  const key = getSealingKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify(session);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealPersistentSession(token?: string): SpotifySession | null {
  if (!token || typeof token !== "string") return null;
  try {
    const buf = Buffer.from(token.trim(), "base64url");
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const key = getSealingKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted) as SpotifySession;
    if (parsed && typeof parsed === "object" && parsed.accessToken) {
      return parsed;
    }
  } catch {
    // invalid or mismatched key
  }
  return null;
}

function loadConfigFromDisk() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.savedRedirectUri === "string" && parsed.savedRedirectUri.trim()) {
        savedRedirectUri = parsed.savedRedirectUri.trim();
      }
    }
  } catch (err) {
    console.warn("Could not load spotify config from disk:", err);
  }
}

function saveConfigToDisk() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          savedRedirectUri: savedRedirectUri || null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch (err) {
    console.warn("Could not save spotify config to disk:", err);
  }
}

function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.lastActiveSessionId === "string" && parsed.lastActiveSessionId.trim()) {
          lastActiveSessionId = parsed.lastActiveSessionId.trim();
        }
        if (parsed.sessions && typeof parsed.sessions === "object") {
          for (const [id, s] of Object.entries(parsed.sessions)) {
            if (s && typeof s === "object" && (s as SpotifySession).accessToken) {
              sessions.set(id, s as SpotifySession);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not load spotify sessions from disk:", err);
  }
}

function saveSessionsToDisk() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    const data = {
      lastActiveSessionId,
      sessions: Object.fromEntries(sessions.entries()),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not save spotify sessions to disk:", err);
  }
}

// Immediately restore config & sessions on startup
loadConfigFromDisk();
loadSessionsFromDisk();

export function getSavedRedirectUri(): string | undefined {
  return savedRedirectUri || process.env.SPOTIFY_REDIRECT_URI?.trim() || undefined;
}

export function setSavedRedirectUri(uri?: string | null): string | undefined {
  const cleaned = typeof uri === "string" ? uri.trim() : "";
  if (!cleaned) {
    savedRedirectUri = undefined;
    saveConfigToDisk();
    return undefined;
  }
  const parsed = new URL(cleaned);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Redirect URI must start with http:// or https://");
  }
  savedRedirectUri = parsed.toString();
  saveConfigToDisk();
  return savedRedirectUri;
}

export function restoreSpotifySession(
  preferredSessionId?: string,
  persistentToken?: string
): { sessionId: string; session: SpotifySession } | null {
  const restored = unsealPersistentSession(persistentToken);
  if (!restored) return null;
  const sid = preferredSessionId?.trim() || crypto.randomUUID();
  if (!sessions.has(sid)) {
    sessions.set(sid, restored);
    lastActiveSessionId = sid;
    saveSessionsToDisk();
  }
  return { sessionId: sid, session: sessions.get(sid)! };
}

const pendingStates = new Map<
  string,
  { createdAt: number; origin?: string; redirectUri: string }
>();

// Cleanup stale pending states every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, meta] of pendingStates.entries()) {
    if (now - meta.createdAt > 15 * 60 * 1000) {
      pendingStates.delete(state);
    }
  }
}, 15 * 60 * 1000);

export function isSpotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
      process.env.SPOTIFY_CLIENT_ID.trim() &&
      process.env.SPOTIFY_CLIENT_SECRET &&
      process.env.SPOTIFY_CLIENT_SECRET.trim()
  );
}

export function getSpotifyCallbackUrl(
  requestOrigin?: string,
  overrideRedirectUri?: string
): string {
  const override = overrideRedirectUri?.trim();
  if (override) return override;
  const saved = getSavedRedirectUri();
  if (saved) return saved;
  const cleanOrigin = requestOrigin?.trim().replace(/\/$/, "");
  const base = (
    cleanOrigin ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/auth/spotify/callback`;
}

export function getSpotifyAuthUrl(
  requestOrigin?: string,
  overrideRedirectUri?: string
): {
  configured: boolean;
  url?: string;
  callbackUrl: string;
  savedRedirectUri?: string;
  error?: string;
} {
  const callbackUrl = getSpotifyCallbackUrl(requestOrigin, overrideRedirectUri);
  if (!isSpotifyConfigured()) {
    return {
      configured: false,
      callbackUrl,
      savedRedirectUri: getSavedRedirectUri(),
      error:
        "Spotify credentials are not configured. Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in AI Studio Secrets.",
    };
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!.trim();
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, {
    createdAt: Date.now(),
    origin: requestOrigin,
    redirectUri: callbackUrl,
  });

  const scopes = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-playback-state",
    "user-read-currently-playing",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: callbackUrl,
    scope: scopes,
    state,
  });

  return {
    configured: true,
    url: `https://accounts.spotify.com/authorize?${params.toString()}`,
    callbackUrl,
    savedRedirectUri: getSavedRedirectUri(),
  };
}

export async function exchangeSpotifyCode(
  code: string,
  state: string,
  requestOrigin?: string
): Promise<{ sessionId: string; session: SpotifySession; persistentToken: string }> {
  if (!state || !pendingStates.has(state)) {
    throw new Error("Invalid or expired Spotify authorization state.");
  }
  const stateMeta = pendingStates.get(state);
  pendingStates.delete(state);
  if (!stateMeta || Date.now() - stateMeta.createdAt > 15 * 60 * 1000) {
    throw new Error("Spotify authorization request expired. Please try again.");
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Spotify client credentials are not configured.");
  }

  const callbackUrl = stateMeta.redirectUri || getSpotifyCallbackUrl(requestOrigin);
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to exchange code with Spotify: ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };

  let profile: SpotifySession["profile"] = undefined;
  try {
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (profileRes.ok) {
      const p = (await profileRes.json()) as {
        id?: string;
        display_name?: string;
        product?: string;
        email?: string;
        images?: Array<{ url?: string }>;
      };
      profile = {
        id: p.id || "",
        displayName: p.display_name || p.id || "Spotify User",
        product: p.product || "free",
        email: p.email,
        avatarUrl: p.images?.[0]?.url,
      };
    }
  } catch (err) {
    console.error("Failed to fetch Spotify profile:", err);
  }

  const sessionId = crypto.randomUUID();
  const session: SpotifySession = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || "",
    expiresAt: Date.now() + tokenData.expires_in * 1000 - 60000,
    profile,
  };

  lastActiveSessionId = sessionId;
  sessions.set(sessionId, session);
  saveSessionsToDisk();
  const persistentToken = sealPersistentSession(session);
  return { sessionId, session, persistentToken };
}

export function getLastActiveSessionId(): string | undefined {
  if (lastActiveSessionId && sessions.has(lastActiveSessionId)) {
    return lastActiveSessionId;
  }
  if (sessions.size > 0) {
    return Array.from(sessions.keys())[0];
  }
  return undefined;
}

export async function getValidAccessToken(sessionId?: string): Promise<string | null> {
  const targetId =
    sessionId ||
    lastActiveSessionId ||
    (sessions.size > 0 ? Array.from(sessions.keys())[0] : undefined);
  if (!targetId) return null;
  const session = sessions.get(targetId);
  if (!session) return null;

  if (Date.now() > session.expiresAt && session.refreshToken) {
    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;

    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        }),
      });

      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
        };
        session.accessToken = data.access_token;
        session.expiresAt = Date.now() + data.expires_in * 1000 - 60000;
        if (data.refresh_token) {
          session.refreshToken = data.refresh_token;
        }
        saveSessionsToDisk();
      }
    } catch (err) {
      console.error("Failed to refresh Spotify token:", err);
    }
  }

  return session.accessToken;
}

export function registerSpotifyDevice(sessionId: string, deviceId: string) {
  const session = getSpotifySession(sessionId);
  if (session) {
    session.deviceId = deviceId;
    saveSessionsToDisk();
  }
}

export function getSpotifySession(sessionId?: string): SpotifySession | null {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }
  if (lastActiveSessionId && sessions.has(lastActiveSessionId)) {
    return sessions.get(lastActiveSessionId)!;
  }
  if (sessions.size > 0) {
    const first = Array.from(sessions.values())[0];
    return first || null;
  }
  return null;
}

export function deleteSpotifySession(sessionId: string) {
  sessions.delete(sessionId);
  if (lastActiveSessionId === sessionId) {
    lastActiveSessionId = sessions.size > 0 ? Array.from(sessions.keys())[0] : undefined;
  }
  saveSessionsToDisk();
}

export async function getAvailableDevices(token: string): Promise<SpotifyDeviceInfo[]> {
  try {
    const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      devices?: Array<{ id?: string; name?: string; type?: string; is_active?: boolean }>;
    };
    return (data.devices || [])
      .filter((d) => Boolean(d.id))
      .map((d) => ({
        id: String(d.id),
        name: d.name || "Spotify Device",
        type: d.type || "Computer",
        isActive: Boolean(d.is_active),
      }));
  } catch {
    return [];
  }
}

export async function getCurrentPlayback(token: string): Promise<SpotifyPlaybackState | null> {
  try {
    const [playerRes, devices] = await Promise.all([
      fetch("https://api.spotify.com/v1/me/player", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      getAvailableDevices(token),
    ]);

    if (playerRes.status === 204 || !playerRes.ok) {
      return null;
    }

    const data = (await playerRes.json()) as {
      is_playing?: boolean;
      progress_ms?: number;
      device?: { id?: string; name?: string; volume_percent?: number };
      item?: {
        id?: string;
        name?: string;
        duration_ms?: number;
        artists?: Array<{ name?: string }>;
        album?: { name?: string; images?: Array<{ url?: string }> };
        external_urls?: { spotify?: string };
      };
    };

    const item = data.item;
    if (!item || !item.id || !item.name) return null;

    return {
      isPlaying: Boolean(data.is_playing),
      progressMs: data.progress_ms || 0,
      durationMs: item.duration_ms || 0,
      deviceName: data.device?.name,
      deviceId: data.device?.id,
      volumePercent: data.device?.volume_percent,
      devices,
      track: {
        id: item.id,
        name: item.name,
        artists: (item.artists || []).map((a) => a.name || "").filter(Boolean).join(", "),
        album: item.album?.name || "",
        albumArtUrl: item.album?.images?.[0]?.url,
        externalUrl: item.external_urls?.spotify,
        durationMs: item.duration_ms || 0,
      },
    };
  } catch {
    return null;
  }
}

async function resolveTargetDeviceId(
  token: string,
  session: SpotifySession | null,
  explicitDeviceId?: string
): Promise<{ deviceId?: string; devices: SpotifyDeviceInfo[] }> {
  const devices = await getAvailableDevices(token);
  if (explicitDeviceId) {
    return { deviceId: explicitDeviceId, devices };
  }
  // Prefer an already-active Spotify Connect device, otherwise fall back to browser Web SDK player
  const activeDevice = devices.find((d) => d.isActive);
  if (activeDevice) {
    return { deviceId: activeDevice.id, devices };
  }
  if (session?.deviceId) {
    return { deviceId: session.deviceId, devices };
  }
  return { deviceId: devices[0]?.id, devices };
}

export async function controlSpotify(
  sessionId: string | undefined,
  params: {
    action: string;
    query?: string;
    volumePercent?: number;
    deviceId?: string;
    uri?: string;
  }
): Promise<{
  success: boolean;
  message: string;
  playback?: SpotifyPlaybackState | null;
  premiumRequired?: boolean;
}> {
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return {
      success: false,
      message:
        "Spotify is not connected. Please tap the + button and connect your Spotify account first.",
    };
  }

  const session = getSpotifySession(sessionId);

  try {
    switch (params.action.toLowerCase()) {
      case "play":
      case "resume": {
        const { deviceId: targetDevice, devices } = await resolveTargetDeviceId(
          token,
          session,
          params.deviceId
        );

        if (params.uri) {
          const playBody = params.uri.startsWith("spotify:track:")
            ? { uris: [params.uri] }
            : { context_uri: params.uri };
          const url = targetDevice
            ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(
                targetDevice
              )}`
            : "https://api.spotify.com/v1/me/player/play";
          const playRes = await fetch(url, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(playBody),
          });
          if (playRes.status === 403) {
            return {
              success: false,
              premiumRequired: true,
              message:
                "Spotify Premium is required for direct playback control. Tap Open in Spotify to listen.",
            };
          }
          if (playRes.status === 404 && !targetDevice) {
            return {
              success: false,
              message:
                "No active Spotify device found. Open Spotify on your phone or browser first.",
            };
          }
          await new Promise((r) => setTimeout(r, 450));
          const playback = await getCurrentPlayback(token);
          return {
            success: true,
            message: playback?.track
              ? `Now playing "${playback.track.name}".`
              : "Playback started.",
            playback,
          };
        }

        if (params.query) {
          const searchRes = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(
              params.query
            )}&type=track,playlist&limit=1`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!searchRes.ok) {
            return { success: false, message: "Failed to search Spotify." };
          }
          const searchData = (await searchRes.json()) as {
            tracks?: { items?: Array<any> };
            playlists?: { items?: Array<any> };
          };
          const topTrack = searchData.tracks?.items?.[0];
          const topPlaylist = searchData.playlists?.items?.[0];

          if (!topTrack && !topPlaylist) {
            return {
              success: false,
              message: `No Spotify songs or playlists found for "${params.query}".`,
            };
          }

          const playBody = topTrack
            ? { uris: [topTrack.uri] }
            : { context_uri: topPlaylist.uri };

          const url = targetDevice
            ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(
                targetDevice
              )}`
            : "https://api.spotify.com/v1/me/player/play";

          const playRes = await fetch(url, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(playBody),
          });

          if (playRes.status === 403) {
            return {
              success: false,
              premiumRequired: true,
              message: `Found "${topTrack?.name || topPlaylist?.name}", but Spotify Premium is required for direct playback control. Open in Spotify to listen.`,
              playback: topTrack
                ? {
                    isPlaying: false,
                    progressMs: 0,
                    durationMs: topTrack.duration_ms,
                    devices,
                    track: {
                      id: topTrack.id,
                      name: topTrack.name,
                      artists: (topTrack.artists || [])
                        .map((a: { name?: string }) => a.name || "")
                        .filter(Boolean)
                        .join(", "),
                      album: topTrack.album?.name || "",
                      albumArtUrl: topTrack.album?.images?.[0]?.url,
                      externalUrl: topTrack.external_urls?.spotify,
                      durationMs: topTrack.duration_ms,
                    },
                  }
                : null,
            };
          }

          if (playRes.status === 404 && !targetDevice) {
            return {
              success: false,
              message:
                "No active Spotify device found. Please open Spotify on your phone/computer or allow the browser player to initialize.",
            };
          }

          await new Promise((r) => setTimeout(r, 550));
          const playback = await getCurrentPlayback(token);

          return {
            success: true,
            message: topTrack
              ? `Now playing "${topTrack.name}" by ${topTrack.artists
                  ?.map((a: { name?: string }) => a.name || "")
                  .filter(Boolean)
                  .join(", ")}.`
              : `Now playing playlist "${topPlaylist?.name}".`,
            playback:
              playback ||
              (topTrack
                ? {
                    isPlaying: true,
                    progressMs: 0,
                    durationMs: topTrack.duration_ms,
                    deviceId: targetDevice,
                    devices,
                    track: {
                      id: topTrack.id,
                      name: topTrack.name,
                      artists: (topTrack.artists || [])
                        .map((a: { name?: string }) => a.name || "")
                        .filter(Boolean)
                        .join(", "),
                      album: topTrack.album?.name || "",
                      albumArtUrl: topTrack.album?.images?.[0]?.url,
                      externalUrl: topTrack.external_urls?.spotify,
                      durationMs: topTrack.duration_ms,
                    },
                  }
                : null),
          };
        } else {
          const url = targetDevice
            ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(
                targetDevice
              )}`
            : "https://api.spotify.com/v1/me/player/play";
          const res = await fetch(url, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 403) {
            return {
              success: false,
              premiumRequired: true,
              message: "Spotify Premium is required to control playback.",
            };
          }
          const playback = await getCurrentPlayback(token);
          return { success: true, message: "Playback resumed.", playback };
        }
      }

      case "pause": {
        const res = await fetch("https://api.spotify.com/v1/me/player/pause", {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) {
          return {
            success: false,
            premiumRequired: true,
            message: "Spotify Premium is required to pause playback.",
          };
        }
        const playback = await getCurrentPlayback(token);
        return { success: true, message: "Playback paused.", playback };
      }

      case "next":
      case "skip": {
        const res = await fetch("https://api.spotify.com/v1/me/player/next", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) {
          return {
            success: false,
            premiumRequired: true,
            message: "Spotify Premium is required to skip tracks.",
          };
        }
        await new Promise((r) => setTimeout(r, 450));
        const playback = await getCurrentPlayback(token);
        return { success: true, message: "Skipped to next track.", playback };
      }

      case "previous":
      case "back": {
        const res = await fetch("https://api.spotify.com/v1/me/player/previous", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) {
          return {
            success: false,
            premiumRequired: true,
            message: "Spotify Premium is required to skip tracks.",
          };
        }
        await new Promise((r) => setTimeout(r, 450));
        const playback = await getCurrentPlayback(token);
        return { success: true, message: "Returned to previous track.", playback };
      }

      case "transfer": {
        if (!params.deviceId) {
          return { success: false, message: "Target device ID is required." };
        }
        const res = await fetch("https://api.spotify.com/v1/me/player", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ device_ids: [params.deviceId], play: true }),
        });
        if (!res.ok) {
          return { success: false, message: "Failed to switch Spotify playback device." };
        }
        await new Promise((r) => setTimeout(r, 450));
        const playback = await getCurrentPlayback(token);
        return { success: true, message: "Switched Spotify playback device.", playback };
      }

      case "volume": {
        const vol = Math.max(0, Math.min(100, Math.round(params.volumePercent ?? 50)));
        const res = await fetch(
          `https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`,
          {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (res.status === 403) {
          return {
            success: false,
            premiumRequired: true,
            message: "Spotify Premium is required to adjust volume.",
          };
        }
        return { success: true, message: `Volume set to ${vol}%.` };
      }

      case "status": {
        const playback = await getCurrentPlayback(token);
        return {
          success: true,
          message: playback?.track
            ? `Currently playing "${playback.track.name}" by ${playback.track.artists}.`
            : "No music is currently playing on Spotify.",
          playback,
        };
      }

      default:
        return { success: false, message: `Unsupported action "${params.action}".` };
    }
  } catch (err) {
    console.error("Spotify control error:", err);
    return {
      success: false,
      message: err instanceof Error ? err.message : "Error controlling Spotify.",
    };
  }
}

export interface SpotifySearchTrackItem {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  albumArtUrl?: string;
  externalUrl?: string;
  durationMs: number;
}

export async function searchSpotifyTracks(
  sessionId: string | undefined,
  query: string
): Promise<{
  success: boolean;
  tracks: SpotifySearchTrackItem[];
  error?: string;
}> {
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    return {
      success: false,
      tracks: [],
      error: "Not authenticated with Spotify.",
    };
  }
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { success: true, tracks: [] };
  }
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        cleanQuery
      )}&type=track&limit=8`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      return { success: false, tracks: [], error: "Spotify search failed." };
    }
    const data = (await res.json()) as {
      tracks?: {
        items?: Array<{
          id?: string;
          uri?: string;
          name?: string;
          duration_ms?: number;
          artists?: Array<{ name?: string }>;
          album?: { name?: string; images?: Array<{ url?: string }> };
          external_urls?: { spotify?: string };
        }>;
      };
    };
    const tracks: SpotifySearchTrackItem[] = (data.tracks?.items || [])
      .filter((t) => Boolean(t.id && t.uri && t.name))
      .map((t) => ({
        id: String(t.id),
        uri: String(t.uri),
        name: String(t.name),
        artists: (t.artists || [])
          .map((a) => a.name || "")
          .filter(Boolean)
          .join(", "),
        album: t.album?.name || "",
        albumArtUrl: t.album?.images?.[0]?.url,
        externalUrl: t.external_urls?.spotify,
        durationMs: t.duration_ms || 0,
      }));
    return { success: true, tracks };
  } catch (err) {
    return {
      success: false,
      tracks: [],
      error: err instanceof Error ? err.message : "Spotify search error.",
    };
  }
}
