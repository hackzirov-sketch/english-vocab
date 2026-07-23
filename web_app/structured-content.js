const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const speakingLessons = loadArray("speaking-lessons.json");
const grammarItems = loadArray("grammar-items.json");

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "vs", "with"
]);

function loadArray(fileName) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(item => item && item.active !== false) : [];
  } catch (error) {
    console.warn(`Structured content could not load ${fileName}: ${error.message}`);
    return [];
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normalize(value)
    .split(" ")
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function matchScore(query, candidates) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const queryTokens = new Set(tokens(query));
  let best = 0;

  for (const candidate of candidates.filter(Boolean)) {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedCandidate === normalizedQuery) best = Math.max(best, 1000);
    if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
      best = Math.max(best, 200);
    }
    const overlap = tokens(candidate).filter(token => queryTokens.has(token)).length;
    best = Math.max(best, overlap * 25);
  }
  return best;
}

function findSpeakingLessons(topic, limit = 2) {
  if (!normalize(topic)) return [];
  return speakingLessons
    .map(item => ({ item, score: matchScore(topic, [item.topic]) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.item.speaking_part - b.item.speaking_part)
    .slice(0, limit)
    .map(result => result.item);
}

function findGrammarItem(topic) {
  if (!normalize(topic)) return null;
  const result = grammarItems
    .map(item => ({
      item,
      score: matchScore(topic, [
        ...(Array.isArray(item.topics) ? item.topics : []),
        item.category,
        item.title
      ])
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.item.formula_number - b.item.formula_number)[0];
  return result?.item || null;
}

function buildStructuredLessonContext(topic) {
  const matchedSpeaking = findSpeakingLessons(topic);
  const matchedGrammar = findGrammarItem(topic);
  const sections = [];

  for (const lesson of matchedSpeaking) {
    sections.push([
      `STRUCTURED SPEAKING PART ${lesson.speaking_part}: ${lesson.topic}`,
      `Goal (UZ): ${lesson.goal_uz || ""}`,
      `Formula: ${lesson.formula?.topic_specific || ""}`,
      `Key vocabulary: ${(lesson.key_vocabulary || []).join("; ")}`,
      `Model answer: ${lesson.model_answer_en || ""}`,
      `Practice questions: ${(lesson.practice_steps || []).join(" | ")}`
    ].join("\n"));
  }

  if (matchedGrammar) {
    sections.push([
      `STRUCTURED GRAMMAR: ${matchedGrammar.title}`,
      `Level: ${matchedGrammar.level || ""}`,
      `Structure: ${matchedGrammar.structure || ""}`,
      `Rule (UZ): ${matchedGrammar.rule_uz || ""}`,
      `Use (UZ): ${matchedGrammar.use_uz || ""}`,
      `Example: ${matchedGrammar.example_en || ""}`,
      `Example (UZ): ${matchedGrammar.example_uz || ""}`,
      `Common error (UZ): ${matchedGrammar.wrong_uz || ""}`,
      `Correct use: ${matchedGrammar.correct_en || ""}`
    ].join("\n"));
  }

  return {
    context: sections.join("\n\n"),
    speakingLessons: matchedSpeaking,
    grammarItem: matchedGrammar
  };
}

function buildStructuredLessonSeed(topic, lessonType, level) {
  const resources = buildStructuredLessonContext(topic);
  const advancedLevel = /^(?:B2|C1|C2)$/i.test(String(level || "").trim());

  if (lessonType === "speaking" && resources.speakingLessons.length) {
    const shortLesson = resources.speakingLessons.find(item => item.speaking_part === 1)
      || resources.speakingLessons[0];
    const extendedLesson = resources.speakingLessons.find(item => item.speaking_part === 2);
    const questions = [
      ...(shortLesson.practice_steps || []),
      ...(extendedLesson?.practice_steps || [])
    ].filter(Boolean);
    return {
      goal_uz: shortLesson.goal_uz || "",
      warmup_question_en: questions[0] || "",
      speaking_questions: questions.slice(0, 3),
      grammar_focus: {
        title: `${shortLesson.topic} speaking formula`,
        formula: shortLesson.formula?.topic_specific || "Direct answer + reason + example + finish",
        explanation_uz: shortLesson.goal_uz || "",
        example_en: shortLesson.model_answer_en || "",
        example_uz: ""
      },
      model_answer_en: shortLesson.model_answer_en || ""
    };
  }

  if (lessonType === "writing" && resources.grammarItem && advancedLevel) {
    const grammar = resources.grammarItem;
    return {
      goal_uz: `${topic || "Mavzu"} bo‘yicha aniq reja asosida paragraph yozish va “${grammar.title}” formulasini tabiiy ishlatish.`,
      grammar_focus: {
        title: grammar.title || "",
        formula: grammar.structure || "",
        explanation_uz: grammar.rule_uz || grammar.use_uz || "",
        example_en: grammar.example_en || "",
        example_uz: grammar.example_uz || ""
      },
      writing_task_uz: `${topic || "Tanlangan mavzu"} bo‘yicha 80–120 so‘zli paragraph yozing. Asosiy fikr, sabab va misol bering; “${grammar.structure || grammar.title}” formulasini kamida bir marta ishlating.`,
      model_answer_en: grammar.example_en || "",
      model_answer_uz: grammar.example_uz || ""
    };
  }

  return {};
}

function structuredContentStats() {
  return {
    loaded: speakingLessons.length > 0 && grammarItems.length > 0,
    speakingLessons: speakingLessons.length,
    grammarItems: grammarItems.length
  };
}

module.exports = {
  buildStructuredLessonContext,
  buildStructuredLessonSeed,
  findGrammarItem,
  findSpeakingLessons,
  structuredContentStats
};
