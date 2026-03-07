import { NextRequest } from "next/server";
import { triggerCall } from "@/lib/vapi";
import { updateQueueItemStatus } from "@/lib/mongo";

//POST /api/call — manually trigger a call (used by scheduler and orchestration)
export async function POST(req: NextRequest) {
  const { phone, businessName, context } = await req.json() as {
    phone: string;
    businessName: string;
    context: { task: string; timeWindow?: string; budget?: string };
  };

  try {
    const { callId } = await triggerCall(phone, { ...context, businessName });
    await updateQueueItemStatus(businessName, "in-progress", callId);
    return Response.json({ success: true, callId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Call failed";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
