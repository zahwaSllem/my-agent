import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1) الأداة: دالة عادية بتجيب الوقت
function getCurrentTime() {
  return { time: new Date().toLocaleTimeString() };
}

// 2) وصف الأداة للموديل علشان يعرف إنها موجودة
const tools = [{
  functionDeclarations: [{
    name: "getCurrentTime",
    description: "Returns the current local time",
  }],
}];

// 3) المحادثة
const contents = [
  { role: "user", parts: [{ text: "Tell me a short joke?" }] },
];

// 4) اللوب: قلب الـ agent
while (true) {
  const res = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents,
    config: { tools },
  });

  if (res.functionCalls && res.functionCalls.length > 0) {
    const call = res.functionCalls[0];
    console.log("[Agent is using tool]:", call.name);

    const result = getCurrentTime();

    contents.push(res.candidates[0].content);
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name: call.name, id: call.id, response: result } }],
    });
  } else {
    console.log("[Agent]:", res.text);
    break;
  }
}