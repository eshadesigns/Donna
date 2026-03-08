import { NextRequest } from "next/server";
import { parseIntent, generateClarifyingQuestions, scoreAndRankResults, extractCalendarIntent } from "@/lib/gemini";
import { searchNearby } from "@/lib/tavily";
import { triggerCall } from "@/lib/vapi";
import { addToQueue, updateQueueItemStatus } from "@/lib/mongo";
import { createEvent, getEvents, getFreeBlocks, deleteAllEvents } from "@/lib/calendar";
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

  const { query: rawQuery, prefs, userId = "default" } = body;

  // ── Step 0: Parse & enrich the raw query ───────────────────────────────────
  const todayISO = new Date().toISOString();
  const intent = await parseIntent(rawQuery, todayISO);

  // Use the enriched query for all downstream steps
  const query = intent.enrichedQuery || rawQuery;

  if (intent.intent === "cancel") {
    return Response.json({ done: true, message: "Got it — I've stopped. No more calls will be made." });
  }

  if (intent.intent === "calendar_delete") {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar access." });
    }
    try {
      const count = await deleteAllEvents(refreshToken);
      return Response.json({ done: true, message: count > 0 ? `Done! Deleted ${count} event${count === 1 ? "" : "s"} from your calendar.` : "Your calendar is already empty." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calendar error";
      return Response.json({ error: `Couldn't delete events: ${msg}` }, { status: 500 });
    }
  }

  const isCalendarIntent = intent.intent === "calendar_add" || intent.addToCalendar === true;

  // Legacy keyword fallback (belt-and-suspenders)
  const lq = query.toLowerCase();
  const calendarVerbs = ["add to calendar","add event","create event","schedule event","put on calendar","add to my calendar","add it to my calendar","add an event","add a","book a","book an","schedule a","set up a","set a","put a"];
  const calendarNouns = ["appointment","event","meeting","reminder","session","slot","booking"];
  const isCalendarKeyword = isCalendarIntent || (calendarVerbs.some(kw => lq.includes(kw)) && calendarNouns.some(kw => lq.includes(kw)));

  //Step A — check for calendar intent first, then ask clarifying questions if needed
  if (isCalendarKeyword || !prefs || !prefs.location) {
    try {
      const calIntent = isCalendarKeyword
        ? await extractCalendarIntent(query, todayISO)
        : { isCalendarAction: false };

      if (calIntent.isCalendarAction && calIntent.dateTime) {
        //Have enough info — create the event directly
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
        if (!refreshToken) {
          return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar events." });
        }
        try {
          await createEvent({
            businessName: calIntent.title ?? "Event",
            dateTime: calIntent.dateTime,
            durationMinutes: calIntent.durationMinutes ?? 60,
            address: calIntent.location ?? undefined,
            summary: calIntent.description ?? undefined,
          }, refreshToken);
          return Response.json({ done: true, message: `Done! "${calIntent.title}" added to your calendar.` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Calendar error";
          return Response.json({ error: `Couldn't add to calendar: ${msg}` }, { status: 500 });
        }
      }

      if (!isCalendarKeyword) {
        const questions = await generateClarifyingQuestions(query);
        return Response.json({ questions });
      }

      // Calendar keyword but AI couldn't extract date/time — ask for it
      return Response.json({ questions: [{ id: "datetime", icon: "📅", label: "Date & Time", question: "What date and time should I add this event?", inputType: "text" }] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  //Step B — we have what we need, run the pipeline
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) => {
        controller.enqueue(enc.encode(sseEvent(type, data)));
      };

      try {
        //Auto-detect availability from calendar if no timeWindow given
        if (!prefs.timeWindow && process.env.GOOGLE_REFRESH_TOKEN) {
          try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dateStr = tomorrow.toISOString().split("T")[0];
            const dayStart = new Date(`${dateStr}T08:00:00`);
            const dayEnd = new Date(`${dateStr}T22:00:00`);
            const calEvents = await getEvents(process.env.GOOGLE_REFRESH_TOKEN, dayStart.toISOString(), dayEnd.toISOString());
            const freeBlocks = getFreeBlocks(calEvents, dayStart, dayEnd, 60);
            // Prefer evening block (7pm+), fall back to any free block
            const pick = freeBlocks.find(b => new Date(b.start).getHours() >= 19) ?? freeBlocks[0];
            if (pick) {
              const fmt = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
              prefs.timeWindow = `${fmt(pick.start)}–${fmt(pick.end)}`;
              send("status", { message: `Donna checked your calendar — you're free ${prefs.timeWindow}.` });
            }
          } catch { /* calendar unavailable, proceed without */ }
        }

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

            //Use demo number if set, otherwise call the real business
            const phoneToCall = process.env.DEMO_PHONE_NUMBER || business.phone;
            try {
              const { callId } = await triggerCall(phoneToCall, {
                task: query,
                timeWindow: prefs.timeWindow,
                budget: prefs.budget,
                businessName: name,
              });

              try { await updateQueueItemStatus(name, "in-progress", callId); } catch {}

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

            try {
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
            } catch {}

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
