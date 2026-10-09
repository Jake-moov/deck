function showVolumeError(msg) {
  for (const r of MASTER_READOUTS) { r.textContent = "erro"; r.title = msg || ""; }
  console.warn("Falha ao ajustar volume:", msg);
}

function sendVolume(level) {
  clearTimeout(volumeSendTimer);
  volumeSendTimer = setTimeout(() => {
    fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: parseInt(level, 10) }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) showVolumeError(data.error || `HTTP ${res.status}`);
      })
      .catch((e) => showVolumeError(String(e)));
  }, 60);
}

/* ---------- categorias (cor do LED de cada tecla) ---------- */

const TYPE_CATEGORY = {
  app: "app", start_app: "app", script: "app",
  hotkey: "hotkey", media: "media", mic_mute: "media",
  obs_scene: "obs", obs_mute: "obs", obs_record: "obs", obs_stream: "obs",
  macro: "macro",
};

function categoryOf(type) {
  return TYPE_CATEGORY[type] || "app";
}

// Ícones prontos (ICON_PRESETS, isIconPreset, isIconImage) vêm de icons.js — compartilhado com o app do PC.
function renderPresetIcon(key, cls) {
  const wrap = document.createElement("span");
  wrap.className = cls || "icon-svg";
  wrap.innerHTML = presetSvg(key);
  return wrap;
}

// Renders an emoji <span>, an extracted <img>, or a built-in <svg> preset
function iconNode(icon) {
  if (isIconPreset(icon)) return renderPresetIcon(icon.slice(7));
  if (isIconImage(icon)) return h("img", { src: icon, class: "icon-img", alt: "" });
  return h("span", { class: "icon" }, icon || "•");
}

/* ---------- tiny DOM helper ---------- */

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/* ---------- connection state ---------- */

const grid = document.getElementById("grid");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const brandMark = document.getElementById("brandMark");
const fsBtn = document.getElementById("fsBtn");
const installTip = document.getElementById("installTip");
const volumeSlider = document.getElementById("volumeSlider");
const volumeReadout = document.getElementById("volumeReadout");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider2 = document.getElementById("volumeSlider2");
const volumeReadout2 = document.getElementById("volumeReadout2");
const muteBtn2 = document.getElementById("muteBtn2");
const screens = document.getElementById("screens");
const screenTabs = document.getElementById("screenTabs");
const audioMixer = document.getElementById("audioMixer");

let ws = null;
let config = { grid: { columns: 3 }, buttons: [] };

function setStatus(state) {
  statusDot.className = "status-dot " + (state === "on" ? "on" : state === "off" ? "off" : "");
  statusText.textContent = state === "on" ? "CONECTADO" : state === "off" ? "DESCONECTADO" : "CONECTANDO";
  const color = state === "on" ? "var(--ok)" : state === "off" ? "var(--err)" : "var(--warn)";
  brandMark.style.background = color;
  brandMark.style.boxShadow = `0 0 10px ${color}`;
}

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------- view mode: the deck grid ---------- */

async function loadConfig() {
  const res = await fetch("/api/config");
  config = await res.json();
  renderGrid();
}

function renderGrid() {
  grid.style.setProperty("--cols", (config.grid && config.grid.columns) || 3);
  grid.innerHTML = "";
  if (!config.buttons.length) {
    grid.appendChild(h("div", { class: "empty" }, "Nenhum botão configurado.\nAdicione botões no app do Deck, no PC."));
    return;
  }
  for (const btn of config.buttons) {
    const el = h("button", { class: "key", "data-category": categoryOf(btn.type), "data-id": btn.id }, [
      iconNode(btn.icon),
      h("span", { class: "label" }, btn.label || btn.id),
    ]);
    el.addEventListener("pointerdown", () => onPress(el, btn.id));
    grid.appendChild(el);
  }
}

function onPress(el, id) {
  vibrate(15);
  el.classList.add("pressed");
  setTimeout(() => el.classList.remove("pressed"), 120);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    flashError(el);
    return;
  }
  ws.send(JSON.stringify({ id }));
}

function flashError(el) {
  vibrate([10, 40, 10]);
  el.classList.add("error");
  setTimeout(() => el.classList.remove("error"), 350);
}

function connect() {
  setStatus("connecting");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => setStatus("on");
  ws.onclose = () => { setStatus("off"); setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (!msg.ok) {
      const el = grid.querySelector(`[data-id="${msg.id}"]`);
      if (el) flashError(el);
      console.warn("Ação falhou:", msg.error);
    }
  };
}

/* ---------- screen navigation (Apps / Áudio) ---------- */

screenTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  vibrate(10);
  const target = btn.dataset.screen;
  screens.classList.toggle("on-audio", target === "audio");
  for (const t of screenTabs.querySelectorAll(".tab-btn")) {
    t.classList.toggle("active", t.dataset.screen === target);
  }
  if (target === "audio") { fetchNowPlaying(); fetchVolume(); fetchAppVolumes(); }
});

/* ---------- volume strip (soundbar) ---------- */

let isDraggingVolume = false;
let volumeSendTimer = null;
let lastKnownLevel = 50;
let lastKnownMuted = false;

// Two physical fader pairs show the same master volume — the quick sidebar
// on the Apps screen, and the full one on the Áudio screen — kept in sync.
const MASTER_SLIDERS = [volumeSlider, volumeSlider2];
const MASTER_READOUTS = [volumeReadout, volumeReadout2];
const MASTER_MUTE_BTNS = [muteBtn, muteBtn2];

function updateVolumeUI(level, muted) {
  lastKnownLevel = level;
  lastKnownMuted = muted;
  for (const s of MASTER_SLIDERS) { s.value = level; s.classList.toggle("muted", !!muted); }
  for (const r of MASTER_READOUTS) r.textContent = muted ? "MUDO" : `${level}%`;
  for (const b of MASTER_MUTE_BTNS) {
    b.textContent = muted || level === 0 ? "🔇" : level < 50 ? "🔉" : "🔊";
    b.classList.toggle("muted", !!muted);
  }
}

async function fetchVolume() {
  try {
    const res = await fetch("/api/volume");
    const data = await res.json();
    if (!res.ok) {
      for (const r of MASTER_READOUTS) { r.textContent = "erro"; r.title = data.error || "falha desconhecida"; }
      console.warn("Volume geral indisponível:", data.error);
      return;
    }
    for (const r of MASTER_READOUTS) r.title = "";
    if (!isDraggingVolume) updateVolumeUI(data.level, data.muted);
  } catch (e) {
    for (const r of MASTER_READOUTS) r.textContent = "offline";
    console.warn("Não foi possível falar com o servidor:", e);
  }
}

function sendVolume(level) {
  clearTimeout(volumeSendTimer);
  volumeSendTimer = setTimeout(() => {
    fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: parseInt(level, 10) }),
    })
      .then((res) => res.json())
      .then((data) => { if (data.error) console.warn("Falha ao ajustar volume:", data.error); })
      .catch((e) => console.warn("Falha ao ajustar volume:", e));
  }, 60);
}

for (const s of MASTER_SLIDERS) {
  s.addEventListener("pointerdown", () => { isDraggingVolume = true; vibrate(8); });
  s.addEventListener("input", (e) => {
    updateVolumeUI(parseInt(e.target.value, 10), false);
    sendVolume(e.target.value);
  });
  s.addEventListener("pointerup", () => { isDraggingVolume = false; });
  s.addEventListener("change", () => { isDraggingVolume = false; });
}

for (const b of MASTER_MUTE_BTNS) {
  b.addEventListener("click", () => {
    vibrate(15);
    const newMuted = !lastKnownMuted;
    updateVolumeUI(lastKnownLevel, newMuted);
    fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted: newMuted }),
    })
      .then((res) => res.json())
      .then((data) => { if (data.error) console.warn("Falha ao mutar:", data.error); })
      .catch((e) => console.warn("Falha ao mutar:", e));
  });
}

setInterval(fetchVolume, 4000);
fetchVolume();

/* ---------- per-app volume mixer (vertical faders, Áudio screen) ---------- */

const appIconCache = new Map(); // process name -> icon_url ("" while pending)
const appStripState = new Map(); // process name -> { dragging, level, muted, sendTimer }

async function fetchAppVolumes() {
  try {
    const res = await fetch("/api/volume/apps");
    const data = await res.json();
    if (!res.ok) {
      console.warn("Mixer por app indisponível:", data.error);
      return;
    }
    renderAppVolumes(data.apps || []);
  } catch (e) {
    console.warn("Não foi possível falar com o servidor:", e);
  }
}

function renderAppVolumes(apps) {
  const seen = new Set();
  for (const app of apps) {
    seen.add(app.process);
    let state = appStripState.get(app.process);
    if (!state) {
      state = { dragging: false, level: app.level, muted: app.muted, sendTimer: null };
      appStripState.set(app.process, state);
      audioMixer.appendChild(buildAppFader(app, state));
      fetchAppIcon(app);
    } else if (!state.dragging) {
      state.level = app.level;
      state.muted = app.muted;
      updateAppFaderUI(app.process, app.level, app.muted);
    }
  }
  // remove faders for apps that stopped playing audio
  for (const [process] of appStripState) {
    if (!seen.has(process)) {
      appStripState.delete(process);
      const el = audioMixer.querySelector(`[data-process="${cssEscape(process)}"]`);
      if (el) el.remove();
    }
  }
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function fetchAppIcon(app) {
  if (!app.exe_path || appIconCache.has(app.process)) return;
  appIconCache.set(app.process, "");
  try {
    const res = await fetch("/api/extract-icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: app.exe_path }),
    });
    const data = await res.json();
    if (res.ok && data.icon_url) {
      appIconCache.set(app.process, data.icon_url);
      const el = audioMixer.querySelector(`[data-process="${cssEscape(app.process)}"] .app-icon`);
      if (el) el.src = data.icon_url;
    }
  } catch (e) { /* fall back to the generic label, no icon */ }
}

function buildAppFader(app, state) {
  const icon = h("img", { class: "app-icon", src: appIconCache.get(app.process) || "/static/icon-192.png", alt: "" });
  const slider = h("input", {
    type: "range", min: "0", max: "100", value: String(app.level), class: "volume-slider vertical",
    "aria-label": app.label, orient: "vertical",
  });
  const readout = h("span", { class: "volume-readout" }, `${app.level}%`);
  const label = h("span", { class: "fader-label" }, app.label);
  const muteBtnEl = h("button", { class: "mute-btn", "aria-label": "Mudo" }, app.muted ? "🔇" : "🔊");

  slider.addEventListener("pointerdown", () => { state.dragging = true; vibrate(6); });
  slider.addEventListener("input", (e) => {
    const level = parseInt(e.target.value, 10);
    state.level = level;
    readout.textContent = `${level}%`;
    clearTimeout(state.sendTimer);
    state.sendTimer = setTimeout(() => sendAppVolume(app.process, { level }), 60);
  });
  slider.addEventListener("pointerup", () => { state.dragging = false; });
  slider.addEventListener("change", () => { state.dragging = false; });

  muteBtnEl.addEventListener("click", () => {
    vibrate(12);
    state.muted = !state.muted;
    muteBtnEl.textContent = state.muted ? "🔇" : "🔊";
    slider.classList.toggle("muted", state.muted);
    sendAppVolume(app.process, { muted: state.muted });
  });

  return h("div", { class: "fader-col", "data-process": app.process }, [icon, slider, readout, muteBtnEl, label]);
}

function updateAppFaderUI(process, level, muted) {
  const el = audioMixer.querySelector(`[data-process="${cssEscape(process)}"]`);
  if (!el) return;
  const slider = el.querySelector(".volume-slider");
  const readout = el.querySelector(".volume-readout");
  const muteBtnEl = el.querySelector(".mute-btn");
  slider.value = level;
  slider.classList.toggle("muted", !!muted);
  readout.textContent = `${level}%`;
  muteBtnEl.textContent = muted ? "🔇" : "🔊";
}

function sendAppVolume(process, payload) {
  fetch("/api/volume/apps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ process, ...payload }),
  })
    .then(async (res) => {
      if (res.ok) return;
      const data = await res.json().catch(() => ({}));
      console.warn(`Volume de ${process} falhou:`, data.error || `HTTP ${res.status}`);
      const el = audioMixer.querySelector(`[data-process="${cssEscape(process)}"] .volume-readout`);
      if (el) { el.textContent = "erro"; el.title = data.error || ""; }
    })
    .catch((e) => console.warn(`Volume de ${process} falhou:`, e));
}

setInterval(fetchAppVolumes, 4000);
fetchAppVolumes();

/* ---------- now playing (qualquer app de música, Áudio screen) ---------- */

const nowPlayingEl = document.getElementById("nowPlaying");
const npArt = document.getElementById("npArt");
const npTitle = document.getElementById("npTitle");
const npArtist = document.getElementById("npArtist");
const npSource = document.getElementById("npSource");
const npPlayPause = document.getElementById("npPlayPause");
const npPrev = document.getElementById("npPrev");
const npNext = document.getElementById("npNext");
const npProgressFill = document.getElementById("npProgressFill");

const DEFAULT_ART = "/static/icon-192.png";
let lastThumbUrl = DEFAULT_ART;
let npSourceId = null; // app que está tocando (Central de Mídia) — enviado nos controles
let npState = { playing: false, progress: 0, duration: 0, at: 0 };

function setNowPlayingIdle(msg, detail) {
  nowPlayingEl.classList.add("idle");
  npTitle.textContent = msg || "Nada tocando";
  npArtist.textContent = detail || "";
  npArtist.title = detail || "";
  npSource.textContent = "";
  npPlayPause.textContent = "▶";
  npProgressFill.style.width = "0%";
  npState = { playing: false, progress: 0, duration: 0, at: Date.now() };
  npSourceId = null;
  if (lastThumbUrl !== DEFAULT_ART) {
    npArt.src = DEFAULT_ART;
    lastThumbUrl = DEFAULT_ART;
  }
}

function renderNpProgress() {
  if (!npState.duration) { npProgressFill.style.width = "0%"; return; }
  let pos = npState.progress;
  if (npState.playing) pos += Date.now() - npState.at; // anda sozinho entre uma consulta e outra
  npProgressFill.style.width = `${Math.max(0, Math.min(100, (100 * pos) / npState.duration))}%`;
}

async function fetchNowPlaying() {
  try {
    const res = await fetch("/api/nowplaying");
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { location.href = "/pair"; return; } // pareamento revogado: pede o PIN de novo
      setNowPlayingIdle("Não consegui ler a mídia", data.error || "");
      console.warn("Tocando agora indisponível:", data.error);
      return;
    }
    if (!data.title) {
      setNowPlayingIdle(); // nada tocando agora — não é erro
      return;
    }
    nowPlayingEl.classList.remove("idle");
    npTitle.textContent = data.title;
    npArtist.textContent = data.artist || "";
    npArtist.title = data.artist || "";
    npSource.textContent = data.source_name || "";
    npSourceId = data.source || null;
    npPlayPause.textContent = data.playing ? "⏸" : "▶";
    npState = {
      playing: !!data.playing,
      progress: data.progress_ms || 0,
      duration: data.duration_ms || 0,
      at: Date.now(),
    };
    renderNpProgress();
    const art = data.thumbnail_url || DEFAULT_ART;
    if (art !== lastThumbUrl) {
      npArt.src = art;
      lastThumbUrl = art;
    }
  } catch (e) {
    setNowPlayingIdle("Sem conexão com o servidor");
    console.warn("Não foi possível falar com o servidor:", e);
  }
}

function sendNowPlayingControl(action) {
  vibrate(15);
  fetch("/api/nowplaying/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, source: npSourceId || "" }),
  })
    .then((res) => res.json())
    .then((data) => { if (data.error) console.warn("Falha no controle de mídia:", data.error); })
    .catch((e) => console.warn("Falha no controle de mídia:", e))
    .finally(() => setTimeout(fetchNowPlaying, 400));
}

npPlayPause.addEventListener("click", () => sendNowPlayingControl("play_pause"));
npPrev.addEventListener("click", () => sendNowPlayingControl("previous"));
npNext.addEventListener("click", () => sendNowPlayingControl("next"));

// Só consulta o servidor com a tela de Áudio aberta (cada consulta roda um PowerShell no PC).
setInterval(() => {
  if (screens.classList.contains("on-audio") && !document.hidden) fetchNowPlaying();
}, 3000);
setInterval(renderNpProgress, 500);

/* ---------- wire up ---------- */


fsBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    const req = document.documentElement.requestFullscreen?.();
    if (req && req.catch) {
      req.catch(() => {
        showTip("Tela cheia não suportada aqui. No iPhone: toque em Compartilhar → Adicionar à Tela de Início, e abra o Deck a partir do ícone.");
      });
    } else if (!req) {
      showTip("Tela cheia não suportada aqui. No iPhone: toque em Compartilhar → Adicionar à Tela de Início, e abra o Deck a partir do ícone.");
    }
  } else {
    document.exitFullscreen?.();
  }
});

let tipTimer = null;
function showTip(msg) {
  installTip.textContent = msg;
  installTip.classList.add("show");
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => installTip.classList.remove("show"), 5000);
}

// One-time nudge for iOS Safari, where the Fullscreen API doesn't work —
// "Add to Home Screen" is the real way to get a chrome-free window there.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (isIOS && !isStandalone) {
  setTimeout(() => showTip("Dica: toque em Compartilhar → Adicionar à Tela de Início para abrir o Deck em tela cheia."), 1200);
}

loadConfig();
connect();
