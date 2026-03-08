import { NextRequest } from "next/server";
import { parseIntent, scoreAndRankResults, extractCalendarIntent, generateDonnaReply, summarizeCallForDonna, cleanCallContext } from "@/lib/gemini";
import { searchNearby } from "@/lib/tavily";
import { triggerCall, pollCallResult } from "@/lib/vapi";
import { addToQueue, updateQueueItemStatus } from "@/lib/mongo";
import { createEvent, getEvents, getFreeBlocks, deleteAllEvents, deleteEvent, updateEvent } from "@/lib/calendar";
import type { UserPrefs } from "@/lib/gemini";

//SSE helper

function sseEvent(type: string, data: unknown): string {
  return `data: ${JSON.stringify({ type, ...( typeof data === "object" ? data : { data }) })}\n\n`;
}

//No prefs yet → return clarifying questions. Prefs provided → stream the full pipeline.

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    query: string;
    prefs?: UserPrefs;
    userId?: string;
    userProfile?: { name?: string; location?: string; hairType?: string; budget?: string; notes?: string };
    confirmedDelete?: { filter: string };
  };

  const { query: rawQuery, userId = "default", userProfile } = body;
  // mutable so we can synthesize prefs when we have enough context from intent + profile
  let prefs: UserPrefs | undefined = body.prefs;

  // ── Confirmed delete — short-circuit before intent parsing ─────────────────
  if (body.confirmedDelete) {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ done: true, message: "Calendar not connected." });
    }
    try {
      const count = await deleteAllEvents(refreshToken, undefined, undefined, body.confirmedDelete.filter);
      return Response.json({ done: true, message: count > 0 ? `Done. Deleted ${count} event${count === 1 ? "" : "s"}.` : `No matching events found.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calendar error";
      return Response.json({ error: `Couldn't delete: ${msg}` }, { status: 500 });
    }
  }

  // ── Step 0: Parse & enrich the raw query ───────────────────────────────────
  const todayISO = new Date().toISOString();
  let intent: Awaited<ReturnType<typeof parseIntent>>;
  try {
    intent = await parseIntent(rawQuery, todayISO);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI service error";
    return Response.json({ error: `Couldn't process your request: ${msg}` }, { status: 500 });
  }

  // Use the enriched query for all downstream steps
  const query = intent.enrichedQuery || rawQuery;

  if (intent.intent === "cancel") {
    return Response.json({ done: true, message: "Got it — I've stopped. No more calls will be made." });
  }

  if (intent.intent === "other") {
    const reply = await generateDonnaReply(rawQuery);
    return Response.json({ done: true, message: reply });
  }

  if (intent.intent === "calendar_edit") {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar access." });
    }
    const fromTitle = intent.editFrom?.toLowerCase();
    const toTitle = intent.editTo;
    const toColor = intent.editColor;
    if (!fromTitle || (!toTitle && !toColor)) {
      return Response.json({ error: "I couldn't figure out what to change. Try: 'rename [event] to [new name]' or 'change [event] color to yellow'." }, { status: 400 });
    }
    try {
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const events = await getEvents(refreshToken, timeMin, timeMax);
      const match = events.find(e => e.summary?.toLowerCase().includes(fromTitle));
      if (!match) {
        return Response.json({ done: true, message: `I couldn't find an event matching "${intent.editFrom}" in your calendar.` });
      }
      const changes: Parameters<typeof updateEvent>[1] = {};
      if (toTitle) changes.businessName = toTitle;
      if (toColor) changes.color = toColor;
      await updateEvent(match.id, changes, refreshToken);
      if (toColor && !toTitle) {
        return Response.json({ done: true, message: `Done. Changed "${match.summary}" to ${toColor}.` });
      }
      return Response.json({ done: true, message: `Done. Renamed "${match.summary}" to "${toTitle}".` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calendar error";
      return Response.json({ error: `Couldn't update the event: ${msg}` }, { status: 500 });
    }
  }

  if (intent.intent === "calendar_delete_and_add") {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar access." });
    }
    const filter = intent.deleteFilter;
    const results: string[] = [];
    try {
      // Step 1: delete
      if (filter) {
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const events = await getEvents(refreshToken, timeMin, timeMax);
        const matching = events.filter(e => e.summary?.toLowerCase().includes(filter.toLowerCase()));
        for (const ev of matching) {
          await deleteEvent(ev.id, refreshToken);
        }
        results.push(matching.length > 0 ? `Removed ${matching.length} "${filter}" event${matching.length === 1 ? "" : "s"}.` : `No "${filter}" events found.`);
      }
      // Step 2: add new event
      const calIntent = await extractCalendarIntent(rawQuery, todayISO);
      const eventsToCreate = calIntent.isCalendarAction
        ? (calIntent.events && calIntent.events.length > 0 ? calIntent.events : [])
        : [];
      for (const ev of eventsToCreate) {
        await createEvent({
          businessName: ev.title ?? "Event",
          dateTime: ev.dateTime,
          durationMinutes: ev.durationMinutes ?? 60,
          address: ev.location ?? undefined,
          summary: ev.description ?? undefined,
          color: ev.color ?? undefined,
        }, refreshToken);
      }
      if (eventsToCreate.length > 0) {
        const names = eventsToCreate.map(e => `"${e.title}"`).join(" and ");
        results.push(`Added ${names} to your calendar.`);
      }
      return Response.json({ done: true, message: results.join(" ") || "Done." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calendar error";
      return Response.json({ error: `Couldn't update calendar: ${msg}` }, { status: 500 });
    }
  }

  if (intent.intent === "calendar_delete") {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken) {
      return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar access." });
    }
    const filter = intent.deleteFilter;
    if (!filter) {
      return Response.json({ done: true, message: "I can only delete specific events — tell me which ones. For example: \"delete my hair appointments\"." });
    }
    try {
      // Preview matching events and ask for confirmation
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const events = await getEvents(refreshToken, timeMin, timeMax);
      const matching = events.filter(e => e.summary?.toLowerCase().includes(filter.toLowerCase()));
      if (matching.length === 0) {
        return Response.json({ done: true, message: `No events matching "${filter}" found in your calendar.` });
      }
      return Response.json({ confirmDelete: { filter, events: matching } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Calendar error";
      return Response.json({ error: `Couldn't process delete: ${msg}` }, { status: 500 });
    }
  }

  const isCalendarIntent = intent.intent === "calendar_add" || intent.addToCalendar === true;

  // Legacy keyword fallback — only applies when Gemini didn't already classify as business_search
  const lq = query.toLowerCase();
  const calendarVerbs = ["add to calendar","add event","create event","schedule event","put on calendar","add to my calendar","add it to my calendar","add an event","add a","schedule a","set up a","set a","put a"];
  const calendarNouns = ["appointment","event","meeting","reminder","session","slot","booking"];
  const isCalendarKeyword = intent.intent !== "business_search" && (isCalendarIntent || (calendarVerbs.some(kw => lq.includes(kw)) && calendarNouns.some(kw => lq.includes(kw))));

  //Step A — calendar intent + clarifying question, only on first call (no prefs yet)
  //If prefs already provided, user answered the question — skip straight to pipeline
  if (!prefs) {
    try {
      const calIntent = isCalendarKeyword
        ? await extractCalendarIntent(query, todayISO)
        : { isCalendarAction: false as const };

      // Support both new multi-event array and legacy single-event fields
      const eventsToCreate = calIntent.isCalendarAction
        ? (calIntent.events && calIntent.events.length > 0
            ? calIntent.events
            : calIntent.dateTime
              ? [{ title: calIntent.title ?? "Event", dateTime: calIntent.dateTime, durationMinutes: calIntent.durationMinutes, location: calIntent.location, description: calIntent.description, color: undefined }]
              : [])
        : [];

      if (eventsToCreate.length > 0) {
        const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
        if (!refreshToken) {
          return Response.json({ done: true, message: "Calendar not connected — set GOOGLE_REFRESH_TOKEN to enable calendar events." });
        }
        try {
          for (const ev of eventsToCreate) {
            await createEvent({
              businessName: ev.title ?? "Event",
              dateTime: ev.dateTime,
              durationMinutes: ev.durationMinutes ?? 60,
              address: ev.location ?? undefined,
              summary: ev.description ?? undefined,
              color: ev.color ?? undefined,
            }, refreshToken);
          }
          const names = eventsToCreate.map(e => `"${e.title}"`).join(" and ");
          const msg = eventsToCreate.length === 1
            ? `Done! ${names} added to your calendar.`
            : `Done! Added ${eventsToCreate.length} events: ${names}.`;
          return Response.json({ done: true, message: msg });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Calendar error";
          return Response.json({ error: `Couldn't add to calendar: ${msg}` }, { status: 500 });
        }
      }

      if (!isCalendarKeyword) {
        // What we already know from intent + user profile
        const knownLocation = intent.locationMentioned || userProfile?.location || process.env.DEMO_LOCATION;

        if (intent.dateTime && knownLocation) {
          // We have time + location — skip questions entirely
          const fmt = new Date(intent.dateTime).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          prefs = { location: knownLocation, timeWindow: fmt, budget: userProfile?.budget };
        } else if (intent.noFurtherQuestions && knownLocation) {
          // User said "just do it" — proceed without time
          prefs = { location: knownLocation, budget: userProfile?.budget };
        } else if (intent.dateTime) {
          // Know when, not where
          return Response.json({ questions: [{ id: "location", icon: "📍", label: "Location", question: "Where should I search? I'll use your profile location if you have one saved.", inputType: "location" }] });
        } else {
          // Ask only for time — location comes from profile or DEMO_LOCATION
          const locationNote = knownLocation ? ` I'll search near ${knownLocation}.` : "";
          return Response.json({ questions: [{ id: "time", icon: "🕐", label: "Time", question: `When do you want this?${locationNote}`, inputType: "text" }] });
        }
      } else {
        // Calendar keyword but couldn't extract date/time — ask for it
        if (!calIntent.isCalendarAction || !calIntent.dateTime) {
          return Response.json({ questions: [{ id: "datetime", icon: "📅", label: "Date & Time", question: "What date and time should I add this event?", inputType: "text" }] });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // At this point prefs must be defined (all !prefs paths either return or set prefs above)
  const activePrefs: UserPrefs = prefs ?? {};

  //Step B — we have what we need, run the pipeline
  // Use profile/env location if not provided
  if (!activePrefs.location) {
    activePrefs.location = userProfile?.location || process.env.DEMO_LOCATION || "New York, NY";
  }
  // Map the "time" answer to timeWindow if user answered the single question
  if (!activePrefs.timeWindow && (activePrefs as Record<string, string>)["time"]) {
    activePrefs.timeWindow = (activePrefs as Record<string, string>)["time"];
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) => {
        controller.enqueue(enc.encode(sseEvent(type, data)));
      };

      function toE164(phone: string): string {
        const digits = phone.replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        return phone.startsWith("+") ? phone : `+${digits}`;
      }

      try {
        //Auto-detect availability from calendar if no timeWindow given
        if (!activePrefs.timeWindow && process.env.GOOGLE_REFRESH_TOKEN) {
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
              activePrefs.timeWindow = `${fmt(pick.start)}–${fmt(pick.end)}`;
              send("status", { message: `Donna checked your calendar — you're free ${activePrefs.timeWindow}.` });
            }
          } catch { /* calendar unavailable, proceed without */ }
        }

        //Search
        send("status", { message: "Donna's scanning the web..." });
        const raw = await searchNearby(query, activePrefs.location!, activePrefs.radius || "10 miles");

        if (raw.length === 0) {
          send("error", { message: "No businesses found. Try a different search." });
          controller.close();
          return;
        }

        //Rank — pass userProfile so scoring considers hair type, budget, preferences
        send("status", { message: `Found ${raw.length} options. Donna is ranking them...` });
        const ranked = await scoreAndRankResults(query, raw, activePrefs, userProfile);
        send("ranked", { businesses: ranked });

        //Always call — use demo number if set, otherwise the top business's real number
        const top = ranked[0];
        for (const business of [top]) {
          const name = business.name;

          send("business_update", {
            name,
            status: "calling",
            detail: `Donna's on the phone with ${name}...`,
          });

          // Always call: demo number takes priority, fall back to real phone
          const rawPhone = process.env.DEMO_PHONE_NUMBER || business.phone || "";
          const phoneToCall = rawPhone ? toE164(rawPhone) : "";

          if (phoneToCall) {
            try {
              const clientNotesParts = [
                userProfile?.hairType,
                userProfile?.notes,
              ].filter(Boolean);
              const cleanCtx = await cleanCallContext({ timeWindow: activePrefs.timeWindow, task: query });
              const { callId } = await triggerCall(phoneToCall, {
                task: cleanCtx.task ?? query,
                service: intent.service,
                clientNotes: clientNotesParts.length > 0 ? clientNotesParts.join(". ") : undefined,
                timeWindow: cleanCtx.timeWindow,
                budget: userProfile?.budget || activePrefs.budget,
                businessName: name,
              });

              try { await updateQueueItemStatus(name, "in-progress", callId); } catch {}

              send("business_update", {
                name,
                status: "call_initiated",
                detail: `Donna is on the phone with ${name}...`,
                callId,
              });

              // Poll for call result (up to 3 min)
              const result = await pollCallResult(callId);
              if (result?.transcript) {
                const summary = await summarizeCallForDonna(result.transcript, name);
                send("call_result", {
                  name,
                  callId,
                  transcript: result.transcript,
                  summary,
                });
              }
            } catch (err) {
              const rawMsg = err instanceof Error ? err.message : String(err);
              console.error(`Vapi call failed for ${name}:`, rawMsg);
              const friendlyMsg = rawMsg.includes("daily outbound call limit")
                ? "Daily call limit reached. Upgrade your Vapi plan or import a Twilio number to keep going."
                : rawMsg.includes("concurrency")
                ? "Too many calls at once — try again in a moment."
                : "Couldn't reach the business. Moving on.";
              send("business_update", {
                name,
                status: "failed",
                detail: friendlyMsg,
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
                phone: business.phone ?? "",
                scheduledTime: tomorrow9am,
                userId,
                context: {
                  task: query,
                  timeWindow: activePrefs.timeWindow,
                  budget: activePrefs.budget,
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

        send("done", {
          message: null,
          businessName: ranked[0]?.name,
          timeWindow: activePrefs.timeWindow,
        });
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
