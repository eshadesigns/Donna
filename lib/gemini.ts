import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { BusinessResult } from "./tavily";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

function getModel() {
  return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
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

//Generate clarifying question cards 

export async function generateClarifyingQuestions(
  query: string
): Promise<ClarifyingQuestion[]> {
  const model = getModel();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are Donna, a personal AI assistant. A user just asked: "${query}"

Generate the most important clarifying questions Donna needs answered before she can act autonomously. Only ask what is truly needed — no more than 5 questions.

Always include location if it's a local search. Always include time/date if booking is involved.

Return a JSON array of question objects.`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.STRING },
            icon: { type: SchemaType.STRING },
            label: { type: SchemaType.STRING },
            question: { type: SchemaType.STRING },
            inputType: { type: SchemaType.STRING },
            options: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
          required: ["id", "icon", "label", "question", "inputType"],
        },
      },
    },
  });

  const text = result.response.text();
  return JSON.parse(text) as ClarifyingQuestion[];
}

//Evaluate whether search results are sufficient or Donna needs to call

export async function evaluateSearchResults(
  query: string,
  results: BusinessResult[]
): Promise<"sufficient" | "insufficient"> {
  const model = getModel();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are Donna's decision engine. A user asked: "${query}"

Here are the web search results:
${results.map((r, i) => `${i + 1}. ${r.name}: ${r.description}`).join("\n")}

Are these results sufficient to answer the user's query, or does Donna need to call businesses directly?
Return a JSON object with a single field "verdict" that is either "sufficient" or "insufficient".`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          verdict: { type: SchemaType.STRING },
        },
        required: ["verdict"],
      },
    },
  });

  const parsed = JSON.parse(result.response.text());
  return parsed.verdict as "sufficient" | "insufficient";
}

//Score and rank business results

export async function scoreAndRankResults(
  query: string,
  results: BusinessResult[],
  prefs: UserPrefs
): Promise<RankedBusiness[]> {
  const model = getModel();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are Donna's scoring engine. A user asked: "${query}"

User preferences:
${Object.entries(prefs)
  .filter(([, v]) => v)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Businesses found:
${results
  .map(
    (r, i) => `${i + 1}. ${r.name}
   Address: ${r.address}
   Phone: ${r.phone || "unknown"}
   Online booking: ${r.onlineBookingUrl || "none"}
   Description: ${r.description}`
  )
  .join("\n\n")}

Score each business from 1–10 based on how well it matches the query and user preferences. Return them ranked best-first. Include a brief reasoning for each score.`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING },
            address: { type: SchemaType.STRING },
            phone: { type: SchemaType.STRING },
            onlineBookingUrl: { type: SchemaType.STRING },
            description: { type: SchemaType.STRING },
            url: { type: SchemaType.STRING },
            score: { type: SchemaType.NUMBER },
            reasoning: { type: SchemaType.STRING },
          },
          required: ["name", "score", "reasoning"],
        },
      },
    },
  });

  return JSON.parse(result.response.text()) as RankedBusiness[];
}

//Summarize a Vapi call transcript and extract booking result

export async function summarizeTranscript(
  transcript: string,
  originalQuery: string
): Promise<TranscriptSummary> {
  const model = getModel();

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are Donna's transcript analyzer. A call was made to book: "${originalQuery}"

Call transcript:
${transcript}

Extract the booking outcome. Was an appointment booked? If so, what time, price, and stylist?
Determine the next action: "confirm" if booked, "move_to_next" if they can't help, "retry" if call failed or no answer.`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          booked: { type: SchemaType.BOOLEAN },
          bookingTime: { type: SchemaType.STRING },
          bookingPrice: { type: SchemaType.STRING },
          stylistName: { type: SchemaType.STRING },
          notes: { type: SchemaType.STRING },
          nextAction: { type: SchemaType.STRING },
        },
        required: ["booked", "notes", "nextAction"],
      },
    },
  });

  return JSON.parse(result.response.text()) as TranscriptSummary;
}
