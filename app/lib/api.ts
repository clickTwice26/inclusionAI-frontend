// Client for the InclusionAI FastAPI backend.
// The browser calls the host-published backend port, so this must be the
// public URL (localhost:8000), NOT the docker-compose service name.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
export async function ttsSpeak(text: string, lang: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) throw new Error(`TTS request failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function describeImage(imageDataUrl: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/describe-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data_url: imageDataUrl }),
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
