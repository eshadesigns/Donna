import { NextRequest } from "next/server";
import { generateClarifyingQuestions, scoreAndRankResults } from "@/lib/gemini";
import { searchNearby } from "@/lib/tavily";
import { triggerCall } from "@/lib/vapi";
import { addToQueue, updateQueueItemStatus } from "@/lib/mongo";
import type { UserPrefs } from "@/lib/gemini";

//SSE helper

function sseEvent(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, ...( typeof data === "object" ? data : { data }) })}\n\n`;
}

//Quick hours check — if no info assume standard business hours

function isLikelyOpen(description: string): boolean {
  const now = new Date();
  const hour = now.getHours();
  // If hours info not available, assume open during business hours
  if (!description.toLowerCase().includes("hour")) return hour >= 9 && hour < 18;
  return true; // Let Gemini / Vapi handle edge cases
}

//No prefs yet → return clarifying questions. Prefs provided → stream the full pipeline.

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    query: string;
    prefs?: UserPrefs;
    userId?: string;
  };

  const { query, prefs, userId = "default" } = body;

  //Step A — no location yet, ask clarifying questions first
  if (!prefs || !prefs.location) {
    const questions = await generateClarifyingQuestions(query);
    return Response.json({ questions });
  }

  //Step B — we have what we need, run the pipeline
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) => {
        controller.enqueue(enc.encode(sseEvent(type, data)));
      };

      try {
        //Search
        send("status", { message: "Donna's scanning the web..." });
        const raw = await searchNearby(query, prefs.location!, prefs.radius || "10 miles");

        if (raw.length === 0) {
          send("error", { message: "No businesses found. Try a different search." });
          controller.close();
          return;
        }

        //Rank
        send("status", { message: `Found ${raw.length} options. Donna is ranking them...` });
        const ranked = await scoreAndRankResults(query, raw, prefs);
        send("ranked", { businesses: ranked });

        //Work through the list
        for (const business of ranked) {
          const name = business.name;

          //Has online booking — skip the call
          if (business.onlineBookingUrl) {
            send("business_update", {
              name,
              status: "booked_online",
              detail: `Online booking available at ${business.onlineBookingUrl}`,
              url: business.onlineBookingUrl,
            });
            continue;
          }

          //No phone number, nothing we can do
          if (!business.phone) {
            send("business_update", {
              name,
              status: "skipped",
              detail: "No phone number found.",
            });
            continue;
          }

          const open = isLikelyOpen(business.description);

          if (open) {
            //Call now
            send("business_update", {
              name,
              status: "calling",
              detail: `Donna's on the phone with ${name}...`,
            });

            try {
              const { callId } = await triggerCall(business.phone, {
                task: query,
                timeWindow: prefs.timeWindow,
                budget: prefs.budget,
                businessName: name,
              });

              await updateQueueItemStatus(name, "in-progress", callId);

              send("business_update", {
                name,
                status: "call_initiated",
                detail: `Call placed to ${name}. Waiting for result...`,
                callId,
              });
            } catch (err) {
              send("business_update", {
                name,
                status: "failed",
                detail: `Call to ${name} failed. Moving on.`,
              });
            }
          } else {
            //Closed — queue for when they open tomorrow
            const tomorrow9am = new Date();
            tomorrow9am.setDate(tomorrow9am.getDate() + 1);
            tomorrow9am.setHours(9, 0, 0, 0);

            await addToQueue({
              businessName: name,
              phone: business.phone,
              scheduledTime: tomorrow9am,
              userId,
              context: {
                task: query,
                timeWindow: prefs.timeWindow,
                budget: prefs.budget,
              },
            });

            send("business_update", {
              name,
              status: "queued",
              detail: `${name} is closed. Donna will call when they open.`,
              scheduledTime: tomorrow9am.toISOString(),
            });
          }
        }

        send("done", { message: "Donna's handled everything on the list." });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
