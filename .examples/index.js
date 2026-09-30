import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const res = await ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: "Introduce yourself in one sentence",
});

console.log(res.text);