export const LOCKED_VOICE = 'Charon' as const;
export type VoiceName = typeof LOCKED_VOICE;

export type SpokenLanguage = 'th' | 'en';

export type NolanEngineMode = 'gemma-open' | 'gemini-live';

export type WorkspaceAppId = 'spotify' | 'settings';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error';

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface GuideStep {
  stepTitle: string;
  instruction: string;
  tip?: string;
}

export interface StepGuide {
  id: string;
  title: string;
  subtitle?: string;
  steps: GuideStep[];
}

export interface SpotifyAuthState {
  configured: boolean;
  connected: boolean;
  displayName?: string;
  product?: string;
  avatarUrl?: string;
  error?: string;
  callbackUrl?: string;
  savedRedirectUri?: string | null;
  defaultCallbackUrl?: string;
}

export interface SpotifyPlaybackTrack {
  id: string;
  name: string;
  artists: string;
  album: string;
  albumArtUrl?: string;
  externalUrl?: string;
  durationMs: number;
}

export interface SpotifySearchTrack {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  albumArtUrl?: string;
  externalUrl?: string;
  durationMs: number;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  track?: SpotifyPlaybackTrack;
  progressMs: number;
  durationMs: number;
  deviceName?: string;
  deviceId?: string;
  volumePercent?: number;
  devices?: SpotifyDevice[];
}

export const SAMPLE_PROMPTS_BY_LANGUAGE: Record<SpokenLanguage, string[]> = {
  th: [
    'เปิดเพลงชิลๆ ใน Spotify ให้ฟังหน่อยครับ',
    'เปิดเพลงของ Jeff Satur หน่อยครับ',
    'ขอสูตรทำบรู๊คกี้ (Brookie) แบบทีละขั้นตอนหน่อยครับ',
    'ทำไมท้องฟ้าถึงเป็นสีฟ้าในช่วงกลางวันครับ',
  ],
  en: [
    'Play some chill lo-fi on Spotify.',
    'Play Espresso by Sabrina Carpenter.',
    'Tell me a brookie recipe step by step.',
    'Why does the sky look blue during the day?',
  ],
};
