import { GoogleGenAI } from "@google/genai";
import type { BusinessResult } from "./tavily";

// OpenAI is kept for Whisper (speech-to-text) — do not remove
// import OpenAI from "openai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const MODEL = "gemini-2.5-flash";

async function ask(system: string, user: string, json = true): Promise<string> {
  const result = await genai.models.generateContent({
    model: MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return result.text ?? "";
}

//Types

export interface ClarifyingQuestion {
  id: string;
  icon: string;
  label: string;
  question: string;
  inputType: "text" | "select" | "location";
  options?: string[];
}

export interface UserPrefs {
  location?: string;
  date?: string;
  timeWindow?: string;
  budget?: string;
  radius?: string;
  [key: string]: string | undefined;
}

export interface RankedBusiness {
  name: string;
  address: string;
  phone: string | null;
  onlineBookingUrl: string | null;
  description: string;
  url: string;
  score: number;
  reasoning: string;
}

export interface TranscriptSummary {
  booked: boolean;
  bookingTime?: string;
  bookingPrice?: string;
  stylistName?: string;
  notes: string;
  nextAction: "confirm" | "move_to_next" | "retry";
}

// ── Query intent parser ──────────────────────────────────────────────────────

export interface ParsedIntent {
  enrichedQuery: string;
  intent: "business_search" | "calendar_add" | "calendar_delete" | "calendar_edit" | "calendar_delete_and_add" | "cancel" | "other";
  service?: string;
  dateTime?: string;
  addToCalendar?: boolean;
  noFurtherQuestions?: boolean;
  locationMentioned?: string;
  editFrom?: string;
  editTo?: string;
  editColor?: string;
  deleteFilter?: string;
}

export async function parseIntent(
  rawQuery: string,
  todayISO: string
): Promise<ParsedIntent> {
  const system = `You are Donna's intent parser. Today is ${todayISO}.

Take a raw user message (possibly messy, from voice transcription) and return a clean structured JSON intent.

Return JSON:
{
  "enrichedQuery": string,
  "intent": "business_search" | "calendar_add" | "calendar_delete" | "calendar_edit" | "calendar_delete_and_add" | "cancel" | "other",
  "service": string | null,
  "dateTime": string | null,
  "addToCalendar": boolean,
  "noFurtherQuestions": boolean,
  "locationMentioned": string | null,
  "editFrom": string | null,
  "editTo": string | null,
  "editColor": string | null,
  "deleteFilter": string | null
}

Examples:
- "hey book me a hair appointment tmrw 8pm no questions add to cal" → intent: business_search, service: hair salon, dateTime: <tomorrow 8pm>, addToCalendar: true, noFurtherQuestions: true
- "add dentist appt thursday 3pm" → intent: calendar_add, dateTime: <thursday 3pm>
- "delete all my appointments" / "clear my calendar" → intent: calendar_delete, deleteFilter: null
- "remove all the hair stylist appointments" → intent: calendar_delete, deleteFilter: "hair"
- "remove the nail appointment for March 8th" → intent: calendar_delete, deleteFilter: "nail"
- IMPORTANT: for single-event deletions, ALWAYS extract a deleteFilter keyword. NEVER return deleteFilter: null unless user explicitly wants ALL events deleted.
- "remove my marketing exam and add an accounting exam from 8am to 12pm" → intent: calendar_delete_and_add, deleteFilter: "marketing", dateTime: <8am today or specified date>
- IMPORTANT: when the user asks to BOTH remove one event AND add another in the same message, use intent: calendar_delete_and_add. Set deleteFilter for what to remove and dateTime for the new event.
- "change exam to OS exam" → intent: calendar_edit, editFrom: "exam", editTo: "OS exam", editColor: null
- "change the color of nail appointment to yellow" → intent: calendar_edit, editFrom: "nail", editTo: null, editColor: "yellow"
- IMPORTANT: color requests must set editColor and leave editTo as null
- "stop" / "cancel" / "nevermind" → intent: cancel
- "call again" / "retry" → intent: business_search (RETRY, NOT cancel)`;

  try {
    const text = await ask(system, rawQuery);
    return JSON.parse(text) as ParsedIntent;
  } catch {
    return { enrichedQuery: rawQuery, intent: "other" };
  }
}

//Generate clarifying question cards

export async function generateClarifyingQuestions(
  query: string
): Promise<ClarifyingQuestion[]> {
  const system = `You are Donna, a personal AI assistant. Generate clarifying questions as JSON.
Return: { "questions": [ { "id": string, "icon": string, "label": string, "question": string, "inputType": "text"|"select"|"location", "options": string[] | undefined } ] }
Rules:
- If the user says "no further questions", skip optional questions — but still ask for location if missing and task requires local search.
- If user already provided all info, return { "questions": [] }.
- For calendar tasks: ONLY ask if date/time is missing. Never ask for location.
- For local business searches: ALWAYS ask for location if not provided.
- Maximum 3 questions.`;

  const text = await ask(system, `User asked: "${query}"`);
  const parsed = JSON.parse(text) as { questions: ClarifyingQuestion[] };
  return parsed.questions;
}

//Detect if the query is a calendar action and extract event details
export interface CalendarEventExtract {
  isCalendarAction: boolean;
  events?: Array<{
    title: string;
    dateTime: string;
    durationMinutes?: number;
    location?: string;
    description?: string;
    color?: string;
  }>;
  // legacy single-event fields (kept for backward compat)
  title?: string;
  dateTime?: string;
  durationMinutes?: number;
  location?: string;
  description?: string;
}

export async function extractCalendarIntent(
  query: string,
  todayISO: string
): Promise<CalendarEventExtract> {
  const system = `You are Donna's intent classifier. Today's date is ${todayISO}.
Determine if the user wants to add/create/schedule one or more calendar events.
Extract ALL events mentioned — users often ask to add multiple in one message.
Return JSON:
{
  "isCalendarAction": boolean,
  "events": [
    {
      "title": string,
      "dateTime": string (ISO 8601, infer year/timezone as local),
      "durationMinutes": number (default 60),
      "location": string | null,
      "description": string | null,
      "color": string | null
    }
  ]
}
If not a calendar action, return { "isCalendarAction": false, "events": [] }.
IMPORTANT: If the user specifies one color for all events, apply it to every event.`;

  const text = await ask(system, query);
  return JSON.parse(text) as CalendarEventExtract;
}

//Evaluate whether search results are sufficient

export async function evaluateSearchResults(
  query: string,
  results: BusinessResult[]
): Promise<"sufficient" | "insufficient"> {
  const system = `You are Donna's decision engine. Return JSON: { "verdict": "sufficient" | "insufficient" }`;
  const user = `User asked: "${query}"\n\nSearch results:\n${results.map((r, i) => `${i + 1}. ${r.name}: ${r.description}`).join("\n")}\n\nAre these results sufficient?`;
  const text = await ask(system, user);
  const parsed = JSON.parse(text) as { verdict: string };
  return parsed.verdict as "sufficient" | "insufficient";
}

//Score and rank business results

export async function scoreAndRankResults(
  query: string,
  results: BusinessResult[],
  prefs: UserPrefs,
  userProfile?: { name?: string; location?: string; hairType?: string; budget?: string; notes?: string }
): Promise<RankedBusiness[]> {
  const profileLines: string[] = [];
  if (userProfile?.hairType) profileLines.push(`Hair type / preferences: ${userProfile.hairType}`);
  if (userProfile?.budget) profileLines.push(`Budget: ${userProfile.budget}`);
  if (userProfile?.notes) profileLines.push(`Additional notes: ${userProfile.notes}`);

  const system = `You are Donna's scoring engine. Score each business 1–10. Return JSON: { "businesses": [ { "name", "address", "phone", "onlineBookingUrl", "description", "url", "score", "reasoning" } ] } ranked best-first.

Scoring rubric:
- +3 pts: Service clearly matches client needs
- +2 pts: Has online booking or phone number
- +2 pts: Within client's budget
- +1 pt: Strong reviews or reputable
- +1 pt: Close to client's location
- -2 pts: Outside budget
- -2 pts: Mismatch with client needs
- -1 pt: No phone and no online booking`;

  const user = `Client request: "${query}"

Timing: ${prefs.timeWindow || "flexible"}
Location: ${prefs.location || "unspecified"}
${prefs.budget ? `Budget: ${prefs.budget}` : ""}
${profileLines.length > 0 ? `\nClient profile:\n${profileLines.map(l => `- ${l}`).join("\n")}` : ""}

Businesses to score:
${results.map((r, i) => `${i + 1}. ${r.name}
   Address: ${r.address}
   Phone: ${r.phone || "none"}
   Online booking: ${r.onlineBookingUrl || "none"}
   Description: ${r.description}`).join("\n\n")}`;

  const text = await ask(system, user);
  const parsed = JSON.parse(text) as { businesses: RankedBusiness[] };
  return parsed.businesses
    .map((b) => ({
      ...b,
      phone: b.phone && b.phone !== "none" && b.phone !== "unknown" ? b.phone : null,
      onlineBookingUrl: b.onlineBookingUrl && b.onlineBookingUrl !== "none" && b.onlineBookingUrl !== "unknown" && b.onlineBookingUrl.startsWith("http") ? b.onlineBookingUrl : null,
    }))
    .sort((a, b) => b.score - a.score);
}

// Donna's spoken summary after a call
export async function summarizeCallForDonna(
  transcript: string,
  businessName: string
): Promise<string> {
  const system = `You are Donna, a sharp executive AI assistant. Summarize this call in 1–2 sentences in first person.

Rules:
- State the outcome first: booked, unavailable, no answer, or unclear.
- If booked: include specific date/time and price. Example: "Booked. Thursday at 2pm, $85."
- If no answer: "No answer at ${businessName}. I'll try again or move to the next option."
- Under 30 words. No filler.`;

  const text = await ask(system, `Business: ${businessName}\nTranscript:\n${transcript}`, false);
  return text.trim() || `I called ${businessName} — check the transcript for details.`;
}

// Donna's in-character reply to casual/conversational messages
export async function generateDonnaReply(rawQuery: string): Promise<string> {
  const system = `You are Donna — a sharp, witty AI executive assistant. Think of the character Donna from Suits: composed, confident, two steps ahead.

Respond in character — brief, warm, a little dry. 1-2 sentences max. Gently redirect toward what you can do for them. Never be robotic.`;

  const text = await ask(system, rawQuery, false);
  return text.trim() || "On it. What do you need?";
}

// Clean up raw user input into professional call context
export async function cleanCallContext(raw: {
  timeWindow?: string;
  task?: string;
}): Promise<{ timeWindow?: string; task?: string }> {
  const system = `You are Donna's call prep assistant. The user spoke casually. Convert their input into clean, professional phrasing suitable for a business phone call. Return JSON: { "timeWindow": string | null, "task": string | null }. Be concise. No filler. Example: "like anytime friday between 1 and 7 ish pm" → "Friday between 1pm and 7pm". Only include fields that were provided.`;
  try {
    const text = await ask(system, JSON.stringify(raw));
    const parsed = JSON.parse(text) as { timeWindow?: string; task?: string };
    return {
      timeWindow: parsed.timeWindow ?? raw.timeWindow,
      task: parsed.task ?? raw.task,
    };
  } catch {
    return raw;
  }
}

//Summarize a Vapi call transcript and extract booking result

export async function summarizeTranscript(
  transcript: string,
  originalQuery: string
): Promise<TranscriptSummary> {
  const system = `You are Donna's transcript analyzer. Extract booking outcome. Return JSON: { "booked": boolean, "bookingTime": string|undefined, "bookingPrice": string|undefined, "stylistName": string|undefined, "notes": string, "nextAction": "confirm"|"move_to_next"|"retry" }`;
  const text = await ask(system, `Booking task: "${originalQuery}"\n\nTranscript:\n${transcript}`);
  return JSON.parse(text) as TranscriptSummary;
}
