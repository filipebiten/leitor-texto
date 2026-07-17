(function () {
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
  };

  var synth = window.speechSynthesis;
  var SUPPORTED = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

  var queue = [];
  var currentIndex = -1;
  var voices = [];
  var selectedVoice = null;
  var rate = 1;
  var pitch = 1;
  var watchdogTimer = null;
  var userPaused = false;
  var state = "idle"; // idle | playing | paused | finished

  var MAX_CHUNK_LEN = 200;
  var WATCHDOG_INTERVAL_MS = 10000;

  function init() {
    if (!SUPPORTED) {
      els.unsupportedMsg.hidden = false;
      [els.btnPlay, els.btnPause, els.btnResume, els.btnStop, els.textInput].forEach(function (el) {
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
  }

  function bindEvents() {
    els.btnPlay.addEventListener("click", onPlay);
    els.btnPause.addEventListener("click", onPause);
    els.btnResume.addEventListener("click", onResume);
    els.btnStop.addEventListener("click", onStop);
    els.btnClear.addEventListener("click", onClear);
    els.textInput.addEventListener("input", updateCharCount);
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

    window.addEventListener("beforeunload", function () {
      if (SUPPORTED) synth.cancel();
    });
  }

  function updateCharCount() {
    var n = els.textInput.value.length;
    els.charCount.textContent = n + (n === 1 ? " caractere" : " caracteres");
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

  // ---------- Text splitting ----------

  function splitIntoSentences(text) {
    var paragraphs = text.split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
    var sentences = [];

    paragraphs.forEach(function (para) {
      var matches = para.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
      if (!matches) matches = [para];
      matches.forEach(function (raw) {
        var s = raw.trim();
        if (s) sentences.push.apply(sentences, chunkLongSentence(s));
      });
    });

    return sentences;
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

  // ---------- Playback ----------

  function onPlay() {
    var text = els.textInput.value.trim();
    if (!text) {
      els.textInput.focus();
      return;
    }

    synth.cancel();
    queue = splitIntoSentences(text);
    currentIndex = -1;
    userPaused = false;

    if (!queue.length) return;

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

    var chunk = queue[currentIndex];
    var utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.lang = selectedVoice ? selectedVoice.lang : "pt-BR";
    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.onend = function () {
      if (state === "playing") speakNext();
    };
    utterance.onerror = function () {
      if (state === "playing") speakNext();
    };

    updateProgress();
    synth.speak(utterance);
  }

  function finishPlayback() {
    stopWatchdog();
    state = "finished";
    updateButtons("idle");
    els.progressBar.style.width = "0%";
    els.progressLabel.textContent = "Concluído";
  }

  function onPause() {
    if (state !== "playing") return;
    userPaused = true;
    synth.pause();
    updateButtons("paused");
  }

  function onResume() {
    if (state !== "paused") return;
    userPaused = false;
    synth.resume();
    updateButtons("playing");
  }

  function onStop() {
    stopWatchdog();
    userPaused = false;
    synth.cancel();
    queue = [];
    currentIndex = -1;
    state = "idle";
    updateButtons("idle");
    els.progressBar.style.width = "0%";
    els.progressLabel.textContent = "Pronto";
  }

  function onClear() {
    onStop();
    els.textInput.value = "";
    updateCharCount();
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
    els.progressLabel.textContent = "Frase " + pos + " de " + total;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
