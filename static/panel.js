"use strict";
/* Deck — app do PC: editor de botões, conexão com o celular e sistema. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- utilidades ---------- */

function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  record: '<circle cx="12" cy="12" r="5"/>',
  image: '<path d="M3 4h18v16H3z"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5.5-5.5L9 17"/>',
  pointer: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24">${PATHS[name] || ""}</svg>`;

function genId() {
  return "btn_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* sem corpo */ }
  if (!res.ok) throw Object.assign(new Error(data.error || data.detail || `Erro ${res.status}`), { data, status: res.status });
  return data;
}
const post = (path, body = {}) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ---------- toast e modais ---------- */

let toastTimer = null;
function toast(msg, actionLabel, onAction) {
  const t = $("#toast"), act = $("#toastAct");
  $("#toastText").textContent = msg;
  act.hidden = !actionLabel;
  act.textContent = actionLabel || "";
  act.onclick = () => { t.classList.remove("show"); if (onAction) onAction(); };
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), actionLabel ? 6000 : 2400);
}

function openModal({ title, sub, body, buttons = [], onClose }) {
  const root = $("#modalRoot");
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const foot = h("div", { class: "mfoot" }, buttons.map((b) => h("button", {
    class: "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""),
    onclick: () => { if (b.onclick) b.onclick(); if (!b.keepOpen) close(); },
  }, b.label)));
  const modal = h("div", { class: "modal", role: "dialog" }, [
    h("h3", {}, title),
    sub ? h("div", { class: "sub" }, sub) : null,
    body ? h("div", { class: "mbody" }, body) : null,
    buttons.length ? foot : h("div", { style: "height:14px" }),
  ]);
  const backdrop = h("div", { class: "backdrop", onmousedown: (e) => { if (e.target === backdrop) close(); } }, modal);
  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey, true);
  return { close, modal };
}

function confirmBox(title, sub, okLabel = "Confirmar", danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; resolve(v); };
    openModal({
      title, sub,
      buttons: [
        { label: "Cancelar", onclick: () => done(false) },
        { label: okLabel, primary: !danger, danger, onclick: () => done(true) },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------- metadados dos tipos de botão ---------- */

const MEDIA_OPTIONS = [
  ["play_pause", "Play/Pause"], ["next", "Próxima faixa"], ["prev", "Faixa anterior"],
  ["vol_up", "Volume +"], ["vol_down", "Volume -"], ["mute", "Mudo"], ["stop", "Parar"],
];

const TYPES = {
  start_app:  { label: "Abrir app instalado",       group: "Apps e sistema", cat: "app",    kind: "app_picker" },
  app:        { label: "Abrir programa (.exe)",     group: "Apps e sistema", cat: "app",    kind: "path", path: "Programa ou comando", pick: true },
  script:     { label: "Rodar script ou comando",   group: "Apps e sistema", cat: "app",    kind: "path", path: "Comando ou arquivo de script", pick: true },
  resolution: { label: "Trocar resolução do monitor", group: "Apps e sistema", cat: "app",    kind: "text", valueLabel: "Resolução (LARGURAxALTURA, ex: 800x600)" },
  hotkey:     { label: "Atalho de teclado",         group: "Teclado",        cat: "hotkey", kind: "hotkey" },
  macro:      { label: "Macro (sequência de ações)", group: "Teclado",       cat: "macro",  kind: "steps" },
  media:      { label: "Controle de mídia",         group: "Mídia e áudio",  cat: "media",  kind: "select", options: MEDIA_OPTIONS, valueLabel: "Ação" },
  mic_mute:   { label: "Mutar microfone (sistema)", group: "Mídia e áudio",  cat: "media",  kind: "none" },
  obs_scene:  { label: "OBS · trocar cena",         group: "OBS",            cat: "obs",    kind: "text", valueLabel: "Nome da cena" },
  obs_mute:   { label: "OBS · mutar fonte",         group: "OBS",            cat: "obs",    kind: "text", valueLabel: "Nome da fonte de áudio" },
  obs_record: { label: "OBS · gravar",              group: "OBS",            cat: "obs",    kind: "none" },
  obs_stream: { label: "OBS · transmitir",          group: "OBS",            cat: "obs",    kind: "none" },
};
const STEP_TYPES = ["hotkey", "media", "app", "start_app", "script", "delay", "resolution", "mic_mute", "obs_scene", "obs_mute", "obs_record", "obs_stream"];
const typeMeta = (t) => TYPES[t] || TYPES.app;

/* ---------- teclas ---------- */

const KEY_LABELS = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", windows: "Win", space: "Espaço", esc: "Esc", enter: "Enter", backspace: "Backspace", tab: "Tab", delete: "Del", up: "↑", down: "↓", left: "←", right: "→" };
function prettyKey(k) {
  const key = k.trim();
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}
const comboParts = (v) => (v || "").split("+").map((s) => s.trim()).filter(Boolean);
const comboText = (v) => comboParts(v).map(prettyKey).join(" + ");

function keyName(ev) {
  const code = ev.code || "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const map = { " ": "space", Escape: "esc", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "enter", Backspace: "backspace", Tab: "tab", Delete: "delete", Insert: "insert", Home: "home", End: "end", PageUp: "page up", PageDown: "page down" };
  return map[ev.key] || ev.key.toLowerCase();
}

/* ---------- estado ---------- */

const S = {
  page: "buttons",
  config: { grid: { columns: 4 }, buttons: [] },
  selId: null,
  info: null,
  saveTimer: null, saving: false, saveAgain: false, dirty: false,
  apps: null, appsPromise: null,
  iconTab: null,
  stopRec: null,
  lastRemoved: null,
  qrKey: "",
};

const selected = () => S.config.buttons.find((b) => b.id === S.selId) || null;

function captionOf(btn) {
  const meta = typeMeta(btn.type);
  switch (btn.type) {
    case "start_app": return btn.app_name || "App instalado";
    case "app": return (btn.value || "").split(/[\\/]/).pop() || "Programa";
    case "script": return "Script";
    case "resolution": return btn.value ? `Tela ${btn.value}` : "Resolução";
    case "hotkey": return btn.value ? comboText(btn.value) : "Atalho";
    case "media": return (MEDIA_OPTIONS.find((o) => o[0] === btn.value) || [0, "Mídia"])[1];
    case "mic_mute": return "Microfone";
    case "obs_scene": return btn.value ? `Cena: ${btn.value}` : "OBS · cena";
    case "obs_mute": return btn.value ? `Mudo: ${btn.value}` : "OBS · fonte";
    case "obs_record": return "OBS · gravar";
    case "obs_stream": return "OBS · live";
    case "macro": return `${(btn.steps || []).length} passos`;
    default: return meta.label;
  }
}

function iconEl(icon) {
  const d = h("span", { class: "ico" });
  if (isIconPreset(icon)) d.innerHTML = presetSvg(icon.slice(7));
  else if (isIconImage(icon)) d.appendChild(h("img", { src: icon, alt: "" }));
  else d.textContent = icon || "•";
  return d;
}

/* ---------- navegação ---------- */

const PAGE_TITLES = { buttons: "Botões", phone: "Celular", system: "Sistema" };

function openNav() {
  $("#sidebar").classList.add("open");
  $("#navScrim").classList.add("open");
  $("#sidebar").setAttribute("aria-hidden", "false");
  $("#burger").setAttribute("aria-expanded", "true");
}
function closeNav() {
  $("#sidebar").classList.remove("open");
  $("#navScrim").classList.remove("open");
  $("#sidebar").setAttribute("aria-hidden", "true");
  $("#burger").setAttribute("aria-expanded", "false");
}
const navIsOpen = () => $("#sidebar").classList.contains("open");
$("#burger").addEventListener("click", () => (navIsOpen() ? closeNav() : openNav()));
$("#navClose").addEventListener("click", closeNav);
$("#navScrim").addEventListener("click", closeNav);

function go(page) {
  S.page = page;
  $("#crumb").textContent = PAGE_TITLES[page] || "";
  closeNav();
  if (page !== "buttons") closeDetails();
  try { localStorage.setItem("deck.page", page); } catch (e) { /* sem storage */ }
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${page}`));
}
$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (b) go(b.dataset.page);
});

/* ============================================================
   EDITOR DE BOTÕES
   ============================================================ */

async function loadConfig() {
  const cfg = await api("/api/config");
  S.config = { grid: cfg.grid && cfg.grid.columns ? cfg.grid : { columns: 4 }, buttons: cfg.buttons || [] };
  syncColumns();
  renderCanvas();
  renderInspector();
}

function syncColumns() {
  const c = S.config.grid.columns || 4;
  $("#colsOut").textContent = c;
  $("#colsDown").disabled = c <= 2;
  $("#colsUp").disabled = c >= 10;
}

function setColumns(n) {
  S.config.grid.columns = Math.max(2, Math.min(10, n));
  syncColumns();
  renderCanvas();
  scheduleSave();
}

/* --- salvar (automático) --- */

function setSave(state, msg) {
  const el = $("#saveState");
  el.className = "savestate" + (state === "saving" || state === "pending" ? " saving" : state === "error" ? " error" : "");
  const dot = $(".dot", el);
  dot.className = "dot" + (state === "saved" ? " on" : state === "error" ? " off" : "");
  $("#saveText").textContent = { saved: "Salvo", pending: "Alterações pendentes…", saving: "Salvando…", error: msg || "Erro ao salvar — clique para tentar de novo" }[state];
}
$("#saveState").addEventListener("click", () => { if ($("#saveState").classList.contains("error")) save(); });

function cleanButton(b) {
  const out = {};
  for (const [k, v] of Object.entries(b)) if (!k.startsWith("_")) out[k] = v;
  return out;
}

function scheduleSave() {
  S.dirty = true;
  setSave("pending");
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(save, 500);
}

async function save(keepalive = false) {
  clearTimeout(S.saveTimer);
  if (S.saving) { S.saveAgain = true; return; }
  S.saving = true;
  setSave("saving");
  try {
    await api("/api/config", {
      method: "PUT", keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grid: S.config.grid, buttons: S.config.buttons.map(cleanButton) }),
    });
    S.dirty = false;
    setSave("saved");
  } catch (e) {
    setSave("error", `Não salvou: ${e.message} — clique para tentar de novo`);
  } finally {
    S.saving = false;
    if (S.saveAgain) { S.saveAgain = false; save(); }
  }
}
function flushSave() { if (S.dirty && !S.saving) save(true); }
window.addEventListener("beforeunload", flushSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });

/** Chamado a cada alteração: atualiza a prévia e agenda o salvamento (sem recriar o inspetor, para não perder o foco). */
function touch() {
  renderCanvas();
  refreshHead();
  scheduleSave();
}

/* --- operações --- */

function select(id) {
  S.selId = id;
  S.iconTab = null;
  $(".editor").classList.toggle("drawer-open", !!id);
  renderCanvas();
  renderInspector();
  if (id) scrollKeyIntoView(id);
}

/** Fecha a gaveta de detalhes (nenhum botão selecionado = editor em largura total). */
function closeDetails() {
  if (S.selId) select(null);
}

function scrollKeyIntoView(id) {
  // a grade encolhe quando a gaveta abre; garante que o botão selecionado continue à vista
  setTimeout(() => { const k = $(`#canvas .key[data-id="${id}"]`); if (k) k.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, 240);
}

function addButton() {
  const btn = { id: genId(), label: "Novo botão", icon: "preset:star", type: "start_app", value: "" };
  S.config.buttons.push(btn);
  select(btn.id);
  scheduleSave();
  setTimeout(() => { const input = $(".name-input"); if (input) { input.focus(); input.select(); } }, 60);
}

function duplicateSelected() {
  const btn = selected();
  if (!btn) return;
  const copy = JSON.parse(JSON.stringify(cleanButton(btn)));
  copy.id = genId();
  copy.label = `${btn.label || "Botão"} (cópia)`;
  const i = S.config.buttons.indexOf(btn);
  S.config.buttons.splice(i + 1, 0, copy);
  select(copy.id);
  scheduleSave();
}

function removeSelected() {
  const btn = selected();
  if (!btn) return;
  const i = S.config.buttons.indexOf(btn);
  S.config.buttons.splice(i, 1);
  S.lastRemoved = { btn, index: i };
  S.selId = null;
  $(".editor").classList.remove("drawer-open");
  renderCanvas();
  renderInspector();
  scheduleSave();
  toast(`“${btn.label || "Botão"}” removido`, "Desfazer", undoRemove);
}

function undoRemove() {
  const r = S.lastRemoved;
  if (!r) return;
  S.lastRemoved = null;
  S.config.buttons.splice(Math.min(r.index, S.config.buttons.length), 0, r.btn);
  select(r.btn.id);
  scheduleSave();
}

function moveTo(id, targetId, after) {
  const list = S.config.buttons;
  const from = list.findIndex((b) => b.id === id);
  if (from < 0 || id === targetId) return;
  const [item] = list.splice(from, 1);
  let to = targetId == null ? list.length : list.findIndex((b) => b.id === targetId);
  if (targetId != null && after) to += 1;
  list.splice(to, 0, item);
  renderCanvas();
  scheduleSave();
}

/* --- tela (canvas) --- */

let dragId = null;
function clearDrop() { $$(".drop-before, .drop-after").forEach((e) => e.classList.remove("drop-before", "drop-after")); }

function renderCanvas() {
  const el = $("#canvas");
  const keep = el.scrollTop;
  el.innerHTML = "";
  const cols = S.config.grid.columns || 4;
  const deck = h("div", { class: "deck" + (cols >= 9 ? " tiny" : cols >= 7 ? " dense" : ""), style: `--cols:${cols}` });

  S.config.buttons.forEach((btn) => {
    const tile = h("div", {
      class: "key" + (btn.id === S.selId ? " selected" : ""),
      "data-cat": typeMeta(btn.type).cat, "data-id": btn.id,
      draggable: "true", tabindex: "0", role: "button", title: "Clique para editar · arraste para reordenar",
    }, [iconEl(btn.icon), h("div", { class: "name" }, btn.label || "Sem nome"), h("div", { class: "cap" }, captionOf(btn))]);
    tile.addEventListener("click", () => select(btn.id));
    tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(btn.id); } });
    tile.addEventListener("dragstart", (e) => {
      dragId = btn.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", btn.id);
      setTimeout(() => tile.classList.add("dragging"), 0);
    });
    tile.addEventListener("dragend", () => { dragId = null; clearDrop(); tile.classList.remove("dragging"); });
    tile.addEventListener("dragover", (e) => {
      if (!dragId || dragId === btn.id) return;
      e.preventDefault();
      const r = tile.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      clearDrop();
      tile.classList.add(after ? "drop-after" : "drop-before");
      tile.dataset.drop = after ? "after" : "before";
    });
    tile.addEventListener("dragleave", () => tile.classList.remove("drop-before", "drop-after"));
    tile.addEventListener("drop", (e) => {
      e.preventDefault();
      const after = tile.dataset.drop === "after";
      clearDrop();
      if (dragId) moveTo(dragId, btn.id, after);
    });
    deck.appendChild(tile);
  });

  el.appendChild(deck);
  el.scrollTop = keep;
}

/* --- inspetor --- */

function stopRecording() { if (S.stopRec) { S.stopRec(); S.stopRec = null; } }

function headKey(btn) {
  return h("div", { class: "key", "data-cat": typeMeta(btn.type).cat }, [iconEl(btn.icon)]);
}

function refreshHead() {
  const btn = selected();
  const box = $(".insp-head .key");
  if (!btn || !box) return;
  box.replaceWith(headKey(btn));
  const small = $(".insp-head small");
  if (small) small.textContent = `${typeMeta(btn.type).group} · ${S.config.buttons.indexOf(btn) + 1} de ${S.config.buttons.length}`;
}

function renderInspector() {
  const box = $("#inspector");
  stopRecording();
  const btn = selected();
  if (!btn) {
    // deixa a gaveta terminar de deslizar antes de esvaziar o conteúdo
    clearTimeout(renderInspector.t);
    renderInspector.t = setTimeout(() => { if (!S.selId) box.innerHTML = ""; }, 260);
    return;
  }
  clearTimeout(renderInspector.t);
  box.innerHTML = "";
  const idx = S.config.buttons.indexOf(btn);
  const nameInput = h("input", {
    class: "name-input", value: btn.label || "", placeholder: "Nome do botão", maxlength: "40", spellcheck: "false",
    oninput: (e) => { btn.label = e.target.value; touch(); },
  });
  box.appendChild(h("div", { class: "insp-head" }, [
    headKey(btn),
    h("div", { class: "meta" }, [h("small", {}, `${typeMeta(btn.type).group} · ${idx + 1} de ${S.config.buttons.length}`), nameInput]),
    h("button", { class: "btn icon-btn ghost insp-close", title: "Fechar (Esc)", "aria-label": "Fechar", onclick: closeDetails, html: svg("x") }),
  ]));
  box.appendChild(actionSection(btn));
  box.appendChild(appearanceSection(btn));
  box.appendChild(h("div", { class: "insp-actions" }, [
    h("button", { class: "btn sm", onclick: duplicateSelected, html: `${svg("copy")}Duplicar` }),
    h("button", { class: "btn sm danger", onclick: removeSelected, html: `${svg("trash")}Remover` }),
  ]));
}

function field(label, control, note) {
  return h("div", { class: "field" }, [label ? h("label", {}, label) : null, control, note ? h("div", { class: "note" }, note) : null]);
}

/* ---- Ação ---- */

function actionSection(btn) {
  const sec = h("div", { class: "section" }, [h("h3", {}, "Ação")]);

  const groups = {};
  Object.entries(TYPES).forEach(([key, m]) => { (groups[m.group] = groups[m.group] || []).push([key, m]); });
  const select = h("select", { class: "in", onchange: (e) => changeType(btn, e.target.value) },
    Object.entries(groups).map(([g, items]) => h("optgroup", { label: g },
      items.map(([key, m]) => h("option", { value: key, selected: btn.type === key }, m.label)))));
  sec.appendChild(field("O que este botão faz", select));

  const meta = typeMeta(btn.type);
  switch (meta.kind) {
    case "path": sec.appendChild(pathFields(btn, meta)); break;
    case "app_picker": sec.appendChild(appPickerFields(btn)); break;
    case "hotkey": sec.appendChild(hotkeyFields(btn)); break;
    case "select":
      sec.appendChild(field(meta.valueLabel, h("select", { class: "in", onchange: (e) => { btn.value = e.target.value; touch(); } },
        meta.options.map(([v, l]) => h("option", { value: v, selected: btn.value === v }, l)))));
      break;
    case "text":
      sec.appendChild(field(meta.valueLabel, h("input", { class: "in", value: btn.value || "", spellcheck: "false", oninput: (e) => { btn.value = e.target.value; touch(); } })));
      break;
    case "steps": sec.appendChild(stepsFields(btn)); break;
    default:
      sec.appendChild(h("div", { class: "note", style: "color:var(--dim);font-size:12px" }, "Este botão não precisa de configuração."));
  }
  return sec;
}

function changeType(btn, type) {
  const oldKind = typeMeta(btn.type).kind, newKind = typeMeta(type).kind;
  btn.type = type;
  if (oldKind !== newKind || newKind === "select") btn.value = newKind === "select" ? (typeMeta(type).options[0][0]) : "";
  if (type !== "start_app") delete btn.app_name;
  if (type === "macro" && !btn.steps) btn.steps = [];
  touch();
  renderInspector();
}

function pathFields(btn, meta) {
  const input = h("input", { class: "in mono", value: btn.value || "", spellcheck: "false", placeholder: btn.type === "app" ? "C:\\Programas\\app.exe" : "comando ou caminho do script", oninput: (e) => { btn.value = e.target.value; touch(); } });
  const pickBtn = h("button", { class: "btn", html: `${svg("folder")}Escolher arquivo…`, onclick: async () => {
    pickBtn.disabled = true;
    try {
      const data = await api("/api/pick-file");
      if (data.path) { btn.value = data.path; touch(); renderInspector(); }
    } catch (e) { toast(e.message || "Nenhum arquivo escolhido"); }
    pickBtn.disabled = false;
  } });
  return h("div", {}, [field(meta.path, input), h("div", { class: "field" }, pickBtn)]);
}

function appPickerFields(btn) {
  const name = btn.app_name || btn.value;
  const chosen = h("div", { class: "chosen" }, [
    h("div", { class: "t" + (name ? "" : " empty") }, name || "Nenhum app selecionado"),
    h("button", { class: "btn sm", onclick: () => pickApp(btn), html: `${svg("search")}${name ? "Trocar" : "Escolher"}` }),
  ]);
  if (btn.value && !btn.app_name) resolveAppName(btn);
  return field("App instalado", chosen, "Lista os mesmos apps do Menu Iniciar — inclui apps da Microsoft Store, como o WhatsApp.");
}

async function resolveAppName(btn) {
  try {
    const apps = await loadApps(true);
    const hit = apps.find((a) => a.app_id === btn.value);
    if (hit && !btn.app_name && selected() === btn) { btn.app_name = hit.name; renderInspector(); renderCanvas(); }
  } catch (e) { /* mantém o id */ }
}

function loadApps(quiet) {
  if (S.apps) return Promise.resolve(S.apps);
  if (!S.appsPromise) {
    S.appsPromise = api("/api/installed-apps").then((d) => (S.apps = d.apps || [])).finally(() => { S.appsPromise = null; });
  }
  return S.appsPromise;
}

function pickApp(btn) {
  const list = h("div", { class: "applist" }, h("div", { class: "empty" }, "Carregando lista de apps…"));
  const search = h("input", { class: "in", placeholder: "Buscar pelo nome…", oninput: () => render(), spellcheck: "false" });
  const body = h("div", {}, [search, list]);
  const m = openModal({ title: "Escolher app instalado", sub: "Os apps do Menu Iniciar do seu PC.", body, buttons: [{ label: "Cancelar" }] });
  setTimeout(() => search.focus(), 30);

  function render() {
    list.innerHTML = "";
    const q = search.value.trim().toLowerCase();
    const apps = (S.apps || []).filter((a) => a.name.toLowerCase().includes(q)).slice(0, 60);
    if (!apps.length) { list.appendChild(h("div", { class: "empty" }, "Nada encontrado.")); return; }
    apps.forEach((a) => list.appendChild(h("button", { onclick: () => choose(a) }, [
      h("span", { class: "av" }, a.name.charAt(0).toUpperCase()), h("span", {}, a.name),
    ])));
  }
  function choose(a) {
    btn.value = a.app_id;
    btn.app_name = a.name;
    if (!btn.label || btn.label === "Novo botão") btn.label = a.name;
    m.close();
    touch();
    renderInspector();
    extractIcon(btn, a.app_id, true);
  }
  loadApps().then(render).catch((e) => {
    list.innerHTML = "";
    list.appendChild(h("div", { class: "empty" }, e.message || "Não consegui listar os apps (só funciona no Windows)."));
  });
}

async function extractIcon(btn, path, quiet) {
  try {
    const data = await post("/api/extract-icon", { path });
    if (data.icon_url) {
      btn.icon = data.icon_url;
      touch();
      if (selected() === btn) renderInspector();
      if (quiet) toast("Ícone do app aplicado");
    }
  } catch (e) {
    if (!quiet) toast(e.message || "Não foi possível extrair o ícone");
  }
}

function hotkeyFields(btn) {
  const combo = h("div", { class: "combo" });
  function renderCombo() {
    combo.classList.remove("recording");
    combo.innerHTML = "";
    const parts = comboParts(btn.value);
    if (!parts.length) { combo.appendChild(h("span", { class: "none" }, "Nenhum atalho definido")); return; }
    parts.forEach((p, i) => {
      if (i) combo.appendChild(h("span", { class: "plus" }, "+"));
      combo.appendChild(h("span", { class: "kcap" }, prettyKey(p)));
    });
  }
  renderCombo();

  const manual = h("input", { class: "in mono", value: btn.value || "", spellcheck: "false", placeholder: "ex: ctrl+shift+m", oninput: (e) => { btn.value = e.target.value.trim().toLowerCase(); renderCombo(); touch(); } });
  const recBtn = h("button", { class: "btn", html: `${svg("record")}Gravar atalho` });

  recBtn.addEventListener("click", () => {
    if (S.stopRec) { stopRecording(); renderCombo(); recBtn.innerHTML = `${svg("record")}Gravar atalho`; return; }
    combo.classList.add("recording");
    combo.innerHTML = "";
    combo.appendChild(h("span", { class: "rec-dot" }));
    combo.appendChild(h("span", { class: "none", style: "color:var(--text)" }, "Pressione a combinação… (Esc cancela)"));
    recBtn.innerHTML = `${svg("x")}Cancelar`;
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(ev.key)) return;
      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
        stopRecording(); renderCombo(); recBtn.innerHTML = `${svg("record")}Gravar atalho`; return;
      }
      const parts = [];
      if (ev.ctrlKey) parts.push("ctrl");
      if (ev.altKey) parts.push("alt");
      if (ev.shiftKey) parts.push("shift");
      if (ev.metaKey) parts.push("windows");
      parts.push(keyName(ev));
      btn.value = parts.join("+");
      stopRecording();
      touch();
      renderInspector();
    };
    window.addEventListener("keydown", onKey, true);
    S.stopRec = () => window.removeEventListener("keydown", onKey, true);
  });

  return h("div", {}, [
    field("Atalho", combo),
    h("div", { class: "field" }, h("div", { class: "row" }, [recBtn,
      h("button", { class: "btn ghost", onclick: () => { btn.value = ""; touch(); renderInspector(); }, html: "Limpar" })])),
    field("Ou digite", manual, "A tecla Windows nem sempre é capturada — digite “windows+d”, por exemplo."),
  ]);
}

function stepsFields(btn) {
  if (!btn.steps) btn.steps = [];
  const wrap = h("div", { class: "steps" });
  btn.steps.forEach((step, i) => {
    const sm = typeMeta(step.type);
    const typeSel = h("select", { class: "in", onchange: (e) => { step.type = e.target.value; step.value = e.target.value === "delay" ? 300 : ""; touch(); renderInspector(); } },
      STEP_TYPES.map((t) => h("option", { value: t, selected: step.type === t }, t === "delay" ? "Esperar (ms)" : typeMeta(t).label)));
    let valueEl = null;
    if (step.type === "delay") valueEl = h("input", { class: "in mono", type: "number", min: "0", step: "50", value: step.value || 300, oninput: (e) => { step.value = parseInt(e.target.value, 10) || 0; touch(); } });
    else if (sm.kind === "select") valueEl = h("select", { class: "in", onchange: (e) => { step.value = e.target.value; touch(); } }, sm.options.map(([v, l]) => h("option", { value: v, selected: step.value === v }, l)));
    else if (sm.kind === "path" || sm.kind === "text" || sm.kind === "app_picker" || sm.kind === "hotkey") {
      const ph = sm.kind === "hotkey" ? "ex: ctrl+shift+m" : sm.kind === "app_picker" ? "ID do app (copie de um botão “Abrir app instalado”)" : (sm.path || sm.valueLabel || "valor");
      valueEl = h("input", { class: "in mono", value: step.value || "", placeholder: ph, spellcheck: "false", oninput: (e) => { step.value = e.target.value; touch(); } });
    }
    wrap.appendChild(h("div", { class: "step" }, [
      h("div", { class: "n" }, String(i + 1)),
      h("div", { class: "body" }, [typeSel, valueEl]),
      h("div", { class: "ops" }, [
        h("button", { class: "btn icon-btn", title: "Subir", disabled: i === 0, onclick: () => swapStep(btn, i, i - 1), html: svg("up") }),
        h("button", { class: "btn icon-btn", title: "Descer", disabled: i === btn.steps.length - 1, onclick: () => swapStep(btn, i, i + 1), html: svg("down") }),
        h("button", { class: "btn icon-btn danger", title: "Remover passo", onclick: () => { btn.steps.splice(i, 1); touch(); renderInspector(); }, html: svg("x") }),
      ]),
    ]));
  });
  if (!btn.steps.length) wrap.appendChild(h("div", { class: "note", style: "color:var(--dim);font-size:12px" }, "Uma macro roda várias ações em sequência."));
  wrap.appendChild(h("button", { class: "btn", onclick: () => { btn.steps.push({ type: "hotkey", value: "" }); touch(); renderInspector(); }, html: `${svg("plus")}Adicionar passo` }));
  return wrap;
}
function swapStep(btn, a, b) {
  [btn.steps[a], btn.steps[b]] = [btn.steps[b], btn.steps[a]];
  touch();
  renderInspector();
}

/* ---- Aparência ---- */

function appearanceSection(btn) {
  const sec = h("div", { class: "section" }, [h("h3", {}, "Aparência")]);
  const tab = S.iconTab || (isIconImage(btn.icon) ? "program" : isIconPreset(btn.icon) || !btn.icon ? "icons" : "emoji");
  S.iconTab = tab;

  const tabs = [["icons", "Ícones"], ["program", "Do programa"], ["emoji", "Emoji"]];
  sec.appendChild(h("div", { class: "seg" }, tabs.map(([k, l]) => h("button", { class: tab === k ? "on" : "", onclick: () => { S.iconTab = k; renderInspector(); } }, l))));

  if (tab === "icons") {
    sec.appendChild(h("div", { class: "icon-grid" }, Object.keys(ICON_PRESETS).map((key) =>
      h("button", { class: btn.icon === `preset:${key}` ? "on" : "", title: key, onclick: () => { btn.icon = `preset:${key}`; touch(); renderInspector(); }, html: presetSvg(key) }))));
  } else if (tab === "program") {
    const usable = ["app", "start_app", "script"].includes(btn.type) && btn.value;
    const box = h("div", { class: "extract" }, [
      isIconImage(btn.icon) ? h("img", { src: btn.icon, alt: "" }) : null,
      h("div", { class: "t" }, usable ? "Usa o ícone real do programa deste botão." : "Disponível para botões que abrem um programa — escolha o programa primeiro."),
      h("button", { class: "btn sm", disabled: !usable, onclick: () => extractIcon(btn, btn.value, false), html: `${svg("image")}Extrair` }),
    ]);
    sec.appendChild(box);
  } else {
    sec.appendChild(field("", h("input", {
      class: "in", maxlength: "4", placeholder: "Cole um emoji, ex: 🎮",
      value: isIconPreset(btn.icon) || isIconImage(btn.icon) ? "" : (btn.icon || ""),
      oninput: (e) => { btn.icon = e.target.value; touch(); },
    })));
  }
  return sec;
}

/* --- atalhos de teclado do editor (alternativa silenciosa ao mouse) --- */

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".backdrop")) return; // modal aberto cuida das próprias teclas
  if (S.stopRec) return; // gravando atalho: Esc cancela a gravação, não fecha a gaveta
  if (e.key === "Escape") {
    if (navIsOpen()) { closeNav(); return; }
    if (S.page === "buttons" && S.selId) { closeDetails(); }
    return;
  }
  if (S.page !== "buttons") return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); addButton(); return; }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === "Delete") { e.preventDefault(); removeSelected(); return; }
  const dirs = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  if (dirs[e.key] && S.selId) {
    e.preventDefault();
    const i = S.config.buttons.findIndex((b) => b.id === S.selId);
    const n = Math.max(0, Math.min(S.config.buttons.length - 1, i + dirs[e.key]));
    select(S.config.buttons[n].id);
  }
});

// Clique fora da gaveta de detalhes fecha. Clicar em outro botão só troca a seleção.
document.addEventListener("mousedown", (e) => {
  if (!S.selId || S.page !== "buttons") return;
  if (e.target.closest("#inspector, .key, .backdrop, .toast, .toolbar, .topbar, .sidebar, .nav-scrim")) return;
  closeDetails();
});

$("#addBtn").addEventListener("click", addButton);
$("#colsDown").addEventListener("click", () => setColumns((S.config.grid.columns || 4) - 1));
$("#colsUp").addEventListener("click", () => setColumns((S.config.grid.columns || 4) + 1));

/* ============================================================
   CELULAR e SISTEMA
   ============================================================ */

function renderUpdate(u, frozen) {
  const msg = $("#updMsg"), apply = $("#apply");
  msg.className = "msg";
  apply.hidden = true;
  $("#updBadge").hidden = u.status !== "available";
  $("#burgerDot").hidden = u.status !== "available";
  const link = u.release_url ? ` <a href="${u.release_url}" target="_blank" rel="noopener">Abrir página da versão</a>` : "";
  if (u.status === "checking") msg.textContent = "Verificando…";
  else if (u.status === "available") {
    if (u.asset_url && frozen) { msg.innerHTML = `Nova versão disponível: <b>${u.latest}</b>.`; msg.classList.add("good"); apply.hidden = false; }
    else msg.innerHTML = `Nova versão <b>${u.latest}</b> disponível — baixe o instalador na página de Releases.${link}`;
  } else if (u.status === "uptodate") { msg.textContent = "Você está na versão mais recente."; msg.classList.add("good"); }
  else if (u.status === "applying") msg.textContent = "Baixando e instalando…";
  else if (u.status === "applied") { msg.textContent = "Atualização instalada. Reiniciando o Deck…"; msg.classList.add("good"); }
  else if (u.status === "error") { msg.classList.add("bad"); msg.innerHTML = (u.error || "Não foi possível verificar.") + (u.needs_reinstall ? link : ""); }
  else msg.textContent = "Ainda não verificado.";
}

function applyInfo(i) {
  const first = !S.info;
  S.info = i;
  $("#dot").className = "dot on";
  $("#liveText").textContent = "no ar";
  $("#dotTop").className = "dot on";
  $("#liveTop").textContent = "no ar";
  $("#sideAddr").textContent = `${i.ip}:${i.port}`;
  $("#sideVer").textContent = `v${i.version}`;

  $("#url").textContent = i.url;
  $("#pin").textContent = i.pin;
  $("#pinBlock").hidden = !i.pin_required;
  const pr = $("#pinRequired");
  if (pr.checked !== i.pin_required && !pr.dataset.busy) pr.checked = i.pin_required;
  $("#devicesHint").textContent = i.devices === 0 ? "Nenhum celular pareado ainda." : i.devices === 1 ? "1 celular pareado." : `${i.devices} celulares pareados.`;
  $("#revoke").disabled = i.devices === 0;

  const as = $("#autostart");
  if (as.checked !== i.autostart && !as.dataset.busy) as.checked = i.autostart;
  $("#dataDir").textContent = i.data_dir;
  $("#ver").textContent = i.version + (i.version !== i.bundled_version ? ` (base ${i.bundled_version})` : "");
  renderUpdate(i.update, i.frozen);

  const key = `${i.url}|${i.pin}|${i.pin_required}`;
  if (key !== S.qrKey) {
    S.qrKey = key;
    const img = new Image();
    img.alt = "QR code para conectar o celular";
    img.onload = () => $("#qrBox").replaceChildren(img);
    img.onerror = () => { $("#qrBox").innerHTML = '<div class="fallback">QR indisponível.<br>Digite o endereço no celular.</div>'; };
    img.src = "/api/panel/qr.svg?k=" + encodeURIComponent(key);
  }
  if (first) {
    let stored = null;
    try { stored = localStorage.getItem("deck.page"); } catch (e) { /* sem storage */ }
    // Primeira vez (nenhum celular pareado e nada guardado): abre direto em "Celular", onde está o QR.
    go(stored || (i.devices === 0 ? "phone" : "buttons"));
  }
}

let infoBusy = false;
async function refreshInfo() {
  if (infoBusy) return;
  try { applyInfo(await api("/api/panel/info")); }
  catch (e) {
    $("#dot").className = "dot off"; $("#liveText").textContent = "sem resposta";
    $("#dotTop").className = "dot off"; $("#liveTop").textContent = "sem resposta";
  }
}

$("#copyUrl").onclick = async () => {
  try { await navigator.clipboard.writeText(S.info.url); toast("Endereço copiado"); } catch (e) { toast(S.info.url); }
};
$("#newPin").onclick = async () => { await post("/api/panel/pin/new"); await refreshInfo(); toast("Novo PIN gerado"); };
$("#pinRequired").onchange = async (e) => {
  const el = e.target, want = el.checked;
  el.dataset.busy = "1";
  if (!want && !(await confirmBox("Desligar o PIN?", "Sem PIN, qualquer aparelho na sua rede poderá usar os botões do Deck — atalhos, apps e scripts.", "Desligar mesmo assim", true))) {
    el.checked = true; delete el.dataset.busy; return;
  }
  try { await post("/api/panel/pin/required", { required: want }); } catch (err) { el.checked = !want; toast(err.message); }
  delete el.dataset.busy;
  refreshInfo();
};
$("#revoke").onclick = async () => {
  if (!(await confirmBox("Desconectar todos os celulares?", "Eles vão precisar do PIN novo para voltar a usar o Deck.", "Desconectar", true))) return;
  await post("/api/panel/devices/revoke");
  await refreshInfo();
  toast("Celulares desconectados");
};
$("#autostart").onchange = async (e) => {
  const el = e.target;
  el.dataset.busy = "1";
  try { await post("/api/panel/autostart", { enabled: el.checked }); toast(el.checked ? "O Deck vai iniciar com o Windows" : "Removido da inicialização"); }
  catch (err) { el.checked = !el.checked; toast(err.message); }
  delete el.dataset.busy;
};
$("#openDeck").onclick = () => post("/api/panel/open-deck").catch((e) => toast(e.message));
$("#openDesktop").onclick = () => post("/api/panel/open-desktop").catch((e) => toast(e.message));
$("#desktopAutostart").onchange = async (e) => {
  const el = e.target;
  try { await post("/api/panel/desktop-autostart", { enabled: el.checked }); toast(el.checked ? "A janela abre junto com o Deck" : "Abertura automática desativada"); }
  catch (err) { toast(err.message); el.checked = !el.checked; }
};
$("#openData").onclick = () => post("/api/panel/open-data").catch((e) => toast(e.message));

$("#check").onclick = async () => {
  const b = $("#check");
  b.disabled = true;
  $("#updMsg").className = "msg";
  $("#updMsg").textContent = "Verificando…";
  try { const u = await post("/api/panel/update/check"); renderUpdate(u, S.info && S.info.frozen); }
  catch (e) { $("#updMsg").className = "msg bad"; $("#updMsg").textContent = e.message; }
  b.disabled = false;
};
$("#apply").onclick = async () => {
  infoBusy = true;
  $("#apply").disabled = true;
  $("#check").disabled = true;
  $("#updMsg").className = "msg";
  $("#updMsg").textContent = "Baixando e instalando…";
  try {
    await post("/api/panel/update/apply");
    $("#updMsg").className = "msg good";
    $("#updMsg").textContent = "Atualização instalada. Reiniciando o Deck…";
    await post("/api/panel/restart");
    setTimeout(() => location.reload(), 9000);
  } catch (e) {
    infoBusy = false;
    $("#apply").disabled = false;
    $("#check").disabled = false;
    $("#updMsg").className = "msg bad";
    $("#updMsg").textContent = e.message;
  }
};

/* ---------- início ---------- */

(async function init() {
  setSave("saved");
  await Promise.all([
    loadConfig().catch((e) => { $("#canvas").appendChild(h("div", { class: "empty-state" }, [h("b", {}, "Não consegui carregar os botões"), e.message])); }),
    refreshInfo(),
  ]);
  setInterval(refreshInfo, 5000);
})();
