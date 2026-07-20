function loadStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const state = {
  mistakes: loadStoredArray("evm_mistakes"),
  chatHistory: []
};

const $ = (id) => document.getElementById(id);
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "So'rov bajarilmadi");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function inlineTutorMarkup(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatTutorText(value) {
  return String(value || "").split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return `<span class="message-spacer" aria-hidden="true"></span>`;
    const heading = trimmed.match(/^#{1,3}\s+(.+)/);
    if (heading) return `<strong class="message-heading">${inlineTutorMarkup(heading[1])}</strong>`;
    const bullet = trimmed.match(/^[-•]\s+(.+)/);
    if (bullet) return `<span class="message-point"><i aria-hidden="true"></i><span>${inlineTutorMarkup(bullet[1])}</span></span>`;
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (numbered) return `<span class="message-point numbered"><b>${escapeHtml(numbered[1])}</b><span>${inlineTutorMarkup(numbered[2])}</span></span>`;
    return `<span class="message-line">${inlineTutorMarkup(trimmed)}</span>`;
  }).join("");
}

function pill(text, tone = "") {
  if (!text) return "";
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.idleText;
}

function showError(target, error) {
  target.innerHTML = `<div class="feedback-card bad" role="alert"><strong>So'rov bajarilmadi</strong><span>${escapeHtml(error.message)}</span></div>`;
}

function saveProgress() {
  localStorage.setItem("evm_mistakes", JSON.stringify(state.mistakes.slice(0, 80)));
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
  if (!state.mistakes.length) {
    target.innerHTML = `
      <div class="empty-state notebook-empty">
        <span>Notebook bo'sh</span>
        <strong>Grammar Check bilan birinchi javobingizni tekshiring.</strong>
        <p>Original, correction, izoh va next task avtomatik saqlanadi.</p>
      </div>`;
    return;
  }
  target.innerHTML = state.mistakes.map(item => `
    <article class="mistake-card">
      <header class="mistake-head">
        <div><span>${escapeHtml(item.type)}</span><strong>${escapeHtml(item.title)}</strong></div>
        <time>${escapeHtml(item.date)}</time>
      </header>
      ${item.original ? `<div class="mistake-field"><span>Original</span><p>${escapeHtml(item.original)}</p></div>` : ""}
      ${item.corrected ? `<div class="mistake-field corrected"><span>Corrected</span><p>${escapeHtml(item.corrected)}</p></div>` : ""}
      ${item.note ? `<div class="mistake-note">${escapeHtml(item.note)}</div>` : ""}
      ${item.task ? `<div class="next-task"><strong>Next task</strong><p>${escapeHtml(item.task)}</p></div>` : ""}
    </article>`).join("");
}

async function loadTopics() {
  const data = await api("/api/topics");
  $("lessonTopic").innerHTML = `<option value="">Topic tanlang</option>` + data.items
    .map(item => `<option value="${escapeHtml(item.topic)}">${escapeHtml(item.topic)}</option>`)
    .join("");
}

async function loadSystemStatus() {
  try {
    const data = await api("/api/health");
    const count = Number(data.tutorKnowledge?.entries || 0);
    if (count) $("knowledgeCount").textContent = count.toLocaleString();
    $("statusDot").classList.toggle("online", Boolean(data.aiConfigured));
    $("modelStatusText").textContent = data.aiConfigured ? "AI online · knowledge loaded" : "Knowledge loaded · API key kutilmoqda";
  } catch {
    $("modelStatusText").textContent = "Tizim holatini olib bo'lmadi";
  }
}

function addBubble(text, who) {
  document.querySelector(".chat-empty")?.remove();
  const bubble = document.createElement("article");
  bubble.className = `bubble ${who}`;
  const label = document.createElement("span");
  label.className = "bubble-label";
  label.textContent = who === "user" ? "Siz" : "AI Coach";
  const content = document.createElement("div");
  content.className = "bubble-content";
  content.innerHTML = formatTutorText(text);
  bubble.append(label, content);
  $("chatLog").appendChild(bubble);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
  return bubble;
}

function updateBubble(bubble, text, isError = false) {
  bubble.classList.toggle("error", isError);
  bubble.querySelector(".bubble-content").innerHTML = formatTutorText(text);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

function renderLesson(data) {
  const drills = Array.isArray(data.vocab_drills) ? data.vocab_drills : [];
  const quiz = Array.isArray(data.mini_quiz) ? data.mini_quiz : [];
  const speaking = Array.isArray(data.speaking_questions) ? data.speaking_questions : [];
  return `
    <article class="lesson-card">
      <header class="lesson-title">
        <div><span>Engineered lesson</span><h3>${escapeHtml(data.title_uz || "Mini dars")}</h3></div>
        ${data.offline ? pill("Offline", "amber") : pill("AI + Workbook", "green")}
      </header>
      <p class="lesson-goal">${escapeHtml(data.goal_uz || "")}</p>
      ${data.raw_note ? `<div class="source-note">${escapeHtml(data.raw_note)}</div>` : ""}
      ${data.warmup_question_en ? `<div class="warmup-card"><span>Warm-up</span><strong>${escapeHtml(data.warmup_question_en)}</strong></div>` : ""}

      <section class="lesson-section">
        <div class="lesson-section-title"><span>01</span><h4>10 words drill</h4><small>Meaning · context · memory</small></div>
        <div class="lesson-vocab">${drills.map((item, index) => `
          <article>
            <span class="item-number">${String(index + 1).padStart(2, "0")}</span>
            <div class="word-pair"><strong>${escapeHtml(item.word || item.english || "")}</strong><span>${escapeHtml(item.uzbek || item.uz || "")}</span></div>
            <p>${escapeHtml(item.sentence_en || item.example_en || "")}</p>
            ${item.sentence_uz ? `<p class="translation">${escapeHtml(item.sentence_uz)}</p>` : ""}
            ${item.memory_tip_uz ? `<em>${escapeHtml(item.memory_tip_uz)}</em>` : ""}
          </article>`).join("")}</div>
      </section>

      <section class="lesson-section">
        <div class="lesson-section-title"><span>02</span><h4>Grammar focus</h4><small>Rule · formula · example</small></div>
        <div class="formula-card">
          <span>${escapeHtml(data.grammar_focus?.title || "Formula")}</span>
          <code>${escapeHtml(data.grammar_focus?.formula || "")}</code>
          <p>${escapeHtml(data.grammar_focus?.explanation_uz || "")}</p>
          ${data.grammar_focus?.example_en ? `<div class="example"><strong>${escapeHtml(data.grammar_focus.example_en)}</strong><span>${escapeHtml(data.grammar_focus.example_uz || "")}</span></div>` : ""}
        </div>
      </section>

      <section class="lesson-section">
        <div class="lesson-section-title"><span>03</span><h4>Speaking ladder</h4><small>D-R-E-F → S.T.O.R.Y.+C.P.R.</small></div>
        <ol class="speaking-ladder">${speaking.map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
      </section>

      <section class="lesson-section">
        <div class="lesson-section-title"><span>04</span><h4>Mini quiz</h4><small>Meaning in context</small></div>
        <div class="lesson-quiz">${quiz.map((item, index) => `
          <article><span>Q${index + 1}</span><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer)}</p>${item.explanation_uz ? `<em>${escapeHtml(item.explanation_uz)}</em>` : ""}</article>`).join("")}</div>
      </section>

      <div class="lesson-finish-grid">
        ${data.writing_task_uz ? `<div class="usage-card"><span>Writing task</span><strong>${escapeHtml(data.writing_task_uz)}</strong></div>` : ""}
        ${data.homework_uz ? `<div class="homework-card"><span>Homework</span><strong>${escapeHtml(data.homework_uz)}</strong></div>` : ""}
      </div>
    </article>`;
}

async function generateLessonPlan() {
  const topic = $("lessonTopic").value;
  const level = $("lessonLevel").value;
  const target = $("lessonResult");
  const button = $("generateLesson");
  setBusy(button, true, "Dars qurilmoqda...");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="lesson-loading"><i aria-hidden="true"></i><div><strong>Workbook bilimlari tanlanmoqda</strong><span>Vocabulary, formula va mashqlar bitta darsga bog'lanadi.</span></div></div>`;
  try {
    const data = await api("/api/ai/lesson", {
      method: "POST",
      body: JSON.stringify({ topic, level })
    });
    target.innerHTML = renderLesson(data);
  } catch (error) {
    showError(target, error);
  } finally {
    target.setAttribute("aria-busy", "false");
    setBusy(button, false);
  }
}

async function sendChatMessage() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  const button = $("sendChat");
  input.value = "";
  addBubble(text, "user");
  const pending = addBubble("Workbookdan mos bilim topilmoqda...", "ai");
  pending.classList.add("thinking");
  setBusy(button, true, "Kutilmoqda...");
  try {
    const data = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, history: state.chatHistory })
    });
    pending.classList.remove("thinking");
    updateBubble(pending, data.reply);
    state.chatHistory = [
      ...state.chatHistory,
      { role: "user", content: text },
      { role: "assistant", content: data.reply }
    ].slice(-8);
  } catch (error) {
    pending.classList.remove("thinking");
    updateBubble(pending, error.message, true);
  } finally {
    setBusy(button, false);
    input.focus();
  }
}

function renderIssue(issue, index) {
  if (typeof issue === "string") return `<article><span>${index + 1}</span><p>${escapeHtml(issue)}</p></article>`;
  return `
    <article>
      <span>${index + 1}</span>
      <div>
        <strong>${escapeHtml(issue.type || "Issue")}</strong>
        ${issue.original ? `<p><del>${escapeHtml(issue.original)}</del></p>` : ""}
        ${issue.correction ? `<p class="issue-correction">${escapeHtml(issue.correction)}</p>` : ""}
        ${issue.reason_uz ? `<small>${escapeHtml(issue.reason_uz)}</small>` : ""}
      </div>
    </article>`;
}

function renderGrammarResult(data) {
  const score = Math.max(0, Math.min(10, Number(data.score) || 0));
  const scoreClass = `score-${Math.round(score)}`;
  const issues = Array.isArray(data.issues) ? data.issues : [];
  return `
    <div class="grammar-report">
      <header class="report-head">
        <div class="score-dial ${scoreClass}"><strong>${escapeHtml(score)}</strong><span>/10</span></div>
        <div><span>Grammar report</span><h3>${score >= 8 ? "Strong answer" : score >= 5 ? "Good base, refine it" : "Build the foundation"}</h3><p>${escapeHtml(data.explanation_uz || data.raw || "")}</p></div>
      </header>
      <div class="comparison-grid">
        <article><span>Corrected · minimum edit</span><p>${escapeHtml(data.corrected || data.corrected_answer || data.raw || "")}</p></article>
        <article class="upgrade"><span>Natural upgrade · optional</span><p>${escapeHtml(data.better || data.better_version || data.corrected || "")}</p></article>
      </div>
      ${issues.length ? `<section class="issues-block"><h4>Real issues</h4><div class="issue-list">${issues.map(renderIssue).join("")}</div></section>` : `<div class="no-issues">Real grammar xatosi topilmadi. Upgrade faqat uslubiy variant.</div>`}
      ${data.grammar_formula ? `<section class="report-formula"><span>Reusable formula</span><code>${escapeHtml(data.grammar_formula)}</code></section>` : ""}
      ${data.practice_task ? `<section class="report-task"><span>Next micro-task</span><strong>${escapeHtml(data.practice_task)}</strong></section>` : ""}
    </div>`;
}

async function checkGrammar() {
  const text = $("grammarText").value.trim();
  if (!text) {
    $("grammarText").focus();
    return;
  }
  const button = $("checkGrammar");
  const target = $("grammarResult");
  setBusy(button, true, "Tahlil qilinmoqda...");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="analysis-loading"><i aria-hidden="true"></i><span>Accuracy, naturalness va formula tekshirilmoqda...</span></div>`;
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
    target.innerHTML = renderGrammarResult(data);
  } catch (error) {
    showError(target, error);
  } finally {
    target.setAttribute("aria-busy", "false");
    setBusy(button, false);
  }
}

$("generateLesson").addEventListener("click", generateLessonPlan);
$("sendChat").addEventListener("click", sendChatMessage);
$("checkGrammar").addEventListener("click", checkGrammar);
$("clearMistakes").addEventListener("click", () => {
  state.mistakes = [];
  saveProgress();
  renderMistakeNotebook();
});

$("chatInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && event.ctrlKey) {
    event.preventDefault();
    sendChatMessage();
  }
});

document.querySelector(".prompt-chips").addEventListener("click", event => {
  const prompt = event.target.closest("[data-prompt]")?.dataset.prompt;
  if (!prompt) return;
  $("chatInput").value = prompt;
  $("chatInput").focus();
});

document.querySelector(".action-dock").addEventListener("click", event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "generate") generateLessonPlan();
  if (action === "chat") {
    $("chatCoach").scrollIntoView({ behavior: "smooth", block: "start" });
    $("chatInput").focus({ preventScroll: true });
  }
  if (action === "grammar") {
    $("grammarLab").scrollIntoView({ behavior: "smooth", block: "start" });
    $("grammarText").focus({ preventScroll: true });
  }
});

renderMistakeNotebook();
Promise.all([loadTopics(), loadSystemStatus()]).catch(error => {
  console.error(error);
});
