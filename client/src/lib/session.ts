export interface SavedCastSession {
  id: number;
  code: string;
  label: string;
}

const CAST_KEY = "sw_cast_session";
const VIEW_KEY = "sw_view_code";

export const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
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
