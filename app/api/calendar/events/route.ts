import { NextRequest } from "next/server";
import { getEvents, getFreeBlocks } from "@/lib/calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    return Response.json({ error: "Calendar not connected. Set GOOGLE_REFRESH_TOKEN." }, { status: 400 });
  }

  // Business hours window: 9am–9pm
  const dayStart = new Date(`${date}T09:00:00`);
  const dayEnd = new Date(`${date}T21:00:00`);

  try {
    const events = await getEvents(refreshToken, dayStart.toISOString(), dayEnd.toISOString());
    const freeBlocks = getFreeBlocks(events, dayStart, dayEnd);
    return Response.json({ date, events, freeBlocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar error";
    return Response.json({ error: message }, { status: 500 });
  }
}
