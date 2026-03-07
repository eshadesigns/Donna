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
}

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

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `${booking.businessName}`,
      location: booking.address,
      description: descriptionParts.join("\n"),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  return event.data.id ?? "";
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
  if (changes.dateTime) {
    const start = new Date(changes.dateTime);
    const end = new Date(start.getTime() + (changes.durationMinutes ?? 60) * 60 * 1000);
    patch.start = { dateTime: start.toISOString() };
    patch.end = { dateTime: end.toISOString() };
  }
  if (changes.address) patch.location = changes.address;

  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: patch,
  });
}
