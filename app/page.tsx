"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as S from "./theme";
import { API_BASE, describeImage, logUsage, simplify as apiSimplify, ttsSpeak } from "./lib/api";

type Tab = "read" | "simplify" | "captions";
type Role = "teacher" | "student";
type WsStatus = "idle" | "connecting" | "connected";
type Lang = "en" | "bn" | "ms";

// Read-Aloud languages. `piper` ones are synthesized server-side by Piper;
// the rest (and any Piper failure) use the browser's built-in speech synthesis.
const LANGS: { code: Lang; label: string; bcp47: string; piper: boolean }[] = [
  { code: "en", label: "English", bcp47: "en-US", piper: true },
  { code: "bn", label: "বাংলা · Bangla", bcp47: "bn-BD", piper: true },
  { code: "ms", label: "Bahasa Malaysia", bcp47: "ms-MY", piper: false },
];
const langInfo = (code: Lang) => LANGS.find((l) => l.code === code) ?? LANGS[0];

// The captions WebSocket lives at the same host as the REST API.
const wsUrlFor = (room: string) =>
  `${API_BASE.replace(/^http/, "ws")}/ws/captions/${encodeURIComponent(room)}`;

const SETTINGS_KEY = "inclusionai:settings";

type StoredSettings = {
  tab: Tab;
  scale: number;
  contrast: boolean;
  dyslexia: boolean;
  rate: number;
  ttsLang: Lang;
  role: Role;
  onboarded: boolean;
  studentName: string;
};

// A tiny speaker icon reused throughout.
function Speaker() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path
        d="M16.5 8.5a4 4 0 0 1 0 7M19 6a7.5 7.5 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Page() {
  // ---- accessibility state ----
  const [tab, setTab] = useState<Tab>("read");
  const [scale, setScale] = useState(1);
  const [contrast, setContrast] = useState(false);
  const [dyslexia, setDyslexia] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [announceMsg, setAnnounceMsg] = useState("");
  const [onboarded, setOnboarded] = useState(true); // assume done until storage says otherwise (avoids SSR flash)
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ---- read-to-me (F1) ----
  const [readText, setReadText] = useState(
    "Photosynthesis is the process plants use to turn sunlight, water, and carbon dioxide into glucose and oxygen. The green pigment chlorophyll absorbs light energy, which powers a series of chemical reactions inside the chloroplasts of plant cells."
  );
  const [imgUrl, setImgUrl] = useState("");
  const [imgDesc, setImgDesc] = useState("");
  const [imgDescBusy, setImgDescBusy] = useState(false);
  const [imgDescMsg, setImgDescMsg] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [ttsMsg, setTtsMsg] = useState("");
  const [ttsLang, setTtsLang] = useState<Lang>("en");

  // ---- simplify (F2) ----
  const [simpIn, setSimpIn] = useState(
    "Notwithstanding the complexity of the underlying mechanisms, the fundamental objective of the experiment was to demonstrate that the accumulation of thermal energy could be attributed to the absorption of incident radiation by the darkened surface."
  );
  const [simpOut, setSimpOut] = useState("");
  const [levelBefore, setLevelBefore] = useState<number | null>(null);
  const [levelAfter, setLevelAfter] = useState<number | null>(null);
  const [simpBusy, setSimpBusy] = useState(false);

  // ---- captions (F3): real teacher→students broadcast over a WebSocket ----
  const [capActive, setCapActive] = useState(false); // teacher microphone live
  const [capFinal, setCapFinal] = useState("");
  const [capInterim, setCapInterim] = useState("");
  const [capSupported, setCapSupported] = useState(true);
  const [role, setRole] = useState<Role>("teacher");
  const [room, setRoom] = useState("class-1");
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [peers, setPeers] = useState(0);
  const [roster, setRoster] = useState<string[]>([]); // teacher: names of joined students
  const [studentName, setStudentName] = useState(""); // student: their display name

  // ---- refs ----
  const curTextRef = useRef("");
  const recognitionRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pausedRef = useRef(false);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null); // Piper playback element
  const audioUrlRef = useRef<string | null>(null); // object-URL to revoke
  const engineRef = useRef<"piper" | "browser" | null>(null);
  const speakSeqRef = useRef(0); // guards against overlapping async Piper requests
  const settingsLoadedRef = useRef(false); // don't persist until initial load runs

  const announce = useCallback((msg: string) => {
    setAnnounceMsg("");
    // next tick so screen readers re-read even identical messages
    setTimeout(() => setAnnounceMsg(msg), 30);
  }, []);

  // ---- speech synthesis (Piper for en/bn, browser for the rest + fallback) ----
  const clearKeepAlive = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  // Tear down any Piper <audio> playback and free its object-URL.
  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.onended = null;
        a.onerror = null;
        a.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  // ---- browser Web Speech engine (all languages; Piper's fallback) ----
  const browserSpeak = useCallback(
    (text: string, bcp47: string) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
      if (!synth) {
        setTtsMsg("Text-to-speech is not supported in this browser.");
        return;
      }
      stopAudio();
      const start = () => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = rate;
        u.lang = bcp47;
        utterRef.current = u; // keep a reference so Chrome doesn't drop it mid-speech
        engineRef.current = "browser";
        curTextRef.current = text;
        u.onend = () => {
          if (utterRef.current !== u) return; // superseded by a newer utterance
          utterRef.current = null;
          clearKeepAlive();
          setSpeaking(false);
          setPaused(false);
          pausedRef.current = false;
          setTtsMsg("");
        };
        u.onerror = (e: any) => {
          if (utterRef.current !== u) return; // stale event from a cancelled utterance
          utterRef.current = null;
          clearKeepAlive();
          setSpeaking(false);
          setPaused(false);
          pausedRef.current = false;
          setTtsMsg(e?.error === "interrupted" || e?.error === "canceled" ? "" : "Reading stopped unexpectedly.");
        };
        setSpeaking(true);
        setPaused(false);
        pausedRef.current = false;
        setTtsMsg("Reading aloud…");
        synth.speak(u);
        logUsage("F1", "read_aloud", { engine: "browser", lang: bcp47 });
        // Chrome silently stops speech after ~15s; nudge it to keep going.
        clearKeepAlive();
        keepAliveRef.current = setInterval(() => {
          if (!synth.speaking) {
            clearKeepAlive();
            return;
          }
          if (!pausedRef.current) {
            try {
              synth.pause();
              synth.resume();
            } catch {
              /* ignore */
            }
          }
        }, 10000);
      };
      // Avoid the Chrome cancel-then-speak race by letting the cancel settle first.
      if (synth.speaking || synth.pending) {
        utterRef.current = null;
        synth.cancel();
        setTimeout(start, 80);
      } else {
        start();
      }
    },
    [rate, clearKeepAlive, stopAudio]
  );

  // ---- Piper engine (server-synthesized audio, played via <audio>) ----
  const piperSpeak = useCallback(
    (text: string, lang: Lang, bcp47: string) => {
      const seq = speakSeqRef.current;
      setSpeaking(true);
      setPaused(false);
      pausedRef.current = false;
      setTtsMsg("Reading aloud…");
      ttsSpeak(text, lang)
        .then((url) => {
          if (seq !== speakSeqRef.current) {
            URL.revokeObjectURL(url); // a newer request superseded this one
            return;
          }
          stopAudio();
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audio.playbackRate = rate;
          audioRef.current = audio;
          engineRef.current = "piper";
          curTextRef.current = text;
          audio.onended = () => {
            if (seq !== speakSeqRef.current) return;
            stopAudio();
            setSpeaking(false);
            setPaused(false);
            pausedRef.current = false;
            setTtsMsg("");
          };
          audio.onerror = () => {
            if (seq !== speakSeqRef.current) return;
            browserSpeak(text, bcp47); // playback failed → browser fallback
          };
          audio.play().catch(() => {
            if (seq === speakSeqRef.current) browserSpeak(text, bcp47);
          });
          logUsage("F1", "read_aloud", { engine: "piper", lang });
        })
        .catch(() => {
          if (seq !== speakSeqRef.current) return;
          // Backend unreachable or no Piper voice for this language → browser TTS.
          browserSpeak(text, bcp47);
        });
    },
    [rate, stopAudio, browserSpeak]
  );

  const speak = useCallback(
    (text: string, langOverride?: Lang) => {
      if (!text || !text.trim()) {
        setTtsMsg("Add some text first, then press Read Aloud.");
        return;
      }
      const info = langInfo(langOverride ?? ttsLang);
      speakSeqRef.current += 1; // invalidate any in-flight Piper request
      stopAudio();
      if (info.piper) {
        // stop any browser speech cleanly before switching to Piper audio
        const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
        utterRef.current = null;
        clearKeepAlive();
        if (synth) {
          try {
            synth.cancel();
          } catch {
            /* ignore */
          }
        }
        piperSpeak(text, info.code, info.bcp47);
      } else {
        browserSpeak(text, info.bcp47);
      }
    },
    [ttsLang, stopAudio, clearKeepAlive, piperSpeak, browserSpeak]
  );

  const pauseRead = useCallback(() => {
    if (!speaking) return;
    const resume = paused;
    if (engineRef.current === "piper") {
      const a = audioRef.current;
      if (!a) return;
      if (resume) a.play().catch(() => {});
      else a.pause();
    } else {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
      if (!synth) return;
      if (resume) synth.resume();
      else synth.pause();
    }
    setPaused(!resume);
    pausedRef.current = !resume;
    setTtsMsg(resume ? "Reading aloud…" : "Paused");
  }, [speaking, paused]);

  const stopRead = useCallback(() => {
    speakSeqRef.current += 1; // invalidate in-flight Piper + ignore late events
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    utterRef.current = null;
    clearKeepAlive();
    if (synth) {
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
    }
    stopAudio();
    engineRef.current = null;
    setSpeaking(false);
    setPaused(false);
    pausedRef.current = false;
    setTtsMsg("");
  }, [clearKeepAlive, stopAudio]);

  const playRead = useCallback(() => {
    if (speaking && paused) {
      pauseRead(); // resume
      return;
    }
    speak(readText);
  }, [speaking, paused, readText, speak, pauseRead]);

  const onRate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const r = parseFloat(e.target.value);
    setRate(r);
    if (!speaking) return;
    if (engineRef.current === "piper") {
      if (audioRef.current) audioRef.current.playbackRate = r; // live, no restart needed
    } else {
      const t = curTextRef.current;
      setTimeout(() => speak(t), 40); // browser voices need a restart
    }
  };

  // ---- image explainer (F1) — described by AI vision on the backend ----
  const describeUploadedImage = useCallback(async (dataUrl: string) => {
    setImgDescBusy(true);
    setImgDescMsg("");
    try {
      const description = await describeImage(dataUrl);
      setImgDesc(description);
      logUsage("F1", "describe_image");
    } catch {
      setImgDescMsg(
        "Could not reach the InclusionAI vision AI. Make sure the backend is running, then try again."
      );
    } finally {
      setImgDescBusy(false);
    }
  }, []);

  const onImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result);
      setImgUrl(dataUrl);
      setImgDesc("");
      describeUploadedImage(dataUrl);
    };
    r.readAsDataURL(f);
  };

  // ---- simplify (F2) — powered by the FastAPI backend ----
  const doSimplify = useCallback(async () => {
    if (!simpIn.trim()) return;
    setSimpBusy(true);
    try {
      const res = await apiSimplify(simpIn);
      setSimpOut(res.simplified);
      setLevelBefore(res.grade_before);
      setLevelAfter(res.grade_after);
      announce(
        `Text simplified. Reading level dropped from grade ${res.grade_before} to grade ${res.grade_after}.`
      );
    } catch {
      setSimpOut(
        "Could not reach the InclusionAI server. Make sure the backend is running, then try again."
      );
      setLevelBefore(null);
      setLevelAfter(null);
    } finally {
      setSimpBusy(false);
    }
  }, [simpIn, announce]);

  // ---- captions (F3): stop the teacher's microphone ----
  const stopRec = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onend = null;
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    setCapActive(false);
  }, []);

  // ---- captions (F3): close the live-captions WebSocket ----
  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    setWsStatus("idle");
    setPeers(0);
  }, []);

  // Open a WebSocket to the room, announce who we are, and resolve once connected.
  const connectWs = useCallback(
    (r: string, identityRole: Role, name: string) =>
      new Promise<WebSocket>((resolve, reject) => {
        setWsStatus("connecting");
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrlFor(r));
        } catch (e) {
          setWsStatus("idle");
          reject(e);
          return;
        }
        ws.onopen = () => {
          setWsStatus("connected");
          ws.send(JSON.stringify({ type: "hello", role: identityRole, name }));
          resolve(ws);
        };
        ws.onmessage = (ev) => {
          let msg: any;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg.type === "roster") {
            // Teacher's live list of joined students.
            setRoster(Array.isArray(msg.students) ? msg.students : []);
            setPeers(typeof msg.count === "number" ? msg.count : 0);
          } else if (msg.type === "caption") {
            // Incoming caption from the teacher (students only receive these).
            if (msg.final) {
              setCapFinal((prev) => (prev ? prev + " " : "") + String(msg.text).trim());
              setCapInterim("");
            } else {
              setCapInterim(String(msg.text));
            }
          } else if (msg.type === "clear") {
            setCapFinal("");
            setCapInterim("");
          }
        };
        ws.onerror = () => {
          /* surfaced via onclose */
        };
        ws.onclose = () => {
          setWsStatus("idle");
          setPeers(0);
          setRoster([]);
        };
        wsRef.current = ws;
      }),
    []
  );

  // ---- teacher: broadcast live captions (mic → WebSocket → students) ----
  const stopBroadcast = useCallback(() => {
    stopRec();
    closeWs();
    announce("Stopped broadcasting captions.");
  }, [stopRec, closeWs, announce]);

  const startBroadcast = useCallback(async () => {
    const SR: any =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setCapSupported(false);
      return;
    }
    let ws: WebSocket;
    try {
      ws = await connectWs(room, "teacher", "Teacher");
    } catch {
      setWsStatus("idle");
      announce("Could not connect to the class. Is the backend running?");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event: any) => {
      let interim = "";
      let finalAdd = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalAdd += r[0].transcript;
        else interim += r[0].transcript;
      }
      const send = (final: boolean, text: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "caption", final, text }));
        }
      };
      if (finalAdd) {
        const clean = finalAdd.trim();
        setCapFinal((prev) => (prev ? prev + " " : "") + clean);
        send(true, clean);
      }
      setCapInterim(interim);
      if (interim) send(false, interim);
    };
    rec.onerror = () => stopBroadcast();
    rec.onend = () => setCapActive(false);
    recognitionRef.current = rec;
    rec.start();
    setCapActive(true);
    announce("Class is live. Broadcasting captions to your students.");
    logUsage("F3", "broadcast_start", { room });
  }, [connectWs, room, announce, stopBroadcast]);

  // Generate a fresh, human-friendly class code (teacher "create class").
  const newClassCode = useCallback(() => {
    const suffix = Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase();
    setRoom(`CLASS-${suffix || "0000"}`);
    setRoster([]);
    announce("Created a new class code.");
  }, [announce]);

  // ---- student: join / leave the live class ----
  const joinClass = useCallback(async () => {
    setCapFinal("");
    setCapInterim("");
    try {
      await connectWs(room, "student", studentName.trim() || "Guest");
      announce("Joined the class. Captions will appear as the teacher speaks.");
      logUsage("F3", "join_class", { room });
    } catch {
      setWsStatus("idle");
      announce("Could not connect to the class. Is the backend running?");
    }
  }, [connectWs, room, studentName, announce]);

  const leaveClass = useCallback(() => {
    closeWs();
    announce("Left the class.");
  }, [closeWs, announce]);

  const clearCap = () => {
    setCapFinal("");
    setCapInterim("");
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "clear" }));
    }
  };

  const speakGuide = () =>
    speak(
      "Welcome to InclusionAI Learning Companion. This page adapts your class to how you learn. Press the Tab key to move between controls, and press Enter to activate one. Keyboard shortcuts: press R to read the lesson aloud. Press the space bar to pause or resume. Press S to stop. Press 1, 2, or 3 to switch between Read to me, Simplify, and Live captions. Press the plus or minus keys to change text size. Press the question mark key at any time to open the list of shortcuts.",
      "en" // the guide script is English regardless of the chosen read-aloud language
    );

  const completeOnboarding = useCallback(() => {
    setOnboarded(true);
    setShowOnboarding(false);
    announce(`Setup complete. Reading language ${langInfo(ttsLang).label}, joining as ${role}.`);
  }, [ttsLang, role, announce]);

  // ---- font / mode toggles ----
  const incFont = useCallback(
    () => setScale((s) => Math.min(1.6, +(s + 0.1).toFixed(2))),
    []
  );
  const decFont = useCallback(
    () => setScale((s) => Math.max(0.8, +(s - 0.1).toFixed(2))),
    []
  );

  // ---- detect browser support once, on mount ----
  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setCapSupported(!!SR);
    if (!("speechSynthesis" in window)) {
      setTtsMsg("Text-to-speech is not supported in this browser.");
    }
  }, []);

  // ---- restore saved settings from localStorage, once on mount ----
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        // Brand-new visitor — no stored settings at all → run onboarding.
        setOnboarded(false);
        setShowOnboarding(true);
        return;
      }
      const saved = JSON.parse(raw) as Partial<StoredSettings>;
      if (saved.tab === "read" || saved.tab === "simplify" || saved.tab === "captions") {
        setTab(saved.tab);
      }
      if (typeof saved.scale === "number") setScale(saved.scale);
      if (typeof saved.contrast === "boolean") setContrast(saved.contrast);
      if (typeof saved.dyslexia === "boolean") setDyslexia(saved.dyslexia);
      if (typeof saved.rate === "number") setRate(saved.rate);
      if (saved.ttsLang === "en" || saved.ttsLang === "bn" || saved.ttsLang === "ms") {
        setTtsLang(saved.ttsLang);
      }
      if (saved.role === "teacher" || saved.role === "student") setRole(saved.role);
      if (typeof saved.studentName === "string") setStudentName(saved.studentName);
      // First visit (or never completed setup) → show the onboarding overlay.
      if (!saved.onboarded) {
        setOnboarded(false);
        setShowOnboarding(true);
      }
    } catch {
      /* ignore corrupt/unavailable storage */
    } finally {
      settingsLoadedRef.current = true;
    }
  }, []);

  // ---- persist settings to localStorage whenever they change ----
  useEffect(() => {
    if (!settingsLoadedRef.current) return; // don't clobber stored values before load runs
    try {
      const settings: StoredSettings = { tab, scale, contrast, dyslexia, rate, ttsLang, role, onboarded, studentName };
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore unavailable storage (e.g. private mode) */
    }
  }, [tab, scale, contrast, dyslexia, rate, ttsLang, role, onboarded, studentName]);

  // ---- global keyboard shortcuts ----
  useEffect(() => {
    const editing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "Escape") {
        stopRead();
        announce("Stopped reading.");
        return;
      }
      if (editing(e)) return;
      const k = e.key.toLowerCase();
      if (k === "r") {
        e.preventDefault();
        speak(readText);
      } else if (k === " " || k === "spacebar" || k === "p") {
        e.preventDefault();
        if (speaking) pauseRead();
        else speak(readText);
      } else if (k === "s") {
        e.preventDefault();
        stopRead();
        announce("Stopped reading.");
      } else if (k === "1") {
        setTab("read");
        announce("Read to me and images.");
      } else if (k === "2") {
        setTab("simplify");
        announce("Simplify this.");
      } else if (k === "3") {
        setTab("captions");
        announce("Live captions.");
      } else if (k === "l") {
        // Teacher shortcut: toggle live-caption broadcasting.
        if (role === "teacher") {
          if (capActive) stopBroadcast();
          else startBroadcast();
        }
      } else if (e.key === "+" || e.key === "=") {
        incFont();
      } else if (e.key === "-" || e.key === "_") {
        decFont();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowKeys((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readText, speaking, speak, pauseRead, stopRead, role, capActive, startBroadcast, stopBroadcast, incFont, decFont, announce]);

  // ---- cleanup on unmount ----
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis && window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {
          /* ignore */
        }
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      const ws = wsRef.current;
      if (ws) {
        try {
          ws.onclose = null;
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // ---- derived values ----
  const fontPct = Math.round(scale * 100);
  const notSpeaking = !speaking;
  const connected = wsStatus === "connected";
  const capStatusColor = capActive
    ? "var(--red,#c62026)"
    : connected
    ? "#0a8f4c"
    : "var(--muted)";

  const rootStyle: React.CSSProperties = {
    fontSize: `${fontPct}%`,
    fontFamily: "var(--body)",
    color: "var(--text)",
    minHeight: "100vh",
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 18px",
    borderRadius: 16,
    border: active ? "2px solid var(--blue,#0b2e6b)" : "1.5px solid var(--border)",
    background: active ? "var(--blue,#0b2e6b)" : "var(--card)",
    color: active ? "#fff" : "var(--text)",
    boxShadow: active ? "0 6px 18px rgba(11,46,107,.25)" : "0 2px 10px rgba(11,46,107,.05)",
    textAlign: "left",
  });

  const panelStyle = (active: boolean): React.CSSProperties => ({
    display: active ? "block" : "none",
  });

  return (
    <div data-contrast={contrast} data-dyslexia={dyslexia} style={rootStyle}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 64px" }}>
        <a href="#tools" className="skip-link">
          Skip to lesson tools
        </a>
        <div role="status" aria-live="assertive" className="sr-only">
          {announceMsg}
        </div>

        {/* ---------- FIRST-LOAD ONBOARDING ---------- */}
        {showOnboarding && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboard-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              background: "rgba(5,12,30,.55)",
              backdropFilter: "blur(3px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                maxHeight: "90vh",
                overflowY: "auto",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 22,
                padding: "30px 30px 26px",
                boxShadow: "0 24px 60px rgba(5,12,30,.4)",
              }}
            >
              <div style={S.themePill}>★ Welcome to InclusionAI</div>
              <h2 id="onboard-title" style={{ ...S.h2, marginTop: 14 }}>
                Let&apos;s set up your Learning Companion
              </h2>
              <p style={{ ...S.lead, marginBottom: 22 }}>
                Choose how you&apos;d like to start. You can change these anytime.
              </p>

              <div style={{ ...S.label, marginBottom: 10 }}>Your language</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    aria-pressed={ttsLang === l.code}
                    onClick={() => setTtsLang(l.code)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "14px 18px",
                      borderRadius: 14,
                      border: ttsLang === l.code ? "2px solid var(--blue,#0b2e6b)" : "1.5px solid var(--border)",
                      background: ttsLang === l.code ? "var(--blue,#0b2e6b)" : "var(--card)",
                      color: ttsLang === l.code ? "#fff" : "var(--text)",
                      fontWeight: 700,
                      fontSize: "1.02em",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {l.label}
                    <span style={{ fontSize: ".74em", fontWeight: 600, opacity: 0.8 }}>
                      {l.piper ? "✨ neural voice" : "🔊 browser voice"}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ ...S.label, marginBottom: 10 }}>You are a…</div>
              <div style={{ display: "flex", gap: 12, marginBottom: 26 }}>
                {(["teacher", "student"] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                    style={{
                      flex: 1,
                      padding: "16px 14px",
                      borderRadius: 14,
                      border: role === r ? "2px solid var(--blue,#0b2e6b)" : "1.5px solid var(--border)",
                      background: role === r ? "var(--blue,#0b2e6b)" : "var(--card)",
                      color: role === r ? "#fff" : "var(--text)",
                      fontWeight: 700,
                      fontSize: "1.02em",
                      cursor: "pointer",
                    }}
                  >
                    {r === "teacher" ? "🎤 Teacher" : "🎧 Student"}
                  </button>
                ))}
              </div>

              <button type="button" onClick={completeOnboarding} style={{ ...S.btnPrimary, width: "100%", justifyContent: "center" }}>
                Start learning →
              </button>
            </div>
          </div>
        )}

        {/* ---------- HERO ---------- */}
        <header style={S.hero}>
          <div
            style={{
              position: "relative",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 22,
            }}
          >
            <div style={{ maxWidth: 640 }}>
              <div style={S.themePill}>★ Where Young Minds Meet AI · STEM Competition</div>
              <div style={{ display: "flex", alignItems: "center", gap: 15, marginTop: 17 }}>
                <span aria-hidden="true" style={S.heroLogo}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3l2.2 5.1L20 9l-4 3.6L17.2 20 12 16.9 6.8 20 8 12.6 4 9l5.8-.9L12 3z"
                      fill="#ff7a7e"
                    />
                  </svg>
                </span>
                <div>
                  <h1
                    style={{
                      fontFamily: "var(--display)",
                      fontSize: "2em",
                      fontWeight: 700,
                      margin: 0,
                      lineHeight: 1,
                      color: "#fff",
                    }}
                  >
                    InclusionAI
                  </h1>
                  <div
                    style={{
                      fontFamily: "var(--display)",
                      fontSize: "1.05em",
                      fontWeight: 600,
                      color: "#cfe0ff",
                      marginTop: 3,
                    }}
                  >
                    Learning Companion
                  </div>
                </div>
              </div>
              <p style={{ margin: "16px 0 0", fontSize: "1.08em", lineHeight: 1.5, color: "#cfe0ff", maxWidth: 540 }}>
                We don&apos;t just deliver content — we adapt it to the learner, in real time.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 210 }}>
              <div style={S.heroBadge}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "#4ade80",
                    boxShadow: "0 0 0 4px rgba(74,222,128,.22)",
                    flex: "none",
                  }}
                />
                Read-aloud &amp; captions on-device
              </div>
              <div style={S.heroBadge}>🛡️ WCAG 2.1 AA target</div>
              <div style={S.heroBadge}>✨ AI-powered simplify &amp; vision</div>
            </div>
          </div>
        </header>

        {/* ---------- ACCESSIBILITY BAR ---------- */}
        <div
          role="region"
          aria-label="Accessibility settings"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "10px 14px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "12px 16px",
            marginBottom: 22,
            boxShadow: "0 2px 12px rgba(11,46,107,.06)",
            position: "sticky",
            top: 10,
            zIndex: 20,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: ".82em",
              fontWeight: 700,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Accessibility
          </span>

          <div role="group" aria-label="Text size" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" aria-label="Decrease text size" onClick={decFont} style={S.toolBtn}>
              A−
            </button>
            <span aria-live="polite" style={{ fontSize: ".8em", fontWeight: 700, color: "var(--muted)", minWidth: 42, textAlign: "center" }}>
              {fontPct}%
            </span>
            <button type="button" aria-label="Increase text size" onClick={incFont} style={{ ...S.toolBtn, fontSize: "1.1em" }}>
              A+
            </button>
          </div>

          <span aria-hidden="true" style={{ width: 1, height: 26, background: "var(--border)" }} />

          <button
            type="button"
            role="switch"
            aria-checked={contrast}
            onClick={() => setContrast((v) => !v)}
            style={{ ...S.btnGhost, padding: "9px 14px", background: contrast ? "var(--blue,#0b2e6b)" : "var(--card)", color: contrast ? "#fff" : "var(--blue,#0b2e6b)" }}
          >
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid currentColor", background: contrast ? "#fff" : "transparent" }} />
            High contrast
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={dyslexia}
            onClick={() => setDyslexia((v) => !v)}
            style={{ ...S.btnGhost, padding: "9px 14px", background: dyslexia ? "var(--blue,#0b2e6b)" : "var(--card)", color: dyslexia ? "#fff" : "var(--blue,#0b2e6b)" }}
          >
            <span aria-hidden="true" style={{ fontFamily: "var(--dys-font)", fontWeight: 700 }}>
              Aa
            </span>
            Dyslexia-friendly font
          </button>

          <span aria-hidden="true" style={{ width: 1, height: 26, background: "var(--border)" }} />

          <button type="button" onClick={speakGuide} style={{ ...S.btnGhost, padding: "9px 14px" }}>
            <Speaker />
            Listen to guide
          </button>
          <button type="button" aria-expanded={showKeys} onClick={() => setShowKeys((v) => !v)} style={{ ...S.btnGhost, padding: "9px 14px" }}>
            ⌨ Shortcuts
          </button>
          <button type="button" onClick={() => setShowOnboarding(true)} style={{ ...S.btnGhost, padding: "9px 14px" }}>
            ⚙ Language &amp; role
          </button>
        </div>

        {/* ---------- SHORTCUTS PANEL ---------- */}
        {showKeys && (
          <div
            role="region"
            aria-label="Keyboard shortcuts"
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", marginBottom: 20 }}
          >
            <h2 style={{ fontFamily: "var(--display)", fontSize: "1.05em", fontWeight: 700, margin: "0 0 14px", color: "var(--text)" }}>
              Keyboard &amp; screen-reader shortcuts
            </h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "10px 22px", margin: 0 }}>
              {[
                [["R"], "Read the lesson aloud"],
                [["Space"], "Pause or resume reading"],
                [["S", "Esc"], "Stop reading"],
                [["1", "2", "3"], "Switch between tools"],
                [["L"], "Teacher: start / stop broadcasting"],
                [["+", "−"], "Increase / decrease text size"],
                [["?"], "Show or hide this list"],
                [["Tab"], "Move focus · Enter activates"],
              ].map(([keys, desc], i) => (
                <div key={i} style={S.keyRow}>
                  <span style={{ display: "flex", gap: 4 }}>
                    {(keys as string[]).map((kk) => (
                      <kbd key={kk} style={S.kbd}>
                        {kk}
                      </kbd>
                    ))}
                  </span>
                  <span>{desc as string}</span>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* ---------- LIVE STREAM BAR ---------- */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "12px 16px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            padding: "12px 18px",
            marginBottom: 20,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: ".76em",
              fontWeight: 800,
              letterSpacing: ".07em",
              color: "#fff",
              background: "var(--red,#c62026)",
              padding: "6px 12px",
              borderRadius: 999,
            }}
          >
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", animation: "rec-pulse 1.1s infinite" }} />
            LIVE
          </span>
          <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.04em", color: "var(--text)" }}>
            Biology · Photosynthesis
          </span>
          <span style={{ color: "var(--muted)", fontSize: ".9em" }}>Streamed live to your device</span>
        </div>

        {/* ---------- TABS ---------- */}
        <nav id="tools" aria-label="Learning tools" role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 22 }}>
          <button type="button" role="tab" aria-selected={tab === "read"} onClick={() => setTab("read")} style={tabStyle(tab === "read")}>
            <Speaker />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: "1.02em" }}>Read-to-Me &amp; Images</span>
              <span style={{ fontSize: ".78em", fontWeight: 600, opacity: 0.72 }}>Blind &amp; low-vision</span>
            </span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "simplify"} onClick={() => setTab("simplify")} style={tabStyle(tab === "simplify")}>
            <span aria-hidden="true" style={{ fontWeight: 800 }}>✦</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: "1.02em" }}>Simplify-This</span>
              <span style={{ fontSize: ".78em", fontWeight: 600, opacity: 0.72 }}>Dyslexia, autism &amp; more</span>
            </span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "captions"} onClick={() => setTab("captions")} style={tabStyle(tab === "captions")}>
            <span aria-hidden="true" style={{ fontWeight: 800 }}>CC</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: "1.02em" }}>Live Captions</span>
              <span style={{ fontSize: ".78em", fontWeight: 600, opacity: 0.72 }}>Deaf &amp; hard-of-hearing</span>
            </span>
          </button>
        </nav>

        {/* ---------- F1: READ-TO-ME ---------- */}
        <section role="tabpanel" aria-label="Read to me and images" style={panelStyle(tab === "read")}>
          <div style={S.card}>
            <div style={S.cardHead}>
              <span aria-hidden="true" style={S.iconChip}>
                <Speaker />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.eyebrow}>For blind &amp; low-vision learners</div>
                <h2 style={S.h2}>Read-to-Me</h2>
                <p style={S.lead}>
                  Have any text read aloud in English or Bangla with natural Piper neural voices — or Bahasa Malaysia via your browser — at an adjustable speed. Pause and resume anytime.
                </p>
              </div>
            </div>
            <label htmlFor="readbox" style={S.label}>
              Lesson text (from the class stream)
            </label>
            <textarea id="readbox" value={readText} onChange={(e) => setReadText(e.target.value)} rows={5} style={S.textarea} />

            {/* voice language picker */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 16 }}>
              <span style={{ fontSize: ".86em", fontWeight: 700, color: "var(--muted)" }}>Voice language</span>
              <div role="group" aria-label="Read-aloud language" style={{ display: "inline-flex", flexWrap: "wrap", borderRadius: 12, border: "1.5px solid var(--border)", overflow: "hidden" }}>
                {LANGS.map((l, i) => (
                  <button
                    key={l.code}
                    type="button"
                    aria-pressed={ttsLang === l.code}
                    onClick={() => {
                      setTtsLang(l.code);
                      stopRead();
                    }}
                    style={{
                      padding: "8px 14px",
                      border: "none",
                      borderLeft: i === 0 ? "none" : "1.5px solid var(--border)",
                      fontWeight: 700,
                      fontSize: ".9em",
                      cursor: "pointer",
                      background: ttsLang === l.code ? "var(--blue,#0b2e6b)" : "var(--card)",
                      color: ttsLang === l.code ? "#fff" : "var(--text)",
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: ".78em", fontWeight: 600, color: "var(--muted)" }}>
                {langInfo(ttsLang).piper ? "✨ Piper neural voice" : "🔊 Browser voice"}
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 14 }}>
              <button type="button" onClick={playRead} style={S.btnPrimary}>
                <Speaker />
                {speaking && !paused ? "Reading…" : "Read Aloud"}
              </button>
              <button type="button" onClick={pauseRead} disabled={notSpeaking} style={{ ...S.btnGhost, opacity: notSpeaking ? 0.5 : 1 }}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" onClick={stopRead} style={S.btnGhost}>
                Stop
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
                <label htmlFor="rate" style={{ fontSize: ".86em", fontWeight: 700, color: "var(--muted)" }}>
                  Speed
                </label>
                <input id="rate" type="range" min={0.5} max={1.8} step={0.1} value={rate} onChange={onRate} aria-label="Reading speed" style={{ width: 160 }} />
                <span aria-live="polite" style={{ fontSize: ".86em", fontWeight: 700, minWidth: 42 }}>
                  {rate.toFixed(1)}×
                </span>
              </div>
            </div>
            {ttsMsg && (
              <div aria-live="polite" style={{ marginTop: 14, fontSize: ".9em", fontWeight: 700, color: "var(--blue,#0b2e6b)" }}>
                {ttsMsg}
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={S.cardHead}>
              <span aria-hidden="true" style={S.iconChip}>
                🖼️
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.eyebrow}>Image explainer</div>
                <h2 style={S.h2}>Describe an image, out loud</h2>
                <p style={S.lead}>
                  Upload an image and AI vision describes what&apos;s in it — then have that description read aloud, turning any picture into spoken words.
                </p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: imgUrl ? "1fr 1fr" : "1fr 1fr", gap: 20, alignItems: "start" }}>
              <div>
                <label htmlFor="imgfile" style={S.label}>
                  Image
                </label>
                <label
                  htmlFor="imgfile"
                  className="uploader"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    textAlign: "center",
                    padding: "26px 18px",
                    borderRadius: 16,
                    border: "2px dashed var(--border)",
                    background: "var(--chip)",
                    cursor: "pointer",
                    color: "var(--text)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 13,
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      color: "var(--blue,#0b2e6b)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    ⬆
                  </span>
                  <span style={{ fontWeight: 700, fontSize: ".96em" }}>Click to upload an image</span>
                  <span style={{ fontSize: ".82em", color: "var(--muted)" }}>
                    PNG, JPG or any picture · described by AI
                  </span>
                  <input id="imgfile" type="file" accept="image/*" onChange={onImage} aria-label="Upload an image to describe" className="sr-only" />
                </label>
                {imgUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgUrl} alt="Uploaded preview" style={{ marginTop: 14, width: "100%", borderRadius: 14, border: "1px solid var(--border)" }} />
                )}
              </div>
              <div>
                <label htmlFor="descbox" style={S.label}>
                  AI description
                </label>
                <textarea
                  id="descbox"
                  value={imgDescBusy ? "Looking at your image…" : imgDesc}
                  onChange={(e) => setImgDesc(e.target.value)}
                  rows={6}
                  placeholder="Upload an image and the AI will describe it here…"
                  aria-busy={imgDescBusy}
                  style={S.textarea}
                />
                {imgDescMsg && (
                  <div aria-live="polite" style={{ marginTop: 10, fontSize: ".9em", fontWeight: 700, color: "var(--red,#c62026)" }}>
                    {imgDescMsg}
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
                  <button type="button" onClick={() => speak(imgDesc)} disabled={!imgDesc || imgDescBusy} style={{ ...S.btnPrimary, opacity: !imgDesc || imgDescBusy ? 0.5 : 1 }}>
                    <Speaker />
                    Read description
                  </button>
                  <button type="button" onClick={() => imgUrl && describeUploadedImage(imgUrl)} disabled={!imgUrl || imgDescBusy} style={{ ...S.btnGhost, opacity: !imgUrl || imgDescBusy ? 0.5 : 1 }}>
                    {imgDescBusy ? "Describing…" : "Describe again"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- F2: SIMPLIFY ---------- */}
        <section role="tabpanel" aria-label="Simplify this" style={panelStyle(tab === "simplify")}>
          <div style={S.card}>
            <div style={S.cardHead}>
              <span aria-hidden="true" style={S.iconChip}>
                ✦
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.eyebrow}>For dyslexia, autism &amp; slow-reading learners</div>
                <h2 style={S.h2}>Simplify-This</h2>
                <p style={S.lead}>
                  Turn dense text into short, plain sentences. Simplified on the InclusionAI server, with a live reading-level score.
                </p>
              </div>
            </div>
            <label htmlFor="simpin" style={S.label}>
              Original text
            </label>
            <textarea id="simpin" value={simpIn} onChange={(e) => setSimpIn(e.target.value)} rows={5} style={S.textarea} />
            <div style={{ marginTop: 16 }}>
              <button type="button" onClick={doSimplify} disabled={simpBusy} style={{ ...S.btnPrimary, opacity: simpBusy ? 0.6 : 1 }}>
                ✦ {simpBusy ? "Simplifying…" : "Simplify"}
              </button>
            </div>

            {simpOut && (
              <div style={{ marginTop: 22 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ ...S.label, margin: 0 }}>Simplified</div>
                  {levelBefore != null && levelAfter != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", fontSize: ".84em", fontWeight: 700 }}>
                      <span style={{ color: "var(--muted)" }}>Reading level</span>
                      <span style={S.gradeChip("before")}>Grade {levelBefore}</span>
                      <span aria-hidden="true" style={{ color: "var(--muted)" }}>
                        →
                      </span>
                      <span style={S.gradeChip("after")}>Grade {levelAfter}</span>
                    </div>
                  )}
                </div>
                <div
                  aria-live="polite"
                  style={{
                    fontFamily: "var(--dys-font)",
                    letterSpacing: ".03em",
                    wordSpacing: ".08em",
                    lineHeight: 1.9,
                    fontSize: "1.08em",
                    background: "var(--chip)",
                    border: "1px solid var(--border)",
                    borderLeft: "6px solid var(--red,#c62026)",
                    borderRadius: 14,
                    padding: "20px 22px",
                  }}
                >
                  {simpOut}
                </div>
                <button type="button" onClick={() => speak(simpOut)} style={{ ...S.btnGhost, marginTop: 16 }}>
                  <Speaker />
                  Read simplified aloud
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ---------- F3: LIVE CAPTIONS ---------- */}
        <section role="tabpanel" aria-label="Live captions" style={panelStyle(tab === "captions")}>
          <div style={S.card}>
            <div style={S.cardHead}>
              <span aria-hidden="true" style={S.iconChip}>
                CC
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.eyebrow}>{role === "teacher" ? "Teacher · run your class" : "For deaf & hard-of-hearing learners"}</div>
                <h2 style={S.h2}>{role === "teacher" ? "Broadcast Live Captions" : "Live Class Captions"}</h2>
                <p style={S.lead}>
                  {role === "teacher"
                    ? "Create a class, start speaking, and your words are captioned on your device and streamed live to every student who joins — while you watch them arrive."
                    : "Join your teacher's class with the code they share, and their words appear live in large, high-contrast text."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                disabled={connected || capActive}
                style={{ ...S.btnGhost, padding: "8px 12px", fontSize: ".82em", opacity: connected || capActive ? 0.5 : 1 }}
              >
                {role === "teacher" ? "🎤 Teacher" : "🎧 Student"} · change
              </button>
            </div>

            {role === "teacher" ? (
              /* ===================== TEACHER VIEW ===================== */
              <>
                {/* class code + status */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14, marginBottom: 16 }}>
                  <div>
                    <label htmlFor="roomcode" style={{ ...S.label, marginBottom: 6 }}>
                      Class code (share with students)
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        id="roomcode"
                        value={room}
                        onChange={(e) => setRoom(e.target.value.toUpperCase())}
                        disabled={connected || capActive}
                        aria-label="Class code"
                        style={{ ...S.input, width: 150, fontSize: "1.1em", letterSpacing: ".06em" }}
                      />
                      <button
                        type="button"
                        onClick={newClassCode}
                        disabled={connected || capActive}
                        style={{ ...S.btnGhost, padding: "9px 14px", opacity: connected || capActive ? 0.5 : 1 }}
                      >
                        ♺ New code
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: ".9em", fontWeight: 700, color: capStatusColor }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: capStatusColor }} />
                    {capActive ? "Class is LIVE" : connected ? "Class open" : "Not started"}
                  </div>
                </div>

                {/* start / stop / clear */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 18 }}>
                  <button
                    type="button"
                    onClick={capActive ? stopBroadcast : startBroadcast}
                    disabled={!capSupported || wsStatus === "connecting"}
                    style={{ ...S.btnPrimary, background: capActive ? "var(--red,#c62026)" : undefined, opacity: !capSupported ? 0.5 : 1 }}
                  >
                    {capActive ? "■ End class" : "🔴 Start class"}
                  </button>
                  <button type="button" onClick={clearCap} disabled={!capActive} style={{ ...S.btnGhost, opacity: capActive ? 1 : 0.5 }}>
                    Clear captions
                  </button>
                </div>

                {!capSupported && (
                  <div role="note" style={{ background: "var(--chip)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", fontSize: ".88em", color: "var(--text)", marginBottom: 16 }}>
                    Broadcasting needs on-device speech recognition — use <strong>Chrome or Edge on desktop</strong>. Students can join in any browser.
                  </div>
                )}

                {/* roster + live caption preview */}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)", gap: 16, alignItems: "stretch" }}>
                  {/* roster */}
                  <div style={{ background: "var(--chip)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1.02em", color: "var(--text)" }}>
                        Students
                      </span>
                      <span style={{ fontSize: ".78em", fontWeight: 800, color: "#fff", background: "var(--blue,#0b2e6b)", borderRadius: 999, padding: "3px 10px" }}>
                        {peers}
                      </span>
                    </div>
                    {roster.length === 0 ? (
                      <p style={{ margin: 0, fontSize: ".86em", color: "var(--muted)", lineHeight: 1.5 }}>
                        No students yet. Share the code{" "}
                        <strong style={{ color: "var(--text)" }}>{room || "…"}</strong> so they can join.
                      </p>
                    ) : (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                        {roster.map((name, i) => (
                          <li key={`${name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: ".94em", fontWeight: 600, color: "var(--text)" }}>
                            <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--blue,#0b2e6b)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: ".8em", fontWeight: 800, flex: "none" }}>
                              {(name || "?").slice(0, 1).toUpperCase()}
                            </span>
                            {name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* live caption preview (what students see) */}
                  <div aria-live="polite" style={{ minHeight: 160, background: "#05132e", border: "1px solid var(--border)", borderRadius: 16, padding: "22px 26px", display: "flex", alignItems: "center" }}>
                    <p style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 600, fontSize: "1.7em", lineHeight: 1.35, color: "#ffffff" }}>
                      {capFinal ? <span>{capFinal} </span> : null}
                      {capInterim ? <span style={{ color: "#9fc0ff" }}>{capInterim}</span> : null}
                      {!capFinal && !capInterim && (
                        <span style={{ color: "#5b78b8", fontSize: ".8em" }}>
                          Press <strong style={{ color: "#9fc0ff" }}>Start class</strong> and begin speaking — your students see this live.
                        </span>
                      )}
                      {capActive && <span style={{ animation: "caret-blink 1s step-end infinite", color: "#9fc0ff" }}> ▌</span>}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              /* ===================== STUDENT VIEW ===================== */
              <>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14, marginBottom: 16 }}>
                  <div>
                    <label htmlFor="studentname" style={{ ...S.label, marginBottom: 6 }}>
                      Your name
                    </label>
                    <input
                      id="studentname"
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      disabled={connected}
                      placeholder="e.g. Shagato"
                      aria-label="Your name"
                      style={{ ...S.input, width: 180 }}
                    />
                  </div>
                  <div>
                    <label htmlFor="roomcode" style={{ ...S.label, marginBottom: 6 }}>
                      Class code
                    </label>
                    <input
                      id="roomcode"
                      value={room}
                      onChange={(e) => setRoom(e.target.value.toUpperCase())}
                      disabled={connected}
                      aria-label="Class code"
                      style={{ ...S.input, width: 150, letterSpacing: ".06em" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={connected ? leaveClass : joinClass}
                    disabled={wsStatus === "connecting" || (!connected && !room.trim())}
                    style={{ ...S.btnPrimary, background: connected ? "var(--red,#c62026)" : undefined }}
                  >
                    {connected ? "■ Leave class" : "▶ Join class"}
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: ".9em", fontWeight: 700, color: capStatusColor }}>
                    <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: capStatusColor }} />
                    {connected ? "In class" : wsStatus === "connecting" ? "Connecting…" : "Not joined"}
                  </div>
                </div>

                {/* caption display */}
                <div aria-live="assertive" style={{ minHeight: 180, background: "#05132e", border: "1px solid var(--border)", borderRadius: 16, padding: "26px 32px", display: "flex", alignItems: "center" }}>
                  <p style={{ margin: 0, fontFamily: "var(--display)", fontWeight: 600, fontSize: "2.1em", lineHeight: 1.3, color: "#ffffff" }}>
                    {capFinal ? <span>{capFinal} </span> : null}
                    {capInterim ? <span style={{ color: "#9fc0ff" }}>{capInterim}</span> : null}
                    {!capFinal && !capInterim && (
                      <span style={{ color: "#5b78b8" }}>
                        {connected ? (
                          <>Waiting for your teacher to speak…</>
                        ) : (
                          <>
                            Enter your teacher&apos;s code and press <strong style={{ color: "#9fc0ff" }}>Join class</strong>.
                          </>
                        )}
                      </span>
                    )}
                    {connected && <span style={{ animation: "caret-blink 1s step-end infinite", color: "#9fc0ff" }}> ▌</span>}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ---------- FOOTER ---------- */}
        <footer style={{ marginTop: 34, paddingTop: 24, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: "12px 20px", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <span style={S.footBadge}>OpenAI vision + text</span>
            <span style={S.footBadge}>Web Speech API</span>
            <span style={S.footBadge}>FastAPI + PostgreSQL</span>
            <span style={S.footBadge}>Keyboard accessible</span>
            <span style={S.footBadge}>WCAG 2.1 AA</span>
          </div>
          <span style={{ fontSize: ".84em", color: "var(--muted)", maxWidth: 440, textAlign: "right" }}>
            Read-Aloud &amp; Captions run on your device; Simplify &amp; image description are powered by AI on the InclusionAI server.
          </span>
        </footer>
      </div>
    </div>
  );
}
