/* Ícones compartilhados entre o celular (script.js) e o app do PC (panel.js). */

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

function isIconImage(icon) {
  return typeof icon === "string" && (icon.startsWith("/") || icon.startsWith("http"));
}

function isIconPreset(icon) {
  return typeof icon === "string" && icon.startsWith("preset:");
}

/** Marcação <svg> de um ícone pronto (a cor vem do `currentColor`). */
function presetSvg(key) {
  const inner = ICON_PRESETS[key] || "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
