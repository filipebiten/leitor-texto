"use strict";

var els = {
  textInput: document.getElementById("textInput"),
  charCount: document.getElementById("charCount"),
  btnPlay: document.getElementById("btnPlay"),
  btnPause: document.getElementById("btnPause"),
  btnResume: document.getElementById("btnResume"),
  btnStop: document.getElementById("btnStop"),
  btnClear: document.getElementById("btnClear"),
  rateRange: document.getElementById("rateRange"),
  rateValue: document.getElementById("rateValue"),
  pitchRange: document.getElementById("pitchRange"),
  pitchValue: document.getElementById("pitchValue"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceWarning: document.getElementById("voiceWarning"),
  btnTestVoice: document.getElementById("btnTestVoice"),
  progressBar: document.getElementById("progressBar"),
  progressLabel: document.getElementById("progressLabel"),
  unsupportedMsg: document.getElementById("unsupportedMsg"),
  fileInput: document.getElementById("fileInput"),
  fileStatus: document.getElementById("fileStatus"),
  sentenceListWrap: document.getElementById("sentenceListWrap"),
  sentenceList: document.getElementById("sentenceList"),
  sentenceCount: document.getElementById("sentenceCount"),
};

var synth = window.speechSynthesis;
var SUPPORTED = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

var queue = []; // [{ text, punct, paraEnd }]
var lastBuiltText = null;
var startIndex = 0;
var currentIndex = -1;
var voices = [];
var selectedVoice = null;
var rate = 1;
var pitch = 1;
var watchdogTimer = null;
var pauseTimer = null;
var gapPending = false;
var userPaused = false;
var state = "idle"; // idle | playing | paused | finished

var MAX_CHUNK_LEN = 200;
var WATCHDOG_INTERVAL_MS = 10000;

// Pausa entre trechos (ms) por pontuação final — simula entonação de quem está explicando.
var PAUSE_MS = {
  ",": 130, ";": 190, ":": 230, ".": 380, "!": 400, "?": 430,
  continuation: 60, none: 200,
};
var PARAGRAPH_EXTRA_MS = 280;

function init() {
  if (!SUPPORTED) {
    els.unsupportedMsg.hidden = false;
    [els.btnPlay, els.btnPause, els.btnResume, els.btnStop, els.textInput, els.fileInput].forEach(function (el) {
      el.disabled = true;
    });
    return;
  }

  bindEvents();
  loadVoices();
  if ("onvoiceschanged" in synth) {
    synth.onvoiceschanged = loadVoices;
  }
  updateButtons("idle");
  updateCharCount();
  registerServiceWorker();
}

function bindEvents() {
  els.btnPlay.addEventListener("click", onPlay);
  els.btnPause.addEventListener("click", onPause);
  els.btnResume.addEventListener("click", onResume);
  els.btnStop.addEventListener("click", onStop);
  els.btnClear.addEventListener("click", onClear);

  var syncTimer = null;
  els.textInput.addEventListener("input", function () {
    updateCharCount();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncQueueFromText, 250);
  });

  els.rateRange.addEventListener("input", function () {
    rate = parseFloat(els.rateRange.value);
    els.rateValue.textContent = rate.toFixed(1) + "x";
  });
  els.pitchRange.addEventListener("input", function () {
    pitch = parseFloat(els.pitchRange.value);
    els.pitchValue.textContent = pitch.toFixed(1);
  });
  els.voiceSelect.addEventListener("change", function () {
    var idx = parseInt(els.voiceSelect.value, 10);
    selectedVoice = voices[idx] || null;
  });
  els.btnTestVoice.addEventListener("click", onTestVoice);

  els.fileInput.addEventListener("change", onFileSelected);
  els.sentenceList.addEventListener("click", onSentenceClick);

  window.addEventListener("beforeunload", function () {
    if (SUPPORTED) synth.cancel();
  });
}

function updateCharCount() {
  var n = els.textInput.value.length;
  els.charCount.textContent = n + (n === 1 ? " caractere" : " caracteres");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("service-worker.js").catch(function () {});
  });
}

// ---------- Voices ----------

function voiceQualityScore(v) {
  var name = v.name || "";
  var score = 0;
  if (/(enhanced|premium|natural)/i.test(name)) score += 110;
  if (/neural/i.test(name)) score += 105;
  if (/google/i.test(name)) score += 90;
  if (v.localService === false) score += 10;
  return score;
}

function loadVoices() {
  voices = synth.getVoices() || [];
  if (!voices.length) return;

  var byQualityDesc = function (a, b) { return voiceQualityScore(b) - voiceQualityScore(a); };

  var ptBR = voices.filter(function (v) { return /^pt-BR/i.test(v.lang); }).sort(byQualityDesc);
  var ptAny = voices.filter(function (v) { return /^pt/i.test(v.lang); }).sort(byQualityDesc);
  var others = voices.filter(function (v) { return !/^pt/i.test(v.lang); });
  var ordered = ptBR.concat(
    ptAny.filter(function (v) { return ptBR.indexOf(v) === -1; }),
    others
  );

  els.voiceSelect.innerHTML = "";
  ordered.forEach(function (v) {
    var realIndex = voices.indexOf(v);
    var opt = document.createElement("option");
    opt.value = String(realIndex);
    opt.textContent = v.name + " (" + v.lang + ")";
    els.voiceSelect.appendChild(opt);
  });

  if (ptBR.length) {
    selectedVoice = ptBR[0];
    els.voiceWarning.hidden = true;
  } else if (ptAny.length) {
    selectedVoice = ptAny[0];
    els.voiceWarning.hidden = false;
    els.voiceWarning.textContent = "Nenhuma voz pt-BR encontrada neste dispositivo. Usando voz em português disponível.";
  } else {
    selectedVoice = voices[0] || null;
    els.voiceWarning.hidden = false;
    els.voiceWarning.textContent = "Nenhuma voz em português encontrada neste dispositivo. Usando a voz padrão.";
  }

  var selIndex = voices.indexOf(selectedVoice);
  if (selIndex >= 0) els.voiceSelect.value = String(selIndex);
}

// ---------- Text splitting (entonação: cada trecho carrega sua pontuação final) ----------

function terminalPunct(sentence) {
  var m = sentence.trim().match(/([.!?;:,])\s*$/);
  return m ? m[1] : "none";
}

function splitIntoSentences(text) {
  var paragraphs = text.split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
  var items = [];

  paragraphs.forEach(function (para) {
    var matches = para.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [para];
    var sentences = matches.map(function (s) { return s.trim(); }).filter(Boolean);

    sentences.forEach(function (sentence, sIdx) {
      var subchunks = chunkLongSentence(sentence);
      var isLastSentenceInPara = sIdx === sentences.length - 1;

      subchunks.forEach(function (sub, subIdx) {
        var isLastSub = subIdx === subchunks.length - 1;
        items.push({
          text: sub,
          punct: isLastSub ? terminalPunct(sentence) : "continuation",
          paraEnd: isLastSub && isLastSentenceInPara,
        });
      });
    });
  });

  return items;
}

function chunkLongSentence(sentence) {
  if (sentence.length <= MAX_CHUNK_LEN) return [sentence];
  var words = sentence.split(/\s+/);
  var chunks = [];
  var current = "";
  words.forEach(function (w) {
    var candidate = current ? current + " " + w : w;
    if (candidate.length > MAX_CHUNK_LEN && current) {
      chunks.push(current);
      current = w;
    } else {
      current = candidate;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

function pauseFor(item) {
  var base = PAUSE_MS[item.punct] !== undefined ? PAUSE_MS[item.punct] : PAUSE_MS.none;
  return item.paraEnd ? base + PARAGRAPH_EXTRA_MS : base;
}

function syncQueueFromText() {
  var text = els.textInput.value.trim();
  if (text === lastBuiltText) return;
  queue = text ? splitIntoSentences(text) : [];
  lastBuiltText = text;
  startIndex = 0;
  renderSentenceList();
}

// ---------- Seleção de trecho inicial ----------

function renderSentenceList() {
  els.sentenceList.innerHTML = "";
  els.sentenceCount.textContent = String(queue.length);
  els.sentenceListWrap.hidden = queue.length === 0;

  queue.forEach(function (item, idx) {
    var span = document.createElement("span");
    span.className = "sentence-item" + (idx === startIndex ? " is-start" : "");
    span.dataset.index = String(idx);
    span.textContent = item.text;
    els.sentenceList.appendChild(span);
  });
}

function onSentenceClick(e) {
  var target = e.target.closest(".sentence-item");
  if (!target) return;
  startIndex = parseInt(target.dataset.index, 10) || 0;
  Array.prototype.forEach.call(els.sentenceList.children, function (child, idx) {
    child.classList.toggle("is-start", idx === startIndex);
  });
}

function highlightSpeaking(idx) {
  Array.prototype.forEach.call(els.sentenceList.children, function (child, childIdx) {
    child.classList.toggle("is-speaking", childIdx === idx);
  });
  var speakingEl = els.sentenceList.children[idx];
  if (speakingEl && speakingEl.scrollIntoView) {
    speakingEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ---------- Playback ----------

function onPlay() {
  var text = els.textInput.value.trim();
  if (!text) {
    els.textInput.focus();
    return;
  }

  syncQueueFromText();
  if (!queue.length) return;

  synth.cancel();
  clearTimeout(pauseTimer);
  gapPending = false;
  currentIndex = startIndex - 1;
  userPaused = false;

  updateButtons("playing");
  speakNext();
  startWatchdog();
}

function onTestVoice() {
  synth.cancel();
  var sample = new SpeechSynthesisUtterance("Olá! Esta é uma amostra da voz selecionada, para você comparar a naturalidade.");
  sample.rate = rate;
  sample.pitch = pitch;
  sample.lang = selectedVoice ? selectedVoice.lang : "pt-BR";
  if (selectedVoice) sample.voice = selectedVoice;
  synth.speak(sample);
}

function speakNext() {
  currentIndex++;
  if (currentIndex >= queue.length) {
    finishPlayback();
    return;
  }

  var item = queue[currentIndex];
  var utterance = new SpeechSynthesisUtterance(item.text);
  utterance.rate = rate;
  utterance.pitch = item.punct === "?" ? Math.min(2, pitch + 0.15) : pitch;
  utterance.lang = selectedVoice ? selectedVoice.lang : "pt-BR";
  if (selectedVoice) utterance.voice = selectedVoice;

  utterance.onend = function () {
    if (state !== "playing") return;
    gapPending = true;
    pauseTimer = setTimeout(function () {
      gapPending = false;
      if (state === "playing") speakNext();
    }, pauseFor(item));
  };
  utterance.onerror = function () {
    if (state === "playing") speakNext();
  };

  updateProgress();
  highlightSpeaking(currentIndex);
  synth.speak(utterance);
}

function finishPlayback() {
  stopWatchdog();
  state = "finished";
  updateButtons("idle");
  els.progressBar.style.width = "0%";
  els.progressLabel.textContent = "Concluído";
  highlightSpeaking(-1);
}

function onPause() {
  if (state !== "playing") return;
  userPaused = true;
  if (gapPending) {
    clearTimeout(pauseTimer);
  } else {
    synth.pause();
  }
  updateButtons("paused");
}

function onResume() {
  if (state !== "paused") return;
  userPaused = false;
  updateButtons("playing");
  if (gapPending) {
    gapPending = false;
    speakNext();
  } else {
    synth.resume();
  }
}

function onStop() {
  stopWatchdog();
  clearTimeout(pauseTimer);
  gapPending = false;
  userPaused = false;
  synth.cancel();
  currentIndex = -1;
  state = "idle";
  updateButtons("idle");
  els.progressBar.style.width = "0%";
  els.progressLabel.textContent = "Pronto";
  highlightSpeaking(-1);
}

function onClear() {
  onStop();
  els.textInput.value = "";
  els.fileStatus.textContent = "";
  updateCharCount();
  syncQueueFromText();
  els.textInput.focus();
}

// ---------- Watchdog (evita corte automático do Chrome em textos longos) ----------

function startWatchdog() {
  stopWatchdog();
  watchdogTimer = setInterval(function () {
    if (!userPaused && synth.speaking && !synth.paused) {
      synth.pause();
      synth.resume();
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

// ---------- UI helpers ----------

function updateButtons(newState) {
  state = newState;
  var playing = newState === "playing";
  var paused = newState === "paused";
  var idle = newState === "idle";

  els.btnPlay.disabled = playing || paused;
  els.btnPause.disabled = !playing;
  els.btnResume.disabled = !paused;
  els.btnStop.disabled = idle;

  els.btnPause.hidden = paused;
  els.btnResume.hidden = !paused;
}

function updateProgress() {
  var total = queue.length;
  var pos = currentIndex + 1;
  var pct = total ? Math.round((pos / total) * 100) : 0;
  els.progressBar.style.width = pct + "%";
  els.progressLabel.textContent = "Trecho " + pos + " de " + total;
}

// ---------- Upload de arquivo (PDF / DOCX / TXT) ----------

async function onFileSelected(e) {
  var file = e.target.files[0];
  if (!file) return;

  els.fileInput.disabled = true;
  els.fileStatus.textContent = "Lendo " + file.name + "...";

  try {
    var text = (await extractTextFromFile(file)).trim();
    if (!text) throw new Error("não encontrei texto legível neste arquivo.");

    onStop();
    els.textInput.value = text;
    updateCharCount();
    syncQueueFromText();
    els.fileStatus.textContent = "✓ " + file.name + " carregado (" + text.length + " caracteres).";
  } catch (err) {
    els.fileStatus.textContent = "Erro ao ler " + file.name + ": " + (err && err.message ? err.message : "formato não suportado.");
  } finally {
    els.fileInput.disabled = false;
    els.fileInput.value = "";
  }
}

function extractTextFromFile(file) {
  var name = file.name.toLowerCase();
  if (name.endsWith(".txt")) return extractTxt(file);
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".docx")) return extractDocx(file);
  return Promise.reject(new Error("use arquivos .pdf, .docx ou .txt."));
}

function extractTxt(file) {
  return file.text();
}

async function extractPdf(file) {
  var pdfjsLib = await import("./vendor/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

  var buf = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  var pages = [];
  for (var i = 1; i <= pdf.numPages; i++) {
    var page = await pdf.getPage(i);
    var content = await page.getTextContent();
    pages.push(content.items.map(function (it) { return it.str; }).join(" "));
  }
  return pages.join("\n\n");
}

async function extractDocx(file) {
  var buf = await file.arrayBuffer();
  var zip = await window.JSZip.loadAsync(buf);
  var xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("arquivo .docx inválido.");
  var xml = await xmlFile.async("string");
  return parseDocxXml(xml);
}

function parseDocxXml(xml) {
  var doc = new DOMParser().parseFromString(xml, "application/xml");
  var paragraphs = doc.getElementsByTagName("w:p");
  var lines = [];
  for (var i = 0; i < paragraphs.length; i++) {
    var texts = paragraphs[i].getElementsByTagName("w:t");
    var line = "";
    for (var j = 0; j < texts.length; j++) {
      line += texts[j].textContent;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

document.addEventListener("DOMContentLoaded", init);
