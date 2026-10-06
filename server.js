import express from "express";
import cors from "cors";
import { GoogleGenAI, Type } from "@google/genai";


import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();
app.use(cors());
app.use(express.json());
const SYSTEM_PROMPT = `
You are Nour, a smart productivity assistant.
Today's date is: ${new Date().toDateString()}

## Your main job
Help the user organize their thoughts, ideas, and tasks.
When the user shares random thoughts or ideas, turn them into a structured task list.

## How to handle tasks
When the user gives you thoughts or ideas:
1. Extract the tasks from what they said.
2. Sort them by priority:
   - 🔴 Urgent & important (deadline soon or blocks other work)
   - 🟡 Important but not urgent (do this week)
   - 🟢 Nice to do (someday)
3. For each task, suggest a simple next action.
4. Ask if the list looks right before saving anything.

## Example
User: "عايزة أعمل portfolio، ومحتاجة أراجع CSS، وعندي إنترفيو الأسبوع الجاي"
You:
"حددتلك 3 مهام:
🔴 التحضير للإنترفيو (الأسبوع الجاي - الأعجل)
  → ابدأي بأسئلة الإنترفيو الشائعة
🟡 مراجعة CSS (مفيدة للإنترفيو كمان)
  → خصصي ساعة يومياً
🟢 Portfolio (بعد الإنترفيو)
  → ابدأي بتجميع مشاريعك
الترتيب ده مناسب؟"

## Language
- Always reply in the same language the user writes in.
- If the user writes in Egyptian Arabic, reply in Egyptian Arabic.

## Tools
- Today's date is: ${new Date().toDateString()}
- Use searchWeb for any current information or news.
- Use getWeather when asked about weather.
- Use getCurrentTime when asked about time.
- Never guess or invent facts. Always use a tool if one fits.

## Formatting
- Use emojis for priorities (🔴🟡🟢).
- Keep answers short and actionable.
- Always end task lists with a confirmation question.
`;
// ===== الأدوات =====

function getCurrentTime() {
  return { time: new Date().toLocaleTimeString() };
}

async function searchWeb(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 3,
        days: 30,
    }),
  });
  const data = await res.json();
  return {
    results: data.results.map((r) => ({
      title: r.title,
      url: r.url,
      summary: r.content?.slice(0, 300),
    })),
  };
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
async function runTool(name, args, userId) {
  if (name === "getCurrentTime") return getCurrentTime();
  if (name === "getWeather") return await getWeather(args.city);
  if (name === "searchWeb") return await searchWeb(args.query);


  if (name === "saveTasks") {
  const rows = args.tasks.map((t) => ({
    user_id: userId,
    title: t.text,
    priority: t.priority,
    status: t.status,
  }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) console.error("Supabase insert failed:", error.message);
  // Always return the tasks so the client can keep them, even if Supabase failed
  return { success: !error, saved: error ? 0 : rows.length, tasks: args.tasks };
}

if (name === "getTasks") {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { tasks: data.map((t) => ({ ...t, text: t.title })) };
}
 return { error: "Unknown tool" };
}



async function getUser(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
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

{
  name: "searchWeb",
  description: "Search the internet for current news, facts, or any real-world information",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Search query in English" },
    },
    required: ["query"],
  },
},

{
  name: "saveTasks",
  description: "Save a list of tasks to the database after the user confirms them",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tasks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            priority: { type: Type.STRING, description: "high, medium, or low" },
            status: { type: Type.STRING, description: "always 'todo'" },
          },
        },
      },
    },
    required: ["tasks"],
  },
},
{
  name: "getTasks",
  description: "Get all saved tasks from the database",
  parameters: {
    type: Type.OBJECT,
    properties: {},
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
    // 1) نتأكد إن في مستخدم مسجّل دخول
    const user = await getUser(req);
    if (!user) return res.status(401).json({ reply: "لازم تسجّلي دخول الأول." });

    const contents = req.body.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    let savedTasks = null;

    while (true) {
      const r = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents,
        config: { tools, systemInstruction: SYSTEM_PROMPT },
      });

      if (r.functionCalls && r.functionCalls.length > 0) {
        const call = r.functionCalls[0];
        console.log("Agent is using tool:", call.name, call.args);

        // 2) نمرّر user.id للأداة
        const result = await runTool(call.name, call.args, user.id);
        if (call.name === "saveTasks" && result.tasks) savedTasks = result.tasks;

        contents.push(r.candidates[0].content);
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: call.name, id: call.id, response: result } }],
        });
      } else {
        return res.json({ reply: r.text, ...(savedTasks && { tasks: savedTasks }) });
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