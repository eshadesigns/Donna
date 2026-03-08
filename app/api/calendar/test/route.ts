import { getEvents, createEvent } from "@/lib/calendar";

// GET /api/calendar/test — verifies the calendar connection and lists upcoming events
export async function GET() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    return Response.json({ ok: false, error: "GOOGLE_REFRESH_TOKEN is not set in .env.local" });
  }

  try {
    const now = new Date();
    const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const events = await getEvents(refreshToken, now.toISOString(), in30days.toISOString());
    return Response.json({
      ok: true,
      tokenSet: true,
      upcomingEvents: events.slice(0, 5).map((e) => ({ summary: e.summary, start: e.start })),
      count: events.length,
    });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// POST /api/calendar/test — creates a test event 1 hour from now
export async function POST() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    return Response.json({ ok: false, error: "GOOGLE_REFRESH_TOKEN is not set" });
  }

  try {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const eventId = await createEvent({
      businessName: "Donna Test Event",
      dateTime: soon.toISOString(),
      durationMinutes: 30,
      summary: "Created by Donna to verify calendar integration.",
    }, refreshToken);
    return Response.json({ ok: true, eventId, scheduledFor: soon.toISOString() });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
