const state = {
  view: "dashboard",
  vocab: [],
  renderedVocab: [],
  offset: 0,
  total: 0,
  flashIndex: 0,
  quiz: [],
  known: JSON.parse(localStorage.getItem("evm_known") || "[]"),
  saved: JSON.parse(localStorage.getItem("evm_saved") || "[]"),
  reviews: JSON.parse(localStorage.getItem("evm_reviews") || "{}"),
  mistakes: JSON.parse(localStorage.getItem("evm_mistakes") || "[]"),
  grammarProgress: JSON.parse(localStorage.getItem("evm_grammar_progress") || "{}"),
  typingStreak: Number(localStorage.getItem("evm_typing_streak") || "0"),
  topic: "",
  activePatternId: null,
  currentGrammarPatterns: []
};

const $ = (id) => document.getElementById(id);
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const titles = {
  dashboard: ["Overview", "Bugungi o'qish holati"],
  vocab: ["Lug'at", "DB asosidagi qidiruv va example'lar"],
  learn: ["Yodlash", "Flashcard va shaxsiy progress"],
  quiz: ["Quiz", "Tasodifiy testlar"],
  grammar: ["Grammar", "Pattern, misol va practice"],
  ai: ["AI Tutor", "Suhbat, generation va grammar check"]
};

const quickActions = {
  dashboard: [["start-plan", "Bugungi plan"], ["open-learn", "Yodlash"], ["open-grammar", "Grammar"]],
  vocab: [["focus-search", "Qidirish"], ["load-more", "Yana so'z"], ["open-learn", "Yodlash"]],
  learn: [["mark-known", "Bildim"], ["focus-typing", "Typing"], ["next-card", "Keyingi"]],
  quiz: [["new-quiz", "Yangi test"], ["open-vocab", "Lug'at"], ["open-ai", "AI yordam"]],
  grammar: [["grammar-review", "Final review"], ["grammar-drill", "Formula mashq"], ["open-ai", "AI check"]],
  ai: [["generate-lesson", "Dars yaratish"], ["focus-chat", "Chat"], ["focus-grammar-check", "Grammar check"]]
};

function authHeaders() {
  return { "Content-Type": "application/json" };
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  if (res.status === 401) {
    throw new Error("Unauthorized");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function pill(text, tone = "") {
  if (!text) return "";
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function taskList(items) {
  const rows = items.filter(Boolean).map(item => `<div>${escapeHtml(item)}</div>`).join("");
  return rows ? `<div class="task-list">${rows}</div>` : "";
}

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function saveProgress() {
  localStorage.setItem("evm_known", JSON.stringify(state.known));
  localStorage.setItem("evm_saved", JSON.stringify(state.saved));
  localStorage.setItem("evm_reviews", JSON.stringify(state.reviews));
  localStorage.setItem("evm_mistakes", JSON.stringify(state.mistakes.slice(0, 80)));
  localStorage.setItem("evm_grammar_progress", JSON.stringify(state.grammarProgress));
  localStorage.setItem("evm_typing_streak", String(state.typingStreak));
  $("streak").textContent = `${state.known.length} so'z`;
  const total = Number($("wordCount")?.textContent.replace(/,/g, "") || state.total || 0);
  const coverage = total ? Math.min(100, Math.round((state.known.length / total) * 1000) / 10) : 0;
  if ($("knownCount")) $("knownCount").textContent = state.known.length.toLocaleString();
  if ($("savedCount")) $("savedCount").textContent = state.saved.length.toLocaleString();
  if ($("coverageCount")) $("coverageCount").textContent = `${coverage}%`;
  if ($("coverageBar")) $("coverageBar").style.width = `${coverage}%`;
  updateStudyStats();
}

function currentStudyWord() {
  const list = state.renderedVocab.length ? state.renderedVocab : state.vocab;
  return list[state.flashIndex % Math.max(1, list.length)];
}

function updateStudyStats() {
  const now = Date.now();
  const reviewItems = Object.values(state.reviews || {});
  const due = reviewItems.filter(item => Number(item.next || 0) <= now).length;
  const mastered = reviewItems.filter(item => Number(item.level || 0) >= 4).length;
  const mastery = reviewItems.length ? Math.round((mastered / reviewItems.length) * 100) : 0;
  if ($("reviewDue")) $("reviewDue").textContent = due.toLocaleString();
  if ($("masteryScore")) $("masteryScore").textContent = `${mastery}%`;
  if ($("typingStreak")) $("typingStreak").textContent = state.typingStreak;
  if ($("planHint")) {
    const left = Math.max(0, 20 - state.known.length);
    $("planHint").textContent = left
      ? `Bugungi minimum uchun yana ${left} ta so'zni "Bildim" qiling va kamida 1 ta grammar formulani tekshiring.`
      : "Bugungi so'z minimumi bajarildi. Endi grammar formula va typing check bilan mustahkamlang.";
  }
}

function scheduleReview(word, quality) {
  if (!word) return;
  const current = state.reviews[word.id] || { level: 0, seen: 0, wrong: 0, next: 0 };
  const level = quality === "hard" ? Math.max(0, current.level - 1) : Math.min(5, current.level + (quality === "easy" ? 2 : 1));
  const minutes = quality === "hard" ? 10 : quality === "easy" ? 60 * 24 * Math.max(1, level) : 60 * Math.max(1, level * 4);
  state.reviews[word.id] = {
    level,
    seen: Number(current.seen || 0) + 1,
    wrong: Number(current.wrong || 0) + (quality === "hard" ? 1 : 0),
    next: Date.now() + minutes * 60 * 1000
  };
  if (quality !== "hard" && !state.known.includes(word.id)) state.known.push(word.id);
  saveProgress();
}

function normalizeAnswer(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
}

function addMistake(item) {
  const entry = {
    id: Date.now(),
    date: new Date().toLocaleDateString(),
    type: item.type || "Grammar",
    title: item.title || "Mistake",
    original: item.original || "",
    corrected: item.corrected || "",
    note: item.note || "",
    task: item.task || ""
  };
  state.mistakes = [entry, ...state.mistakes].slice(0, 80);
  saveProgress();
  renderMistakeNotebook();
}

function renderMistakeNotebook() {
  const target = $("mistakeNotebook");
  if (!target) return;
  if (!state.mistakes.length) {
    target.innerHTML = `<div class="empty-state">Hali xato saqlanmagan. Grammar check yoki Formula Lab ishlatsangiz, xatolar shu yerga yig'iladi.</div>`;
    return;
  }
  target.innerHTML = state.mistakes.map(item => `
    <article class="mistake-card">
      <div class="mistake-head"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.date)} - ${escapeHtml(item.type)}</span></div>
      ${item.original ? `<p><b>Original:</b> ${escapeHtml(item.original)}</p>` : ""}
      ${item.corrected ? `<p><b>Corrected:</b> ${escapeHtml(item.corrected)}</p>` : ""}
      ${item.note ? `<p class="uz">${escapeHtml(item.note)}</p>` : ""}
      ${item.task ? `<p><b>Next:</b> ${escapeHtml(item.task)}</p>` : ""}
    </article>`).join("");
}

function checkTypingAnswer() {
  const word = currentStudyWord();
  const input = $("typingAnswer");
  const target = $("typingFeedback");
  if (!word || !input || !target) return;
  const answer = normalizeAnswer(input.value);
  const english = normalizeAnswer(word.english);
  const uzbek = normalizeAnswer(word.uzbek);
  const ok = Boolean(answer) && (english.includes(answer) || answer.includes(english) || uzbek.includes(answer) || answer.includes(uzbek));
  if (ok) {
    state.typingStreak += 1;
    scheduleReview(word, "good");
    target.innerHTML = `<div class="typing-ok"><strong>To'g'ri.</strong> ${escapeHtml(word.english)} - ${escapeHtml(word.uzbek)}</div>`;
  } else {
    state.typingStreak = 0;
    scheduleReview(word, "hard");
    target.innerHTML = `<div class="typing-bad"><strong>Yana urinib ko'ring.</strong> Hint: ${escapeHtml(word.learning?.formula || word.definition || "")}</div>`;
  }
  input.value = "";
  saveProgress();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
  document.querySelectorAll(".nav").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  $("viewTitle").textContent = titles[view][0];
  $("viewSub").textContent = titles[view][1];
  renderQuickActions(view);
  if (view === "quiz" && !state.quiz.length) loadQuiz();
  if (view === "grammar") {
    renderGrammarMissionStats();
    loadGrammarSections();
  }
  if (view === "ai") renderMistakeNotebook();
  if (view === "learn") {
    if (!state.vocab.length) loadVocab(true).then(renderFlashcard);
    else renderFlashcard();
  }
}

function renderQuickActions(view = state.view) {
  const target = $("quickActions");
  if (!target) return;
  target.innerHTML = (quickActions[view] || []).map(([action, label]) =>
    `<button class="quick-action" data-quick-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`
  ).join("");
}

function runQuickAction(action) {
  const click = (id) => $(id)?.click();
  const focus = (id) => $(id)?.focus();
  const go = (view) => setView(view);
  const actions = {
    "start-plan": () => click("startDailyPlan"),
    "open-learn": () => go("learn"),
    "open-grammar": () => go("grammar"),
    "open-vocab": () => go("vocab"),
    "open-ai": () => go("ai"),
    "focus-search": () => focus("searchInput"),
    "load-more": () => click("loadMore"),
    "mark-known": () => click("knowCard"),
    "focus-typing": () => focus("typingAnswer"),
    "next-card": () => click("nextCard"),
    "new-quiz": () => click("newQuiz"),
    "grammar-review": () => click("buildReviewDeck"),
    "grammar-drill": () => click("startGrammarDrill"),
    "generate-lesson": () => click("generateLesson"),
    "focus-chat": () => focus("chatInput"),
    "focus-grammar-check": () => focus("grammarText")
  };
  actions[action]?.();
}

function wordCard(word) {
  const saved = state.saved.includes(word.id);
  const learning = word.learning || {};
  return `
    <article class="word-card" data-word="${word.id}">
      <div class="word-title">
        <div><h3>${escapeHtml(word.english)}</h3><span>${escapeHtml(word.uzbek)}</span></div>
        <button class="ghost save-word" data-save="${word.id}">${saved ? "Saved" : "Save"}</button>
      </div>
      <div class="meta">
        ${pill(learning.topic_label || word.topic)}
        ${pill(word.level, "green")}
        ${pill(learning.type_label || word.type, "rose")}
        ${pill(learning.usage_label, "amber")}
      </div>
      <p>${escapeHtml(word.definition || "")}</p>
      <div class="mini-formula"><strong>Formula:</strong> ${escapeHtml(learning.formula || `${word.english} + context`)}</div>
      <div class="example">${escapeHtml(word.example_en || "Example mavjud emas")}
        <div class="uz">${escapeHtml(word.example_uz || "")}</div>
      </div>
    </article>`;
}

function renderVocab(append = false) {
  const source = append ? state.vocab : state.renderedVocab;
  const html = source.map(wordCard).join("");
  if (append) $("vocabList").insertAdjacentHTML("beforeend", html);
  else $("vocabList").innerHTML = html;
  $("loadMore").style.display = state.renderedVocab.length < state.total ? "block" : "none";
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  $("wordCount").textContent = data.counts.words.toLocaleString();
  $("topicCount").textContent = data.counts.topics;
  $("quizCount").textContent = data.counts.quiz.toLocaleString();
  $("grammarCount").textContent = data.counts.grammar;
  saveProgress();
  $("todayWord").innerHTML = wordCard(data.today);
  $("todayAi").dataset.wordId = data.today.id;
  $("topicChips").innerHTML = data.topics.map(t => `<button class="chip" data-topic="${escapeHtml(t.topic)}">${escapeHtml(t.topic)} ${t.count}</button>`).join("");
}

async function loadTopics() {
  const data = await api("/api/topics");
  const options = `<option value="">Barcha mavzular</option>` + data.items
    .map(t => `<option value="${escapeHtml(t.topic)}">${escapeHtml(t.topic)} (${t.count})</option>`)
    .join("");
  $("topicFilter").innerHTML = options;
  if ($("lessonTopic")) {
    $("lessonTopic").innerHTML = `<option value="">Topic tanlang</option>` + data.items
      .map(t => `<option value="${escapeHtml(t.topic)}">${escapeHtml(t.topic)}</option>`)
      .join("");
  }
}

async function loadVocab(reset = false) {
  if (reset) {
    state.offset = 0;
    state.vocab = [];
    state.renderedVocab = [];
  }
  const params = new URLSearchParams({
    offset: String(state.offset),
    limit: "24"
  });
  const q = $("searchInput")?.value?.trim();
  const level = $("levelFilter")?.value;
  const topic = $("topicFilter")?.value || state.topic;
  if (q) params.set("q", q);
  if (level) params.set("level", level);
  if (topic) params.set("topic", topic);
  const data = await api(`/api/vocab?${params}`);
  state.total = data.total;
  state.vocab = data.items;
  state.renderedVocab = reset ? data.items : [...state.renderedVocab, ...data.items];
  renderVocab(!reset && state.offset > 0);
  return data.items;
}

async function showWord(id) {
  const word = await api(`/api/word/${id}`);
  const learning = word.learning || {};
  $("wordDetail").innerHTML = `
    <div class="word-detail-layout">
      <section class="word-detail-main">
        <div class="word-title">
          <div><h3>${escapeHtml(word.english)}</h3><span>${escapeHtml(word.uzbek)}</span></div>
          <button id="aiForWord">AI card</button>
        </div>
        <div class="meta">
          ${pill(learning.topic_label || word.topic)}
          ${pill(word.level, "green")}
          ${pill(learning.type_label || word.type, "rose")}
          ${pill(learning.subtype_label, "amber")}
          ${pill(learning.register_label)}
        </div>
        <p>${escapeHtml(word.definition || "")}</p>
        <div class="example">${escapeHtml(word.example_en || "")}<div class="uz">${escapeHtml(word.example_uz || "")}</div></div>
        ${word.synonyms?.length ? `<p><strong>Synonyms:</strong> ${word.synonyms.map(escapeHtml).join(", ")}</p>` : ""}
      </section>
      <aside class="word-detail-side">
        <section class="learning-grid">
          <div class="learning-box"><span>Formula</span><strong>${escapeHtml(learning.formula || "")}</strong></div>
          <div class="learning-box"><span>Qachon ishlatiladi</span><strong>${escapeHtml(learning.pattern || "")}</strong></div>
        </section>
        ${taskList([learning.memory_tip_uz, learning.speak_task, learning.write_task])}
      </aside>
    </div>
    <div id="wordAiResult" class="ai-result"></div>`;
  $("aiForWord").onclick = () => generateForWord(id, $("wordAiResult"));
  $("wordDialog").showModal();
}

async function generateForWord(id, target) {
  target.innerHTML = "AI tayyorlayapti...";
  const data = await api("/api/ai/sentence", { method: "POST", body: JSON.stringify({ wordId: id }) });
  target.innerHTML = `
    <div class="example">
      <strong>${escapeHtml(data.sentence_en || data.raw || "")}</strong>
      <div class="uz">${escapeHtml(data.sentence_uz || "")}</div>
    </div>
    <p>${escapeHtml(data.explanation_uz || "")}</p>
    ${data.speaking_prompt ? `<p><strong>Speaking:</strong> ${escapeHtml(data.speaking_prompt)}</p>` : ""}
    ${data.writing_prompt ? `<p><strong>Writing:</strong> ${escapeHtml(data.writing_prompt)}</p>` : ""}
    ${data.memory_tip_uz ? `<p><strong>Memory:</strong> ${escapeHtml(data.memory_tip_uz)}</p>` : ""}
    ${data.common_mistake_uz ? `<p><strong>Common mistake:</strong> ${escapeHtml(data.common_mistake_uz)}</p>` : ""}
    ${data.offline ? `<p class="uz">OpenRouter kalit topilmagani uchun offline javob.</p>` : ""}`;
}

function renderFlashcard() {
  const word = currentStudyWord();
  if (!word) return;
  const learning = word.learning || {};
  const review = state.reviews[word.id] || {};
  $("flashTopic").textContent = `${learning.topic_label || word.topic} - ${word.level} - ${learning.type_label || word.type}`;
  $("flashWord").textContent = word.english;
  $("flashUz").textContent = word.uzbek;
  $("flashExample").innerHTML = `
    <strong>${escapeHtml(learning.formula || "")}</strong><br>
    ${escapeHtml(word.example_en || word.definition || "")}
    <span>${escapeHtml(learning.memory_tip_uz || "")}</span>
    <small>Review level: ${escapeHtml(review.level ?? 0)}/5 - Seen: ${escapeHtml(review.seen ?? 0)}</small>`;
  $("savedWords").innerHTML = state.saved.slice(-12).map(id => `<span class="chip">#${id}</span>`).join("");
  if ($("typingFeedback")) $("typingFeedback").innerHTML = "";
  if ($("typingAnswer")) $("typingAnswer").value = "";
  updateStudyStats();
}

async function loadQuiz() {
  const topic = $("topicFilter").value;
  const data = await api(`/api/quiz${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`);
  state.quiz = data.items;
  $("quizBox").innerHTML = data.items.map((q, idx) => `
    <article class="quiz-item" data-q="${idx}">
      <div class="quiz-head"><span>${escapeHtml(q.topic || "General")}</span><strong>${idx + 1}. ${escapeHtml(q.question)}</strong></div>
      <div class="answers">
        ${q.options.map(opt => `<button class="answer" data-answer="${escapeHtml(opt)}" data-correct="${escapeHtml(q.correct_answer)}">${escapeHtml(opt)}</button>`).join("")}
      </div>
      <p class="uz hidden">${escapeHtml(q.explanation || "")}</p>
    </article>`).join("");
}

async function loadGrammarSections() {
  if ($("grammarSections").dataset.loaded) return;
  const data = await api("/api/grammar/sections");
  $("grammarSections").dataset.loaded = "1";
  $("grammarSections").innerHTML = data.items.map(s => `<button data-section="${escapeHtml(s.code)}">${escapeHtml(s.title_en)} (${s.pattern_count})</button>`).join("");
  renderGrammarRoadmap(data.items);
  if (data.items[0]) loadGrammarPatterns(data.items[0].code);
}

function renderGrammarRoadmap(items) {
  const target = $("grammarRoadmap");
  if (!target) return;
  target.innerHTML = items.map((section, index) => `
    <button class="roadmap-step" data-section="${escapeHtml(section.code)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(section.title_en)}</strong>
      <em>${escapeHtml(section.pattern_count)} pattern - formula, example, practice</em>
    </button>`).join("");
}

function renderGuidedBuilder(pattern) {
  const steps = pattern.formula_steps?.length
    ? pattern.formula_steps
    : [{ index: 1, text: pattern.formula || "Your idea" }];
  return `
    <h4>Guided answer builder</h4>
    <div class="guided-builder" data-builder-pattern="${pattern.id}">
      <div class="builder-toolbar">
        <div class="segmented">
          <button class="active" data-builder-mode="speaking">Speaking</button>
          <button data-builder-mode="writing">Writing</button>
        </div>
        <span>Formula qismlarini to'ldiring, keyin javobni yig'ing.</span>
      </div>
      <div class="builder-steps">
        ${steps.map(step => `
          <label>
            <span>${escapeHtml(step.index)}. ${escapeHtml(step.text)}</span>
            <input data-builder-step="${escapeHtml(step.index)}" placeholder="${escapeHtml(step.text)} uchun gap bo'lagi">
          </label>`).join("")}
      </div>
      <div class="builder-actions">
        <button id="buildGrammarAnswer">Build answer</button>
        <button id="sendBuilderToLab" class="ghost">Formula Labga yuborish</button>
      </div>
      <div id="builderOutput" class="builder-output empty">Hali javob yig'ilmagan.</div>
    </div>`;
}

function grammarProgressLevel(patternId) {
  return Number(state.grammarProgress[String(patternId)]?.level || 0);
}

function grammarStatusMeta(patternId) {
  const level = grammarProgressLevel(patternId);
  if (level >= 3) return { label: "Mastered", className: "mastered" };
  if (level === 2) return { label: "Practice", className: "practice" };
  if (level === 1) return { label: "Started", className: "started" };
  return { label: "New", className: "new" };
}

function renderPatternSummary(items = []) {
  const target = $("patternSummary");
  if (!target) return;
  const mastered = items.filter(item => grammarProgressLevel(item.id) >= 3).length;
  const started = items.filter(item => grammarProgressLevel(item.id) > 0).length;
  const total = items.length || 0;
  const percent = total ? Math.round((mastered / total) * 100) : 0;
  target.innerHTML = `
    <div><strong>${mastered}/${total}</strong><span>mastered</span></div>
    <div><strong>${started}</strong><span>started</span></div>
    <div><strong>${percent}%</strong><span>section</span></div>`;
}

function renderGrammarRecommendations(items = state.currentGrammarPatterns || []) {
  const target = $("grammarRecommendations");
  if (!target) return;
  if (!items.length) {
    target.innerHTML = "";
    return;
  }
  const sorted = [...items].sort((a, b) => grammarProgressLevel(a.id) - grammarProgressLevel(b.id));
  const weakest = sorted[0];
  const review = sorted.find(item => {
    const level = grammarProgressLevel(item.id);
    return level > 0 && level < 3;
  }) || weakest;
  const mastered = items.filter(item => grammarProgressLevel(item.id) >= 3).length;
  const percent = Math.round((mastered / items.length) * 100);
  const cards = [
    {
      label: "1-qadam",
      title: "Zaif formulani oching",
      text: weakest ? `${weakest.title_en} orqali gap tuzishni boshlang.` : "Birinchi patternni tanlang.",
      action: "Boshlash",
      id: weakest?.id
    },
    {
      label: "Review",
      title: "Qayta mustahkamlang",
      text: review ? `${review.title_en} bo'yicha bitta speaking javob yozing.` : "Final review deckdan foydalaning.",
      action: "Practice",
      id: review?.id
    },
    {
      label: "Section",
      title: `${percent}% mastered`,
      text: percent >= 80 ? "Zo'r. Endi mini quiz va Formula Lab bilan yakunlang." : "80% ga yetguncha har kuni 2 ta patternni tekshiring.",
      action: "Final review",
      id: weakest?.id,
      reviewDeck: true
    }
  ];
  target.innerHTML = `
    <div class="recommendation-head">
      <strong>Smart tavsiyalar</strong>
      <span>Progressga qarab keyingi mashq</span>
    </div>
    <div class="recommendation-grid">
      ${cards.map(card => `<article class="recommendation-card">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <p>${escapeHtml(card.text)}</p>
        <button class="ghost" data-recommend-pattern="${escapeHtml(card.id || "")}" data-recommend-review="${card.reviewDeck ? "1" : "0"}">${escapeHtml(card.action)}</button>
      </article>`).join("")}
    </div>`;
}

function markGrammarProgress(patternId, level) {
  if (!patternId) return;
  const key = String(patternId);
  const current = state.grammarProgress[key] || { level: 0, checks: 0 };
  state.grammarProgress[key] = {
    level: Math.max(Number(current.level || 0), level),
    checks: Number(current.checks || 0) + 1,
    updated: Date.now()
  };
  saveProgress();
  updateGrammarProgressUi(patternId);
}

function updateGrammarProgressUi(patternId) {
  const level = grammarProgressLevel(patternId);
  const labels = ["Boshlanmagan", "Tushundim", "Mashq qildim", "Mastered"];
  if ($("grammarMasteryLabel")) $("grammarMasteryLabel").textContent = labels[level] || labels[0];
  if ($("grammarMasteryBar")) $("grammarMasteryBar").style.width = `${Math.min(100, level * 33.34)}%`;
  document.querySelectorAll("[data-grammar-level]").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.grammarLevel) <= level);
  });
  renderGrammarMissionStats();
  document.querySelectorAll("[data-pattern]").forEach(btn => {
    const meta = grammarStatusMeta(btn.dataset.pattern);
    const badge = btn.querySelector(".pattern-status");
    if (badge) {
      badge.className = `pattern-status ${meta.className}`;
      badge.textContent = meta.label;
    }
  });
  renderPatternSummary(state.currentGrammarPatterns);
  renderGrammarRecommendations(state.currentGrammarPatterns);
}

function renderGrammarMissionStats() {
  const items = Object.values(state.grammarProgress || {});
  const started = items.filter(item => Number(item.level || 0) > 0).length;
  const mastered = items.filter(item => Number(item.level || 0) >= 3).length;
  const review = items.filter(item => Number(item.level || 0) > 0 && Number(item.level || 0) < 3).length;
  if ($("grammarStartedCount")) $("grammarStartedCount").textContent = started;
  if ($("grammarMasteredCount")) $("grammarMasteredCount").textContent = mastered;
  if ($("grammarReviewCount")) $("grammarReviewCount").textContent = review;
}

function renderGrammarMission(pattern) {
  const target = $("grammarMission");
  if (!target || !pattern) return;
  const pack = pattern.teacher_pack || {};
  const prompts = pack.exam_prompts || [];
  const prompt = prompts[Math.floor(Math.random() * Math.max(1, prompts.length))] || {};
  target.innerHTML = `
    <div>
      <span>${escapeHtml(prompt.part || pattern.ielts_part || "Practice")}</span>
      <strong>${escapeHtml(prompt.prompt_en || "Use this formula in one natural answer.")}</strong>
      <p>${escapeHtml(prompt.target_uz || pack.mini_challenge_uz || "Formula bilan bitta javob yozing.")}</p>
    </div>
    <button id="useMissionPrompt" class="ghost">Builderda boshlash</button>`;
}

function buildGrammarReviewDeck() {
  const target = $("grammarReviewDeck");
  if (!target) return;
  const items = [...(state.currentGrammarPatterns || [])];
  if (!items.length) {
    target.innerHTML = `<div class="empty-state">Avval grammar section tanlang.</div>`;
    return;
  }
  const sorted = items.sort((a, b) => grammarProgressLevel(a.id) - grammarProgressLevel(b.id));
  const deck = sorted.slice(0, 3);
  target.innerHTML = `
    <h4>Final review deck</h4>
    <div class="review-grid">
      ${deck.map(item => {
        const meta = grammarStatusMeta(item.id);
        return `<article class="review-card" data-review-pattern="${item.id}">
          <div class="review-head">
            <span class="pattern-status ${meta.className}">${escapeHtml(meta.label)}</span>
            <small>${escapeHtml(item.level || "")} - ${escapeHtml(item.ielts_part || "")}</small>
          </div>
          <strong>${escapeHtml(item.title_en)}</strong>
          <p>${escapeHtml(item.formula || "")}</p>
          <div class="review-actions">
            <button data-open-review="${item.id}" class="ghost">Ochish</button>
            <button data-mark-reviewed="${item.id}">Reviewed</button>
          </div>
        </article>`;
      }).join("")}
    </div>`;
}

function getBuilderAnswer() {
  const builder = document.querySelector(".guided-builder");
  if (!builder) return "";
  const mode = builder.querySelector("[data-builder-mode].active")?.dataset.builderMode || "speaking";
  const parts = Array.from(builder.querySelectorAll("[data-builder-step]"))
    .map(input => input.value.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const connector = mode === "writing" ? " " : " ";
  return parts.join(connector).replace(/\s+/g, " ").trim();
}

function buildGrammarAnswer() {
  const output = $("builderOutput");
  if (!output) return;
  const answer = getBuilderAnswer();
  if (!answer) {
    output.className = "builder-output empty";
    output.textContent = "Kamida bitta formula qismini to'ldiring.";
    return;
  }
  output.className = "builder-output";
  output.innerHTML = `<strong>Built answer:</strong><p>${escapeHtml(answer)}</p>`;
  markGrammarProgress(state.activePatternId, 2);
}

function sendBuilderToLab() {
  const answer = getBuilderAnswer();
  const lab = $("patternAnswer");
  const output = $("builderOutput");
  if (!answer || !lab) {
    if (output) {
      output.className = "builder-output empty";
      output.textContent = "Avval formula qismlarini yozing.";
    }
    return;
  }
  lab.value = answer;
  lab.focus();
  if (output) {
    output.className = "builder-output";
    output.innerHTML = `<strong>Formula Lab tayyor:</strong><p>${escapeHtml(answer)}</p>`;
  }
}

function startMissionInBuilder() {
  const mission = $("grammarMission");
  const firstInput = document.querySelector("[data-builder-step]");
  if (!mission || !firstInput) return;
  const prompt = mission.querySelector("strong")?.textContent || "";
  firstInput.value = prompt;
  firstInput.focus();
  markGrammarProgress(state.activePatternId, 1);
}

async function loadGrammarPatterns(section) {
  const data = await api(`/api/grammar/patterns?section=${encodeURIComponent(section)}`);
  state.currentGrammarPatterns = data.items;
  document.querySelectorAll("[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === section));
  renderPatternSummary(data.items);
  renderGrammarRecommendations(data.items);
  $("grammarPatterns").innerHTML = data.items.map(p => {
    const meta = grammarStatusMeta(p.id);
    return `<button data-pattern="${p.id}">
      <span class="pattern-row"><strong>${escapeHtml(p.title_en)}</strong><span class="pattern-status ${meta.className}">${escapeHtml(meta.label)}</span></span>
      <small>${escapeHtml(p.level || "")} - ${escapeHtml(p.category || "")}</small>
    </button>`;
  }).join("");
  if (data.items[0]) loadGrammarDetail(data.items[0].id);
}

async function loadGrammarDetail(id) {
  state.activePatternId = Number(id);
  const data = await api(`/api/grammar/pattern/${id}`);
  const pack = data.pattern.teacher_pack || {};
  document.querySelectorAll("[data-pattern]").forEach(b => b.classList.toggle("active", Number(b.dataset.pattern) === Number(id)));
  $("grammarDetail").innerHTML = `
    <h3>${escapeHtml(data.pattern.title_en)}</h3>
    <p class="uz">${escapeHtml(data.pattern.title_uz || "")}</p>
    <div class="meta">
      ${pill(data.pattern.level)}
      ${pill(data.pattern.ielts_part || "All", "green")}
      ${pill(data.pattern.category, "rose")}
      ${pill(data.pattern.learning?.register, "amber")}
    </div>
    <div class="formula-card">
      <span>Formula</span>
      <strong>${escapeHtml(data.pattern.formula || "")}</strong>
      <div class="formula-steps">
        ${(data.pattern.formula_steps || []).map(step => `<div><b>${step.index}</b>${escapeHtml(step.text)}</div>`).join("")}
      </div>
    </div>
    <div class="grammar-mastery-card">
      <div>
        <span>Mastery</span>
        <strong id="grammarMasteryLabel">Boshlanmagan</strong>
      </div>
      <div class="mastery-bar"><span id="grammarMasteryBar"></span></div>
      <div class="grammar-markers">
        <button data-grammar-level="1">Tushundim</button>
        <button data-grammar-level="2">Mashq qildim</button>
        <button data-grammar-level="3">Mastered</button>
      </div>
    </div>
    <div class="teacher-card">
      <strong>Masterclass path</strong>
      <p>${escapeHtml(pack.objective_uz || "")}</p>
      <ol>
        ${(pack.mastery_checklist || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
    </div>
    <div class="usage-card"><strong>Qachon ishlatiladi:</strong> ${escapeHtml(data.pattern.learning?.use_case || "")}</div>
    <div class="teacher-note">${escapeHtml(pack.simple_explanation_uz || data.pattern.explanation_uz || "")}</div>
    <p>${escapeHtml(data.pattern.explanation_uz || "")}</p>
    <section class="masterclass-grid">
      <div>
        <h4>Common mistakes</h4>
        ${taskList(pack.common_mistakes || [])}
      </div>
      <div>
        <h4>Speaking frames</h4>
        ${taskList(pack.speaking_frames || [])}
      </div>
      <div>
        <h4>Writing frames</h4>
        ${taskList(pack.writing_frames || [])}
      </div>
      <div>
        <h4>Transformation drills</h4>
        ${taskList(pack.transformation_drills || [])}
      </div>
      <div>
        <h4>Band booster</h4>
        ${taskList(pack.band_boosters || [])}
      </div>
      <div>
        <h4>Self-check rubric</h4>
        <div class="rubric-grid">
          ${(pack.self_check_rubric || []).map(item => `<div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.target)}</span></div>`).join("")}
        </div>
      </div>
    </section>
    <section class="exam-coach-grid">
      <div class="exam-card">
        <h4>Exam coach</h4>
        ${(pack.exam_prompts || []).map(item => `
          <article>
            <span>${escapeHtml(item.part)}</span>
            <strong>${escapeHtml(item.prompt_en)}</strong>
            <p>${escapeHtml(item.target_uz)}</p>
          </article>`).join("")}
      </div>
      <div class="band-ladder-card">
        <h4>Band ladder</h4>
        ${(pack.band_ladder || []).map(item => `
          <article>
            <span>Band ${escapeHtml(item.band)}</span>
            <strong>${escapeHtml(item.focus)}</strong>
            <p>${escapeHtml(item.example)}</p>
          </article>`).join("")}
      </div>
    </section>
    <section class="do-dont-grid">
      ${(pack.do_dont || []).map(item => `
        <div>
          <strong>Do</strong>
          <p>${escapeHtml(item.do)}</p>
        </div>
        <div class="dont">
          <strong>Don't</strong>
          <p>${escapeHtml(item.dont)}</p>
        </div>`).join("")}
    </section>
    ${pack.mini_challenge_uz ? `<div class="challenge-card"><strong>Mini challenge</strong><span>${escapeHtml(pack.mini_challenge_uz)}</span></div>` : ""}
    ${renderGuidedBuilder(data.pattern)}
    <h4>Ready phrases</h4>
    <div class="phrase-grid">${data.phrases.map(p => `<div><strong>${escapeHtml(p.phrase_en)}</strong><span>${escapeHtml(p.use_case || p.phrase_uz || "")}</span></div>`).join("")}</div>
    <h4>Examples</h4>
    ${data.examples.map(e => `<div class="example">${escapeHtml(e.example_en)}<div class="uz">${escapeHtml(e.example_uz)}</div></div>`).join("")}
    <h4>Practice</h4>
    ${data.practice.map(p => `<div class="practice-card"><strong>${escapeHtml(p.question)}</strong><span>${escapeHtml(p.answer || "")}</span><em>${escapeHtml(p.explanation_uz || "")}</em></div>`).join("")}
    <h4>Formula Lab</h4>
    <div class="formula-lab">
      <textarea id="patternAnswer" placeholder="Shu formuladan foydalanib javob yozing..."></textarea>
      <button id="checkPatternAnswer" data-pattern-id="${data.pattern.id}">Formula bo'yicha tekshirish</button>
      <div id="patternFeedback" class="pattern-feedback"></div>
    </div>
    <h4>Mini quiz</h4>
    ${data.quiz.map(q => {
      const options = shuffled([q.correct_answer, ...(q.wrong_answers || []).slice(0, 3)]);
      return `<div class="practice-card grammar-quiz-card">
        <strong>${escapeHtml(q.question)}</strong>
        <div class="grammar-options">
          ${options.map(option => `<button class="grammar-answer" data-answer="${escapeHtml(option)}" data-correct="${escapeHtml(q.correct_answer)}">${escapeHtml(option)}</button>`).join("")}
        </div>
        <em class="hidden">${escapeHtml(q.explanation_uz || "")}</em>
      </div>`;
    }).join("")}`;
  updateGrammarProgressUi(data.pattern.id);
  renderGrammarMission(data.pattern);
}

function addBubble(text, who) {
  const div = document.createElement("div");
  div.className = `bubble ${who}`;
  div.textContent = text;
  $("chatLog").appendChild(div);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
  return div;
}

async function init() {
  saveProgress();
  renderQuickActions(state.view);
  await Promise.all([loadDashboard(), loadTopics(), loadVocab(true)]);
}

document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
$("quickActions").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-quick-action]");
  if (!btn) return;
  runQuickAction(btn.dataset.quickAction);
});
$("syncBtn").onclick = () => Promise.all([loadDashboard(), loadVocab(true)]);
$("resetProgress").onclick = () => {
  state.known = [];
  state.saved = [];
  state.reviews = {};
  state.typingStreak = 0;
  saveProgress();
  renderVocab(false);
  renderFlashcard();
};
$("startDailyPlan").onclick = () => {
  setView("learn");
  renderFlashcard();
};
$("searchBtn").onclick = () => loadVocab(true);
$("searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") loadVocab(true); });
$("levelFilter").onchange = () => loadVocab(true);
$("topicFilter").onchange = () => loadVocab(true);
$("loadMore").onclick = async () => {
  state.offset += 24;
  await loadVocab(false);
};
$("vocabList").addEventListener("click", (e) => {
  const save = e.target.closest("[data-save]");
  if (save) {
    e.stopPropagation();
    const id = Number(save.dataset.save);
    state.saved = state.saved.includes(id) ? state.saved.filter(x => x !== id) : [...state.saved, id];
    saveProgress();
    renderVocab(false);
    return;
  }
  const card = e.target.closest("[data-word]");
  if (card) showWord(card.dataset.word);
});
$("todayWord").addEventListener("click", (e) => {
  const card = e.target.closest("[data-word]");
  if (card) showWord(card.dataset.word);
});
$("todayAi").onclick = () => showWord($("todayAi").dataset.wordId);
$("topicChips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-topic]");
  if (!chip) return;
  $("topicFilter").value = chip.dataset.topic;
  setView("vocab");
  loadVocab(true);
});
$("prevCard").onclick = () => { state.flashIndex = Math.max(0, state.flashIndex - 1); renderFlashcard(); };
$("nextCard").onclick = () => { state.flashIndex += 1; renderFlashcard(); };
$("hardCard").onclick = () => {
  scheduleReview(currentStudyWord(), "hard");
  state.flashIndex += 1;
  renderFlashcard();
};
$("knowCard").onclick = () => {
  const word = currentStudyWord();
  scheduleReview(word, "good");
  state.flashIndex += 1;
  renderFlashcard();
};
$("easyCard").onclick = () => {
  scheduleReview(currentStudyWord(), "easy");
  state.flashIndex += 1;
  renderFlashcard();
};
$("checkTyping").onclick = checkTypingAnswer;
$("typingAnswer").addEventListener("keydown", (e) => { if (e.key === "Enter") checkTypingAnswer(); });
$("revealAnswer").onclick = () => {
  const word = currentStudyWord();
  if (!word) return;
  $("typingFeedback").innerHTML = `<div class="typing-hint"><strong>Javob:</strong> ${escapeHtml(word.english)} - ${escapeHtml(word.uzbek)}</div>`;
};
$("newQuiz").onclick = loadQuiz;
$("quizBox").addEventListener("click", (e) => {
  const btn = e.target.closest(".answer");
  if (!btn) return;
  const item = btn.closest(".quiz-item");
  item.querySelectorAll(".answer").forEach(answer => {
    answer.disabled = true;
    if (answer.dataset.answer === answer.dataset.correct) answer.classList.add("ok");
  });
  if (btn.dataset.answer !== btn.dataset.correct) btn.classList.add("bad");
  item.querySelector(".uz")?.classList.remove("hidden");
});
$("grammarSections").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-section]");
  if (btn) loadGrammarPatterns(btn.dataset.section);
});
$("grammarPatterns").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pattern]");
  if (btn) loadGrammarDetail(btn.dataset.pattern);
});
$("grammarDetail").addEventListener("click", (e) => {
  const modeButton = e.target.closest("[data-builder-mode]");
  if (modeButton) {
    modeButton.closest(".segmented")?.querySelectorAll("[data-builder-mode]").forEach(btn => btn.classList.remove("active"));
    modeButton.classList.add("active");
    return;
  }
  if (e.target.closest("#buildGrammarAnswer")) {
    buildGrammarAnswer();
    return;
  }
  if (e.target.closest("#sendBuilderToLab")) {
    sendBuilderToLab();
    return;
  }
  const marker = e.target.closest("[data-grammar-level]");
  if (marker) {
    markGrammarProgress(state.activePatternId, Number(marker.dataset.grammarLevel));
    return;
  }
  const checkBtn = e.target.closest("#checkPatternAnswer");
  if (checkBtn) {
    checkPatternAnswer(Number(checkBtn.dataset.patternId));
    return;
  }
  const btn = e.target.closest(".grammar-answer");
  if (!btn) return;
  const card = btn.closest(".grammar-quiz-card");
  card.querySelectorAll(".grammar-answer").forEach(answer => {
    answer.disabled = true;
    if (answer.dataset.answer === answer.dataset.correct) answer.classList.add("ok");
  });
  if (btn.dataset.answer !== btn.dataset.correct) btn.classList.add("bad");
  card.querySelector("em")?.classList.remove("hidden");
});
$("grammarMission").addEventListener("click", (e) => {
  if (e.target.closest("#useMissionPrompt")) startMissionInBuilder();
});
$("newGrammarMission").onclick = () => {
  if (state.activePatternId) loadGrammarDetail(state.activePatternId);
};
$("buildReviewDeck").onclick = buildGrammarReviewDeck;
$("grammarReviewDeck").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open-review]");
  if (open) {
    loadGrammarDetail(open.dataset.openReview);
    return;
  }
  const reviewed = e.target.closest("[data-mark-reviewed]");
  if (reviewed) {
    markGrammarProgress(Number(reviewed.dataset.markReviewed), 2);
    buildGrammarReviewDeck();
  }
});
$("grammarRecommendations").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-recommend-pattern]");
  if (!btn) return;
  if (btn.dataset.recommendReview === "1") buildGrammarReviewDeck();
  if (btn.dataset.recommendPattern) loadGrammarDetail(btn.dataset.recommendPattern);
});

async function checkPatternAnswer(patternId) {
  const answer = $("patternAnswer")?.value.trim();
  const target = $("patternFeedback");
  if (!answer || !target) return;
  target.innerHTML = "<div class=\"feedback-card\">Tekshirilmoqda...</div>";
  try {
    const data = await api("/api/ai/pattern-check", {
      method: "POST",
      body: JSON.stringify({ patternId, answer })
    });
    if ((Number(data.score) || 0) < 8) {
      addMistake({
        type: "Formula Lab",
        title: "Grammar formula",
        original: answer,
        corrected: data.corrected || "",
        note: data.formula_feedback_uz || data.raw || "",
        task: data.next_task_uz || ""
      });
      markGrammarProgress(patternId, 2);
    } else {
      markGrammarProgress(patternId, 3);
    }
    target.innerHTML = `
      <div class="feedback-card">
        <div class="score-row"><strong>Score: ${escapeHtml(data.score ?? 0)}/10</strong><span>${data.is_correct ? "Formula ishlatilgan" : "Yana ishlash kerak"}</span></div>
        <p><strong>Corrected:</strong><br>${escapeHtml(data.corrected || "")}</p>
        ${data.better ? `<p><strong>Better:</strong><br>${escapeHtml(data.better)}</p>` : ""}
        <p class="uz">${escapeHtml(data.formula_feedback_uz || data.raw || "")}</p>
        ${(data.used_steps || []).length ? `<p><strong>Used steps:</strong> ${data.used_steps.map(escapeHtml).join(", ")}</p>` : ""}
        ${(data.missing_steps || []).length ? `<p><strong>Missing steps:</strong> ${data.missing_steps.map(escapeHtml).join(", ")}</p>` : ""}
        ${data.next_task_uz ? `<p><strong>Next task:</strong> ${escapeHtml(data.next_task_uz)}</p>` : ""}
      </div>`;
  } catch (err) {
    target.innerHTML = `<div class="feedback-card bad">${escapeHtml(err.message)}</div>`;
  }
}

async function generateLessonPlan() {
  const topic = $("lessonTopic")?.value || $("topicFilter")?.value || "";
  const level = $("lessonLevel")?.value || "";
  const target = $("lessonResult");
  if (!target) return;
  target.innerHTML = `<div class="lesson-loading">Dars tayyorlanmoqda...</div>`;
  try {
    const data = await api("/api/ai/lesson", {
      method: "POST",
      body: JSON.stringify({ topic, level })
    });
    const drills = Array.isArray(data.vocab_drills) ? data.vocab_drills : [];
    const quiz = Array.isArray(data.mini_quiz) ? data.mini_quiz : [];
    target.innerHTML = `
      <div class="lesson-card">
        <div class="lesson-title">
          <div><span>AI lesson</span><h3>${escapeHtml(data.title_uz || "Mini dars")}</h3></div>
          ${data.offline ? pill("Offline", "amber") : pill("AI", "green")}
        </div>
        <p class="uz">${escapeHtml(data.goal_uz || "")}</p>
        ${data.warmup_question_en ? `<div class="example"><strong>Warm-up:</strong> ${escapeHtml(data.warmup_question_en)}</div>` : ""}
        <h4>10 words drill</h4>
        <div class="lesson-vocab">${drills.map(item => `
          <div>
            <strong>${escapeHtml(item.word || item.english || "")}</strong>
            <span>${escapeHtml(item.uzbek || item.uz || "")}</span>
            <p>${escapeHtml(item.sentence_en || item.example_en || "")}</p>
            <em>${escapeHtml(item.memory_tip_uz || "")}</em>
          </div>`).join("")}</div>
        <h4>Grammar focus</h4>
        <div class="formula-card">
          <span>${escapeHtml(data.grammar_focus?.title || "Formula")}</span>
          <strong>${escapeHtml(data.grammar_focus?.formula || "")}</strong>
          <p class="uz">${escapeHtml(data.grammar_focus?.explanation_uz || "")}</p>
          ${data.grammar_focus?.example_en ? `<div class="example">${escapeHtml(data.grammar_focus.example_en)}<div class="uz">${escapeHtml(data.grammar_focus.example_uz || "")}</div></div>` : ""}
        </div>
        <h4>Speaking</h4>
        <div class="task-list">${(data.speaking_questions || []).map(q => `<div>${escapeHtml(q)}</div>`).join("")}</div>
        <h4>Mini quiz</h4>
        <div class="lesson-quiz">${quiz.map(item => `<div><strong>${escapeHtml(item.question)}</strong><span>${escapeHtml(item.answer)}</span><em>${escapeHtml(item.explanation_uz || "")}</em></div>`).join("")}</div>
        ${data.writing_task_uz ? `<div class="usage-card"><strong>Writing:</strong> ${escapeHtml(data.writing_task_uz)}</div>` : ""}
        ${data.homework_uz ? `<p class="uz">${escapeHtml(data.homework_uz)}</p>` : ""}
      </div>`;
  } catch (err) {
    target.innerHTML = `<div class="feedback-card bad">${escapeHtml(err.message)}</div>`;
  }
}
$("sendChat").onclick = async () => {
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  addBubble(text, "user");
  const pending = addBubble("AI javob yozmoqda...", "ai");
  try {
    const data = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ message: text }) });
    pending.textContent = data.reply;
  } catch (err) {
    pending.textContent = err.message;
  }
};
$("checkGrammar").onclick = async () => {
  const text = $("grammarText").value.trim();
  if (!text) return;
  $("grammarResult").textContent = "Tekshirilmoqda...";
  try {
    const data = await api("/api/ai/grammar-check", { method: "POST", body: JSON.stringify({ text }) });
    addMistake({
      type: "Grammar check",
      title: `Score ${data.score ?? "-"}/10`,
      original: text,
      corrected: data.corrected || data.corrected_answer || "",
      note: data.explanation_uz || data.raw || "",
      task: data.practice_task || ""
    });
    $("grammarResult").innerHTML = `
      <div class="example"><strong>Score:</strong> ${escapeHtml(data.score ?? "-")}/10</div>
      <p><strong>Corrected:</strong><br>${escapeHtml(data.corrected || data.corrected_answer || data.raw || "")}</p>
      <p><strong>Better:</strong><br>${escapeHtml(data.better || data.better_version || "")}</p>
      ${data.grammar_formula ? `<p><strong>Formula:</strong><br>${escapeHtml(data.grammar_formula)}</p>` : ""}
      ${data.practice_task ? `<p><strong>Practice:</strong><br>${escapeHtml(data.practice_task)}</p>` : ""}
      <p class="uz">${escapeHtml(data.explanation_uz || "")}</p>`;
  } catch (err) {
    $("grammarResult").textContent = err.message;
  }
};
$("closeDialog").onclick = () => $("wordDialog").close();
$("generateLesson").onclick = generateLessonPlan;
$("clearMistakes").onclick = () => {
  state.mistakes = [];
  saveProgress();
  renderMistakeNotebook();
};
$("grammarRoadmap").addEventListener("click", (e) => {
  const step = e.target.closest("[data-section]");
  if (step) loadGrammarPatterns(step.dataset.section);
});
$("startGrammarDrill").onclick = () => {
  const box = $("patternAnswer");
  if (box) box.focus();
};

init().catch(err => {
  console.error(err);
  logout();
});
