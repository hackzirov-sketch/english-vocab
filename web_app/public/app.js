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

const voiceState = {
  recorder: null,
  stream: null,
  chunks: [],
  blob: null,
  previewUrl: "",
  startedAt: 0,
  durationMs: 0,
  timerId: null
};

const $ = (id) => document.getElementById(id);
function setActiveDock(action) {
  document.querySelectorAll(".action-dock [data-action]").forEach(button => {
    if (button.dataset.action === action) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  document.documentElement.classList.add("telegram-webapp");
  try {
    tg.setHeaderColor?.("#07111f");
    tg.setBackgroundColor?.("#07111f");
    tg.setBottomBarColor?.("#081321");
  } catch {
    // Older Telegram clients do not expose every color method.
  }
}

if (window.matchMedia("(max-width: 760px)").matches) {
  $("methodBoard")?.removeAttribute("open");
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

function setValidation(targetId, fields, message = "") {
  const target = $(targetId);
  target.textContent = message;
  target.hidden = !message;
  fields.forEach(field => field?.setAttribute("aria-invalid", message ? "true" : "false"));
}

function setVoiceStatus(message, isError = false) {
  const target = $("voiceStatus");
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function formatRecordingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function stopVoiceTracks() {
  voiceState.stream?.getTracks().forEach(track => track.stop());
  voiceState.stream = null;
}

function finishVoiceRecording() {
  window.clearInterval(voiceState.timerId);
  voiceState.timerId = null;
  voiceState.durationMs = Math.min(60_000, Date.now() - voiceState.startedAt);
  const mimeType = voiceState.recorder?.mimeType || voiceState.chunks[0]?.type || "audio/webm";
  voiceState.blob = new Blob(voiceState.chunks, { type: mimeType });
  stopVoiceTracks();

  const recorder = $("voiceRecorder");
  const button = $("recordVoice");
  recorder.classList.remove("is-recording");
  button.classList.remove("is-recording");
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Qayta yozish";
  $("recordingTimer").textContent = formatRecordingTime(voiceState.durationMs);

  if (voiceState.previewUrl) URL.revokeObjectURL(voiceState.previewUrl);
  voiceState.previewUrl = URL.createObjectURL(voiceState.blob);
  const preview = $("voicePreview");
  preview.src = voiceState.previewUrl;
  preview.hidden = false;
  $("transcribeVoice").disabled = voiceState.blob.size < 800;
  setVoiceStatus(voiceState.blob.size < 800
    ? "Audio juda qisqa. Qayta yozib ko‘ring."
    : "Yozuv tayyor. Matnga aylantirishda audio Groq xizmatiga yuboriladi; serverda saqlanmaydi.", voiceState.blob.size < 800);
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setVoiceStatus("Bu brauzer ovoz yozishni qo‘llab-quvvatlamaydi. Chrome, Edge yoki Telegram’ning yangi versiyasidan foydalaning.", true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    if (voiceState.previewUrl) {
      URL.revokeObjectURL(voiceState.previewUrl);
      voiceState.previewUrl = "";
    }
    voiceState.stream = stream;
    voiceState.recorder = recorder;
    voiceState.chunks = [];
    voiceState.blob = null;
    voiceState.startedAt = Date.now();
    $("voicePreview").hidden = true;
    $("transcribeVoice").disabled = true;
    $("voiceMetrics").hidden = true;
    $("analysisMode").value = "speaking";

    recorder.addEventListener("dataavailable", event => {
      if (event.data.size) voiceState.chunks.push(event.data);
    });
    recorder.addEventListener("stop", finishVoiceRecording, { once: true });
    recorder.addEventListener("error", () => {
      stopVoiceTracks();
      setVoiceStatus("Ovoz yozishda xato yuz berdi. Qayta urinib ko‘ring.", true);
    }, { once: true });
    recorder.start(250);

    $("voiceRecorder").classList.add("is-recording");
    const button = $("recordVoice");
    button.classList.add("is-recording");
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Yozishni to‘xtatish";
    setVoiceStatus("Yozilmoqda. Javobingizni tabiiy tempda ayting.");
    voiceState.timerId = window.setInterval(() => {
      const elapsed = Date.now() - voiceState.startedAt;
      $("recordingTimer").textContent = formatRecordingTime(elapsed);
      if (elapsed >= 60_000 && recorder.state === "recording") recorder.stop();
    }, 250);
    tg?.HapticFeedback?.impactOccurred?.("light");
  } catch (error) {
    stopVoiceTracks();
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    setVoiceStatus(denied
      ? "Mikrofon ruxsati berilmadi. Brauzer sozlamalaridan mikrofonni yoqing."
      : "Mikrofonni ishga tushirib bo‘lmadi. Boshqa ilovada band emasligini tekshiring.", true);
  }
}

function stopVoiceRecording() {
  if (voiceState.recorder?.state === "recording") voiceState.recorder.stop();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("Audio faylni o‘qib bo‘lmadi.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function transcribeVoiceRecording() {
  if (!voiceState.blob) return;
  const button = $("transcribeVoice");
  setBusy(button, true, "Matnga aylantirilmoqda...");
  setVoiceStatus("Audio English matnga aylantirilmoqda...");
  try {
    const audio = await blobToBase64(voiceState.blob);
    const data = await api("/api/ai/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio, mimeType: voiceState.blob.type, durationMs: voiceState.durationMs })
    });
    $("grammarText").value = data.text;
    $("analysisMode").value = "speaking";
    $("grammarText").dispatchEvent(new Event("input", { bubbles: true }));
    const metrics = data.metrics || {};
    $("voiceMetrics").innerHTML = `
      <span><strong>${escapeHtml(metrics.durationSeconds ?? "—")}s</strong>davomiylik</span>
      <span><strong>${escapeHtml(metrics.wordCount ?? "—")}</strong>so‘z</span>
      <span><strong>${escapeHtml(metrics.wordsPerMinute ?? "—")}</strong>so‘z/min</span>
      <span><strong>${escapeHtml(metrics.pauseCount ?? "—")}</strong>uzoq pauza</span>`;
    $("voiceMetrics").hidden = false;
    setVoiceStatus("Transkript tayyor. Matnni tekshirib, to‘liq Speaking tahlilini boshlang.");
    $("grammarText").focus();
  } catch (error) {
    setVoiceStatus(error.message, true);
  } finally {
    setBusy(button, false);
  }
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
  const steps = Array.isArray(data.practice_steps) ? data.practice_steps : [];
  const isWriting = data.lesson_type === "writing";
  return `
    <article class="lesson-card">
      <header class="lesson-title">
        <div><span>${isWriting ? "Writing lesson" : "Speaking lesson"}</span><h3>${escapeHtml(data.title_uz || "Mini dars")}</h3></div>
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

      ${isWriting ? `
        <section class="lesson-section">
          <div class="lesson-section-title"><span>03</span><h4>Writing task</h4><small>Purpose · audience · length</small></div>
          <div class="usage-card"><span>Topshiriq</span><strong>${escapeHtml(data.writing_task_uz || "")}</strong></div>
        </section>` : `
        <section class="lesson-section">
          <div class="lesson-section-title"><span>03</span><h4>Speaking ladder</h4><small>D-R-E-F → S.T.O.R.Y.+C.P.R.</small></div>
          <ol class="speaking-ladder">${speaking.map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
        </section>`}

      <section class="lesson-section">
        <div class="lesson-section-title"><span>04</span><h4>${isWriting ? "Writing plan" : "Speaking practice"}</h4><small>Controlled → independent</small></div>
        <ol class="practice-steps">${steps.map(step => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      </section>

      <section class="lesson-section">
        <div class="lesson-section-title"><span>05</span><h4>Model ${isWriting ? "paragraph" : "answer"}</h4><small>CEFR-safe example</small></div>
        <div class="model-answer-card"><span>${isWriting ? "Model writing" : "Natural spoken answer"}</span><p>${escapeHtml(data.model_answer_en || "")}</p>${data.model_answer_uz ? `<small>${escapeHtml(data.model_answer_uz)}</small>` : ""}</div>
      </section>

      <section class="lesson-section">
        <div class="lesson-section-title"><span>06</span><h4>Mini quiz</h4><small>Meaning in context</small></div>
        <div class="lesson-quiz">${quiz.map((item, index) => `
          <article><span>Q${index + 1}</span><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer)}</p>${item.explanation_uz ? `<em>${escapeHtml(item.explanation_uz)}</em>` : ""}</article>`).join("")}</div>
      </section>

      <div class="lesson-finish-grid">
        ${data.homework_uz ? `<div class="homework-card"><span>Homework</span><strong>${escapeHtml(data.homework_uz)}</strong></div>` : ""}
      </div>
    </article>`;
}

function setLessonType(type, resetResult = true) {
  const isWriting = type === "writing";
  const button = $("generateLesson");
  button.textContent = isWriting ? "Writing darsini yaratish" : "Speaking darsini yaratish";
  button.dataset.idleText = button.textContent;
  if (!resetResult) return;
  $("lessonResult").innerHTML = `
    <div class="empty-state">
      <span>${isWriting ? "Writing" : "Speaking"} lesson canvas</span>
      <strong>Topic tanlang va ${isWriting ? "Writing" : "Speaking"} darsini yarating.</strong>
      <p>${isWriting
        ? "Vocabulary, formula, writing task, outline va model paragraph bitta darsga bog‘lanadi."
        : "Vocabulary, formula, D-R-E-F savollari, model answer va mashqlar bitta darsga bog‘lanadi."}</p>
    </div>`;
}

async function generateLessonPlan() {
  setActiveDock("generate");
  const topic = $("lessonTopic").value;
  const level = $("lessonLevel").value;
  const lessonType = document.querySelector('input[name="lessonType"]:checked')?.value || "speaking";
  const target = $("lessonResult");
  const button = $("generateLesson");
  const missingFields = [!topic && $("lessonTopic"), !level && $("lessonLevel")].filter(Boolean);
  if (missingFields.length) {
    setValidation("lessonValidation", missingFields, "Dars yaratish uchun topic va CEFR darajani tanlang.");
    missingFields[0].focus();
    return;
  }
  setValidation("lessonValidation", [$("lessonTopic"), $("lessonLevel")]);
  setBusy(button, true, "Dars qurilmoqda...");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="lesson-loading"><i aria-hidden="true"></i><div><strong>${lessonType === "writing" ? "Writing" : "Speaking"} darsi qurilmoqda</strong><span>Vocabulary, formula va maqsadli mashqlar bitta darsga bog‘lanadi.</span></div></div>`;
  try {
    const data = await api("/api/ai/lesson", {
      method: "POST",
      body: JSON.stringify({ topic, level, lessonType })
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
  setActiveDock("chat");
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

function renderCriterion(item) {
  if (!item || typeof item !== "object") return "";
  const score = Math.max(0, Math.min(10, Number(item.score) || 0));
  return `<article><span>${escapeHtml(item.criterion || "Criterion")}</span><strong>${escapeHtml(score)}/10</strong><p>${escapeHtml(item.reason_uz || "")}</p></article>`;
}

function renderRecommendation(item, index) {
  if (typeof item === "string") return `<article><span>${index + 1}</span><div><strong>Tavsiya</strong><p>${escapeHtml(item)}</p></div></article>`;
  const priority = ["Now", "Next", "Stretch"].includes(item?.priority) ? item.priority : "Next";
  return `<article class="recommendation-card priority-${priority.toLowerCase()}">
    <span>${escapeHtml(priority)}</span>
    <div>
      <strong>${escapeHtml(item?.area || `Tavsiya ${index + 1}`)}</strong>
      ${item?.evidence ? `<small>Dalil: ${escapeHtml(item.evidence)}</small>` : ""}
      <p>${escapeHtml(item?.advice_uz || "")}</p>
      ${item?.example_en ? `<em>${escapeHtml(item.example_en)}</em>` : ""}
    </div>
  </article>`;
}

function renderVocabularyUpgrade(item) {
  if (typeof item === "string") return `<article><strong>${escapeHtml(item)}</strong></article>`;
  return `<article><div><del>${escapeHtml(item?.original || "")}</del><span aria-hidden="true">→</span><strong>${escapeHtml(item?.upgrade || "")}</strong></div>${item?.reason_uz ? `<p>${escapeHtml(item.reason_uz)}</p>` : ""}</article>`;
}

function renderGrammarResult(data) {
  const score = Math.max(0, Math.min(10, Number(data.score) || 0));
  const scoreClass = `score-${Math.round(score)}`;
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const criteria = Array.isArray(data.criterion_scores) ? data.criterion_scores : [];
  const strengths = Array.isArray(data.strengths) ? data.strengths : [];
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
  const vocabularyUpgrades = Array.isArray(data.vocabulary_upgrades) ? data.vocabulary_upgrades : [];
  const cefr = data.estimated_cefr && typeof data.estimated_cefr === "object" ? data.estimated_cefr : null;
  const plan = data.practice_plan && typeof data.practice_plan === "object" ? data.practice_plan : null;
  const reportLabel = data.task_type === "speaking" ? "CEFR Speaking report" : data.task_type === "writing" ? "CEFR Writing report" : "Grammar report";
  return `
    <div class="grammar-report">
      <header class="report-head">
        <div class="score-dial ${scoreClass}"><strong>${escapeHtml(score)}</strong><span>/10</span></div>
        <div><span>${reportLabel}</span><h3>${score >= 8 ? "Strong answer" : score >= 5 ? "Good base, refine it" : "Build the foundation"}</h3><p>${escapeHtml(data.explanation_uz || data.raw || "")}</p></div>
      </header>
      ${cefr ? `<section class="cefr-estimate"><span>Taxminiy CEFR · ${escapeHtml(cefr.confidence || "low")} confidence</span><strong>${escapeHtml(cefr.level || "—")}</strong><p>${escapeHtml(cefr.evidence_uz || "")}</p></section>` : ""}
      ${criteria.length ? `<section class="criteria-block"><div class="report-section-head"><span>CEFR mezonlari</span><strong>${escapeHtml(data.task_type || "English")}</strong></div><div class="criteria-grid">${criteria.map(renderCriterion).join("")}</div></section>` : ""}
      ${strengths.length ? `<section class="strengths-block"><div class="report-section-head"><span>Saqlab qoling</span><strong>Kuchli tomonlar</strong></div><ul>${strengths.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}
      <div class="comparison-grid">
        <article><span>Corrected · minimum edit</span><p>${escapeHtml(data.corrected || data.corrected_answer || data.raw || "")}</p></article>
        <article class="upgrade"><span>Natural upgrade · optional</span><p>${escapeHtml(data.better || data.better_version || data.corrected || "")}</p></article>
      </div>
      ${issues.length ? `<section class="issues-block"><h4>Real issues</h4><div class="issue-list">${issues.map(renderIssue).join("")}</div></section>` : `<div class="no-issues">Real grammar xatosi topilmadi. Upgrade faqat uslubiy variant.</div>`}
      ${recommendations.length ? `<section class="recommendations-block"><div class="report-section-head"><span>Shaxsiy yo‘l xaritasi</span><strong>${recommendations.length} ta ustuvor tavsiya</strong></div><div class="recommendation-list">${recommendations.map(renderRecommendation).join("")}</div></section>` : ""}
      ${vocabularyUpgrades.length ? `<section class="vocab-upgrades"><div class="report-section-head"><span>Lexical resource</span><strong>Vocabulary upgrades</strong></div><div>${vocabularyUpgrades.map(renderVocabularyUpgrade).join("")}</div></section>` : ""}
      ${data.grammar_formula ? `<section class="report-formula"><span>Reusable formula</span><code>${escapeHtml(data.grammar_formula)}</code></section>` : ""}
      ${data.practice_task ? `<section class="report-task"><span>Next micro-task</span><strong>${escapeHtml(data.practice_task)}</strong></section>` : ""}
      ${plan ? `<section class="practice-plan"><div class="report-section-head"><span>Amaliy reja</span><strong>Now → Next → Stretch</strong></div><div><article><span>Now</span><p>${escapeHtml(plan.now || "")}</p></article><article><span>Next</span><p>${escapeHtml(plan.next || "")}</p></article><article><span>Stretch</span><p>${escapeHtml(plan.stretch || "")}</p></article></div></section>` : ""}
      ${data.follow_up_prompt ? `<section class="follow-up-task"><span>Keyingi javob</span><strong>${escapeHtml(data.follow_up_prompt)}</strong></section>` : ""}
      ${data.delivery_note_uz ? `<p class="delivery-note">${escapeHtml(data.delivery_note_uz)}</p>` : ""}
    </div>`;
}

async function checkGrammar() {
  setActiveDock("grammar");
  const text = $("grammarText").value.trim();
  const mode = $("analysisMode").value;
  if (!text) {
    setValidation("grammarValidation", [$("grammarText")], "Tahlil qilish uchun English matn yoki speaking javob yozing.");
    $("grammarText").focus();
    return;
  }
  setValidation("grammarValidation", [$("grammarText")]);
  const button = $("checkGrammar");
  const target = $("grammarResult");
  setBusy(button, true, "Tahlil qilinmoqda...");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="analysis-loading"><i aria-hidden="true"></i><span>Accuracy, naturalness va formula tekshirilmoqda...</span></div>`;
  try {
    const data = await api("/api/ai/grammar-check", { method: "POST", body: JSON.stringify({ text, mode }) });
    addMistake({
      type: mode === "speaking" ? "CEFR Speaking" : mode === "writing" ? "CEFR Writing" : "Grammar check",
      title: `${data.estimated_cefr?.level ? `${data.estimated_cefr.level} · ` : ""}Score ${data.score ?? "-"}/10`,
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
$("recordVoice").addEventListener("click", () => {
  if (voiceState.recorder?.state === "recording") stopVoiceRecording();
  else startVoiceRecording();
});
$("transcribeVoice").addEventListener("click", transcribeVoiceRecording);
document.querySelectorAll('input[name="lessonType"]').forEach(input => {
  input.addEventListener("change", () => setLessonType(input.value));
});
[$("lessonTopic"), $("lessonLevel")].forEach(field => field.addEventListener("change", () => {
  if ($("lessonTopic").value && $("lessonLevel").value) {
    setValidation("lessonValidation", [$("lessonTopic"), $("lessonLevel")]);
  }
}));
$("grammarText").addEventListener("input", () => {
  if ($("grammarText").value.trim()) setValidation("grammarValidation", [$("grammarText")]);
});
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
  tg?.HapticFeedback?.selectionChanged?.();
  if (action === "generate") {
    $("lessonStudio").scrollIntoView({ behavior: "smooth", block: "start" });
    $("lessonTopic").focus({ preventScroll: true });
  }
  if (action === "chat") {
    $("chatCoach").scrollIntoView({ behavior: "smooth", block: "start" });
    $("chatInput").focus({ preventScroll: true });
  }
  if (action === "grammar") {
    $("grammarLab").scrollIntoView({ behavior: "smooth", block: "start" });
    $("grammarText").focus({ preventScroll: true });
  }
});

const dockTargets = [
  ["generate", $("lessonStudio")],
  ["chat", $("chatCoach")],
  ["grammar", $("grammarLab")]
];

if ("IntersectionObserver" in window) {
  const dockObserver = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const activeAction = dockTargets.find(([, target]) => target === visible.target)?.[0];
    setActiveDock(activeAction);
  }, { rootMargin: "-22% 0px -58%", threshold: [0, .2, .5] });
  dockTargets.forEach(([, target]) => target && dockObserver.observe(target));
}

renderMistakeNotebook();
setLessonType(document.querySelector('input[name="lessonType"]:checked')?.value || "speaking", false);
window.addEventListener("pagehide", () => {
  stopVoiceTracks();
  if (voiceState.previewUrl) URL.revokeObjectURL(voiceState.previewUrl);
});
Promise.all([loadTopics(), loadSystemStatus()]).catch(error => {
  console.error(error);
});
