export interface CallContext {
  task: string;
  service?: string;       // Clean service name, e.g. "hairstylist", "Italian restaurant"
  clientNotes?: string;   // Relevant client context, e.g. "thick curly hair, prefers female stylists"
  timeWindow?: string;
  budget?: string;
  businessName: string;
  userId?: string;
}

export interface CallResult {
  callId: string;
}

export interface VapiCallStatus {
  id: string;
  status: string; // "queued" | "ringing" | "in-progress" | "forwarding" | "ended"
  transcript?: string;
  summary?: string;
  endedReason?: string;
}

export async function triggerCall(
  phoneNumber: string,
  context: CallContext
): Promise<CallResult> {
  const VAPI_API_KEY = process.env.VAPI_API_KEY!;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID!;
  const webhookUrl = process.env.VAPI_WEBHOOK_URL || "http://localhost:3000/api/result";

  const serviceLabel = context.service || "appointment";
  const timeNote = context.timeWindow ? ` for ${context.timeWindow}` : "";
  const budgetNote = context.budget ? ` Budget: ${context.budget}.` : "";
  const clientNotesLine = context.clientNotes ? ` Client notes: ${context.clientNotes}.` : "";

  const systemPrompt = `You are Donna, a sharp AI assistant making a quick professional call for a client.
Your mission: find out if ${context.businessName} can book a ${serviceLabel} appointment${timeNote}.${budgetNote}${clientNotesLine}

Rules:
- Be brief and professional. Get in, get the answer, get out — under 60 seconds.
- After your opening, ask ONE combined question about availability and cost.
- If they confirm availability: get the specific time slot and price, then say EXACTLY: "Perfect, I'll let my client know. Thank you so much, goodbye." — then END the call immediately.
- If they cannot accommodate: say EXACTLY: "Understood, thank you for your time. Goodbye." — then END the call immediately.
- ALWAYS end with "goodbye" — never leave the call hanging.
- Do NOT repeat yourself or ask the same question twice.
- Do NOT make small talk or go off-topic.
- Never say "I'm an AI" more than once (already disclosed in opening).`;

  const response = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: { number: phoneNumber },
      assistant: {
        firstMessage: `Hi, this is Donna — I'm an AI assistant calling on behalf of a client. They're looking to book a ${serviceLabel} appointment${timeNote}. Do you have availability, and what would the cost be?`,
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          systemPrompt,
        },
        voice: { provider: "openai", voiceId: "nova" },
        silenceTimeoutSeconds: 20,
        maxDurationSeconds: 120,
        endCallPhrases: ["goodbye", "thank you, goodbye", "thank you so much, goodbye", "i'll let my client know", "understood, thank you"],
        serverUrl: webhookUrl,
        metadata: {
          businessName: context.businessName,
          task: context.task,
          userId: context.userId ?? "default",
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vapi call failed: ${err}`);
  }

  const data = await response.json() as { id: string };
  return { callId: data.id };
}

export async function pollCallResult(
  callId: string,
  maxWaitMs = 180_000,
  intervalMs = 5_000
): Promise<VapiCallStatus | null> {
  const VAPI_API_KEY = process.env.VAPI_API_KEY!;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
        headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      });
      if (!res.ok) continue;
      const data = await res.json() as VapiCallStatus;
      if (data.status === "ended") return data;
    } catch { /* keep polling */ }
  }
  return null;
}
