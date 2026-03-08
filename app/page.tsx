"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import Image from "next/image";
import type { ClarifyingQuestion, RankedBusiness } from "@/lib/gemini";

const donnaImg = "/images/donna.png";

type Phase = "idle" | "clarifying" | "searching" | "ranking" | "working" | "done" | "error";
type View = "home" | "donna" | "calendar" | "activity" | "profile" | "settings";

interface UserProfile {
  name: string;
  location: string;
  hairType: string;
  budget: string;
  notes: string;
}

const PROFILE_KEY = "donna_user_profile";
function loadProfile(): UserProfile {
  if (typeof window === "undefined") return { name: "", location: "", hairType: "", budget: "", notes: "" };
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { return { name: "", location: "", hairType: "", budget: "", notes: "" }; }
}
function saveProfile(p: UserProfile) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

interface BusinessUpdate {
  name: string;
  status: string;
  detail: string;
  url?: string;
  callId?: string;
  scheduledTime?: string;
  timestamp: Date;
}

interface CallRecord {
  businessName: string;
  timeWindow?: string;
  callId?: string;
  transcript?: string;
  summary?: string;
  time: string;
}

type ChatMessage =
  | { type: "user"; text: string; time: string }
  | { type: "donna"; text: string; time: string }
  | { type: "working"; text: string }
  | { type: "clarify"; questions: ClarifyingQuestion[] }
  | { type: "confirm_delete"; filter: string; events: Array<{ id: string; summary: string; start: string }> }
  | { type: "businesses"; businesses: RankedBusiness[]; updates: BusinessUpdate[] };

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

const iconPaths: Record<string, string> = {
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  email: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  calendar: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z",
  activity: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  help: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
};

function NavBtn({ icon, active, onClick, title, size = 19 }: { icon: string; active: boolean; onClick: () => void; title: string; size?: number }) {
  return (
    <button className={`ni${active ? " active" : ""}`} onClick={onClick} title={title} type="button">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
        <path d={iconPaths[icon]} />
      </svg>
    </button>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [phase, setPhase] = useState<Phase>("idle");
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const rankedRef = useRef<RankedBusiness[]>([]);
  const [updates, setUpdates] = useState<BusinessUpdate[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [wakeTriggered, setWakeTriggered] = useState(false);
  const [toastText, setToastText] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ name: "", location: "", hairType: "", budget: "", notes: "" });
  useEffect(() => { setProfile(loadProfile()); }, []);
  interface CalEvent { id: string; summary: string; start: string; end: string; }
  const [homeEvents, setHomeEvents] = useState<CalEvent[]>([]);
  const [homeEventsLoading, setHomeEventsLoading] = useState(false);
  useEffect(() => {
    if (view !== "home") return;
    setHomeEventsLoading(true);
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    fetch(`/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`)
      .then(r => r.json())
      .then(data => { if (data.events) setHomeEvents(data.events); })
      .catch(() => {})
      .finally(() => setHomeEventsLoading(false));
  }, [view]);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wakeRecognitionRef = useRef<{ stop(): void } | null>(null);
  const listeningRef = useRef(false);
  const wakeJustFiredRef = useRef(false); // prevents wake rec from restarting while main mic is starting
  const phaseRef = useRef<Phase>("idle");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toggleMicRef = useRef<() => void>(() => {});
  const msgEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, updates]);

  // Keep refs in sync so wake-word callbacks see fresh values
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // When wake word fires, start the main mic
  useEffect(() => {
    if (!wakeTriggered) return;
    setWakeTriggered(false);
    setView("donna");
    showToast("Hey! I'm listening…");
    // Delay so Chrome fully releases the wake rec's mic before we start the main mic
    setTimeout(() => toggleMicRef.current(), 600);
  }, [wakeTriggered]);

  // Background wake-word listener — runs while voiceOn
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!voiceOn || !SR) {
      wakeRecognitionRef.current?.stop();
      setWakeActive(false);
      return;
    }

    let active = true;

    function startWake() {
      if (!active) return;
      if (listeningRef.current || wakeJustFiredRef.current) {
        // Main mic is active or just triggered — wait and retry
        setTimeout(startWake, 1200);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = new SR() as any;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = String(e.results[i][0].transcript).toLowerCase();
          if (t.includes("hey donna") || t.includes("hey, donna")) {
            rec.stop();
            setWakeActive(false);
            if (!listeningRef.current && (phaseRef.current === "idle" || phaseRef.current === "done" || phaseRef.current === "error")) {
              wakeJustFiredRef.current = true;
              setTimeout(() => { if (active) setWakeTriggered(true); }, 250);
            }
            return;
          }
        }
      };

      // Let onend handle all restarts
      rec.onerror = () => {};

      rec.onend = () => {
        setWakeActive(false);
        // If wake word just fired, hold longer so main mic can fully initialize before we try to restart
        const delay = wakeJustFiredRef.current ? 2500 : listeningRef.current ? 1500 : 700;
        if (active) setTimeout(startWake, delay);
      };

      wakeRecognitionRef.current = rec;
      try {
        rec.start();
        setWakeActive(true);
      } catch {
        setTimeout(startWake, 1000);
      }
    }

    startWake();

    return () => {
      active = false;
      wakeRecognitionRef.current?.stop();
      setWakeActive(false);
    };
  }, [voiceOn]);

  function showToast(msg: string) {
    setToastText(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3200);
  }

  function appendMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateBusinessesMsg(newRanked: RankedBusiness[], newUpdates: BusinessUpdate[]) {
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.type === "businesses");
      if (idx === -1) return [...prev, { type: "businesses", businesses: newRanked, updates: newUpdates }];
      const actualIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[actualIdx] = { type: "businesses", businesses: newRanked, updates: newUpdates };
      return next;
    });
  }

  function removeWorking() {
    setMessages((prev) => prev.filter((m) => m.type !== "working"));
  }

  function getLatestUpdate(name: string, allUpdates: BusinessUpdate[]) {
    return [...allUpdates].reverse().find((u) => u.name === name);
  }

  async function handleSend(overrideText?: string) {
    unlockAudio();
    const q = (overrideText ?? inputVal).trim();
    if (!q || phase === "searching" || phase === "ranking" || phase === "working") return;

    // If a clarify card is showing, treat the typed message as the time answer
    if (phase === "clarifying") {
      setInputVal("");
      appendMessage({ type: "user", text: q, time: ts() });
      handleAnswers({ time: q });
      return;
    }
    setInputVal("");
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    setQuery(q);
    setPhase("searching");
    rankedRef.current = [];
    setUpdates([]);
    appendMessage({ type: "user", text: q, time: ts() });
    appendMessage({ type: "working", text: "Donna's thinking..." });

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, userProfile: profile }),
      });

      // If the route returned SSE (it had enough info to go straight to search), handle it inline
      if (res.headers.get("Content-Type")?.includes("text/event-stream")) {
        if (!res.body) throw new Error("No stream");
        setPhase("working");
        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try { handleSSEEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
        return;
      }

      const data = await res.json() as { questions?: ClarifyingQuestion[]; error?: string; done?: boolean; message?: string; confirmDelete?: { filter: string; events: Array<{ id: string; summary: string; start: string }> } };

      if (data.error) {
        removeWorking();
        setPhase("error");
        appendMessage({ type: "donna", text: data.error, time: ts() });
        return;
      }

      if (data.done && data.message) {
        removeWorking();
        setPhase("done");
        appendMessage({ type: "donna", text: data.message, time: ts() });
        if (voiceOn) speakText(data.message);
        return;
      }

      if (data.confirmDelete) {
        removeWorking();
        setPhase("clarifying");
        appendMessage({ type: "confirm_delete", filter: data.confirmDelete.filter, events: data.confirmDelete.events });
        const names = data.confirmDelete.events.map(e => e.summary).join(", ");
        if (voiceOn) speakText(`I found ${data.confirmDelete.events.length} event${data.confirmDelete.events.length === 1 ? "" : "s"}: ${names}. Should I delete them?`);
        return;
      }

      if (data.questions && data.questions.length > 0) {
        removeWorking();
        setPhase("clarifying");
        appendMessage({ type: "clarify", questions: data.questions });
        if (voiceOn) speakText(data.questions[0].question);
        return;
      }
      // Fallthrough — questions was empty (e.g. AI skipped them) but nothing else came back
      removeWorking();
      setPhase("clarifying");
      appendMessage({ type: "clarify", questions: [{ id: "location", icon: "📍", label: "Location", question: "Where are you located? I need this to search nearby.", inputType: "location" }] });
    } catch {
      removeWorking();
      setPhase("error");
      appendMessage({ type: "donna", text: "Something went wrong. Try again.", time: ts() });
    }
  }

  async function handleConfirmDelete(filter: string, originalQuery: string) {
    setMessages(prev => prev.filter(m => m.type !== "confirm_delete"));
    setPhase("searching");
    appendMessage({ type: "working", text: "Deleting events..." });
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: originalQuery, userProfile: profile, confirmedDelete: { filter } }),
      });
      const data = await res.json() as { done?: boolean; message?: string; error?: string };
      removeWorking();
      setPhase("done");
      const msg = data.message ?? data.error ?? "Done.";
      appendMessage({ type: "donna", text: msg, time: ts() });
      if (voiceOn) speakText(msg);
    } catch {
      removeWorking();
      setPhase("error");
      appendMessage({ type: "donna", text: "Something went wrong. Try again.", time: ts() });
    }
  }

  function handleCancelDelete() {
    setMessages(prev => prev.filter(m => m.type !== "confirm_delete"));
    setPhase("idle");
    const msg = "Got it — nothing was deleted.";
    appendMessage({ type: "donna", text: msg, time: ts() });
    if (voiceOn) speakText(msg);
  }

  async function handleAnswers(answers: Record<string, string>) {
    setPhase("searching");
    setMessages((prev) => prev.filter((m) => m.type !== "clarify"));
    appendMessage({ type: "working", text: "Donna's scanning the web..." });

    const prefs = {
      location: answers["location"] ?? "",
      date: answers["date"],
      timeWindow: answers["time"] ?? answers["timeWindow"] ?? answers[Object.keys(answers)[0]],
      budget: answers["budget"],
      radius: answers["radius"],
      ...answers,
    };

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, prefs, userProfile: profile }),
      });

      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { handleSSEEvent(JSON.parse(line.slice(6))); } catch {}
        }
      }
    } catch {
      removeWorking();
      setPhase("error");
      appendMessage({ type: "donna", text: "Connection lost. Try again.", time: ts() });
    }
  }

  function handleSSEEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case "status":
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === "working") {
            const next = [...prev];
            next[next.length - 1] = { type: "working", text: event.message as string };
            return next;
          }
          return [...prev, { type: "working", text: event.message as string }];
        });
        break;

      case "ranked": {
        const businesses = event.businesses as RankedBusiness[];
        rankedRef.current = businesses;
        setPhase("working");
        setMessages((prev) => {
          const next = prev.filter((m) => m.type !== "working");
          return [...next, { type: "businesses", businesses, updates: [] }];
        });
        break;
      }

      case "business_update": {
        const newUpdate: BusinessUpdate = {
          name: event.name as string,
          status: event.status as string,
          detail: event.detail as string,
          url: event.url as string | undefined,
          callId: event.callId as string | undefined,
          scheduledTime: event.scheduledTime as string | undefined,
          timestamp: new Date(),
        };
        setUpdates((prev) => {
          const next = [...prev, newUpdate];
          updateBusinessesMsg(rankedRef.current, next);
          return next;
        });
        if (event.status === "calling") showToast(`Calling ${event.name as string}...`);
        if (event.status === "booked" || event.status === "booked_online") showToast(`Booked at ${event.name as string}!`);
        break;
      }

      case "done": {
        removeWorking();
        setPhase("done");
        if (event.businessName) {
          setCallRecords(prev => {
            const name = event.businessName as string;
            // call_result may have already created this record with transcript — don't overwrite
            if (prev.some(r => r.businessName === name)) return prev;
            return [...prev, {
              businessName: name,
              timeWindow: event.timeWindow as string | undefined,
              time: ts(),
            }];
          });
        }
        break;
      }

      case "call_result": {
        const summary = event.summary as string;
        const name = event.name as string;
        const callId = event.callId as string;
        const transcript = event.transcript as string;
        appendMessage({ type: "donna", text: summary, time: ts() });
        if (voiceOn) speakText(summary);
        setCallRecords(prev => {
          const exists = prev.some(r => r.businessName === name);
          if (exists) return prev.map(r => r.businessName === name ? { ...r, callId, transcript, summary } : r);
          return [...prev, { businessName: name, callId, transcript, summary, time: ts() }];
        });
        break;
      }

      case "error":
        removeWorking();
        setPhase("error");
        appendMessage({ type: "donna", text: event.message as string, time: ts() });
        break;
    }
  }

  // Call once on any user gesture to satisfy browser autoplay policy
  function unlockAudio() {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    const a = new Audio();
    a.play().catch(() => {});
  }

  async function speakText(text: string) {
    // Stop any currently playing audio before starting new
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
      setVoiceSpeaking(false);
    }
    try {
      setVoiceSpeaking(true);
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("voice error");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => { setVoiceSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; });
      audio.onended = () => { setVoiceSpeaking(false); URL.revokeObjectURL(url); audioRef.current = null; };
    } catch { setVoiceSpeaking(false); }
  }

  function clearChat() {
    if (readerRef.current) readerRef.current.cancel();
    setPhase("idle");
    setQuery("");
    setMessages([]);
    rankedRef.current = [];
    setUpdates([]);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function toggleMic() {
    unlockAudio();
    if (listening) {
      mediaRecorderRef.current?.stop();
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: BlobPart[] = [];

      // Silence detection via AudioContext analyser
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let hasSpeech = false;

      const checkSilence = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        if (avg > 8) {
          hasSpeech = true;
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        } else if (hasSpeech && !silenceTimer) {
          silenceTimer = setTimeout(() => { mediaRecorder.stop(); }, 2200);
        }
      }, 100);

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      mediaRecorder.onstop = async () => {
        clearInterval(checkSilence);
        if (silenceTimer) clearTimeout(silenceTimer);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();
        wakeJustFiredRef.current = false;
        setListening(false);
        if (!hasSpeech || chunks.length === 0) return;

        setInputVal("Transcribing...");
        const blob = new Blob(chunks, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "audio.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json() as { text?: string };
          if (data.text?.trim()) {
            setInputVal(data.text.trim());
            handleSend(data.text.trim());
          } else {
            setInputVal("");
          }
        } catch {
          setInputVal("");
          showToast("Transcription failed. Try again.");
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setListening(true);
    }).catch((err: unknown) => {
      wakeJustFiredRef.current = false;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not-allowed") || msg.includes("Permission")) showToast("Microphone blocked — allow mic access in browser settings.");
      else showToast("Could not access microphone.");
    });

  }
  // Keep ref fresh every render so wake effect can call it without stale closure
  toggleMicRef.current = toggleMic;

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputVal(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 90) + "px";
  }

  function useCmd(text: string) {
    setInputVal(text);
    setView("donna");
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  const busy = phase === "searching" || phase === "ranking" || phase === "working";
  const calUrl = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_EMBED_URL
    ?? "https://calendar.google.com/calendar/embed?src=en.usa%23holiday%40group.v.calendar.google.com&ctz=America%2FNew_York&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=0&showCalendars=0&showTz=0&mode=MONTH";

  const donnaPanel = (compact: boolean) => (
    <div className={`donna-panel${compact ? " compact" : ""}`}>
      <button className="donna-more" type="button">···</button>
      <div className="donna-hero">
        <div className="d-avatar-wrap">
          <Image src={donnaImg} alt="Donna" className="d-avatar-img" width={110} height={110} priority />
        </div>
        <div className="d-name">Donna</div>
      </div>
      <div className="donna-chat">
        <div className="chat-msgs">
          {messages.length === 0 ? (
            <div className="donna-empty">
              <p>What needs handling?</p>
              <div className="empty-cmds">
                {[
                  "Find the best blowout salon near me",
                  "Book a dinner reservation Saturday 7pm",
                  "Check restaurants near me for date night",
                  "Add a task to my calendar for tomorrow",
                ].map((cmd, i) => (
                  <button key={cmd} className="ecmd" onClick={() => useCmd(cmd)} type="button">
                    <span className="ecmd-n">0{i + 1}</span>
                    <span className="ecmd-t">{cmd}</span>
                    <span className="ecmd-arr">→</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageBlock
                key={i}
                msg={msg}
                onAnswers={handleAnswers}
                onConfirmDelete={handleConfirmDelete}
                onCancelDelete={handleCancelDelete}
                allUpdates={updates}
                getLatestUpdate={getLatestUpdate}
                callRecords={callRecords}
              />
            ))
          )}
          <div ref={msgEndRef} />
        </div>
        <div className="chat-input-wrap">
          <div className="input-row">
            <textarea
              id="msg-input"
              ref={textareaRef}
              placeholder="Ask Donna anything..."
              rows={1}
              value={inputVal}
              onChange={handleInput}
              onKeyDown={handleKey}
              disabled={busy}
              autoFocus
            />
            <button
              className={`mic-btn${listening ? " active" : ""}`}
              onClick={toggleMic}
              disabled={busy}
              title={listening ? "Stop listening" : "Voice input"}
              type="button"
            >
              <svg viewBox="0 0 24 24">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
            <button className="send-btn" onClick={() => handleSend()} disabled={busy || !inputVal.trim()} title="Send" type="button">
              <svg viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </div>
          <div className="input-hint">
            <span>↵ Enter to send</span>
            {listening ? (
              <span className="voice-ind on"><span className="v-pulse" />Listening...</span>
            ) : voiceSpeaking ? (
              <span className="voice-ind on"><span className="v-pulse" />Speaking...</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );


  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-logo">D</div>
        <nav className="sb-nav">
          <NavBtn icon="home" size={19} active={view === "home"} onClick={() => setView("home")} title="Home" />
          <NavBtn icon="email" size={19} active={view === "donna"} onClick={() => setView("donna")} title="Talk to Donna" />
          <NavBtn icon="calendar" size={19} active={view === "calendar"} onClick={() => setView("calendar")} title="Calendar" />
          <NavBtn icon="activity" size={19} active={view === "activity"} onClick={() => setView("activity")} title="Activity" />
          <NavBtn icon="person" size={19} active={view === "profile"} onClick={() => setView("profile")} title="My Profile" />
        </nav>
        <div className="sb-bot">
          <NavBtn icon="help" size={17} active={false} onClick={() => {}} title="Help" />
          <NavBtn icon="settings" size={17} active={view === "settings"} onClick={() => setView("settings")} title="Settings" />
          <NavBtn icon="logout" size={17} active={false} onClick={() => {}} title="Log out" />
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="tb-brand"><strong>DONNA</strong><span> — Get everything done.</span></div>
          <div className="tb-center"></div>
          <div className="tb-right-new">
            {wakeActive && (
              <div className="wake-chip">
                <span className="wake-dot" />
                Hey Donna
              </div>
            )}
            <button className={`voice-toggle${voiceOn ? " on" : ""}`} onClick={() => setVoiceOn((v) => !v)} type="button">
              Voice: {voiceOn ? "ON" : "OFF"}
            </button>
            {messages.length > 0 && (view === "home" || view === "donna") && (
              <button className="clear-btn" onClick={clearChat} type="button">Clear</button>
            )}
            <div className="tb-av">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
          </div>
        </div>

        <div className="body">
          {view === "home" && (
            <>
              <div className="cal-panel">
                <div className="cal-top">
                  <h2>Upcoming Meetings &amp; Events</h2>
                  <p>The best goddamn AI in this city</p>
                </div>
                <div className="cal-toolbar">
                  <div className="cal-toolbar-left">
                    <button className="cal-btn" type="button">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>
                      Month View
                    </button>
                    <button className="cal-btn" type="button">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/></svg>
                      Filter
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                    </button>
                  </div>
                  <button className="gcal-btn" type="button" onClick={() => window.open("https://calendar.google.com", "_blank")}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z"/></svg>
                    Google Calendar
                  </button>
                </div>
                <div className="cal-grid-wrap">
                  {homeEventsLoading ? (
                    <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>Loading your calendar...</div>
                  ) : homeEvents.length === 0 ? (
                    <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>No upcoming events. Ask Donna to schedule something.</div>
                  ) : (
                    <div style={{ padding: "0 4px" }}>
                      {Object.entries(
                        homeEvents.reduce((acc, ev) => {
                          const d = ev.start.split("T")[0];
                          if (!acc[d]) acc[d] = [];
                          acc[d].push(ev);
                          return acc;
                        }, {} as Record<string, CalEvent[]>)
                      ).map(([date, evs]) => {
                        const dt = new Date(date + "T12:00:00");
                        const label = dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
                        const colors = ["red", "blue", "green", "gray"];
                        return (
                          <div key={date}>
                            <div className="week-lbl" style={{ justifyContent: "flex-start", padding: "6px 8px", fontWeight: 600, fontSize: "11px" }}>{label}</div>
                            <div className="day-cell" style={{ minHeight: "auto" }}>
                              {evs.map((ev, i) => {
                                const t = ev.start.includes("T")
                                  ? new Date(ev.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                  : "All day";
                                return (
                                  <div key={ev.id} className={`cal-event ${colors[i % colors.length]}`}>
                                    <div className="ev-time">{t}</div>
                                    {ev.summary}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {donnaPanel(true)}
            </>
          )}

          {view === "donna" && (
            <div className="donna-full">
              {donnaPanel(false)}
            </div>
          )}

          {view === "calendar" && (
            <div className="full-view">
              <div className="view-header">
                <h2>Calendar</h2>
                <span className="view-sub">Google Calendar</span>
              </div>
              <div className="cal-grid-wrap-new" style={{ flex: 1 }}>
                <iframe src={calUrl} title="Donna Calendar" />
              </div>
            </div>
          )}

          {view === "activity" && (
            <div className="full-view">
              <div className="view-header">
                <h2>Activity</h2>
                <span className="view-sub">{callRecords.length} call{callRecords.length !== 1 ? "s" : ""} placed</span>
              </div>
              <div className="activity-list">
                {callRecords.length === 0 ? (
                  <div className="empty-activity">No calls yet. Ask Donna to find and book something.</div>
                ) : (
                  callRecords.map((rec, i) => {
                    const key = `${rec.businessName}-${i}`;
                    const expanded = expandedCall === key;
                    return (
                      <div key={key} className="activity-item donna" style={{ cursor: rec.transcript ? "pointer" : "default" }} onClick={() => rec.transcript && setExpandedCall(expanded ? null : key)}>
                        <div className="activity-role">{rec.transcript ? (expanded ? "▾ Call transcript" : "▸ Call placed — click for transcript") : "On call..."}</div>
                        <div className="activity-text">
                          <strong>{rec.businessName}</strong>
                          {rec.timeWindow && <> — {rec.timeWindow}</>}
                        </div>
                        {rec.summary && <div className="activity-text" style={{ opacity: 0.8, fontStyle: "italic" }}>{rec.summary}</div>}
                        {expanded && rec.transcript && (
                          <div className="activity-text" style={{ marginTop: "0.5rem", fontSize: "0.8rem", opacity: 0.7, whiteSpace: "pre-wrap", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "0.5rem" }}>
                            {rec.transcript}
                          </div>
                        )}
                        <div className="activity-time">{rec.time}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {view === "profile" && (
            <div className="full-view">
              <div className="view-header">
                <h2>Your Profile</h2>
                <span className="view-sub">The more Donna knows, the less she has to ask</span>
              </div>
              <div className="settings-list">
                <div className="settings-section">
                  <div className="settings-title">The Basics</div>
                  {([
                    { key: "name", label: "Name", placeholder: "e.g. Harvey" },
                    { key: "location", label: "Where you're based", placeholder: "e.g. Midtown Manhattan, NY" },
                    { key: "budget", label: "Spending range", placeholder: "e.g. $100–$200, or 'mid-range'" },
                  ] as { key: keyof UserProfile; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                    <div key={key} className="settings-row profile-row">
                      <label className="profile-label">{label}</label>
                      <input
                        className="profile-input"
                        placeholder={placeholder}
                        value={profile[key]}
                        onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="settings-section">
                  <div className="settings-title">Preferences & Context</div>
                  <div className="settings-row profile-row">
                    <label className="profile-label">Personal preferences</label>
                    <input
                      className="profile-input"
                      placeholder="e.g. curly hair, vegetarian, prefer female providers"
                      value={profile.hairType}
                      onChange={(e) => setProfile((p) => ({ ...p, hairType: e.target.value }))}
                    />
                  </div>
                  <div className="settings-row profile-row">
                    <label className="profile-label">Anything else</label>
                    <textarea
                      className="profile-input"
                      placeholder="e.g. I'm usually free evenings, no peanuts, always running 10 min late"
                      rows={3}
                      value={profile.notes}
                      onChange={(e) => setProfile((p) => ({ ...p, notes: e.target.value }))}
                    />
                  </div>
                  <button
                    className="clarify-submit"
                    style={{ marginTop: "1rem" }}
                    onClick={() => { saveProfile(profile); showToast("Saved."); }}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === "settings" && (
            <div className="full-view">
              <div className="view-header">
                <h2>Settings</h2>
              </div>
              <div className="settings-list">
                <div className="settings-section">
                  <div className="settings-title">Voice</div>
                  <div className="settings-row">
                    <span>Voice responses</span>
                    <button
                      className={`toggle-btn${voiceOn ? " on" : ""}`}
                      onClick={() => setVoiceOn((v) => !v)}
                      type="button"
                    >
                      {voiceOn ? "ON" : "OFF"}
                    </button>
                  </div>
                  <div className="settings-row">
                    <span>Wake word (&ldquo;Hey Donna&rdquo;)</span>
                    <span className="settings-val">{voiceOn ? "Active" : "Off — enable Voice first"}</span>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-title">About</div>
                  <div className="settings-row">
                    <span>App</span>
                    <span className="settings-val">Donna v1.0</span>
                  </div>
                  <div className="settings-row">
                    <span>AI Model</span>
                    <span className="settings-val">GPT-4o mini + ElevenLabs</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`toast${toastVisible ? " show" : ""}`}>{toastText}</div>
    </div>
  );
}

function MessageBlock({
  msg,
  onAnswers,
  onConfirmDelete,
  onCancelDelete,
  allUpdates,
  getLatestUpdate,
  callRecords,
}: {
  msg: ChatMessage;
  onAnswers: (a: Record<string, string>) => void;
  onConfirmDelete: (filter: string, originalQuery: string) => void;
  onCancelDelete: () => void;
  allUpdates: BusinessUpdate[];
  getLatestUpdate: (name: string, updates: BusinessUpdate[]) => BusinessUpdate | undefined;
  callRecords: CallRecord[];
}) {
  if (msg.type === "user") {
    return (
      <div className="msg-row user">
        <div className="msg-bubble user-bubble">{msg.text}</div>
      </div>
    );
  }

  if (msg.type === "donna") {
    return (
      <div className="msg-row donna">
        <div className="msg-av"><Image src={donnaImg} alt="Donna" width={28} height={28} className="msg-av-img" /></div>
        <div className="msg-bubble donna-bubble">{msg.text}</div>
      </div>
    );
  }

  if (msg.type === "working") {
    return (
      <>
        <div className="msg-row donna">
          <div className="msg-av"><Image src={donnaImg} alt="Donna" width={28} height={28} className="msg-av-img" /></div>
          <div className="typing-dots"><span /><span /><span /></div>
        </div>
        <div className="working-txt">{msg.text}</div>
      </>
    );
  }

  if (msg.type === "clarify") {
    return (
      <div className="msg-row donna">
        <div className="msg-av"><Image src={donnaImg} alt="Donna" width={28} height={28} className="msg-av-img" /></div>
        <div className="clarify-wrap">
          <ClarifyBlock questions={msg.questions} onSubmit={onAnswers} />
        </div>
      </div>
    );
  }

  if (msg.type === "confirm_delete") {
    return (
      <div className="msg-row donna">
        <div className="msg-av"><Image src={donnaImg} alt="Donna" width={28} height={28} className="msg-av-img" /></div>
        <div className="msg-bubble donna-bubble" style={{ maxWidth: "420px" }}>
          <div style={{ marginBottom: "10px", fontWeight: 600 }}>I&apos;ll delete the following {msg.events.length} event{msg.events.length === 1 ? "" : "s"}:</div>
          <ul style={{ margin: "0 0 12px 0", padding: "0 0 0 16px", fontSize: "13px", lineHeight: "1.6" }}>
            {msg.events.map(e => (
              <li key={e.id}>
                <strong>{e.summary}</strong>
                {e.start && <span style={{ opacity: 0.65, marginLeft: "6px" }}>
                  {new Date(e.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>}
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => onConfirmDelete(msg.filter, msg.filter)}
              style={{ background: "var(--red)", color: "white", border: "none", borderRadius: "6px", padding: "7px 16px", fontWeight: 600, cursor: "pointer", fontSize: "13px" }}
            >Yes, delete them</button>
            <button
              onClick={onCancelDelete}
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "6px", padding: "7px 16px", fontWeight: 600, cursor: "pointer", fontSize: "13px" }}
            >No, keep them</button>
          </div>
        </div>
      </div>
    );
  }

  if (msg.type === "businesses") {
    return (
      <div className="msg-row donna full-width">
        <div className="msg-av"><Image src={donnaImg} alt="Donna" width={28} height={28} className="msg-av-img" /></div>
        <div className="biz-list">
          <BizList businesses={msg.businesses} allUpdates={allUpdates} getLatestUpdate={getLatestUpdate} callRecords={callRecords} />
        </div>
      </div>
    );
  }

  return null;
}

function ClarifyBlock({ questions, onSubmit }: { questions: ClarifyingQuestion[]; onSubmit: (a: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, v: string) => setAnswers((p) => ({ ...p, [id]: v }));
  const allAnswered = questions.every((q) => answers[q.id]?.trim());

  return (
    <div className="clarify-grid">
      {questions.map((q) => (
        <div key={q.id} className="clarify-card">
          <div className="clarify-label">{q.icon} {q.label}</div>
          <div className="clarify-q">{q.question}</div>
          {q.inputType === "select" && q.options ? (
            <select
              className="clarify-input"
              value={answers[q.id] ?? ""}
              onChange={(e) => set(q.id, e.target.value)}
              style={{ background: "transparent", fontFamily: "Inter, sans-serif" }}
            >
              <option value="">Select...</option>
              {q.options.map((opt) => <option key={opt} value={opt} style={{ background: "#1e2d42" }}>{opt}</option>)}
            </select>
          ) : (
            <input
              type="text"
              className="clarify-input"
              placeholder="Your answer..."
              value={answers[q.id] ?? ""}
              onChange={(e) => set(q.id, e.target.value)}
            />
          )}
        </div>
      ))}
      <button className="clarify-submit" onClick={() => onSubmit(answers)} disabled={!allAnswered} type="button">
        Let Donna handle it
      </button>
    </div>
  );
}

const badgeClass: Record<string, string> = {
  calling: "badge-calling", call_initiated: "badge-calling",
  booked: "badge-booked",   booked_online: "badge-booked",
  queued: "badge-queued",   failed: "badge-failed", skipped: "badge-skipped",
};
const badgeLabel: Record<string, string> = {
  calling: "On the phone", call_initiated: "Call placed",
  booked: "Booked",        booked_online: "Book online",
  queued: "Calling tomorrow", failed: "Couldn't reach", skipped: "No phone",
};

function BizList({ businesses, allUpdates, getLatestUpdate, callRecords }: {
  businesses: RankedBusiness[];
  allUpdates: BusinessUpdate[];
  getLatestUpdate: (n: string, u: BusinessUpdate[]) => BusinessUpdate | undefined;
  callRecords: CallRecord[];
}) {
  const [expandedName, setExpandedName] = useState<string | null>(null);
  return (
    <>
      {businesses.map((b, i) => {
        const update = getLatestUpdate(b.name, allUpdates);
        const isActive = update?.status === "calling" || update?.status === "call_initiated";
        const rec = callRecords.find(r => r.businessName === b.name);
        const hasTranscript = !!rec?.transcript;
        const expanded = expandedName === b.name;
        return (
          <div key={`${b.name}-${i}`} className={`biz-card${isActive ? " active" : ""}`}
            style={{ cursor: hasTranscript ? "pointer" : "default" }}
            onClick={() => hasTranscript && setExpandedName(expanded ? null : b.name)}
          >
            <div className="biz-row">
              <span className="biz-rank">#{i + 1}</span>
              <span className="biz-name">{b.name}</span>
              <span className="biz-score">{b.score}/10</span>
              {update && badgeClass[update.status] && (
                <span className={`biz-badge ${badgeClass[update.status]}`}>{badgeLabel[update.status]}</span>
              )}
              {hasTranscript && <span style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto" }}>{expanded ? "▾ hide" : "▸ transcript"}</span>}
            </div>
            <div className="biz-address">{b.address}</div>
            <div className="biz-reason">{b.reasoning}</div>
            {update && <div className="biz-detail">{update.detail}</div>}
            {update?.status === "booked_online" && update.url && (
              <a href={update.url} target="_blank" rel="noopener noreferrer" className="biz-link">Book now →</a>
            )}
            {expanded && rec?.transcript && (
              <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)", fontSize: "11.5px", color: "var(--text-dim)", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                {rec.summary && <div style={{ marginBottom: "8px", color: "var(--text)", fontWeight: 600 }}>{rec.summary}</div>}
                <div style={{ opacity: 0.7 }}>{rec.transcript}</div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
