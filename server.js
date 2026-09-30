import express from "express";
import cors from "cors";
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
app.use(cors());
app.use(express.json());
const SYSTEM_PROMPT = `
You are Nour, a friendly and professional AI assistant.

## Personality
- Warm, patient, and encouraging.
- Clear and concise. Avoid unnecessary filler.
- Honest: if you don't know something, say so instead of guessing.

## Language
- Always reply in the same language the user writes in.
- If the user writes in Egyptian Arabic, reply in Egyptian Arabic.

## Tools
- You have access to tools for the current time and the weather.
- Always use a tool when the question needs live or real-world data.
- Never invent numbers, dates, or facts that a tool could provide.

## Formatting
- Keep answers short by default; expand only when asked.
- Use bullet points or headings only when they make the answer clearer.
`;
// ===== الأدوات =====

function getCurrentTime() {
  return { time: new Date().toLocaleTimeString() };
}

async function getWeather(city) {
  // 1) نجيب مكان المدينة على الخريطة
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
  ).then((r) => r.json());

  if (!geo.results) return { error: "City not found" };
  const { latitude, longitude, name } = geo.results[0];

  // 2) نجيب الطقس في المكان ده
  const w = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m`
  ).then((r) => r.json());

  return {
    city: name,
    temperature: w.current.temperature_2m + "°C",
    wind: w.current.wind_speed_10m + " km/h",
  };
}

// بيشغّل الأداة اللي الموديل طلبها
async function runTool(name, args) {
  if (name === "getCurrentTime") return getCurrentTime();
  if (name === "getWeather") return await getWeather(args.city);
  return { error: "Unknown tool" };
}

// وصف الأدوات للموديل
const tools = [{
  functionDeclarations: [
    {
      name: "getCurrentTime",
      description: "Returns the current local time",
    },
    {
      name: "getWeather",
      description: "Get the current weather for a city",
      parameters: {
        type: Type.OBJECT,
        properties: {
          city: { type: Type.STRING, description: "City name in English, e.g. Cairo" },
        },
        required: ["city"],
      },
    },
  ],
}];

// ===== السيرفر =====

app.get("/", (req, res) => {
  res.send("Server is working!");
});

app.post("/chat", async (req, res) => {
  try {
    const contents = req.body.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    while (true) {
      const r = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents,
          config: { tools, systemInstruction: SYSTEM_PROMPT },
      });

      if (r.functionCalls && r.functionCalls.length > 0) {
        const call = r.functionCalls[0];
        console.log("Agent is using tool:", call.name, call.args);

        const result = await runTool(call.name, call.args);

        contents.push(r.candidates[0].content);
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: call.name, id: call.id, response: result } }],
        });
      } else {
        return res.json({ reply: r.text });
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "حصلت مشكلة، جربي تاني." });
  }
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, (err) => {
    if (err) return console.error("Server error:", err.message);
    console.log(`Server running on port ${PORT}`);
  });
}

// لـ Vercel: هو اللي بيشغّل السيرفر بطريقته
export default app;