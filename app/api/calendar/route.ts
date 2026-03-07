import { NextRequest } from "next/server";
import { getAuthUrl, createEvent } from "@/lib/calendar";
import type { BookingDetails } from "@/lib/calendar";

//GET /api/calendar — redirect user to Google OAuth
export async function GET() {
  const url = getAuthUrl();
  return Response.redirect(url);
}

//POST /api/calendar — create a calendar event after a booking is confirmed
export async function POST(req: NextRequest) {
  const { booking, refreshToken } = await req.json() as {
    booking: BookingDetails;
    refreshToken: string;
  };

  if (!refreshToken) {
    return Response.json({ error: "Not authenticated with Google Calendar" }, { status: 401 });
  }

  try {
    const eventId = await createEvent(booking, refreshToken);
    return Response.json({ success: true, eventId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create calendar event";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
