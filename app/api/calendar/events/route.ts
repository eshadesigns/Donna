import { NextRequest } from "next/server";
import { getEvents, getFreeBlocks } from "@/lib/calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    return Response.json({ error: "Calendar not connected. Set GOOGLE_REFRESH_TOKEN." }, { status: 400 });
  }

  // Support either a date (single day) or a timeMin/timeMax range
  const timeMin = searchParams.get("timeMin") ?? (() => {
    const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];
    return new Date(`${date}T09:00:00`).toISOString();
  })();
  const timeMax = searchParams.get("timeMax") ?? (() => {
    const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];
    return new Date(`${date}T21:00:00`).toISOString();
  })();

  try {
    const events = await getEvents(refreshToken, timeMin, timeMax);
    const dayStart = new Date(timeMin);
    const dayEnd = new Date(timeMax);
    const freeBlocks = getFreeBlocks(events, dayStart, dayEnd);
    return Response.json({ events, freeBlocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar error";
    return Response.json({ error: message }, { status: 500 });
  }
}
