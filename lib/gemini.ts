import OpenAI from "openai";
import type { BusinessResult } from "./tavily";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
// Runs first on every raw query. Normalises sloppy/voice input into a clean
// structured intent so all downstream steps work reliably.

export interface ParsedIntent {
  enrichedQuery: string;         // Rewritten, clear description of what the user wants
  intent: "business_search" | "calendar_add" | "calendar_delete" | "calendar_edit" | "cancel" | "other";
  service?: string;              // e.g. "hair stylist", "Italian restaurant"
  dateTime?: string;             // ISO 8601 if mentioned
  addToCalendar?: boolean;       // User wants event added to calendar after booking
  noFurtherQuestions?: boolean;  // User explicitly said no more questions
  locationMentioned?: string;    // Explicit location if stated in query
  editFrom?: string;             // For calendar_edit: the current event title to find
  editTo?: string;               // For calendar_edit: the new title to set
}

export async function parseIntent(
  rawQuery: string,
  todayISO: string
): Promise<ParsedIntent> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna's intent parser. Today is ${todayISO}.

Your job: take a raw user message (possibly messy, from voice transcription) and return a clean structured JSON intent that Donna can act on reliably.

Return JSON:
{
  "enrichedQuery": string,          // Rewrite the query as a clear, detailed task description (1-2 sentences). Fix grammar, expand abbreviations, make implicit info explicit.
  "intent": "business_search" | "calendar_add" | "calendar_delete" | "calendar_edit" | "cancel" | "other",
  "service": string | null,         // What type of business/service (e.g. "hair salon", "Italian restaurant")
  "dateTime": string | null,        // ISO 8601 — convert relative times like "tomorrow 8pm" to absolute. Use local time (no UTC offset needed).
  "addToCalendar": boolean,         // true if user says "add to calendar", "put it on my calendar", etc.
  "noFurtherQuestions": boolean,    // true if user says "no further questions", "no questions", "just do it", etc.
  "locationMentioned": string | null, // Location if explicitly stated by user (e.g. "near downtown Austin")
  "editFrom": string | null,        // For calendar_edit: the current event title to search for
  "editTo": string | null           // For calendar_edit: the new title to replace it with
}

Examples:
- "hey book me a hair appointment tmrw 8pm no questions add to cal" → intent: business_search, service: hair salon, dateTime: <tomorrow 8pm>, addToCalendar: true, noFurtherQuestions: true
- "add dentist appt thursday 3pm" → intent: calendar_add, dateTime: <thursday 3pm>
- "delete all my appointments" / "remove every event" / "clear my calendar" → intent: calendar_delete
- "change exam to OS exam" / "rename exam to OS exam" / "update my dentist event to dentist cleaning" → intent: calendar_edit, editFrom: "exam", editTo: "OS exam"
- "stop" / "stop calling" / "cancel" / "nevermind" / "abort" → intent: cancel
- "call again" / "try again" / "retry" / "call them again" / "try calling again" → intent: business_search (these are RETRY requests, NOT cancel)`,
      },
      { role: "user", content: rawQuery },
    ],
  });

  try {
    return JSON.parse(completion.choices[0].message.content ?? "{}") as ParsedIntent;
  } catch {
    return { enrichedQuery: rawQuery, intent: "other" };
  }
}

//Generate clarifying question cards

export async function generateClarifyingQuestions(
  query: string
): Promise<ClarifyingQuestion[]> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna, a personal AI assistant. Generate clarifying questions as JSON.
Return: { "questions": [ { "id": string, "icon": string, "label": string, "question": string, "inputType": "text"|"select"|"location", "options": string[] | undefined } ] }
Rules:
- If the user says "no further questions", "no more questions", "no questions", or similar, skip all optional questions — BUT still ask for location if it is missing and the task requires a local search (location is non-negotiable).
- If the user has already provided all needed information (date, time, location, etc.), return { "questions": [] }.
- For calendar tasks (add event, create event, schedule, put on calendar): ONLY ask if date/time is missing. Never ask for location or extra details.
- For local business searches (salons, restaurants, stores, spas, etc.): ALWAYS ask for location if not provided, even if user said "no further questions". Without location, the search cannot run.
- Maximum 3 questions. Only ask what is truly essential to complete the task.`,
      },
      {
        role: "user",
        content: `User asked: "${query}"`,
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw) as { questions: ClarifyingQuestion[] };
  return parsed.questions;
}

//Detect if the query is a calendar action and extract event details
export interface CalendarEventExtract {
  isCalendarAction: boolean;
  title?: string;
  dateTime?: string; // ISO string, relative to today if needed
  durationMinutes?: number;
  location?: string;
  description?: string;
}

export async function extractCalendarIntent(
  query: string,
  todayISO: string
): Promise<CalendarEventExtract> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna's intent classifier. Today's date is ${todayISO}.
Determine if the user wants to add/create/schedule a calendar event.
If yes, extract the event details.
Return JSON: { "isCalendarAction": boolean, "title": string, "dateTime": string (ISO 8601, infer year/timezone as local), "durationMinutes": number (default 60), "location": string|null, "description": string|null }
If not a calendar action, return { "isCalendarAction": false }.`,
      },
      { role: "user", content: query },
    ],
  });
  return JSON.parse(completion.choices[0].message.content ?? "{}") as CalendarEventExtract;
}

//Evaluate whether search results are sufficient or Donna needs to call

export async function evaluateSearchResults(
  query: string,
  results: BusinessResult[]
): Promise<"sufficient" | "insufficient"> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna's decision engine. Return JSON: { "verdict": "sufficient" | "insufficient" }`,
      },
      {
        role: "user",
        content: `User asked: "${query}"\n\nSearch results:\n${results.map((r, i) => `${i + 1}. ${r.name}: ${r.description}`).join("\n")}\n\nAre these results sufficient to answer the query?`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}") as { verdict: string };
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

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna's scoring engine. Score each business 1–10 on how well it fits the client's request. Return JSON: { "businesses": [ { "name", "address", "phone", "onlineBookingUrl", "description", "url", "score", "reasoning" } ] } ranked best-first.

Scoring rubric (apply all that apply):
- +3 pts: Service clearly matches what the client needs (e.g. specializes in their hair type, cuisine, etc.)
- +2 pts: Business has online booking or a phone number to call
- +2 pts: Appears to be within the client's budget range
- +1 pt: Has strong reviews or is well-known/reputable
- +1 pt: Address is close to the client's location
- -2 pts: Likely outside the client's budget (too expensive or too cheap)
- -2 pts: Mismatch with specific client needs (e.g. doesn't do curly hair, wrong cuisine)
- -1 pt: No phone number and no online booking (hard to reach)`,
      },
      {
        role: "user",
        content: `Client request: "${query}"

Timing: ${prefs.timeWindow || "flexible"}
Location: ${prefs.location || "unspecified"}
${prefs.budget ? `Budget: ${prefs.budget}` : ""}
${profileLines.length > 0 ? `\nClient profile:\n${profileLines.map(l => `- ${l}`).join("\n")}` : ""}

Businesses to score:
${results.map((r, i) => `${i + 1}. ${r.name}
   Address: ${r.address}
   Phone: ${r.phone || "none"}
   Online booking: ${r.onlineBookingUrl || "none"}
   Description: ${r.description}`).join("\n\n")}`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content ?? "{}") as { businesses: RankedBusiness[] };
  //Normalize "none"/"unknown"/empty strings to null, sort best-first
  return parsed.businesses
    .map((b) => ({
      ...b,
      phone: b.phone && b.phone !== "none" && b.phone !== "unknown" ? b.phone : null,
      onlineBookingUrl: b.onlineBookingUrl && b.onlineBookingUrl !== "none" && b.onlineBookingUrl !== "unknown" && b.onlineBookingUrl.startsWith("http") ? b.onlineBookingUrl : null,
    }))
    .sort((a, b) => b.score - a.score);
}

// Donna's spoken summary after a call — sharp, factual, first-person
export async function summarizeCallForDonna(
  transcript: string,
  businessName: string
): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are Donna, a sharp executive AI assistant. Summarize this call in 1–2 sentences in first person, like you made the call yourself.

Rules:
- ALWAYS state the outcome first: booked, unavailable, no answer, or unclear.
- If booked: include the specific date/time and price. Example: "Booked. Thursday at 2pm, $85."
- If unavailable: say why if known. Example: "No availability Thursday — they're fully booked."
- If no answer / voicemail: "No answer at ${businessName}. I'll try again or move to the next option."
- Keep it under 30 words. No filler. No "I called and..." preamble — get straight to the result.`,
      },
      {
        role: "user",
        content: `Business: ${businessName}\nTranscript:\n${transcript}`,
      },
    ],
  });
  return completion.choices[0].message.content?.trim() ?? `I called ${businessName} — check the transcript for details.`;
}

// Donna's in-character reply to casual/conversational messages
export async function generateDonnaReply(rawQuery: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are Donna — a sharp, witty AI executive assistant. Think of the character Donna from Suits: composed, confident, and two steps ahead. You handle anything from booking restaurants to scheduling meetings to calling businesses on the client's behalf.

When the client makes small talk, chats, or asks how you're doing, respond in character — brief, warm, and a little dry. Keep it 1-2 sentences max. Then gently redirect toward what you can actually do for them.

Never be robotic or formal. You're Donna, not a chatbot.`,
      },
      { role: "user", content: rawQuery },
    ],
  });
  return completion.choices[0].message.content?.trim() ?? "On it. What do you need?";
}

//Summarize a Vapi call transcript and extract booking result

export async function summarizeTranscript(
  transcript: string,
  originalQuery: string
): Promise<TranscriptSummary> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are Donna's transcript analyzer. Extract booking outcome from the call. Return JSON: { "booked": boolean, "bookingTime": string|undefined, "bookingPrice": string|undefined, "stylistName": string|undefined, "notes": string, "nextAction": "confirm"|"move_to_next"|"retry" }`,
      },
      {
        role: "user",
        content: `Booking task: "${originalQuery}"\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  return JSON.parse(completion.choices[0].message.content ?? "{}") as TranscriptSummary;
}
