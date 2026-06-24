const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4173);

loadEnv(path.join(__dirname, ".env"));
loadEnv(path.join(ROOT, "bot", ".env"));
loadEnv(path.join(ROOT, "backend", ".env"));

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "database", "master_maximal_v14_openrouter_ready.db");
const DEFAULT_PASSWORD_HASH = "70e8d52a9b4616e728112408ceca7abd9507e93f30e958ecb09f6ea607d99d06";
const APP_PASSWORD_HASH = process.env.APP_PASSWORD_HASH || (
  process.env.APP_PASSWORD
    ? crypto.createHash("sha256").update(process.env.APP_PASSWORD).digest("hex")
    : DEFAULT_PASSWORD_HASH
);
const SESSION_COOKIE = "evm_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const SESSION_SAMESITE = process.env.SESSION_SAMESITE || "Lax";
const SESSION_SECURE = process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database file not found: ${DB_PATH}`);
  console.error("Set DB_PATH or include database/master_maximal_v14_openrouter_ready.db in the deployment.");
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const sessions = new Map();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=").trim();
  }
}

function send(res, code, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  const cacheControl = type.startsWith("application/json") || type.includes("html") || type.includes("javascript") || type.includes("css")
    ? "no-store"
    : "public, max-age=300";
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    ...extraHeaders
  });
  if (Buffer.isBuffer(body)) return res.end(body);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function healthPayload() {
  return {
    ok: true,
    service: "english-vocab-master-web",
    database: path.basename(DB_PATH),
    time: new Date().toISOString()
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${SESSION_SAMESITE}`,
    `Max-Age=${maxAge}`
  ];
  if (SESSION_SECURE) attrs.push("Secure");
  return attrs.join("; ");
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return parseCookies(req)[SESSION_COOKIE] || "";
}

function passwordMatches(input) {
  const actual = Buffer.from(crypto.createHash("sha256").update(String(input || "")).digest("hex"), "hex");
  const expected = Buffer.from(APP_PASSWORD_HASH, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requireAuth(req, res) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    send(res, 401, { error: "Unauthorized" });
    return false;
  }
  session.expires = Date.now() + 1000 * 60 * 60 * 12;
  return true;
}

function rows(sql, params = {}) {
  return db.prepare(sql).all(params);
}

function row(sql, params = {}) {
  return db.prepare(sql).get(params);
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function compact(value) {
  return String(value || "").trim();
}

function titleCase(value) {
  return compact(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function vocabSelect() {
  return "id, english, uzbek, topic, type, subtype, level, definition, example_en, example_uz, synonyms_json, register, usage_area, notes";
}

function wordLearning(item) {
  const english = compact(item.english);
  const topic = titleCase(item.topic);
  const type = titleCase(item.type);
  const subtype = titleCase(item.subtype);
  const register = titleCase(item.register || "neutral");
  const usageArea = titleCase(item.usage_area || "daily");
  const formulaByType = {
    collocation: `${english} + object/context`,
    phrasal_verb: `${english} + noun / situation`,
    academic_word: `${english} + explanation / essay idea`,
    essay_phrase: `${english} + claim + reason`,
    topic: `${english} + topic detail`
  };
  const key = compact(item.type).toLowerCase();
  const formula = formulaByType[key] || `${english} + clear context`;
  return {
    topic_label: topic,
    type_label: type,
    subtype_label: subtype,
    register_label: register,
    usage_label: usageArea,
    formula,
    pattern: `Use "${english}" when speaking or writing about ${topic || "this topic"}.`,
    memory_tip_uz: `${english} so'zini "${item.uzbek}" ma'nosi va ${topic || "mavzu"} konteksti bilan bog'lab yodlang.`,
    speak_task: `${english} so'zini ishlatib 1 ta IELTS-style javob tuzing.`,
    write_task: `${english} so'zi bilan 1 ta B1-B2 darajadagi gap yozing.`
  };
}

function enrichWord(item) {
  if (!item) return item;
  return {
    ...item,
    synonyms: parseJsonList(item.synonyms_json),
    learning: wordLearning(item)
  };
}

function formulaSteps(formula) {
  const raw = compact(formula);
  if (!raw) return [];
  return raw
    .split(/\s*(?:\u2192|->|\+|;)\s*/)
    .map((part, index) => ({ index: index + 1, text: part.trim() }))
    .filter(step => step.text);
}

function enrichPattern(pattern) {
  if (!pattern) return pattern;
  const steps = formulaSteps(pattern.formula);
  const title = compact(pattern.title_en);
  const formula = compact(pattern.formula);
  const useCase = compact(pattern.when_to_use_uz);
  const meaning = compact(pattern.meaning_uz);
  return {
    ...pattern,
    tags: parseJsonList(pattern.tags_json),
    formula_steps: steps,
    learning: {
      use_case: useCase,
      meaning,
      register: titleCase(pattern.register || "neutral"),
      drill: `${title} formulasidan foydalanib 2 ta javob tuzing: bitta speaking, bitta writing.`
    },
    teacher_pack: {
      objective_uz: `${title} patternini formulaga qarab, IELTS javobida tabiiy ishlatishni o'rganasiz.`,
      simple_explanation_uz: `${meaning || "Bu pattern fikrni aniqroq aytishga yordam beradi."} ${useCase ? `Asosan ${useCase.toLowerCase()} ishlatiladi.` : ""}`.trim(),
      common_mistakes: [
        `Formulaning barcha qismlarini ishlatmaslik: ${formula || title}.`,
        "Gapni faqat tarjima qilib yozish, lekin kontekst bermaslik.",
        "Bitta uzun gapga juda ko'p fikr qo'shib yuborish."
      ],
      speaking_frames: [
        `In my opinion, ${steps[0]?.text || "this"} ...`,
        `For example, ... and this shows that ...`,
        `Personally, I would say that ... because ...`
      ],
      writing_frames: [
        `${steps[0]?.text || "This"} can be used to explain a clear idea in an essay.`,
        `One possible reason is that ...`,
        `This example demonstrates that ...`
      ],
      transformation_drills: [
        "Oddiy gap yozing va formula qismlariga bo'ling.",
        "Bir xil fikrni speaking uslubida qayta yozing.",
        "Shu fikrni writing uslubida formalroq qilib yozing."
      ],
      band_boosters: [
        "Javobga sabab va real misol qo'shing, shunda fluency kuchayadi.",
        "Bitta aniq connector ishlating: because, for example, as a result.",
        "Formula tugagach, qisqa takeaway bilan javobni yopib qo'ying."
      ],
      exam_prompts: [
        {
          part: pattern.ielts_part || "Speaking",
          prompt_en: "Describe your opinion about a familiar topic and support it with one reason.",
          target_uz: `${title} patternini ishlatib fikr + sabab + misol bering.`
        },
        {
          part: "Writing",
          prompt_en: "Write two connected sentences using this grammar pattern.",
          target_uz: "Bitta asosiy fikr va bitta natija/sabab gapini yozing."
        },
        {
          part: "Speaking follow-up",
          prompt_en: "Give a personal example connected to your answer.",
          target_uz: "Javobga shaxsiy tajriba qo'shing va xulosa bilan yoping."
        }
      ],
      band_ladder: [
        { band: "5", focus: "Oddiy javob", example: "I like it because it is good." },
        { band: "6", focus: "Sabab + misol", example: "I generally like it because it helps me save time, for example when I study." },
        { band: "7", focus: "Formula + natural detail", example: "Honestly, I tend to prefer it because it makes my routine more efficient; for instance, it helps me stay consistent when I study English." }
      ],
      do_dont: [
        { do: `Formulani tartib bilan ishlating: ${formula || title}.`, dont: "Faqat bitta so'z yoki yarim gap bilan javob bermang." },
        { do: "Misolni shaxsiy tajriba yoki aniq vaziyat bilan bog'lang.", dont: "Hamma mavzuga bir xil yodlangan gapni ishlatmang." },
        { do: "Speakingda tabiiy, writingda biroz formalroq variant tanlang.", dont: "Uzbekcha gap tartibini inglizchaga to'g'ridan-to'g'ri ko'chirmang." }
      ],
      self_check_rubric: [
        { name: "Formula", target: "Barcha asosiy qismlar bor" },
        { name: "Meaning", target: "Fikr aniq va mavzuga mos" },
        { name: "Example", target: "Kamida bitta real misol bor" },
        { name: "Naturalness", target: "Gap og'zaki yoki yozma uslubga mos" }
      ],
      mini_challenge_uz: `Shu pattern bilan 45 soniyalik speaking javob yozing, keyin bitta writing gapga aylantiring.`,
      mastery_checklist: [
        "Formulani yoddan ayta olaman.",
        "Kamida 2 ta ready phrase ishlata olaman.",
        "O'z mavzum bo'yicha bitta speaking javob yozdim.",
        "Formula Lab orqali tekshirtirib, xatoni tuzatdim."
      ]
    }
  };
}

function cleanText(text, max = 4000) {
  return String(text || "").trim().slice(0, max);
}

function cleanAiJson(content) {
  return String(content || "").replace(/^```json|```$/g, "").trim();
}

function normalizeLesson(parsed, words, pattern, topic) {
  const vocabDrills = Array.isArray(parsed.vocab_drills) && parsed.vocab_drills.length
    ? parsed.vocab_drills
    : words.map(word => ({
      word: word.english,
      uzbek: word.uzbek,
      sentence_en: word.example_en || `I can use "${word.english}" in a clear sentence.`,
      sentence_uz: word.example_uz || "",
      memory_tip_uz: word.learning?.memory_tip_uz || ""
    }));
  const grammarFocus = parsed.grammar_focus && typeof parsed.grammar_focus === "object" ? parsed.grammar_focus : {};
  return {
    ...parsed,
    title_uz: parsed.title_uz || `${titleCase(topic || "Mixed")} uchun mini dars`,
    goal_uz: parsed.goal_uz || "So'z, formula, speaking va writing orqali mavzuni mustahkamlash.",
    warmup_question_en: parsed.warmup_question_en || `What do you usually say about ${topic || "this topic"}?`,
    vocab_drills: vocabDrills,
    grammar_focus: {
      title: grammarFocus.title || pattern?.title_en || "Useful sentence pattern",
      formula: grammarFocus.formula || pattern?.formula || "Idea + reason + example",
      explanation_uz: grammarFocus.explanation_uz || pattern?.explanation_uz || "Bu formula javobni tartibli qilishga yordam beradi.",
      example_en: grammarFocus.example_en || "In my opinion, this topic is important because it affects daily life.",
      example_uz: grammarFocus.example_uz || "Menimcha, bu mavzu muhim, chunki u kundalik hayotga ta'sir qiladi."
    },
    speaking_questions: Array.isArray(parsed.speaking_questions) && parsed.speaking_questions.length
      ? parsed.speaking_questions
      : [
        `Do you like talking about ${topic || "this topic"}? Why?`,
        `What is one advantage related to ${topic || "this topic"}?`,
        "Can you give a real example from your life?"
      ],
    mini_quiz: Array.isArray(parsed.mini_quiz) && parsed.mini_quiz.length
      ? parsed.mini_quiz
      : words.slice(0, 5).map(word => ({
        question: `"${word.english}" so'zining ma'nosi nima?`,
        answer: word.uzbek,
        explanation_uz: word.learning?.memory_tip_uz || ""
      })),
    writing_task_uz: parsed.writing_task_uz || "Bugungi so'zlardan kamida 5 tasini ishlatib 6-8 gap yozing.",
    homework_uz: parsed.homework_uz || "Darsni qayta ko'rib chiqing va bitta speaking javobni Grammar check orqali tekshiring."
  };
}

async function callAi(messages, temperature = 0.45, maxTokens = 900) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.includes("your_") || apiKey.includes("xxxx")) {
    return { offline: true, content: null };
  }
  const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://english-vocab-master.local",
      "X-Title": process.env.OPENROUTER_X_TITLE || "English Vocabulary Master Web"
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
  });
  if (!response.ok) throw new Error(`AI service returned ${response.status}`);
  const data = await response.json();
  return { offline: false, content: data.choices?.[0]?.message?.content?.trim() || "" };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    return send(res, 200, healthPayload());
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await parseBody(req);
    if (!passwordMatches(body.password)) return send(res, 403, { error: "Wrong password" });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expires: Date.now() + 1000 * 60 * 60 * 12 });
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
      "Set-Cookie": sessionCookie(token)
    });
  }

  if (!requireAuth(req, res)) return;

  if (url.pathname === "/api/session") {
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    sessions.delete(getToken(req));
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
      "Set-Cookie": sessionCookie("", 0)
    });
  }

  if (url.pathname === "/api/dashboard") {
    const counts = {
      words: row("SELECT COUNT(*) c FROM vocab_enriched").c,
      topics: row("SELECT COUNT(DISTINCT topic) c FROM vocab_enriched").c,
      quiz: row("SELECT COUNT(*) c FROM quiz_items").c,
      grammar: row("SELECT COUNT(*) c FROM grammar_patterns").c
    };
    const today = enrichWord(row(`SELECT ${vocabSelect()} FROM vocab_enriched ORDER BY abs(random()) LIMIT 1`));
    const topics = rows("SELECT topic, COUNT(*) count FROM vocab_enriched GROUP BY topic ORDER BY count DESC LIMIT 12");
    return send(res, 200, { counts, today, topics });
  }

  if (url.pathname === "/api/topics") {
    return send(res, 200, {
      items: rows("SELECT topic, COUNT(*) count FROM vocab_enriched GROUP BY topic ORDER BY topic")
    });
  }

  if (url.pathname === "/api/vocab") {
    const q = cleanText(url.searchParams.get("q"), 160);
    const topic = cleanText(url.searchParams.get("topic"), 120);
    const level = cleanText(url.searchParams.get("level"), 20);
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const limit = Math.min(60, Math.max(12, Number(url.searchParams.get("limit") || 24)));
    const where = [];
    const params = { limit, offset };
    if (q) {
      params.q = `%${q}%`;
      where.push("(english LIKE @q OR uzbek LIKE @q OR definition LIKE @q OR example_en LIKE @q OR example_uz LIKE @q)");
    }
    if (topic) {
      params.topic = topic;
      where.push("topic = @topic");
    }
    if (level) {
      params.level = level;
      where.push("level = @level");
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const items = rows(`SELECT ${vocabSelect()} FROM vocab_enriched ${clause} ORDER BY id LIMIT @limit OFFSET @offset`, params)
      .map(enrichWord);
    const total = row(`SELECT COUNT(*) c FROM vocab_enriched ${clause}`, params).c;
    return send(res, 200, { items, total, offset, limit });
  }

  if (url.pathname.startsWith("/api/word/")) {
    const id = Number(url.pathname.split("/").pop());
    const item = row(`SELECT ${vocabSelect()} FROM vocab_enriched WHERE id = ?`, id);
    if (!item) return send(res, 404, { error: "Word not found" });
    return send(res, 200, enrichWord(item));
  }

  if (url.pathname === "/api/quiz") {
    const topic = cleanText(url.searchParams.get("topic"), 120);
    const params = {};
    let clause = "";
    if (topic) {
      clause = "WHERE topic = @topic";
      params.topic = topic;
    }
    const items = rows(`SELECT * FROM quiz_items ${clause} ORDER BY random() LIMIT 10`, params)
      .map(item => {
        const options = [item.correct_answer, ...parseJsonList(item.wrong_answers_json).slice(0, 3)]
          .sort(() => Math.random() - 0.5);
        return { id: item.id, vocab_id: item.vocab_id, topic: item.topic, question: item.question, correct_answer: item.correct_answer, options, explanation: item.explanation };
      });
    return send(res, 200, { items });
  }

  if (url.pathname === "/api/grammar/sections") {
    return send(res, 200, {
      items: rows(`SELECT s.*, COUNT(p.id) pattern_count
                   FROM grammar_sections s
                   LEFT JOIN grammar_patterns p ON p.section_code = s.code
                   GROUP BY s.id
                   ORDER BY s.display_order`)
    });
  }

  if (url.pathname === "/api/grammar/patterns") {
    const section = cleanText(url.searchParams.get("section"), 120);
    const params = {};
    const clause = section ? "WHERE section_code = @section" : "";
    if (section) params.section = section;
    const items = rows(`SELECT * FROM grammar_patterns ${clause} ORDER BY display_order LIMIT 80`, params).map(enrichPattern);
    return send(res, 200, { items });
  }

  if (url.pathname.startsWith("/api/grammar/pattern/")) {
    const id = Number(url.pathname.split("/").pop());
    const pattern = enrichPattern(row("SELECT * FROM grammar_patterns WHERE id = ?", id));
    if (!pattern) return send(res, 404, { error: "Pattern not found" });
    return send(res, 200, {
      pattern,
      examples: rows("SELECT * FROM grammar_examples WHERE pattern_id = ? LIMIT 12", id),
      phrases: rows("SELECT * FROM grammar_ready_phrases WHERE pattern_id = ? LIMIT 12", id),
      practice: rows("SELECT * FROM grammar_practice WHERE pattern_id = ? LIMIT 8", id),
      quiz: rows("SELECT * FROM grammar_quiz_items WHERE pattern_id = ? LIMIT 8", id).map(q => ({ ...q, wrong_answers: parseJsonList(q.wrong_answers_json) }))
    });
  }

  if (url.pathname === "/api/ai/sentence" && req.method === "POST") {
    const body = await parseBody(req);
    const word = body.wordId ? enrichWord(row(`SELECT ${vocabSelect()} FROM vocab_enriched WHERE id = ?`, Number(body.wordId))) : enrichWord(body);
    if (!word) return send(res, 404, { error: "Word not found" });
    const prompt = `Create a useful English learning card for an Uzbek student.
Word: ${word.english}
Uzbek: ${word.uzbek || ""}
Topic: ${word.topic || ""}
Level: ${word.level || ""}
Type: ${word.type || ""}
Formula: ${word.learning?.formula || ""}
Usage pattern: ${word.learning?.pattern || ""}
Existing example: ${word.example_en || ""}

Return ONLY valid JSON with:
sentence_en, sentence_uz, explanation_uz, speaking_prompt, writing_prompt, memory_tip_uz, common_mistake_uz.
Make the sentence natural, useful, and clearly connected to the formula.`;
    const ai = await callAi([{ role: "user", content: prompt }], 0.5, 700);
    if (ai.offline) {
      return send(res, 200, {
        offline: true,
        sentence_en: word.example_en || `I use "${word.english}" in a natural sentence.`,
        sentence_uz: word.example_uz || `${word.uzbek || word.english} uchun namuna gap.`,
        explanation_uz: "AI kalit sozlanmagan. Hozircha bazadagi example ko'rsatildi.",
        speaking_prompt: `Talk about ${word.topic || "this topic"} using "${word.english}".`,
        writing_prompt: word.learning?.write_task || "",
        memory_tip_uz: word.learning?.memory_tip_uz || `So'zni mavzu bilan bog'lab eslab qoling: ${word.topic || "general"}.`,
        common_mistake_uz: "So'zni tarjima bilan emas, butun gap ichida yodlang."
      });
    }
    const text = ai.content.replace(/^```json|```$/g, "").trim();
    try {
      const parsed = JSON.parse(text);
      return send(res, 200, {
        sentence_en: parsed.sentence_en || word.example_en || "",
        sentence_uz: parsed.sentence_uz || word.example_uz || "",
        explanation_uz: parsed.explanation_uz || "",
        speaking_prompt: parsed.speaking_prompt || word.learning?.speak_task || "",
        writing_prompt: parsed.writing_prompt || word.learning?.write_task || "",
        memory_tip_uz: parsed.memory_tip_uz || word.learning?.memory_tip_uz || "",
        common_mistake_uz: parsed.common_mistake_uz || "So'zni alohida emas, formula va example ichida ishlating."
      });
    } catch {
      return send(res, 200, {
        raw: ai.content,
        speaking_prompt: word.learning?.speak_task || "",
        writing_prompt: word.learning?.write_task || "",
        memory_tip_uz: word.learning?.memory_tip_uz || "",
        common_mistake_uz: "So'zni alohida emas, formula va example ichida ishlating."
      });
    }
  }

  if (url.pathname === "/api/ai/chat" && req.method === "POST") {
    const body = await parseBody(req);
    const message = cleanText(body.message, 3000);
    if (!message) return send(res, 400, { error: "Message is required" });
    const ai = await callAi([
      { role: "system", content: "You are an English tutor for an Uzbek learner. Teach vocabulary, grammar formulas, IELTS speaking/writing usage, and correct mistakes gently. Keep answers practical. Explain in Uzbek when helpful." },
      { role: "user", content: message }
    ], 0.55, 900);
    if (ai.offline) return send(res, 200, { offline: true, reply: "AI kalit sozlanmagan. Savolingiz saqlandi, lekin javob uchun OpenRouter API key kerak." });
    return send(res, 200, { reply: ai.content });
  }

  if (url.pathname === "/api/ai/lesson" && req.method === "POST") {
    const body = await parseBody(req);
    const topic = cleanText(body.topic, 120);
    const level = cleanText(body.level, 20);
    const where = [];
    const params = {};
    if (topic) {
      where.push("topic = @topic");
      params.topic = topic;
    }
    if (level) {
      where.push("level = @level");
      params.level = level;
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const words = rows(`SELECT ${vocabSelect()} FROM vocab_enriched ${clause} ORDER BY random() LIMIT 10`, params)
      .map(enrichWord);
    const pattern = enrichPattern(row("SELECT * FROM grammar_patterns ORDER BY random() LIMIT 1"));
    if (!words.length) return send(res, 404, { error: "Lesson uchun so'z topilmadi" });

    const wordLines = words.map((word, index) => `${index + 1}. ${word.english} - ${word.uzbek}; formula: ${word.learning?.formula || ""}; example: ${word.example_en || ""}`).join("\n");
    const prompt = `Create a compact but powerful English lesson for an Uzbek learner.
Topic: ${topic || "mixed"}
Level: ${level || "mixed"}

Vocabulary:
${wordLines}

Grammar pattern:
${pattern?.title_en || ""}
Formula: ${pattern?.formula || ""}
Meaning Uzbek: ${pattern?.meaning_uz || ""}

Return ONLY valid JSON with:
title_uz, goal_uz, warmup_question_en, vocab_drills (array of 10 objects: word, uzbek, sentence_en, sentence_uz, memory_tip_uz), grammar_focus (title, formula, explanation_uz, example_en, example_uz), speaking_questions (array of 3), writing_task_uz, mini_quiz (array of 5 objects: question, answer, explanation_uz), homework_uz.
Make it practical, IELTS-friendly, and not too long.`;

    const ai = await callAi([{ role: "user", content: prompt }], 0.5, 2200);
    if (ai.offline) {
      return send(res, 200, {
        offline: true,
        title_uz: `${titleCase(topic || "Mixed")} uchun mini dars`,
        goal_uz: "10 ta so'zni formula, gap va speaking/writing orqali mustahkamlash.",
        warmup_question_en: `What do you usually say about ${topic || "this topic"}?`,
        vocab_drills: words.map(word => ({
          word: word.english,
          uzbek: word.uzbek,
          sentence_en: word.example_en || `I can use "${word.english}" in a clear sentence.`,
          sentence_uz: word.example_uz || `${word.uzbek || word.english} uchun namuna gap.`,
          memory_tip_uz: word.learning?.memory_tip_uz || ""
        })),
        grammar_focus: {
          title: pattern?.title_en || "Useful sentence pattern",
          formula: pattern?.formula || "Idea + reason + example",
          explanation_uz: pattern?.explanation_uz || "Bu formula javobni tartibli qilishga yordam beradi.",
          example_en: "In my opinion, this topic is important because it affects daily life.",
          example_uz: "Menimcha, bu mavzu muhim, chunki u kundalik hayotga ta'sir qiladi."
        },
        speaking_questions: [
          `Do you like talking about ${topic || "this topic"}? Why?`,
          `What is one advantage related to ${topic || "this topic"}?`,
          `Can you give a real example from your life?`
        ],
        writing_task_uz: "Bugungi 10 ta so'zdan kamida 5 tasini ishlatib 6-8 gap yozing.",
        mini_quiz: words.slice(0, 5).map(word => ({
          question: `"${word.english}" so'zining ma'nosi nima?`,
          answer: word.uzbek,
          explanation_uz: word.learning?.memory_tip_uz || ""
        })),
        homework_uz: "Darsni qayta ko'rib chiqing, 3 ta speaking javob yozing va Grammar check orqali tekshiring."
      });
    }

    try {
      return send(res, 200, normalizeLesson(JSON.parse(cleanAiJson(ai.content)), words, pattern, topic));
    } catch {
      return send(res, 200, normalizeLesson({ raw_note: "AI JSON javobi tugallanmagani uchun DB asosidagi dars ko'rsatildi." }, words, pattern, topic));
    }
  }

  if (url.pathname === "/api/ai/grammar-check" && req.method === "POST") {
    const body = await parseBody(req);
    const text = cleanText(body.text, 3000);
    if (!text) return send(res, 400, { error: "Text is required" });
    const ai = await callAi([{ role: "user", content: `Check this English text for an Uzbek learner. Return ONLY valid JSON with score, corrected, better, explanation_uz, issues, grammar_formula, practice_task. Text: "${text}"` }], 0.25, 900);
    if (ai.offline) return send(res, 200, { offline: true, score: 0, corrected: text, better: text, explanation_uz: "AI kalit sozlanmagan.", issues: [] });
    const cleaned = cleanAiJson(ai.content);
    try {
      return send(res, 200, JSON.parse(cleaned));
    } catch {
      return send(res, 200, { raw: ai.content });
    }
  }

  if (url.pathname === "/api/ai/pattern-check" && req.method === "POST") {
    const body = await parseBody(req);
    const patternId = Number(body.patternId);
    const answer = cleanText(body.answer, 3000);
    if (!patternId || !answer) return send(res, 400, { error: "Pattern and answer are required" });

    const pattern = enrichPattern(row("SELECT * FROM grammar_patterns WHERE id = ?", patternId));
    if (!pattern) return send(res, 404, { error: "Pattern not found" });
    const examples = rows("SELECT example_en FROM grammar_examples WHERE pattern_id = ? LIMIT 3", patternId)
      .map(example => `- ${example.example_en}`)
      .join("\n");

    const prompt = `You are an IELTS grammar coach for an Uzbek student.

Target grammar pattern:
Title: ${pattern.title_en}
Formula: ${pattern.formula}
Meaning in Uzbek: ${pattern.meaning_uz || ""}
When to use: ${pattern.when_to_use_uz || ""}

Examples:
${examples}

Student answer:
"${answer}"

Return ONLY valid JSON with:
score, is_correct, corrected, better, formula_feedback_uz, missing_steps, used_steps, next_task_uz.
Focus on whether the student applied the formula, not only general grammar.`;

    const ai = await callAi([{ role: "user", content: prompt }], 0.25, 900);
    if (ai.offline) {
      return send(res, 200, {
        offline: true,
        score: 0,
        is_correct: false,
        corrected: answer,
        better: answer,
        formula_feedback_uz: `AI kalit sozlanmagan. Tekshiruv uchun formula: ${pattern.formula}`,
        missing_steps: pattern.formula_steps.map(step => step.text),
        used_steps: [],
        next_task_uz: pattern.learning?.drill || "Shu formula bilan yana bitta javob yozing."
      });
    }

    const cleaned = cleanAiJson(ai.content);
    try {
      const parsed = JSON.parse(cleaned);
      return send(res, 200, {
        score: parsed.score ?? 0,
        is_correct: Boolean(parsed.is_correct),
        corrected: parsed.corrected || answer,
        better: parsed.better || "",
        formula_feedback_uz: parsed.formula_feedback_uz || "",
        missing_steps: Array.isArray(parsed.missing_steps) ? parsed.missing_steps : [],
        used_steps: Array.isArray(parsed.used_steps) ? parsed.used_steps : [],
        next_task_uz: parsed.next_task_uz || pattern.learning?.drill || ""
      });
    } catch {
      return send(res, 200, {
        raw: ai.content,
        score: 0,
        corrected: answer,
        better: "",
        formula_feedback_uz: "AI javobini JSON sifatida o'qib bo'lmadi.",
        missing_steps: [],
        used_steps: [],
        next_task_uz: pattern.learning?.drill || ""
      });
    }
  }

  send(res, 404, { error: "Not found" });
}

function serveStatic(req, res, url) {
  let file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const full = path.resolve(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
  const ext = path.extname(full).toLowerCase();
  send(res, 200, fs.readFileSync(full), mime[ext] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/healthz") return send(res, 200, healthPayload());
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch (err) {
    send(res, 500, { error: "Server error", detail: process.env.NODE_ENV === "development" ? String(err.message || err) : undefined });
  }
});

server.listen(PORT, () => {
  console.log(`English Vocab Master Web running at http://localhost:${PORT}`);
});
