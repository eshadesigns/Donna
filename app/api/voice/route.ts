import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { text } = await req.json() as { text: string };

  if (!text) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!voiceId || !apiKey) {
    console.error("ElevenLabs env vars missing:", { voiceId: !!voiceId, apiKey: !!apiKey });
    return NextResponse.json({ error: "ElevenLabs not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.68, similarity_boost: 0.82, style: 0.15, use_speaker_boost: true },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("ElevenLabs TTS error:", res.status, body);
      return NextResponse.json({ error: `TTS failed: ${res.status} ${body}` }, { status: 500 });
    }

    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("ElevenLabs fetch threw:", err);
    return NextResponse.json({ error: "TTS network error" }, { status: 500 });
  }
}
