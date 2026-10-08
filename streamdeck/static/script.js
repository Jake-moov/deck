/* ---------- type metadata (drives the visual editor) ---------- */

const MEDIA_OPTIONS = [
  ["play_pause", "Play/Pause"],
  ["next", "Próxima faixa"],
  ["prev", "Faixa anterior"],
  ["vol_up", "Volume +"],
  ["vol_down", "Volume -"],
  ["mute", "Mudo"],
  ["stop", "Parar"],
];

const TYPE_META = {
  app:        { label: "Abrir programa (.exe)", valueLabel: "Caminho / nome do .exe", valueType: "text",   category: "app" },
  start_app:  { label: "Abrir app instalado",   valueLabel: "App",                     valueType: "app_picker", category: "app" },
  script:     { label: "Rodar script",         valueLabel: "Comando",                 valueType: "text",   category: "app" },
  hotkey:     { label: "Atalho de teclado",    valueLabel: "Ex: ctrl+shift+m",        valueType: "text",   category: "hotkey" },
  media:      { label: "Controle de mídia",    valueLabel: "Ação",                    valueType: "select", options: MEDIA_OPTIONS, category: "media" },
  mic_mute:   { label: "Mutar microfone (sistema)", valueLabel: null,                  valueType: "none",   category: "media" },
  obs_scene:  { label: "OBS · trocar cena",    valueLabel: "Nome da cena",            valueType: "text",   category: "obs" },
  obs_mute:   { label: "OBS · mutar fonte",    valueLabel: "Nome da fonte de áudio",  valueType: "text",   category: "obs" },
  obs_record: { label: "OBS · gravar",         valueLabel: null,                       valueType: "none",   category: "obs" },
  obs_stream: { label: "OBS · transmitir",     valueLabel: null,                       valueType: "none",   category: "obs" },
  macro:      { label: "Macro (sequência)",    valueLabel: null,                       valueType: "steps",  category: "macro" },
};

const STEP_TYPES = ["hotkey", "media", "app", "start_app", "script", "delay", "mic_mute", "obs_scene", "obs_mute", "obs_record", "obs_stream"];

function categoryOf(type) {
  return (TYPE_META[type] && TYPE_META[type].category) || "app";
}

function isIconImage(icon) {
  return typeof icon === "string" && (icon.startsWith("/") || icon.startsWith("http"));
}

function isIconPreset(icon) {
  return typeof icon === "string" && icon.startsWith("preset:");
}

// A small set of flat, single-stroke icons — picked for buttons instead of
// typing an emoji. Each is just inner <svg> markup, rendered at 24x24.
const ICON_PRESETS = {
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4.7 1.65 1.65 0 0 0 10 3.2V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  power:    '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  folder:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  terminal: '<path d="M4 5h16v14H4z"/><path d="M8 9l3 3-3 3"/><path d="M13 15h3"/>',
  mail:     '<path d="M3 5h18v14H3z"/><path d="M3 6l9 7 9-7"/>',
  chat:     '<path d="M4 4h16v12H8l-4 4z"/>',
  gamepad:  '<path d="M6 9h12l2 8a2 2 0 0 1-2 2 3 3 0 0 1-2.4-1.2L14 16h-4l-1.6 1.8A3 3 0 0 1 6 19a2 2 0 0 1-2-2z"/><path d="M9 11v3"/><path d="M7.5 12.5h3"/><path d="M16 11h.01"/><path d="M18.5 13h.01"/>',
  camera:   '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  video:    '<path d="M3 6h12v12H3z"/><path d="M15 9l6-3v12l-6-3z"/>',
  music:    '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  image:    '<path d="M3 4h18v16H3z"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5.5-5.5L9 17"/>',
  mic:      '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 19v3"/>',
  headphones: '<path d="M4 13a8 8 0 0 1 16 0"/><path d="M4 13h2v6H4z"/><path d="M18 13h2v6h-2z"/>',
  bell:     '<path d="M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  star:     '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
  heart:    '<path d="M12 21s-7-4.3-9.5-8.5C.7 9 2 5.5 5.5 5c2-.3 3.6.7 4.5 2.2C10.9 5.7 12.5 4.7 14.5 5c3.5.5 4.8 4 3 7.5C19 16.7 12 21 12 21z"/>',
  bolt:     '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  moon:     '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4 12H2"/><path d="M22 12h-2"/><path d="M5 5l1.5 1.5"/><path d="M17.5 17.5L19 19"/><path d="M19 5l-1.5 1.5"/><path d="M6.5 17.5L5 19"/>',
  link:     '<path d="M9 15l6-6"/><path d="M8 17l-3 3a3 3 0 0 1-4-4l3-3"/><path d="M16 7l3-3a3 3 0 0 1 4 4l-3 3"/>',
  lock:     '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  trash:    '<path d="M4 6h16"/><path d="M9 6V4h6v2"/><path d="M6 6l1 14h10l1-14"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
};

function renderPresetIcon(key, cls) {
  const wrap = document.createElement("span");
  wrap.className = cls || "icon-svg";
  const inner = ICON_PRESETS[key] || "";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return wrap;
}

// Renders an emoji <span>, an extracted <img>, or a built-in <svg> preset
function iconNode(icon) {
  if (isIconPreset(icon)) return renderPresetIcon(icon.slice(7));
  if (isIconImage(icon)) return h("img", { src: icon, class: "icon-img", alt: "" });
  return h("span", { class: "icon" }, icon || "•");
}

function genId() {
  return "btn_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
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
const gearBtn = document.getElementById("gearBtn");
const fsBtn = document.getElementById("fsBtn");
const editorOverlay = document.getElementById("editorOverlay");
const editorSheet = document.getElementById("editorSheet");
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
let draft = null; // editable clone while the editor is open

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
    grid.appendChild(h("div", { class: "empty" }, "Nenhum botão configurado.\nToque em ⚙ para adicionar."));
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
});

/* ---------- editor mode ---------- */

function openEditor() {
  draft = JSON.parse(JSON.stringify(config));
  if (!draft.grid) draft.grid = { columns: 3 };
  renderEditor();
  editorOverlay.classList.add("open");
}

function closeEditor() {
  editorOverlay.classList.remove("open");
  draft = null;
}

async function saveEditor() {
  const saveBtn = editorSheet.querySelector(".icon-btn.save");
  if (saveBtn) saveBtn.textContent = "…";
  try {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) throw new Error("save failed");
    config = draft;
    renderGrid();
    closeEditor();
  } catch (e) {
    if (saveBtn) saveBtn.textContent = "✕";
    console.error(e);
  }
}

function renderEditor() {
  editorSheet.innerHTML = "";

  const header = h("div", { class: "editor-header" }, [
    h("h2", {}, "EDITAR DECK"),
    h("div", { class: "actions" }, [
      h("button", { class: "icon-btn", onclick: closeEditor }, "✕"),
      h("button", { class: "icon-btn save", onclick: saveEditor }, "✓"),
    ]),
  ]);
  editorSheet.appendChild(header);

  editorSheet.appendChild(
    h("div", { class: "field-row" }, [
      h("label", {}, "Colunas"),
      h("input", {
        type: "number", min: "2", max: "5", value: String(draft.grid.columns || 3),
        oninput: (e) => { draft.grid.columns = parseInt(e.target.value, 10) || 3; },
      }),
    ])
  );

  const list = h("div", { class: "btn-list" });
  draft.buttons.forEach((btn, idx) => list.appendChild(renderButtonCard(btn, idx)));
  editorSheet.appendChild(list);

  editorSheet.appendChild(
    h("button", {
      class: "add-btn",
      onclick: () => {
        draft.buttons.push({ id: genId(), label: "Novo botão", icon: "⭐", type: "app", value: "" });
        renderEditor();
      },
    }, "+ Novo botão")
  );
}

function renderButtonCard(btn, idx) {
  const expanded = btn._open;
  const meta = TYPE_META[btn.type] || TYPE_META.app;

  const row = h("div", { class: "btn-card-row", onclick: () => { btn._open = !btn._open; renderEditor(); } }, [
    iconNode(btn.icon),
    h("div", { class: "meta" }, [
      h("div", { class: "lbl" }, btn.label || btn.id),
      h("div", { class: "typ" }, meta.label),
    ]),
    h("div", { class: "ops" }, [
      h("button", { class: "mini-btn", onclick: (e) => { e.stopPropagation(); moveButton(idx, -1); } }, "↑"),
      h("button", { class: "mini-btn", onclick: (e) => { e.stopPropagation(); moveButton(idx, 1); } }, "↓"),
      h("button", { class: "mini-btn danger", onclick: (e) => { e.stopPropagation(); removeButton(idx); } }, "🗑"),
    ]),
  ]);

  const card = h("div", { class: "btn-card" }, [row]);
  if (expanded) card.appendChild(renderButtonForm(btn, idx));
  return card;
}

function moveButton(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= draft.buttons.length) return;
  [draft.buttons[idx], draft.buttons[j]] = [draft.buttons[j], draft.buttons[idx]];
  renderEditor();
}

function removeButton(idx) {
  draft.buttons.splice(idx, 1);
  renderEditor();
}

function renderIconField(btn) {
  const frag = document.createDocumentFragment();

  frag.appendChild(h("div", { class: "field-row" }, [
    h("label", {}, "Emoji"),
    h("input", {
      value: isIconPreset(btn.icon) || isIconImage(btn.icon) ? "" : (btn.icon || ""),
      placeholder: "opcional, ex: 🎮",
      maxlength: "4",
      oninput: (e) => { btn.icon = e.target.value; },
    }),
  ]));

  const grid = h("div", { class: "icon-preset-grid" });
  grid.style.display = "none";
  let open = false;

  function renderGridItems() {
    grid.innerHTML = "";
    for (const key of Object.keys(ICON_PRESETS)) {
      grid.appendChild(h("button", {
        class: "icon-preset-item" + (btn.icon === `preset:${key}` ? " selected" : ""),
        onclick: (e) => { e.preventDefault(); btn.icon = `preset:${key}`; renderEditor(); },
      }, [renderPresetIcon(key)]));
    }
  }

  const toggleBtn = h("button", {
    class: "pc-only-btn",
    onclick: (e) => {
      e.preventDefault();
      open = !open;
      grid.style.display = open ? "grid" : "none";
      if (open) renderGridItems();
    },
  }, "🎨 Escolher ícone pronto");

  frag.appendChild(h("div", { class: "icon-preset-row" }, [toggleBtn, grid]));
  return frag;
}

function renderButtonForm(btn, idx) {
  const body = h("div", { class: "btn-card-body" });

  body.appendChild(renderIconField(btn));

  body.appendChild(h("div", { class: "field-row" }, [
    h("label", {}, "Nome"),
    h("input", { value: btn.label || "", oninput: (e) => { btn.label = e.target.value; } }),
  ]));

  const typeSelect = h("select", {
    onchange: (e) => {
      btn.type = e.target.value;
      if (btn.type === "macro" && !btn.steps) btn.steps = [];
      renderEditor();
    },
  }, Object.entries(TYPE_META).map(([key, m]) =>
    h("option", { value: key, ...(btn.type === key ? { selected: "selected" } : {}) }, m.label)
  ));
  body.appendChild(h("div", { class: "field-row" }, [h("label", {}, "Tipo"), typeSelect]));

  const meta = TYPE_META[btn.type] || TYPE_META.app;

  if (meta.valueType === "text") {
    body.appendChild(h("div", { class: "field-row" }, [
      h("label", {}, meta.valueLabel),
      h("input", { value: btn.value || "", oninput: (e) => { btn.value = e.target.value; } }),
    ]));
    if (btn.type === "app" || btn.type === "script") {
      body.appendChild(renderPickFileRow(btn));
      body.appendChild(renderIconExtractRow(btn));
    }
    if (btn.type === "hotkey") {
      body.appendChild(renderHotkeyRecordRow(btn));
    }
  } else if (meta.valueType === "select") {
    body.appendChild(h("div", { class: "field-row" }, [
      h("label", {}, meta.valueLabel),
      h("select", { onchange: (e) => { btn.value = e.target.value; } },
        meta.options.map(([val, lbl]) => h("option", { value: val, ...(btn.value === val ? { selected: "selected" } : {}) }, lbl))
      ),
    ]));
  } else if (meta.valueType === "app_picker") {
    body.appendChild(renderAppPicker(btn));
    body.appendChild(renderIconExtractRow(btn));
  } else if (meta.valueType === "steps") {
    body.appendChild(renderStepsEditor(btn, idx));
  }

  return body;
}

let appListCache = null; // fetched once per editor session, reused across buttons

function renderAppPicker(btn) {
  const wrap = document.createDocumentFragment();

  wrap.appendChild(h("div", { class: "field-row" }, [
    h("label", {}, "App"),
    h("input", {
      value: btn.value ? (btn._appName || btn.value) : "",
      readonly: "readonly",
      placeholder: "nenhum selecionado",
    }),
  ]));

  if (btn.value) {
    wrap.appendChild(renderIconExtractRow(btn));
  }

  const status = h("span", {}, "🔎 Escolher app instalado");
  const listBox = h("div", { class: "app-picker-list" });
  let open = false;

  const searchInput = h("input", {
    class: "app-picker-search",
    placeholder: "Buscar pelo nome…",
    oninput: (e) => filterList(e.target.value),
  });

  function filterList(query) {
    const q = query.trim().toLowerCase();
    listBox.innerHTML = "";
    if (!appListCache) return;
    const matches = appListCache.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 40);
    if (!matches.length) {
      listBox.appendChild(h("div", { class: "app-picker-empty" }, "nada encontrado"));
      return;
    }
    for (const a of matches) {
      listBox.appendChild(h("button", {
        class: "app-picker-item",
        onclick: (e) => {
          e.preventDefault();
          btn.value = a.app_id;
          btn._appName = a.name;
          if (!btn.label || btn.label === "Novo botão") btn.label = a.name;
          renderEditor();
          autoFetchAppIcon(btn, a.app_id);
        },
      }, a.name));
    }
  }

  const toggleBtn = h("button", {
    class: "pc-only-btn",
    onclick: async (e) => {
      e.preventDefault();
      open = !open;
      if (!open) { listBox.style.display = "none"; searchInput.style.display = "none"; return; }
      listBox.style.display = "flex";
      searchInput.style.display = "block";
      if (!appListCache) {
        status.textContent = "Carregando lista de apps…";
        try {
          const res = await fetch("/api/installed-apps");
          const data = await res.json();
          if (!res.ok) {
            status.textContent = data.error || "Falha ao listar apps";
            return;
          }
          appListCache = data.apps;
          status.textContent = "🔎 Escolher app instalado";
          filterList("");
        } catch (err) {
          status.textContent = "Falha — só funciona rodando no Windows";
        }
      } else {
        filterList(searchInput.value);
      }
    },
  }, [status]);

  listBox.style.display = "none";
  searchInput.style.display = "none";

  wrap.appendChild(h("div", { class: "pc-only-row" }, [toggleBtn]));
  wrap.appendChild(h("div", { class: "pc-only-hint" }, "lista os mesmos apps do Menu Iniciar — funciona também para apps da Microsoft Store, como o WhatsApp. Só disponível editando pelo navegador do próprio PC."));
  wrap.appendChild(searchInput);
  wrap.appendChild(listBox);
  return wrap;
}

async function autoFetchAppIcon(btn, app_id) {
  // Runs right after picking an app from the "Abrir app instalado" search —
  // pulls its real icon automatically, no extra tap needed. Fails silently
  // (keeps whatever emoji was already there) since this is a background nicety.
  try {
    const res = await fetch("/api/extract-icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: app_id }),
    });
    const data = await res.json();
    if (res.ok && data.icon_url) {
      btn.icon = data.icon_url;
      renderEditor();
    }
  } catch (err) { /* keep the emoji fallback */ }
}

function renderIconExtractRow(btn) {
  const preview = isIconImage(btn.icon) ? h("img", { class: "extract-preview", src: btn.icon, alt: "" }) : null;
  const status = h("span", {}, "🖼 Usar ícone do programa");

  const btnEl = h("button", {
    class: "extract-btn",
    onclick: async (e) => {
      e.preventDefault();
      if (!btn.value) return;
      status.textContent = "Extraindo…";
      try {
        const res = await fetch("/api/extract-icon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: btn.value }),
        });
        const data = await res.json();
        if (res.ok && data.icon_url) {
          btn.icon = data.icon_url;
          renderEditor();
        } else {
          status.textContent = data.error || "Não foi possível extrair o ícone";
        }
      } catch (err) {
        status.textContent = "Falha ao extrair — servidor sem pywin32?";
      }
    },
  }, [status]);

  const row = h("div", { class: "extract-row" }, [btnEl]);
  if (preview) row.insertBefore(preview, btnEl);
  return row;
}

function renderPickFileRow(btn) {
  const label = h("span", {}, "📂 Escolher arquivo no PC");
  const btnEl = h("button", {
    class: "pc-only-btn",
    onclick: async (e) => {
      e.preventDefault();
      label.textContent = "Abrindo seletor no PC…";
      try {
        const res = await fetch("/api/pick-file");
        const data = await res.json();
        if (res.ok && data.path) {
          btn.value = data.path;
          renderEditor();
        } else {
          label.textContent = data.error || "Nenhum arquivo escolhido";
          setTimeout(() => { label.textContent = "📂 Escolher arquivo no PC"; }, 2500);
        }
      } catch (err) {
        label.textContent = "Falha — só funciona rodando no Windows";
        setTimeout(() => { label.textContent = "📂 Escolher arquivo no PC"; }, 2500);
      }
    },
  }, [label]);

  const wrap = document.createDocumentFragment();
  wrap.appendChild(h("div", { class: "pc-only-row" }, [btnEl]));
  wrap.appendChild(h("div", { class: "pc-only-hint" }, "abre a janela de arquivos do Windows — só funciona se você estiver editando pelo navegador do próprio PC"));
  return wrap;
}

function renderHotkeyRecordRow(btn) {
  const label = h("span", {}, "⌨ Gravar atalho");
  const btnEl = h("button", {
    class: "pc-only-btn",
    onclick: (e) => {
      e.preventDefault();
      btnEl.classList.add("recording");
      label.textContent = "Pressione a combinação…";

      const handler = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (["Control", "Shift", "Alt", "Meta"].includes(ev.key)) return; // wait for the real key
        const parts = [];
        if (ev.ctrlKey) parts.push("ctrl");
        if (ev.altKey) parts.push("alt");
        if (ev.shiftKey) parts.push("shift");
        if (ev.metaKey) parts.push("windows");
        parts.push(normalizeKeyName(ev.key));
        btn.value = parts.join("+");
        window.removeEventListener("keydown", handler, true);
        renderEditor();
      };
      window.addEventListener("keydown", handler, true);
    },
  }, [label]);

  const wrap = document.createDocumentFragment();
  wrap.appendChild(h("div", { class: "pc-only-row" }, [btnEl]));
  wrap.appendChild(h("div", { class: "pc-only-hint" }, "captura a tecla pressionada no teclado do PC — só funciona editando pelo navegador do próprio PC"));
  return wrap;
}

function normalizeKeyName(key) {
  const map = {
    " ": "space", "Escape": "esc", "ArrowUp": "up", "ArrowDown": "down",
    "ArrowLeft": "left", "ArrowRight": "right", "Enter": "enter",
    "Backspace": "backspace", "Tab": "tab", "Delete": "delete",
  };
  if (map[key]) return map[key];
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function renderStepsEditor(btn) {
  if (!btn.steps) btn.steps = [];
  const wrap = h("div", { class: "steps-list" });

  btn.steps.forEach((step, sIdx) => {
    const stepMeta = TYPE_META[step.type] || { valueType: "text", valueLabel: "Valor" };
    const row = h("div", { class: "step-row" });

    row.appendChild(h("select", {
      onchange: (e) => { step.type = e.target.value; renderEditor(); },
    }, STEP_TYPES.map((t) =>
      h("option", { value: t, ...(step.type === t ? { selected: "selected" } : {}) }, t === "delay" ? "espera (ms)" : (TYPE_META[t] ? TYPE_META[t].label : t))
    )));

    if (step.type === "delay") {
      row.appendChild(h("input", { type: "number", value: step.value || 300, oninput: (e) => { step.value = parseInt(e.target.value, 10) || 0; } }));
    } else if (stepMeta.valueType === "select") {
      row.appendChild(h("select", { onchange: (e) => { step.value = e.target.value; } },
        stepMeta.options.map(([val, lbl]) => h("option", { value: val, ...(step.value === val ? { selected: "selected" } : {}) }, lbl))
      ));
    } else if (stepMeta.valueType === "text" || stepMeta.valueType === "app_picker") {
      row.appendChild(h("input", { value: step.value || "", placeholder: stepMeta.valueType === "app_picker" ? "AppID (copie do botão principal)" : stepMeta.valueLabel, oninput: (e) => { step.value = e.target.value; } }));
    }

    row.appendChild(h("button", { class: "mini-btn danger", onclick: () => { btn.steps.splice(sIdx, 1); renderEditor(); } }, "✕"));
    wrap.appendChild(row);
  });

  wrap.appendChild(h("button", {
    class: "add-step-btn",
    onclick: () => { btn.steps.push({ type: "hotkey", value: "" }); renderEditor(); },
  }, "+ adicionar passo"));

  return wrap;
}

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
  }).catch(() => {});
}

setInterval(fetchAppVolumes, 4000);
fetchAppVolumes();

/* ---------- now playing (Spotify mini player) ---------- */

const nowPlayingEl = document.getElementById("nowPlaying");
const npArt = document.getElementById("npArt");
const npTitle = document.getElementById("npTitle");
const npArtist = document.getElementById("npArtist");
const npPlayPause = document.getElementById("npPlayPause");
const npPrev = document.getElementById("npPrev");
const npNext = document.getElementById("npNext");
const npProgressFill = document.getElementById("npProgressFill");

let lastThumbUrl = null;

async function fetchNowPlaying() {
  try {
    const res = await fetch("/api/nowplaying");
    const data = await res.json();
    if (!res.ok) {
      nowPlayingEl.classList.remove("show");
      console.warn("Spotify (now playing) indisponível:", data.error);
      return;
    }
    if (!data.title) {
      nowPlayingEl.classList.remove("show"); // nothing playing right now — not an error
      return;
    }
    nowPlayingEl.classList.add("show");
    npTitle.textContent = data.title || "—";
    npArtist.textContent = data.artist || "—";
    npPlayPause.textContent = data.playing ? "⏸" : "▶";
    if (data.duration_ms) {
      const pct = Math.min(100, (100 * (data.progress_ms || 0)) / data.duration_ms);
      npProgressFill.style.width = `${pct}%`;
    }
    if (data.thumbnail_url && data.thumbnail_url !== lastThumbUrl) {
      npArt.src = data.thumbnail_url;
      lastThumbUrl = data.thumbnail_url;
    }
  } catch (e) {
    nowPlayingEl.classList.remove("show");
    console.warn("Não foi possível falar com o servidor:", e);
  }
}

function sendNowPlayingControl(action) {
  vibrate(15);
  fetch("/api/nowplaying/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  })
    .then(() => setTimeout(fetchNowPlaying, 300)) // let Spotify catch up, then refresh
    .catch((e) => console.warn("Falha no controle do Spotify:", e));
}

npPlayPause.addEventListener("click", () => sendNowPlayingControl("play_pause"));
npPrev.addEventListener("click", () => sendNowPlayingControl("previous"));
npNext.addEventListener("click", () => sendNowPlayingControl("next"));

setInterval(fetchNowPlaying, 3000);
fetchNowPlaying();

/* ---------- wire up ---------- */

gearBtn.addEventListener("click", openEditor);
editorOverlay.addEventListener("click", (e) => { if (e.target === editorOverlay) closeEditor(); });

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
