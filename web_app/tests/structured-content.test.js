const assert = require("node:assert/strict");
const {
  buildStructuredLessonContext,
  buildStructuredLessonSeed,
  findGrammarItem,
  findSpeakingLessons,
  structuredContentStats
} = require("../structured-content");

assert.deepEqual(structuredContentStats(), {
  loaded: true,
  speakingLessons: 60,
  grammarItems: 100
});

const healthLessons = findSpeakingLessons("Health");
assert.equal(healthLessons.length, 2);
assert(healthLessons.every(lesson => lesson.topic === "Health"));
assert.deepEqual(healthLessons.map(lesson => lesson.speaking_part), [1, 2]);

const educationGrammar = findGrammarItem("Education");
assert(educationGrammar);
assert(educationGrammar.topics.includes("education"));

const context = buildStructuredLessonContext("Technology");
assert.match(context.context, /STRUCTURED SPEAKING PART 1: Technology/);
assert.match(context.context, /STRUCTURED GRAMMAR:/);
assert(context.context.length < 10000);

const speakingSeed = buildStructuredLessonSeed("Food", "speaking", "B1");
assert.match(speakingSeed.grammar_focus.formula, /->/);
assert.equal(speakingSeed.speaking_questions.length, 3);
assert(speakingSeed.model_answer_en.length > 100);

const writingSeed = buildStructuredLessonSeed("Education", "writing", "B2");
assert(writingSeed.grammar_focus.formula);
assert.match(writingSeed.writing_task_uz, /80–120/);

const beginnerWritingSeed = buildStructuredLessonSeed("Education", "writing", "A2");
assert.deepEqual(beginnerWritingSeed, {});

assert.deepEqual(findSpeakingLessons("unmatched topic xyz"), []);
assert.equal(findGrammarItem("unmatched topic xyz"), null);

console.log("Structured content tests passed");
