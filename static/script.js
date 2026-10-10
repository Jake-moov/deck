/* ---------- categorias (cor do LED de cada tecla) ---------- */

const TYPE_CATEGORY = {
  app: "app", start_app: "app", script: "app", resolution: "app",
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

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

/* ---------- connection state ---------- */

const grid = document.getElementById("grid");
const brandMark = document.getElementById("brandMark");
const brand = document.getElementById("brand");
const fsBtn = document.getElementById("fsBtn");
const installTip = document.getElementById("installTip");
const volumeReadout = document.getElementById("volumeReadout");
const muteBtn = document.getElementById("muteBtn");
const quickVolumeAside = document.getElementById("quickVolume");
const screens = document.getElementById("screens");
const screensViewport = document.getElementById("screensViewport");
const screenTabs = document.getElementById("screenTabs");
const audioMixer = document.getElementById("audioMixer");

let ws = null;
let config = { grid: { columns: 3 }, buttons: [] };

function setStatus(state) {
  const label = state === "on" ? "Conectado" : state === "off" ? "Desconectado" : "Conectando";
  const color = state === "on" ? "var(--ok)" : state === "off" ? "var(--err)" : "var(--warn)";
  brandMark.style.background = color;
  brandMark.style.boxShadow = `0 0 10px ${color}`;
  brand.title = label;
}

function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------- custom fader component ----------
   Substitui o <input type=range> nativo: visual próprio, e o thumb percorre
   EXATAMENTE a altura da barra (100% = topo, 0% = base). */

const THUMB_HALF = 14; // metade da altura do thumb (px) — igual ao padding do .fader

function createFader(mount, { value = 50, muted = false, label = "Volume", onInput, onRelease } = {}) {
  const el = h("div", {
    class: "fader", role: "slider", tabindex: "0",
    "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100",
  });
  const track = h("div", { class: "fader-track" });
  const fill = h("div", { class: "fader-fill" });
  const thumb = h("div", { class: "fader-thumb" });
  track.append(fill, thumb);
  el.append(track);
  mount.append(el);

  let level = clamp(Math.round(value));
  let isMuted = !!muted;
  let dragging = false;

  function render() {
    fill.style.height = level + "%";
    // centro do thumb em `level`% da altura da barra: 100% = topo exato, 0% = base exata
    thumb.style.bottom = `calc(${level}% - ${THUMB_HALF}px)`;
    el.setAttribute("aria-valuenow", String(level));
    el.classList.toggle("muted", isMuted);
  }

  function levelFromClientY(clientY) {
    const r = track.getBoundingClientRect();
    if (r.height <= 0) return level;
    return clamp(Math.round(100 * (1 - (clientY - r.top) / r.height)));
  }

  function userSet(v) {
    v = clamp(Math.round(v));
    if (v === level) return;
    level = v;
    render();
    onInput && onInput(level);
  }

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    vibrate(8);
    userSet(levelFromClientY(e.clientY));
  });
  el.addEventListener("pointermove", (e) => {
    if (dragging) userSet(levelFromClientY(e.clientY));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    onRelease && onRelease(level);
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  el.addEventListener("keydown", (e) => {
    let v = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") v = level + 5;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") v = level - 5;
    else if (e.key === "Home") v = 0;
    else if (e.key === "End") v = 100;
    else if (e.key === "PageUp") v = level + 10;
    else if (e.key === "PageDown") v = level - 10;
    if (v !== null) {
      e.preventDefault();
      userSet(v);
      onRelease && onRelease(level);
    }
  });

  render();

  return {
    el,
    get level() { return level; },
    isDragging() { return dragging; },
    // ajuste vindo de fora (polling): silencioso, não dispara onInput
    set(v, m) {
      level = clamp(Math.round(v));
      if (typeof m === "boolean") isMuted = m;
      render();
    },
    setMuted(m) { isMuted = !!m; render(); },
  };
}

/* ---------- view mode: the deck grid ---------- */

async function loadConfig() {
  const res = await fetch("/api/config");
  config = await res.json();
  renderGrid();
}

// Um toque numa tecla só dispara se o dedo não arrastou (para não conflitar com o swipe de telas).
let suppressTap = false;

function renderGrid() {
  grid.style.setProperty("--cols", (config.grid && config.grid.columns) || 3);
  grid.innerHTML = "";
  if (!config.buttons.length) {
    grid.appendChild(h("div", { class: "empty" }, "Nenhum botão configurado.\nAdicione botões no app do Deck, no PC."));
    return;
  }
  for (const btn of config.buttons) {
    const appKey = (btn.label || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const el = h("button", { class: "key", "data-category": categoryOf(btn.type), "data-id": btn.id, "data-app": appKey }, [
      iconNode(btn.icon),
      h("span", { class: "label" }, btn.label || btn.id),
    ]);
    let downPos = null;
    el.addEventListener("pointerdown", (e) => {
      downPos = { x: e.clientX, y: e.clientY };
      el.classList.add("pressed");
    });
    const cancelPress = () => {
      downPos = null;
      el.classList.remove("pressed");
    };
    el.addEventListener("pointerup", (e) => {
      el.classList.remove("pressed");
      if (downPos && !suppressTap) {
        const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
        if (moved < 12) onPress(el, btn.id);
      }
      downPos = null;
    });
    el.addEventListener("pointercancel", cancelPress);
    el.addEventListener("pointerleave", () => {
      // se o dedo escorregou para fora sem soltar, não é um toque
      if (downPos) cancelPress();
    });
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

/* ---------- screen navigation (Teclas / Áudio): tabs no topo + swipe ---------- */

const tabBtns = [...screenTabs.querySelectorAll(".tab-btn")];
let activeScreens = ["apps"]; // máx 2 em split

function renderScreens() {
  const isSplit = activeScreens.length === 2;
  const onAudio = activeScreens.includes("audio") && !isSplit;
  screens.classList.remove("no-anim");
  screens.style.transform = "";
  screens.classList.toggle("split", isSplit);
  screens.classList.toggle("on-audio", onAudio);
  screenTabs.classList.toggle("on-audio", onAudio);
  screenTabs.classList.toggle("split", isSplit);
  for (const t of tabBtns) t.classList.toggle("active", activeScreens.includes(t.dataset.screen));
  if (activeScreens.includes("audio")) { fetchNowPlaying(); fetchVolume(); fetchAppVolumes(); }
}

function goToScreen(name, keepInlineTransform = false) {
  // Tap sempre = single view. Merge (split) é só via long-press de 3s.
  if (keepInlineTransform) {
    activeScreens = [name];
  } else if (activeScreens.length === 1 && activeScreens[0] === name) {
    return; // já está na tela
  } else {
    activeScreens = [name]; // unmerge ou troca de tela
  }
  renderScreens();
}

screenTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  // click simples = navegação single (o merge é via long-press de 3s)
  if (btn.dataset.longpress === "1") {
    btn.dataset.longpress = "";
    return;
  }
  vibrate(10);
  goToScreen(btn.dataset.screen);
});

// Long-press (3s) numa aba inativa = merge (split). Evita split acidental.
let tabPressTimer = null;
screenTabs.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  const target = btn.dataset.screen;
  // só faz sentido dar merge se a aba não está ativa
  if (activeScreens.includes(target)) return;
  tabPressTimer = setTimeout(() => {
    btn.dataset.longpress = "1";
    vibrate(30);
    // merge: adiciona a aba ao split (ordem fixa apps, audio)
    activeScreens = ["apps", "audio"].filter((s) => activeScreens.includes(s) || s === target);
    activeScreens.sort((a, b) => (a === "apps" ? -1 : 1));
    if (activeScreens.length > 2) activeScreens = activeScreens.slice(0, 2);
    renderScreens();
    tabPressTimer = null;
  }, 3000);
});
["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
  screenTabs.addEventListener(ev, () => {
    if (tabPressTimer) {
      clearTimeout(tabPressTimer);
      tabPressTimer = null;
    }
  })
);

// Swipe horizontal no viewport troca de tela. Não inicia em cima de
// controles interativos (faders, botões, mixer com rolagem própria).
let swipe = null;

function swipeShouldIgnore(target) {
  // Teclas do grid: swipe permitido — se virar swipe, o toque é suprimido.
  if (target.closest(".key")) return false;
  return !!target.closest(".fader, button, input, select, .audio-mixer, .np-controls");
}

screensViewport.addEventListener("pointerdown", (e) => {
  if (activeScreens.length === 2) return; // sem swipe no modo split
  if (swipeShouldIgnore(e.target)) return;
  swipe = { x0: e.clientX, y0: e.clientY, dx: 0, active: false };
});

screensViewport.addEventListener("pointermove", (e) => {
  if (activeScreens.length === 2) return; // sem swipe no modo split
  if (!swipe || swipe.active) {
    if (swipe && swipe.active) {
      swipe.dx = e.clientX - swipe.x0;
      const base = activeScreens[0] === "audio" ? -screensViewport.clientWidth : 0;
      screens.style.transform = `translateX(${base + swipe.dx}px)`;
    }
    return;
  }
  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    swipe.active = true;
    suppressTap = true; // um swipe que começou numa tecla não pode dispará-la
    screens.classList.add("no-anim");
    swipe.dx = dx;
  } else if (Math.abs(dy) > 28 || Math.abs(dx) > 80) {
    swipe = null; // gesto vertical (ou nada): não é swipe de tela
  }
});

function endSwipe() {
  if (!swipe) return;
  const wasActive = swipe.active;
  const dx = swipe.dx;
  swipe = null;
  if (!wasActive) return;
  if (activeScreens.length === 2) return; // sem swipe no modo split
  const w = screensViewport.clientWidth;
  let target = activeScreens[0];
  if (dx < -w * 0.22 && activeScreens[0] === "apps") target = "audio";
  else if (dx > w * 0.22 && activeScreens[0] === "audio") target = "apps";
  // Aplica a classe destino ANTES de soltar o transform inline (que ainda
  // sobrepõe a classe): assim a animação parte da posição arrastada.
  screens.classList.remove("no-anim");
  goToScreen(target, true);
  screens.style.transform = "";
  setTimeout(() => { suppressTap = false; }, 50);
}

screensViewport.addEventListener("pointerup", endSwipe);
screensViewport.addEventListener("pointercancel", () => {
  swipe = null;
  screens.classList.remove("no-anim");
  screens.style.transform = "";
  setTimeout(() => { suppressTap = false; }, 50);
});

/* ---------- master volume (faders sincronizados: sidebar + mixer) ---------- */

let volumeSendTimer = null;
let lastKnownLevel = 50;
let lastKnownMuted = false;

const masterFaders = []; // { fader, readout, muteBtn }

function showVolumeError(msg) {
  for (const m of masterFaders) { m.readout.textContent = "erro"; m.readout.title = msg || ""; }
  console.warn("Falha ao ajustar volume:", msg);
}

function paintMaster(level, muted) {
  for (const m of masterFaders) {
    m.readout.textContent = muted ? "MUDO" : `${level}%`;
    m.readout.title = "";
    m.muteBtn.textContent = muted || level === 0 ? "🔇" : level < 50 ? "🔉" : "🔊";
    m.muteBtn.classList.toggle("muted", !!muted);
  }
}

function updateVolumeUI(level, muted) {
  lastKnownLevel = level;
  lastKnownMuted = muted;
  for (const m of masterFaders) m.fader.set(level, muted);
  paintMaster(level, muted);
}

// Chamada pelo fader que o usuário está arrastando.
function onMasterInput(src, level) {
  lastKnownLevel = level;
  lastKnownMuted = false;
  for (const m of masterFaders) {
    if (m.fader !== src) m.fader.set(level, false);
  }
  paintMaster(level, false);
  sendVolume(level);
}

async function fetchVolume() {
  try {
    const res = await fetch("/api/volume");
    const data = await res.json();
    if (!res.ok) {
      showVolumeError(data.error || "falha desconhecida");
      return;
    }
    const dragging = masterFaders.some((m) => m.fader.isDragging());
    if (!dragging) updateVolumeUI(data.level, data.muted);
  } catch (e) {
    for (const m of masterFaders) m.readout.textContent = "offline";
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
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) showVolumeError(data.error || `HTTP ${res.status}`);
      })
      .catch((e) => showVolumeError(String(e)));
  }, 60);
}

function registerMasterFader(mount, readout, muteBtn) {
  const fader = createFader(mount, {
    value: lastKnownLevel,
    label: "Volume geral",
    onInput: (v) => onMasterInput(fader, v),
  });
  const entry = { fader, readout, muteBtn };
  masterFaders.push(entry);
  muteBtn.addEventListener("click", () => {
    vibrate(15);
    const newMuted = !lastKnownMuted;
    updateVolumeUI(lastKnownLevel, newMuted);
    fetch("/api/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted: newMuted }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) showVolumeError(data.error || `HTTP ${res.status}`);
      })
      .catch((e) => showVolumeError(String(e)));
  });
  return entry;
}

// Sidebar da tela Teclas: o fader é filho direto do aside (flex column),
// mesma estrutura simples do slider nativo original.
const quickEntry = registerMasterFader(quickVolumeAside, volumeReadout, muteBtn);
quickVolumeAside.insertBefore(quickEntry.fader.el, volumeReadout);

setInterval(fetchVolume, 4000);
fetchVolume();

/* ---------- per-app volume mixer (faders verticais, tela Áudio) ---------- */

const appIconCache = new Map(); // process name -> icon_url ("" while pending)
const appStripState = new Map(); // process name -> { fader, readout, muteBtnEl, dragging, level, muted, sendTimer }

function buildMasterFaderCol() {
  const icon = h("span", { class: "app-icon" }, "🔊");
  const name = h("span", { class: "fader-name" }, "Geral");
  const readout = h("span", { class: "volume-readout" }, "--%");
  const muteBtnEl = h("button", { class: "mute-btn", "aria-label": "Mudo" }, "🔊");
  const footer = h("div", { class: "fader-footer" }, [
    icon,
    h("span", { class: "footer-divider" }),
    muteBtnEl,
  ]);
  const col = h("div", { class: "fader-col", "data-process": "__master__" }, [name]);
  // o fader é filho direto da coluna (flex:1) — sem wrapper aninhado
  requestAnimationFrame(() => {
    registerMasterFader(col, readout, muteBtnEl);
    col.appendChild(readout);
    col.appendChild(footer);
  });
  return col;
}

audioMixer.appendChild(buildMasterFaderCol());

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
      state = { fader: null, readout: null, muteBtnEl: null, dragging: false, level: app.level, muted: app.muted, sendTimer: null };
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
  const iconPath = app.aumid || app.exe_path;
  if (!iconPath || appIconCache.has(app.process)) return;
  appIconCache.set(app.process, "");
  try {
    const res = await fetch("/api/extract-icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: iconPath }),
    });
    const data = await res.json();
    if (res.ok && data.icon_url) {
      appIconCache.set(app.process, data.icon_url);
      const el = audioMixer.querySelector(`[data-process="${cssEscape(app.process)}"] .app-icon`);
      if (el) el.src = data.icon_url;
    }
  } catch (e) { /* fall back to the generic icon, no problem */ }
}

function buildAppFader(app, state) {
  const icon = h("img", { class: "app-icon", src: appIconCache.get(app.process) || "/static/icon-192.png", alt: "" });
  const name = h("span", { class: "fader-name" }, app.label);
  name.title = app.label;
  const readout = h("span", { class: "volume-readout" }, `${app.level}%`);
  const muteBtnEl = h("button", { class: "mute-btn", "aria-label": "Mudo" }, app.muted ? "🔇" : "🔊");
  const footer = h("div", { class: "fader-footer" }, [
    icon,
    h("span", { class: "footer-divider" }),
    muteBtnEl,
  ]);
  // o fader é filho direto da coluna (flex:1) — sem wrapper aninhado
  const col = h("div", { class: "fader-col", "data-process": app.process }, [name]);

  const fader = createFader(col, {
    value: app.level,
    muted: app.muted,
    label: `Volume de ${app.label}`,
    onInput: (v) => {
      state.level = v;
      readout.textContent = `${v}%`;
      muteBtnEl.textContent = v === 0 ? "🔇" : "🔊";
      clearTimeout(state.sendTimer);
      state.sendTimer = setTimeout(() => sendAppVolume(app.process, { level: v }), 60);
    },
    onRelease: () => { state.dragging = false; },
  });
  // marca dragging no pointerdown do fader (o createFader não expõe o início)
  fader.el.addEventListener("pointerdown", () => { state.dragging = true; vibrate(6); }, { capture: true });

  muteBtnEl.addEventListener("click", () => {
    vibrate(12);
    state.muted = !state.muted;
    muteBtnEl.textContent = state.muted ? "🔇" : "🔊";
    fader.setMuted(state.muted);
    sendAppVolume(app.process, { muted: state.muted });
  });

  col.appendChild(readout);
  col.appendChild(footer);

  state.fader = fader;
  state.readout = readout;
  state.muteBtnEl = muteBtnEl;

  return col;
}

function updateAppFaderUI(process, level, muted) {
  const state = appStripState.get(process);
  if (!state || !state.fader) return;
  state.fader.set(level, muted);
  state.readout.textContent = `${level}%`;
  state.muteBtnEl.textContent = muted ? "🔇" : "🔊";
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
      const state = appStripState.get(process);
      if (state && state.readout) { state.readout.textContent = "erro"; state.readout.title = data.error || ""; }
    })
    .catch((e) => console.warn(`Volume de ${process} falhou:`, e));
}

setInterval(fetchAppVolumes, 4000);
fetchAppVolumes();

/* ---------- microfone (painel fixo à direita) ---------- */

const micPanel = document.getElementById("micPanel");
const micReadout = document.getElementById("micReadout");
const micMuteBtn = document.getElementById("micMuteBtn");
const discordMuteBtn = document.getElementById("discordMuteBtn");

let micState = { level: 100, muted: false, dragging: false, sendTimer: null };
let discordMuted = false; // estado local — o Discord não confirma de volta

const micFader = createFader(micPanel, {
  value: 100,
  label: "Volume do microfone",
  onInput: (v) => {
    micState.level = v;
    micReadout.textContent = `${v}%`;
    micMuteBtn.textContent = v === 0 ? "🔇" : "🔊";
    clearTimeout(micState.sendTimer);
    micState.sendTimer = setTimeout(() => sendMicVolume({ level: v }), 80);
  },
  onRelease: () => { micState.dragging = false; },
});
micPanel.insertBefore(micFader.el, micReadout);
micFader.el.addEventListener("pointerdown", () => { micState.dragging = true; vibrate(6); }, { capture: true });

function updateMicUI(level, muted) {
  if (!micState.dragging) micFader.set(level, muted);
  micReadout.textContent = `${level}%`;
  micMuteBtn.textContent = muted ? "🔇" : "🔊";
}

async function fetchMicVolume() {
  try {
    const res = await fetch("/api/mic");
    const data = await res.json();
    if (!res.ok) return;
    micState.level = data.level;
    micState.muted = !!data.muted;
    updateMicUI(data.level, !!data.muted);
  } catch (e) { /* endpoint ainda não existe no servidor — silencioso */ }
}

function sendMicVolume(payload) {
  fetch("/api/mic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

micMuteBtn.addEventListener("click", () => {
  vibrate(12);
  const newMuted = !micState.muted;
  micState.muted = newMuted;
  updateMicUI(micState.level, newMuted);
  sendMicVolume({ muted: newMuted });
});

discordMuteBtn.addEventListener("click", () => {
  vibrate(15);
  discordMuted = !discordMuted;
  discordMuteBtn.classList.toggle("active", discordMuted);
  fetch("/api/discord/mute", { method: "POST" }).catch(() => {});
});

setInterval(fetchMicVolume, 4000);
fetchMicVolume();

/* ---------- now playing (qualquer app de música, tela Áudio) ---------- */

const nowPlayingEl = document.getElementById("nowPlaying");
const npArt = document.getElementById("npArt");
const npTitle = document.getElementById("npTitle");
const npArtist = document.getElementById("npArtist");
const npSource = document.getElementById("npSource");
const npPlayPause = document.getElementById("npPlayPause");
const npPrev = document.getElementById("npPrev");
const npNext = document.getElementById("npNext");
const npProgressFill = document.getElementById("npProgressFill");
const npProgressTrack = document.getElementById("npProgressTrack");
const npProgressKnob = document.getElementById("npProgressKnob");
let npScrubbing = false;

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
  if (npScrubbing) return; // não briga com o dedo durante o seek
  if (!npState.duration) { npProgressFill.style.width = "0%"; npProgressKnob.style.left = "0%"; return; }
  let pos = npState.progress;
  if (npState.playing) pos += Date.now() - npState.at; // anda sozinho entre uma consulta e outra
  const pct = Math.max(0, Math.min(100, (100 * pos) / npState.duration));
  npProgressFill.style.width = `${pct}%`;
  npProgressKnob.style.left = `${pct}%`;
}

/* ---------- seek: arrastar a barrinha do "tocando agora" ---------- */

function npScrubTo(clientX) {
  const rect = npProgressTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (!npState.duration) return null;
  npProgressFill.style.width = `${ratio * 100}%`;
  npProgressKnob.style.left = `${ratio * 100}%`;
  return Math.round(ratio * npState.duration);
}

npProgressTrack.addEventListener("pointerdown", (e) => {
  if (!npState.duration) return;
  npScrubbing = true;
  try { npProgressTrack.setPointerCapture(e.pointerId); } catch (_) {}
  npScrubTo(e.clientX);
  vibrate(8);
});

npProgressTrack.addEventListener("pointermove", (e) => {
  if (!npScrubbing) return;
  npScrubTo(e.clientX);
});

function npEndScrub(e) {
  if (!npScrubbing) return;
  npScrubbing = false;
  const posMs = npScrubTo(e.clientX);
  if (posMs == null) return;
  // atualiza o estado local pra barra não "pular" de volta antes do próximo poll
  npState.progress = posMs;
  npState.at = Date.now();
  vibrate(12);
  fetch("/api/nowplaying/seek", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ position_ms: posMs, source: npSourceId || "" }),
  })
    .then((res) => res.json())
    .then((data) => { if (data.error) console.warn("Falha no seek:", data.error); })
    .catch((err) => console.warn("Falha no seek:", err))
    .finally(() => setTimeout(fetchNowPlaying, 400));
}

npProgressTrack.addEventListener("pointerup", npEndScrub);
npProgressTrack.addEventListener("pointercancel", () => { npScrubbing = false; });

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
    updateNpArt(data.thumbnail_url, data.title, data.artist);
  } catch (e) {
    setNowPlayingIdle("Sem conexão com o servidor");
    console.warn("Não foi possível falar com o servidor:", e);
  }
}

/* ---------- capa do álbum: SMTC primeiro, iTunes como fallback ---------- */

const itunesArtCache = new Map(); // "title|artist" -> url ("" = não achou)

async function fetchItunesArt(title, artist) {
  const key = `${title}|${artist}`.toLowerCase();
  if (itunesArtCache.has(key)) return itunesArtCache.get(key);
  itunesArtCache.set(key, ""); // marca como pendente pra não disparar 2x
  try {
    const q = encodeURIComponent(`${artist} ${title}`.trim());
    const res = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=1`);
    const data = await res.json();
    const url = data.results?.[0]?.artworkUrl100?.replace("100x100", "600x600") || "";
    itunesArtCache.set(key, url);
    return url;
  } catch (e) {
    return "";
  }
}

async function updateNpArt(thumbnailUrl, title, artist) {
  // 1. tenta a capa do SMTC (backend)
  if (thumbnailUrl) {
    if (thumbnailUrl !== lastThumbUrl) {
      npArt.src = thumbnailUrl;
      lastThumbUrl = thumbnailUrl;
    }
    return;
  }
  // 2. fallback: busca no iTunes pela faixa
  if (title) {
    const fb = await fetchItunesArt(title, artist || "");
    const art = fb || DEFAULT_ART;
    if (art !== lastThumbUrl) {
      npArt.src = art;
      lastThumbUrl = art;
    }
    return;
  }
  // 3. nada: placeholder
  if (lastThumbUrl !== DEFAULT_ART) {
    npArt.src = DEFAULT_ART;
    lastThumbUrl = DEFAULT_ART;
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
  if (activeScreens.includes("audio") && !document.hidden) fetchNowPlaying();
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

/* ---------- bolinhas de status: app rodando = acesa ---------- */

const APP_PROC_MAP = {
  discord: ["discord.exe"],
  whatsapp: ["whatsapp.exe"],
  spotube: ["spotube.exe"],
  spotify: ["spotify.exe"],
  claude: ["claude.exe"],
  chatgpt: ["chatgpt.exe"],
  chrome: ["chrome.exe"],
  steam: ["steam.exe"],
};

async function updateAppDots() {
  try {
    const res = await fetch("/api/apps/running");
    if (!res.ok) return;
    const data = await res.json();
    const running = (data.processes || []).map((n) => n.toLowerCase());
    document.querySelectorAll(".key[data-app]").forEach((el) => {
      const app = el.getAttribute("data-app");
      const procs = APP_PROC_MAP[app];
      // match exato primeiro, depois substring (para apps da Store/UWP)
      let isActive = false;
      if (procs) {
        isActive = procs.some((p) => running.includes(p.toLowerCase()));
      }
      if (!isActive && app) {
        isActive = running.some((r) => r.includes(app));
      }
      el.classList.toggle("app-active", isActive);
    });
  } catch (e) {
    // backend ainda não tem o endpoint — ignora silenciosamente
  }
}

// atualiza a cada 5s
setInterval(updateAppDots, 5000);
setTimeout(updateAppDots, 2000);
