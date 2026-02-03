import express from "express";
import cors from "cors";
import fs from "fs/promises";

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/api/questions", async (req, res) => {
  try {
    // Support level: easy, medium, hard. Default is medium.
    const level = String(req.query.level || "medium").toLowerCase();
    const rawCount = parseInt(req.query.count || "100", 10);
    // Allow large counts but protect server: cap to 2000 by default
    const count = isNaN(rawCount) ? 100 : Math.max(1, Math.min(2000, rawCount));

    if (!cachedFacts) cachedFacts = await loadFacts();
    const questions = generateFromFacts(cachedFacts, count, level);
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

app.listen(5000, () => console.log("✅ Backend running at http://localhost:5000"));
