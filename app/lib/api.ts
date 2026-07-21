// Base URL of the FastAPI backend, resolved in priority order:
//   1. NEXT_PUBLIC_API_URL  — explicit override (set this in production).
//   2. The host the page was loaded from, on port 8000 — so opening the app by
//      LAN IP (e.g. http://192.168.0.109:3000 from a phone) automatically talks
//      to http://192.168.0.109:8000 for both REST and the captions WebSocket.
//   3. localhost:8000 — SSR fallback (no window yet).
function resolveApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

// Base URL of the captions WebSocket, resolved in priority order:
//   1. NEXT_PUBLIC_WS_URL   — explicit override (e.g. ws://192.168.0.109:8000).
//   2. Derived from API_BASE by swapping http->ws / https->wss.
// wsUrlFor() appends "/ws/captions/<room>", so this must have no trailing path.
function resolveWsBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv;
  return API_BASE.replace(/^http/, "ws");
}

export const WS_BASE = resolveWsBase();

export interface SimplifyResult {
  original: string;
  simplified: string;
  grade_before: number;
  grade_after: number;
}

export async function simplify(text: string): Promise<SimplifyResult> {
  const res = await fetch(`${API_BASE}/api/simplify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Simplify request failed (${res.status})`);
  return res.json();
}

// Synthesize speech via self-hosted Piper on the backend (English & Bangla).
// Returns an object-URL for the audio; throws if the language is unsupported
// (HTTP 422) or the backend is unreachable — callers fall back to browser TTS.
export async function ttsSpeak(text: string, lang: string, engine: "piper" | "openai" = "piper"): Promise<string> {
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, engine }),
  });
  if (!res.ok) throw new Error(`TTS request failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface TranslateResult {
  original: string;
  translated: string;
  target_lang: string;
}

// Translate lesson text into another language via OpenAI on the backend, so the
// Read-Aloud voice speaks real words in that language (not the English text).
export async function translate(text: string, targetLang: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, target_lang: targetLang }),
  });
  if (!res.ok) throw new Error(`Translate request failed (${res.status})`);
  const data: TranslateResult = await res.json();
  return data.translated;
}

// Describe an image via OpenAI vision on the backend. `lang` is the learner's
// selected language short-code (en/bn/ms) so the description comes back in that
// language rather than always English.
export async function describeImage(imageDataUrl: string, lang = "en"): Promise<string> {
  const res = await fetch(`${API_BASE}/api/describe-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data_url: imageDataUrl, lang }),
  });
  if (!res.ok) throw new Error(`Describe-image request failed (${res.status})`);
  const data = await res.json();
  return data.description as string;
}

// Fire-and-forget analytics — never blocks or throws into the UI.
export function logUsage(
  feature: string,
  action: string,
  meta?: Record<string, unknown>
): void {
  fetch(`${API_BASE}/api/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, action, meta: meta ?? null }),
  }).catch(() => {
    /* offline / backend down — analytics are non-essential */
  });
}

// Generate a simple learning picture for the simplified text via the backend
// image model. Returns a data URL (PNG) ready to drop into an <img src>.
export async function illustrate(text: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/illustrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Illustrate request failed (${res.status})`);
  const data = await res.json();
  return data.image_data_url as string;
}

export interface Lesson {
  id: number;
  subject: string;
  title: string;
  body: string;
  sample_image_desc: string;
  created_at: string;
}

export async function getLessons(): Promise<Lesson[]> {
  const res = await fetch(`${API_BASE}/api/lessons`);
  if (!res.ok) throw new Error(`Lessons request failed (${res.status})`);
  return res.json();
}
