import { useCallback, useEffect, useRef, useState } from "react";
import type { SpotifyAuthState, SpotifyPlaybackState } from "../types/assistant";

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayerInstance;
    };
  }
}

interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (...args: any[]) => void) => void;
  removeListener: (event: string, cb: (...args: any[]) => void) => void;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
}

const STORAGE_KEY = "nolan_spotify_session_id";
const PERSISTENT_TOKEN_KEY = "nolan_spotify_persistent_token";
const AUTH_CACHE_KEY = "nolan_spotify_auth_cache";
const REDIRECT_URI_KEY = "nolan_spotify_redirect_uri";

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore storage errors
  }
}

function readCachedAuthState(): SpotifyAuthState {
  const raw = readStorage(AUTH_CACHE_KEY);
  const savedUri = readStorage(REDIRECT_URI_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SpotifyAuthState>;
      if (parsed && typeof parsed === "object" && parsed.connected) {
        return {
          configured: Boolean(parsed.configured ?? true),
          connected: true,
          displayName: parsed.displayName,
          product: parsed.product,
          avatarUrl: parsed.avatarUrl,
          callbackUrl: savedUri || parsed.callbackUrl,
          savedRedirectUri: savedUri,
        };
      }
    } catch {
      // ignore invalid cache
    }
  }
  return {
    configured: false,
    connected: false,
    ...(savedUri ? { callbackUrl: savedUri, savedRedirectUri: savedUri } : {}),
  };
}

export function useSpotify() {
  const [authState, setAuthState] = useState<SpotifyAuthState>(readCachedAuthState);
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [spotifySessionId, setSpotifySessionId] = useState<string | null>(() =>
    readStorage(STORAGE_KEY)
  );
  const [persistentToken, setPersistentToken] = useState<string | null>(() =>
    readStorage(PERSISTENT_TOKEN_KEY)
  );

  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(spotifySessionId);
  const persistentTokenRef = useRef<string | null>(persistentToken);
  const popupWatcherRef = useRef<number | null>(null);

  useEffect(() => {
    sessionIdRef.current = spotifySessionId;
  }, [spotifySessionId]);

  useEffect(() => {
    persistentTokenRef.current = persistentToken;
  }, [persistentToken]);

  const clearPopupWatcher = useCallback(() => {
    if (popupWatcherRef.current !== null) {
      window.clearInterval(popupWatcherRef.current);
      popupWatcherRef.current = null;
    }
  }, []);

  const getSpotifyHeaders = useCallback((includeJsonContentType = false): HeadersInit => {
    const headers: Record<string, string> = {
      "X-Requested-With": "XMLHttpRequest",
    };
    if (includeJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    const activeSessionId = sessionIdRef.current || readStorage(STORAGE_KEY);
    if (activeSessionId) {
      headers["x-spotify-session"] = activeSessionId;
    }
    const activeRestoreToken =
      persistentTokenRef.current || readStorage(PERSISTENT_TOKEN_KEY);
    if (activeRestoreToken) {
      headers["x-spotify-restore"] = activeRestoreToken;
    }
    const savedRedirectUri = readStorage(REDIRECT_URI_KEY);
    if (savedRedirectUri) {
      headers["x-spotify-redirect-uri"] = savedRedirectUri;
    }
    return headers;
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const originParam = encodeURIComponent(window.location.origin);
      const res = await fetch(`/api/spotify/status?origin=${originParam}`, {
        headers: getSpotifyHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const localSavedUri = readStorage(REDIRECT_URI_KEY);
        const resolvedSavedUri = data.savedRedirectUri ?? localSavedUri ?? null;
        if (data.savedRedirectUri && typeof data.savedRedirectUri === "string") {
          writeStorage(REDIRECT_URI_KEY, data.savedRedirectUri);
        }

        const nextAuthState: SpotifyAuthState = {
          configured: Boolean(data.configured),
          connected: Boolean(data.connected),
          displayName: data.displayName,
          product: data.product,
          avatarUrl: data.avatarUrl,
          callbackUrl: data.callbackUrl || resolvedSavedUri || undefined,
          savedRedirectUri: resolvedSavedUri,
          defaultCallbackUrl: data.defaultCallbackUrl,
        };
        setAuthState(nextAuthState);

        if (data.connected) {
          writeStorage(
            AUTH_CACHE_KEY,
            JSON.stringify({
              configured: nextAuthState.configured,
              connected: true,
              displayName: nextAuthState.displayName,
              product: nextAuthState.product,
              avatarUrl: nextAuthState.avatarUrl,
              callbackUrl: nextAuthState.callbackUrl,
            })
          );
        } else {
          writeStorage(AUTH_CACHE_KEY, null);
        }

        if (data.sessionId && typeof data.sessionId === "string") {
          sessionIdRef.current = data.sessionId;
          setSpotifySessionId(data.sessionId);
          writeStorage(STORAGE_KEY, data.sessionId);
        }
        if (data.persistentToken && typeof data.persistentToken === "string") {
          persistentTokenRef.current = data.persistentToken;
          setPersistentToken(data.persistentToken);
          writeStorage(PERSISTENT_TOKEN_KEY, data.persistentToken);
        }
        if (data.playback) {
          setPlayback(data.playback);
        }
      }
    } catch (err) {
      console.error("Failed to fetch Spotify status:", err);
    }
  }, [getSpotifyHeaders]);

  // Initialize status on mount
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    return () => clearPopupWatcher();
  }, [clearPopupWatcher]);

  // Sync login written by OAuth popup via localStorage storage events
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY ||
        e.key === PERSISTENT_TOKEN_KEY ||
        e.key === AUTH_CACHE_KEY
      ) {
        const sid = readStorage(STORAGE_KEY);
        const ptok = readStorage(PERSISTENT_TOKEN_KEY);
        if (sid) {
          sessionIdRef.current = sid;
          setSpotifySessionId(sid);
        }
        if (ptok) {
          persistentTokenRef.current = ptok;
          setPersistentToken(ptok);
        }
        if (sid || ptok) {
          setIsConnecting(false);
          clearPopupWatcher();
          void fetchStatus();
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearPopupWatcher, fetchStatus]);

  // Listen for OAuth popup completion or error with strict origin check
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        const origin = event.origin || "";
        const isTrustedOrigin =
          origin === window.location.origin ||
          origin.endsWith(".run.app") ||
          origin.includes("localhost");
        if (!isTrustedOrigin) {
          return;
        }
      } catch {
        return;
      }

      if (event.data?.type === "SPOTIFY_AUTH_SUCCESS") {
        clearPopupWatcher();
        setAuthError(null);
        if (typeof event.data.sessionId === "string" && event.data.sessionId.trim()) {
          const cleanSessionId = event.data.sessionId.trim();
          sessionIdRef.current = cleanSessionId;
          setSpotifySessionId(cleanSessionId);
          writeStorage(STORAGE_KEY, cleanSessionId);
        }
        if (
          typeof event.data.persistentToken === "string" &&
          event.data.persistentToken.trim()
        ) {
          const cleanToken = event.data.persistentToken.trim();
          persistentTokenRef.current = cleanToken;
          setPersistentToken(cleanToken);
          writeStorage(PERSISTENT_TOKEN_KEY, cleanToken);
        }
        if (event.data.profile) {
          const cached = {
            configured: true,
            connected: true,
            displayName: event.data.profile.displayName,
            product: event.data.profile.product,
            avatarUrl: event.data.profile.avatarUrl,
          };
          writeStorage(AUTH_CACHE_KEY, JSON.stringify(cached));
          setAuthState((prev) => ({ ...prev, ...cached }));
        }
        setIsConnecting(false);
        void fetchStatus();
        setPlayerNotice("Connected to Spotify!");
        setTimeout(() => setPlayerNotice(null), 3500);
      } else if (event.data?.type === "SPOTIFY_AUTH_ERROR") {
        clearPopupWatcher();
        setIsConnecting(false);
        const msg =
          typeof event.data.error === "string" && event.data.error.trim()
            ? event.data.error.trim()
            : "Failed to authorize Spotify.";
        setAuthError(msg);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clearPopupWatcher, fetchStatus]);

  // Initialize Spotify Web Playback SDK when connected
  useEffect(() => {
    if (!authState.connected) {
      if (playerRef.current) {
        try {
          playerRef.current.disconnect();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      return;
    }

    const initPlayer = () => {
      try {
        if (!window.Spotify || playerRef.current) return;

        const player = new window.Spotify.Player({
          name: "Nolan Voice Player",
          getOAuthToken: async (cb) => {
            try {
              const res = await fetch("/api/spotify/token", {
                headers: getSpotifyHeaders(),
              });
              if (res.ok) {
                const data = await res.json();
                cb(data.accessToken);
              }
            } catch (err) {
              console.error("Failed to fetch Spotify token for SDK:", err);
            }
          },
          volume: 0.5,
        });

        player.addListener("ready", ({ device_id }) => {
          deviceIdRef.current = device_id;
          setIsSdkReady(true);
          fetch("/api/spotify/device", {
            method: "POST",
            headers: getSpotifyHeaders(true),
            body: JSON.stringify({ deviceId: device_id }),
          }).catch(() => {});
        });

        player.addListener("not_ready", () => {
          setIsSdkReady(false);
        });

        player.addListener("player_state_changed", (state) => {
          try {
            if (!state) return;
            const current = state.track_window?.current_track;
            if (current) {
              setPlayback((prev) => ({
                isPlaying: !state.paused,
                progressMs: state.position,
                durationMs: state.duration,
                deviceName: "Nolan Voice Player",
                deviceId: deviceIdRef.current || undefined,
                devices: prev?.devices,
                volumePercent: prev?.volumePercent,
                track: {
                  id: current.id,
                  name: current.name,
                  artists: current.artists?.map((a: any) => a.name).join(", ") || "",
                  album: current.album?.name || "",
                  albumArtUrl: current.album?.images?.[0]?.url,
                  durationMs: state.duration,
                },
              }));
            }
          } catch {
            // ignore
          }
        });

        player.connect().catch((err) => {
          console.warn("Spotify Web Playback SDK connection note:", err);
        });

        playerRef.current = player;
      } catch (err) {
        console.warn("Spotify Player init error:", err);
      }
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (!document.getElementById("spotify-player-sdk")) {
        const script = document.createElement("script");
        script.id = "spotify-player-sdk";
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        script.crossOrigin = "anonymous";
        document.body.appendChild(script);
      }
    }

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.disconnect();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [authState.connected, getSpotifyHeaders]);

  const saveRedirectUri = useCallback(
    async (redirectUri: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = redirectUri.trim();
      try {
        const originParam = encodeURIComponent(window.location.origin);
        const res = await fetch(`/api/spotify/config?origin=${originParam}`, {
          method: "POST",
          headers: getSpotifyHeaders(true),
          body: JSON.stringify({ redirectUri: trimmed }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || "Invalid Redirect URI" };
        }
        writeStorage(REDIRECT_URI_KEY, data.savedRedirectUri || null);
        setAuthState((prev) => ({
          ...prev,
          callbackUrl: data.callbackUrl,
          savedRedirectUri: data.savedRedirectUri,
          defaultCallbackUrl: data.defaultCallbackUrl,
        }));
        return { ok: true };
      } catch {
        return { ok: false, error: "Could not save Redirect URI." };
      }
    },
    [getSpotifyHeaders]
  );

  const connectSpotify = useCallback(async () => {
    setIsConnecting(true);
    setAuthError(null);
    clearPopupWatcher();
    try {
      const originParam = encodeURIComponent(window.location.origin);
      const res = await fetch(`/api/auth/spotify/url?origin=${originParam}`, {
        headers: getSpotifyHeaders(),
      });
      const data = await res.json();
      if (data.callbackUrl) {
        setAuthState((prev) => ({
          ...prev,
          configured: Boolean(data.configured),
          callbackUrl: data.callbackUrl,
          savedRedirectUri: data.savedRedirectUri ?? prev.savedRedirectUri,
        }));
      }
      if (data.url) {
        const popup = window.open(
          data.url,
          "spotify_oauth",
          "width=560,height=720,left=200,top=90"
        );
        if (!popup) {
          const msg =
            "เบราว์เซอร์บล็อกหน้าต่างป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วลองเชื่อมต่ออีกครั้งครับ";
          setAuthError(msg);
          setPlayerNotice(msg);
          setTimeout(() => setPlayerNotice(null), 5000);
          setIsConnecting(false);
          return;
        }
        popupWatcherRef.current = window.setInterval(() => {
          try {
            if (popup.closed) {
              clearPopupWatcher();
              setIsConnecting(false);
              // Re-sync in case localStorage was updated by callback before closing
              const sid = readStorage(STORAGE_KEY);
              const ptok = readStorage(PERSISTENT_TOKEN_KEY);
              if (sid) {
                sessionIdRef.current = sid;
                setSpotifySessionId(sid);
              }
              if (ptok) {
                persistentTokenRef.current = ptok;
                setPersistentToken(ptok);
              }
              void fetchStatus();
            }
          } catch {
            // cross-origin window check may ignore
          }
        }, 450);
      } else {
        const msg =
          data.error ||
          "Spotify application credentials (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET) are missing.";
        setAuthError(msg);
        setPlayerNotice(msg);
        setTimeout(() => setPlayerNotice(null), 5000);
        setIsConnecting(false);
      }
    } catch (err) {
      console.error("Connect Spotify error:", err);
      setAuthError("Unable to reach Spotify authentication server.");
      setIsConnecting(false);
    }
  }, [clearPopupWatcher, fetchStatus, getSpotifyHeaders]);

  const disconnectSpotify = useCallback(async () => {
    try {
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      await fetch("/api/auth/spotify/logout", {
        method: "POST",
        headers: getSpotifyHeaders(),
      });
      sessionIdRef.current = null;
      persistentTokenRef.current = null;
      deviceIdRef.current = null;
      setSpotifySessionId(null);
      setPersistentToken(null);
      writeStorage(STORAGE_KEY, null);
      writeStorage(PERSISTENT_TOKEN_KEY, null);
      writeStorage(AUTH_CACHE_KEY, null);
      setIsSdkReady(false);
      setAuthState((prev) => ({
        ...prev,
        connected: false,
        displayName: undefined,
        product: undefined,
        avatarUrl: undefined,
      }));
      setPlayback(null);
      setPlayerNotice("Disconnected from Spotify.");
      setTimeout(() => setPlayerNotice(null), 3000);
    } catch (err) {
      console.error("Disconnect Spotify error:", err);
    }
  }, [getSpotifyHeaders]);

  const togglePlayPause = useCallback(async () => {
    if (!playback) return;
    const action = playback.isPlaying ? "pause" : "resume";
    try {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: getSpotifyHeaders(true),
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.playback) {
        setPlayback(data.playback);
      } else {
        setPlayback((prev) => (prev ? { ...prev, isPlaying: !prev.isPlaying } : null));
      }
    } catch {
      // ignore
    }
  }, [getSpotifyHeaders, playback]);

  const nextTrack = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: getSpotifyHeaders(true),
        body: JSON.stringify({ action: "next" }),
      });
      const data = await res.json();
      if (data.playback) {
        setPlayback(data.playback);
      }
    } catch {
      // ignore
    }
  }, [getSpotifyHeaders]);

  const previousTrack = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: getSpotifyHeaders(true),
        body: JSON.stringify({ action: "previous" }),
      });
      const data = await res.json();
      if (data.playback) {
        setPlayback(data.playback);
      }
    } catch {
      // ignore
    }
  }, [getSpotifyHeaders]);

  const transferDevice = useCallback(
    async (deviceId: string) => {
      if (!deviceId) return;
      try {
        const res = await fetch("/api/spotify/control", {
          method: "POST",
          headers: getSpotifyHeaders(true),
          body: JSON.stringify({ action: "transfer", deviceId }),
        });
        const data = await res.json();
        if (data.playback) {
          setPlayback(data.playback);
        }
        if (data.message) {
          setPlayerNotice(data.message);
          setTimeout(() => setPlayerNotice(null), 3500);
        }
      } catch {
        // ignore
      }
    },
    [getSpotifyHeaders]
  );

  const searchTracks = useCallback(
    async (query: string) => {
      if (!query.trim()) return [];
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(query.trim())}`,
          { headers: getSpotifyHeaders() }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.tracks) ? data.tracks : [];
      } catch {
        return [];
      }
    },
    [getSpotifyHeaders]
  );

  const playTrack = useCallback(
    async (opts: { uri?: string; query?: string }) => {
      try {
        const res = await fetch("/api/spotify/control", {
          method: "POST",
          headers: getSpotifyHeaders(true),
          body: JSON.stringify({ action: "play", ...opts }),
        });
        const data = await res.json();
        if (data.playback) {
          setPlayback(data.playback);
        }
        if (data.message && !data.success) {
          setPlayerNotice(data.message);
          setTimeout(() => setPlayerNotice(null), 4500);
        }
        return data;
      } catch {
        return { success: false };
      }
    },
    [getSpotifyHeaders]
  );

  const setVolume = useCallback(
    async (volumePercent: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
      setPlayback((prev) => (prev ? { ...prev, volumePercent: clamped } : prev));
      try {
        await fetch("/api/spotify/control", {
          method: "POST",
          headers: getSpotifyHeaders(true),
          body: JSON.stringify({ action: "volume", volumePercent: clamped }),
        });
      } catch {
        // ignore
      }
    },
    [getSpotifyHeaders]
  );

  const handleSpotifyStateFromWs = useCallback(
    (newPlayback?: SpotifyPlaybackState | null, notice?: string, _premiumRequired?: boolean) => {
      if (newPlayback) {
        setPlayback(newPlayback);
      }
      if (notice) {
        setPlayerNotice(notice);
        setTimeout(() => setPlayerNotice(null), 5000);
      }
    },
    []
  );

  const dismissNowPlaying = useCallback(() => {
    setPlayback(null);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  return {
    authState,
    playback,
    playerNotice,
    authError,
    isSdkReady,
    isConnecting,
    spotifySessionId,
    persistentToken,
    connectSpotify,
    disconnectSpotify,
    saveRedirectUri,
    togglePlayPause,
    nextTrack,
    previousTrack,
    transferDevice,
    searchTracks,
    playTrack,
    setVolume,
    handleSpotifyStateFromWs,
    dismissNowPlaying,
    clearAuthError,
    refreshStatus: fetchStatus,
  };
}
