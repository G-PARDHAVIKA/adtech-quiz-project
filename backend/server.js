import express from "express";
import cors from "cors";
import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { Configuration, OpenAIApi } from "openai";

const app = express();
app.use(cors());
app.use(express.json());

// --- Leaderboard DB setup (SQLite) ---
let db;
(async () => {
  db = await open({ filename: new URL('./leaderboard.db', import.meta.url).pathname, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    score INTEGER,
    total INTEGER,
    level TEXT,
    date INTEGER
  )`);
})();

// --- OpenAI setup (optional, uses OPENAI_API_KEY env var) ---
let openai = null;
if (process.env.OPENAI_API_KEY) {
  const conf = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
  openai = new OpenAIApi(conf);
}

// Read simple knowledge base from book.txt and parse short facts into subjects and definitions
async function loadFacts() {
  const text = await fs.readFile(new URL("./book.txt", import.meta.url), "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const facts = lines.map((line) => {
    // Try common patterns: 'means', 'stands for', ' use ', ' uses ', verbs like 'buys', 'is', 'are'
    const patterns = [/\bmeans\b/i, /\bstands for\b/i, /\buses?\b/i, /\bbuys\b/i, /\bis\b/i, /\bare\b/i];
    for (const p of patterns) {
      if (p.test(line)) {
        const parts = line.split(p);
        const subject = parts[0].trim().replace(/\.$/, "");
        const definition = parts.slice(1).join(" ").trim().replace(/\.$/, "");
        return { subject, definition, raw: line };
      }
    }
    // Fallback: take first two words as subject
    const subject = line.split(" ").slice(0, 2).join(" ").replace(/\.$/, "");
    const definition = line.replace(subject, "").trim().replace(/^,|^\s+/, "").replace(/\.$/, "");
    return { subject, definition: definition || "(definition not found)", raw: line };
  });

  return facts;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateFromFacts(facts, count = 20, level = "medium") {
  // Templates tuned to difficulty level
  const templatesEasy = [
    (f) => ({ q: `What does ${f.subject} mean?`, a: f.definition }),
    (f) => ({ q: `Which best describes ${f.subject}?`, a: f.definition }),
    (f) => ({ q: `Which of these is ${f.subject}?`, a: f.definition })
  ];

  const templatesMedium = [
    (f) => ({ q: `Which statement about ${f.subject} is correct?`, a: f.definition }),
    (f) => ({ q: `Pick the correct meaning of ${f.subject}:`, a: f.definition }),
    (f) => ({ q: `Which option describes ${f.subject}?`, a: f.definition })
  ];

  const templatesHard = [
    (f) => ({ q: `True or False: ${f.subject} ${f.definition}.`, a: "True" }),
    (f) => ({ q: `Which acronym matches: "${f.definition}"?`, a: f.subject }),
    (f) => ({ q: `Fill the blank: ${f.definition.replace(/\b\w+\b/, '_____')}`, a: f.subject })
  ];

  const questions = [];
  const seen = new Set();

  const otherDefs = facts.map((f) => f.definition);
  const otherSubjects = facts.map((f) => f.subject);

  const templates = level === "easy" ? templatesEasy : level === "hard" ? templatesHard : templatesMedium;

  // Keep generating until we reach requested count or exhaust reasonable attempts
  let attempts = 0;
  while (questions.length < count && attempts < Math.max(5000, count * 20)) {
    attempts++;
    const fact = facts[Math.floor(Math.random() * facts.length)];
    const tmpl = templates[Math.floor(Math.random() * templates.length)];
    const base = tmpl(fact);
    const questionText = base.q;

    // Make questions more unique by adding small variations
    const variation = Math.random() < 0.2 ? " (choose the best answer)" : "";
    const fullQuestion = questionText + variation;

    if (seen.has(fullQuestion)) continue;

    // Build options: include correct answer and 3 distractors tuned by level
    const options = new Set();
    options.add(base.a);

    const pool = base.a && otherDefs.includes(base.a) ? otherDefs : otherSubjects;

    // For hard, pick distractors that are more similar (by word overlap); for easy pick random
    const shuffledPool = shuffle(pool.slice());
    for (const p of shuffledPool) {
      if (options.size >= 4) break;
      if (p === base.a) continue;
      if (level === "hard") {
        // prefer distractors sharing at least one word
        const aWords = String(base.a).toLowerCase().split(/\W+/);
        const pWords = String(p).toLowerCase().split(/\W+/);
        const shared = aWords.filter((w) => pWords.includes(w) && w.length > 2);
        if (shared.length === 0 && Math.random() < 0.6) continue; // skip unrelated with some chance
      }
      options.add(p);
    }

    // If still less than 4, add generic distractors
    const genericDistractors = ["None of the above", "All of the above", "Not listed here", "Both are true"];
    for (const g of genericDistractors) {
      if (options.size >= 4) break;
      if (!options.has(g)) options.add(g);
    }

    const optionArr = shuffle(Array.from(options));

    const qObj = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      question: fullQuestion,
      options: optionArr,
      answer: base.a,
      raw: fact.raw,
      level
    };

    questions.push(qObj);
    seen.add(fullQuestion);
  }

  return questions;
}

let cachedFacts = null;

async function refineQuestions(questions, level = 'medium') {
  if (!openai) return questions;
  const refined = [];
  for (const q of questions) {
    try {
      const system = 'You are a helpful quiz editor. Return only valid JSON.';
      const prompt = `Refine and improve this multiple-choice question for a ${level} level learner. Input JSON: ${JSON.stringify(q)}. Return a JSON object with keys: question (string), options (array of 4 unique strings), answer (one of the options), explanation (short). Output only JSON.`;
      const resp = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        max_tokens: 400
      });
      const text = resp.data.choices[0].message.content.trim();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Try to extract JSON substring
        const match = text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }
      if (parsed && parsed.question && parsed.options && parsed.answer) {
        // ensure options length 4
        const options = Array.isArray(parsed.options) ? parsed.options.slice(0, 4) : q.options;
        // ensure answer in options
        if (!options.includes(parsed.answer)) options[0] = parsed.answer;
        refined.push({ ...q, question: parsed.question, options, answer: parsed.answer, explanation: parsed.explanation || '' });
      } else {
        refined.push(q);
      }
    } catch (err) {
      console.error('refine failed for q', q.id, err && err.message);
      refined.push(q);
    }
  }
  return refined;
}

app.get("/api/questions", async (req, res) => {
  try {
    // Support level: easy, medium, hard. Default is medium.
    const level = String(req.query.level || "medium").toLowerCase();
    const rawCount = parseInt(req.query.count || "100", 10);
    // Allow large counts but protect server: cap to 2000 by default
    const count = isNaN(rawCount) ? 100 : Math.max(1, Math.min(2000, rawCount));

    const refine = String(req.query.refine || "false").toLowerCase() === 'true';

    if (!cachedFacts) cachedFacts = await loadFacts();
    let questions = generateFromFacts(cachedFacts, count, level);

    if (refine && openai) {
      questions = await refineQuestions(questions, level);
    }

    res.json({ count: questions.length, questions, level });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate questions" });
  }
});

// Keep /api/question for single random question for backwards compatibility
app.get("/api/question", async (req, res) => {
  if (!cachedFacts) cachedFacts = await loadFacts();
  const q = generateFromFacts(cachedFacts, 1)[0];
  res.json(q);
});

// Leaderboard endpoints
app.post('/api/score', async (req, res) => {
  try {
    const { name, score, total, level } = req.body || {};
    if (!name || typeof score !== 'number' || typeof total !== 'number') {
      return res.status(400).json({ error: 'Invalid payload. Provide name, score (number), total (number).' });
    }
    await db.run('INSERT INTO scores (name, score, total, level, date) VALUES (?, ?, ?, ?, ?)', [name, score, total, level || 'unknown', Date.now()]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const level = req.query.level || 'all';
    const limit = Math.min(50, parseInt(req.query.limit || '10', 10));
    let rows;
    if (level === 'all') {
      rows = await db.all('SELECT name, score, total, level, date FROM scores ORDER BY score DESC, date ASC LIMIT ?', [limit]);
    } else {
      rows = await db.all('SELECT name, score, total, level, date FROM scores WHERE level = ? ORDER BY score DESC, date ASC LIMIT ?', [level, limit]);
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.listen(5000, () => console.log("✅ Backend running at http://localhost:5000"));
