import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

export interface BookingDetails {
  businessName: string;
  address?: string;
  dateTime: string; //ISO string
  durationMinutes?: number;
  price?: string;
  stylistName?: string;
  summary?: string;
  color?: string; // color name e.g. "yellow", "red", "blue"
}

const COLOR_MAP: Record<string, string> = {
  lavender: "1", sage: "2", grape: "3", purple: "3",
  flamingo: "4", pink: "4", banana: "5", yellow: "5",
  tangerine: "6", orange: "6", peacock: "7", teal: "7", blue: "7",
  blueberry: "8", navy: "8", darkblue: "8", basil: "9", green: "9",
  tomato: "10", red: "10", scarlet: "11",
};

function getOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

//Generate the URL the user visits to connect their Google Calendar
export function getAuthUrl(): string {
  const auth = getOAuthClient();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });
}

//Exchange the OAuth code for tokens — call this in the callback route
export async function getTokensFromCode(code: string) {
  const auth = getOAuthClient();
  const { tokens } = await auth.getToken(code);
  return tokens;
}

//Build an authenticated client from a stored refresh token
function getAuthedClient(refreshToken: string) {
  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

//Create a calendar event after a booking is confirmed
export async function createEvent(
  booking: BookingDetails,
  refreshToken: string
): Promise<string> {
  const auth = getAuthedClient(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const start = new Date(booking.dateTime);
  const end = new Date(start.getTime() + (booking.durationMinutes ?? 60) * 60 * 1000);

  const descriptionParts = [
    booking.price ? `Price: ${booking.price}` : "",
    booking.stylistName ? `Stylist: ${booking.stylistName}` : "",
    booking.summary ? `Notes: ${booking.summary}` : "",
    "Booked by Donna.",
  ].filter(Boolean);

  const colorId = booking.color ? COLOR_MAP[booking.color.toLowerCase().replace(/\s/g, "")] : undefined;

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `${booking.businessName}`,
      location: booking.address,
      description: descriptionParts.join("\n"),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      ...(colorId ? { colorId } : {}),
    },
  });

  return event.data.id ?? "";
}

//Read calendar events within a time range
export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

export async function getEvents(
  refreshToken: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const auth = getAuthedClient(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "Busy",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
  }));
}

//Find free time blocks in a list of events within a day window
export interface FreeBlock {
  start: string;
  end: string;
  durationMinutes: number;
}

export function getFreeBlocks(
  events: CalendarEvent[],
  dayStart: Date,
  dayEnd: Date,
  minBlockMinutes = 60
): FreeBlock[] {
  const blocks: FreeBlock[] = [];
  let cursor = dayStart.getTime();

  for (const event of events) {
    const eventStart = new Date(event.start).getTime();
    const gap = eventStart - cursor;
    if (gap >= minBlockMinutes * 60 * 1000) {
      blocks.push({
        start: new Date(cursor).toISOString(),
        end: new Date(eventStart).toISOString(),
        durationMinutes: Math.floor(gap / 60000),
      });
    }
    cursor = Math.max(cursor, new Date(event.end).getTime());
  }

  const remaining = dayEnd.getTime() - cursor;
  if (remaining >= minBlockMinutes * 60 * 1000) {
    blocks.push({
      start: new Date(cursor).toISOString(),
      end: dayEnd.toISOString(),
      durationMinutes: Math.floor(remaining / 60000),
    });
  }

  return blocks;
}

//Delete a single calendar event
export async function deleteEvent(
  eventId: string,
  refreshToken: string
): Promise<void> {
  const auth = getAuthedClient(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
}

//Delete all future events (or all events within a range)
export async function deleteAllEvents(
  refreshToken: string,
  timeMin = new Date().toISOString(),
  timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  filter?: string
): Promise<number> {
  const events = await getEvents(refreshToken, timeMin, timeMax);
  const toDelete = filter
    ? events.filter(e => e.summary?.toLowerCase().includes(filter.toLowerCase()))
    : events;
  for (const e of toDelete) {
    await deleteEvent(e.id, refreshToken);
  }
  return toDelete.length;
}

//Update an existing event if the appointment changes
export async function updateEvent(
  eventId: string,
  changes: Partial<BookingDetails>,
  refreshToken: string
): Promise<void> {
  const auth = getAuthedClient(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const patch: Record<string, unknown> = {};
  if (changes.businessName) patch.summary = changes.businessName;
  if (changes.dateTime) {
    const start = new Date(changes.dateTime);
    const end = new Date(start.getTime() + (changes.durationMinutes ?? 60) * 60 * 1000);
    patch.start = { dateTime: start.toISOString() };
    patch.end = { dateTime: end.toISOString() };
  }
  if (changes.address) patch.location = changes.address;
  if (changes.color) {
    const colorId = COLOR_MAP[changes.color.toLowerCase().replace(/\s/g, "")];
    if (colorId) patch.colorId = colorId;
  }

  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: patch,
  });
}
