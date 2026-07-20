const assert = require("node:assert/strict");
const { knowledgeStats, retrieveTutorKnowledge } = require("../tutor-knowledge");
const tutor = require("../tutor-methodology");

const stats = knowledgeStats();
assert.equal(stats.loaded, true);
assert.equal(stats.entries, 1624);
assert.deepEqual(stats.counts, {
  speaking_part1: 30,
  speaking_part2: 30,
  grammar_formula: 100,
  pro_example: 747,
  reference_item: 717
});

const cases = [
  ["Health speaking Part 1", "speaking_part1", "Health"],
  ["Food cue card Part 2", "speaking_part2", "Food"],
  ["Not only grammar inversion", "grammar_formula", "Not only"],
  ["perspective weak strong use", "pro_example", "Perspective"],
  ["phrasal verb think over", "reference_item", "Think over"]
];

for (const [query, type, title] of cases) {
  const result = retrieveTutorKnowledge(query, { limit: 6 });
  assert(
    result.entries.some(entry => entry.type === type && entry.title.toLowerCase().includes(title.toLowerCase())),
    `Missing expected result for: ${query}`
  );
  assert(result.characters <= 14000);
}

const lessonKnowledge = retrieveTutorKnowledge("Health B2 speaking not only", {
  limit: 8,
  maxChars: 9000
});
const lessonPrompt = tutor.buildLessonPrompt({
  topic: "Health",
  level: "B2",
  wordLines: "wellbeing - farovonlik",
  pattern: { title_en: "Not only", formula: "Not only ..., but also ..." },
  knowledgeContext: lessonKnowledge.context
});
assert.match(lessonPrompt, /RETRIEVED WORKBOOK KNOWLEDGE/);
assert(lessonPrompt.length < 16000);

const writingLessonPrompt = tutor.buildLessonPrompt({
  topic: "Education",
  level: "B1",
  lessonType: "writing",
  wordLines: "curriculum - o'quv dasturi",
  pattern: { title_en: "Giving reasons", formula: "idea + because + reason" },
  knowledgeContext: lessonKnowledge.context
});
assert.match(writingLessonPrompt, /Lesson type: WRITING/);
assert.match(writingLessonPrompt, /model paragraph/i);
assert.match(writingLessonPrompt, /Keep speaking_questions empty/);

console.log("Tutor knowledge tests passed");
