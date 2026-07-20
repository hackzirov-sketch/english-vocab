const fs = require("fs");
const path = require("path");

const KNOWLEDGE_PATH = path.join(__dirname, "data", "tutor-knowledge.json");
const STOP_WORDS = new Set([
  "about", "after", "also", "and", "answer", "are", "bilan", "bir", "bor", "but",
  "can", "english", "for", "from", "give", "haqida", "ham", "have", "how", "i",
  "in", "is", "it", "kerak", "lesson", "menga", "my", "of", "on", "or", "qanday",
  "shu", "the", "this", "to", "uchun", "use", "what", "with", "you"
]);

const ALIASES = [
  [/\bpart\s*1\b|short answer|qisqa javob/i, "direct reason example finish dref"],
  [/\bpart\s*2\b|cue card|extended answer|uzun javob/i, "situation background main idea feeling comparison purpose reflection story cpr"],
  [/if|would|could|hypothetical|shartli/i, "conditional hypothetical inversion"],
  [/not only|never|rarely|seldom|only when|only after/i, "inversion formal emphasis"],
  [/although|though|despite|however|but|contrast|qarama/i, "concession contrast balanced argument"],
  [/because|cause|result|reason|sabab|natija/i, "cause effect reason result"],
  [/who|which|that|relative clause/i, "relative clause reduced structure"],
  [/maybe|perhaps|likely|hedg|ehtimol/i, "qualification hedging probability"],
  [/school|student|study|o'qish|ta'lim/i, "education learning studies"],
  [/tech|internet|phone|social media/i, "technology communication online"],
  [/healthy|fitness|sport|diet|food/i, "health sports fitness food wellbeing"],
  [/job|career|work|profession/i, "work studies career goals"],
  [/city|village|hometown|rural|urban/i, "hometown urban rural life"],
  [/nature|climate|pollution|environment/i, "environment sustainability"],
];

let payload = { version: 0, counts: {}, entries: [] };
try {
  payload = JSON.parse(fs.readFileSync(KNOWLEDGE_PATH, "utf8"));
} catch (error) {
  console.warn(`Tutor knowledge unavailable: ${error.message}`);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[ʻʼ’`]/g, "'")
    .replace(/[^a-z0-9'\u00c0-\u024f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return [...new Set(normalize(value).split(" "))]
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function expandQuery(query) {
  const additions = ALIASES.filter(([pattern]) => pattern.test(query)).map(([, value]) => value);
  return `${query} ${additions.join(" ")}`.trim();
}

const indexedEntries = payload.entries.map(entry => ({
  entry,
  title: normalize(entry.title),
  titleTokens: new Set(tokenize(entry.title)),
  categoryTokens: new Set(tokenize(entry.category)),
  contentTokens: new Set(tokenize(entry.content))
}));

function scoreEntry(indexed, tokens, originalQuery, preferredTypes) {
  const { entry, title, titleTokens, categoryTokens, contentTokens } = indexed;
  let score = preferredTypes?.includes(entry.type) ? 3 : 0;
  if (title && originalQuery.includes(title)) score += 24;
  for (const token of tokens) {
    if (titleTokens.has(token)) score += 8;
    if (categoryTokens.has(token)) score += 4;
    if (contentTokens.has(token)) score += 1;
  }
  if (entry.level && tokens.some(token => normalize(entry.level).includes(token))) score += 2;
  return score;
}

function formatEntry(entry) {
  const header = [entry.type, entry.title, entry.level, entry.category].filter(Boolean).join(" | ");
  const limit = entry.type === "speaking_part2" ? 3200 : entry.type === "speaking_part1" ? 2200 : 1600;
  const content = String(entry.content || "").slice(0, limit).trim();
  return `[${header}]\n${content}`;
}

function retrieveTutorKnowledge(query, options = {}) {
  const preferredTypes = Array.isArray(options.types) ? options.types : null;
  const originalQuery = normalize(query);
  const expanded = expandQuery(String(query || ""));
  const tokens = tokenize(expanded);
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 7));
  const maxChars = Math.max(1000, Math.min(14000, Number(options.maxChars) || 8500));
  const candidates = indexedEntries
    .filter(item => !preferredTypes || preferredTypes.includes(item.entry.type))
    .map(item => ({ item, score: scoreEntry(item, tokens, originalQuery, preferredTypes) }))
    .filter(result => result.score > 3)
    .sort((a, b) => b.score - a.score || a.item.entry.id.localeCompare(b.item.entry.id));

  const selected = [];
  const typeCounts = new Map();
  let usedChars = 0;
  for (const candidate of candidates) {
    const type = candidate.item.entry.type;
    const typeLimit = type === "pro_example" || type === "reference_item" ? 3 : 2;
    if ((typeCounts.get(type) || 0) >= typeLimit) continue;
    const formatted = formatEntry(candidate.item.entry);
    if (usedChars + formatted.length > maxChars && selected.length) continue;
    selected.push({ ...candidate.item.entry, score: candidate.score, formatted });
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    usedChars += formatted.length;
    if (selected.length >= limit || usedChars >= maxChars) break;
  }

  return {
    entries: selected.map(({ formatted, ...entry }) => entry),
    context: selected.map(item => item.formatted).join("\n\n"),
    characters: usedChars
  };
}

function knowledgeStats() {
  return {
    version: payload.version,
    entries: payload.entries.length,
    counts: payload.counts,
    loaded: payload.entries.length > 0
  };
}

module.exports = { knowledgeStats, retrieveTutorKnowledge };
