import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const audio = formData.get("audio") as File | null;
  if (!audio) return Response.json({ error: "No audio provided" }, { status: 400 });

  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: audio,
    language: "en",
  });

  return Response.json({ text: transcription.text });
}
