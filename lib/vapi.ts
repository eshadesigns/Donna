export interface CallContext {
  task: string;
  timeWindow?: string;
  budget?: string;
  businessName: string;
  userId?: string;
}

export interface CallResult {
  callId: string;
}

export async function triggerCall(
  phoneNumber: string,
  context: CallContext
): Promise<CallResult> {
  const VAPI_API_KEY = process.env.VAPI_API_KEY!;
  const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID!;
  const webhookUrl = process.env.VAPI_WEBHOOK_URL || "http://localhost:3000/api/result";

  const systemPrompt = [
    `You are Donna, a professional AI assistant calling on behalf of a customer.`,
    `Always open with exactly: "Hi, I'm Donna, an AI assistant calling on behalf of a customer. This call may be logged for accuracy."`,
    `You are calling ${context.businessName} to: ${context.task}.`,
    context.timeWindow ? `The customer's preferred time window is: ${context.timeWindow}.` : "",
    context.budget ? `Their budget is: ${context.budget}.` : "",
    `Ask if they have availability that fits, get a specific date and time, confirm the price.`,
    `Be concise and professional. If they cannot help or don't have availability, thank them politely and end the call.`,
    `Do not make up information. If you're unsure, ask.`,
  ].filter(Boolean).join(" ");

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
        firstMessage: `Hi, I'm Donna, an AI assistant calling on behalf of a customer. This call may be logged for accuracy. I'm reaching out about ${context.task} — do you have a moment?`,
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          systemPrompt,
        },
        voice: {
          provider: "11labs",
          voiceId: process.env.ELEVENLABS_VOICE_ID,
        },
        //End call if they don't answer or go silent for 30s
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 300,
        endCallPhrases: ["goodbye", "thank you, goodbye", "have a good day"],
        serverUrl: webhookUrl,
        //Pass metadata so the webhook knows which business this was for
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
