import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_KEY = process.env.ELEVEN_API_KEY;

const eleven = new ElevenLabsClient({
  apiKey: ELEVEN_KEY,
});

// =======================
//  AI QUESTION ENDPOINT
// =======================
app.post("/ask", async (req, res) => {
  const question = req.body.question;

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: question }],
            },
          ],
        }),
      }
    );

    const data = await geminiResponse.json();
    const answer = data.candidates[0].content.parts[0].text;

    res.json({ answer });
  } catch (err) {
    console.log(err);
    res.json({ answer: "Error contacting AI" });
  }
});

// =======================
//  VOICE GENERATION (TTS)
// =======================
app.post("/voice", async (req, res) => {
  const { text } = req.body;

  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
        }),
      }
    );

    const audioBuffer = await response.arrayBuffer();

    res.set({
      "Content-Type": "audio/mpeg",
    });

    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    console.error(error);
    res.status(500).send("Voice generation failed");
  }
});

// =======================
//  (OPTIONAL) CALL ENDPOINT
//  Add Twilio here later
// =======================
app.post("/call", async (req, res) => {
  const { phone, message } = req.body;

  // Placeholder for Twilio integration
  res.json({
    message: "Call functionality not yet implemented",
    phone,
    script: message,
  });
});

// =======================
app.listen(3000, () => {
  console.log("Server running on port 3000");
});