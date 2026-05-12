export interface SavedCastSession {
  id: number;
  code: string;
  label: string;
}

const CAST_KEY = "sw_cast_session";
const VIEW_KEY = "sw_view_code";

// ICE servers: STUN for same-network, TURN for cross-network/mobile data
// Without TURN, WebRTC often fails when the two devices are on different
// networks (e.g. your phone on WiFi, daughter's phone on mobile data).
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  // Free public TURN servers (Open Relay Project)
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function getSavedCastSession(): SavedCastSession | null {
  try {
    const raw = localStorage.getItem(CAST_KEY);
    return raw ? (JSON.parse(raw) as SavedCastSession) : null;
  } catch {
    return null;
  }
}

export function saveCastSession(s: SavedCastSession): void {
  localStorage.setItem(CAST_KEY, JSON.stringify(s));
}

export function clearCastSession(): void {
  localStorage.removeItem(CAST_KEY);
}

export function getSavedViewCode(): string | null {
  return localStorage.getItem(VIEW_KEY);
}

export function saveViewCode(code: string): void {
  localStorage.setItem(VIEW_KEY, code.toUpperCase().trim());
}

export function clearViewCode(): void {
  localStorage.removeItem(VIEW_KEY);
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Returns the best supported video/webm MIME type for MediaRecorder on this
 * browser. Falls back through the most-compatible codecs in order.
 */
export function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm;codecs=h264",
    "video/webm",
    "video/mp4;codecs=h264",
    "video/mp4",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // Some browsers throw on unrecognised types
    }
  }
  return "video/webm"; // last resort — browser will reject if unsupported
}
