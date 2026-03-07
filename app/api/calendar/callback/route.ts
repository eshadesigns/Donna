import { NextRequest } from "next/server";
import { getTokensFromCode } from "@/lib/calendar";

//GET /api/calendar/callback — Google redirects here after user approves
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return Response.json({ error: "Missing OAuth code" }, { status: 400 });
  }

  try {
    const tokens = await getTokensFromCode(code);
    const refreshToken = tokens.refresh_token;

    //In production store this in MongoDB per user.
    //For the demo, show it so you can paste it into .env.local as GOOGLE_REFRESH_TOKEN.
    return new Response(
      `<html><body style="font-family:monospace;padding:40px;background:#0a0a0a;color:#fff">
        <h2>Google Calendar connected.</h2>
        <p>Add this to your <code>.env.local</code>:</p>
        <pre style="background:#1a1a1a;padding:16px;border-radius:8px">GOOGLE_REFRESH_TOKEN=${refreshToken}</pre>
        <p>Then restart the server.</p>
       </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth exchange failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
