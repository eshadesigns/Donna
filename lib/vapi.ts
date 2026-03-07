//Vapi call trigger — full implementation in Step 6

export interface CallContext {
  task: string;
  timeWindow?: string;
  budget?: string;
  businessName: string;
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

  const systemPrompt = `You are Donna, a professional AI assistant calling on behalf of a customer.
Always open with: "Hi, I'm Donna, an AI assistant calling on behalf of a customer. This call may be logged for accuracy."
You are calling ${context.businessName} to: ${context.task}.
${context.timeWindow ? `The customer's preferred time window is: ${context.timeWindow}.` : ""}
${context.budget ? `Budget: ${context.budget}.` : ""}
Ask if they have availability, get a specific time, confirm the price. Be concise and professional.
If they cannot help, thank them and end the call politely.`;

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
        model: {
          provider: "google",
          model: "gemini-2.0-flash",
          systemPrompt,
        },
        voice: {
          provider: "11labs",
          voiceId: process.env.ELEVENLABS_VOICE_ID || "Rachel",
        },
        serverUrl: webhookUrl,
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
