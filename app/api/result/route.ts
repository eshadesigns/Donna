import { NextRequest } from "next/server";
import { summarizeTranscript } from "@/lib/gemini";
import { storeCallLog, updateQueueItemStatus } from "@/lib/mongo";

//Vapi webhook — fires when a call ends with a full transcript
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    message?: {
      type: string;
      call?: {
        id: string;
        assistant?: {
          metadata?: {
            businessName?: string;
            task?: string;
            userId?: string;
          };
        };
      };
      artifact?: { transcript?: string };
      endedReason?: string;
    };
  };

  const msg = body.message;
  if (!msg || msg.type !== "end-of-call-report") {
    return Response.json({ received: true });
  }

  const callId = msg.call?.id ?? "unknown";
  const transcript = msg.artifact?.transcript ?? "";
  const endedReason = msg.endedReason ?? "";
  const metadata = msg.call?.assistant?.metadata;
  const businessName = metadata?.businessName ?? "unknown";
  const task = metadata?.task ?? "appointment booking";

  try {
    const summary = await summarizeTranscript(transcript, task);

    await storeCallLog({
      callId,
      businessName,
      transcript,
      summary: summary.notes,
      booked: summary.booked,
      bookingTime: summary.bookingTime,
      bookingPrice: summary.bookingPrice,
      notes: `Ended: ${endedReason}`,
    });

    if (summary.booked) {
      await updateQueueItemStatus(businessName, "done", callId);
    } else if (summary.nextAction === "move_to_next") {
      await updateQueueItemStatus(businessName, "failed", callId);
    }

    return Response.json({ success: true, booked: summary.booked });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    console.error("Vapi webhook error:", message);
    return Response.json({ success: false }, { status: 500 });
  }
}
