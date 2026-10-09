"""
Deck server — a lightweight Stream Deck replacement controlled from your phone.

Run:  python server.py           (dev)
      Deck.exe                   (built with build.bat, or via the tray app)
Then open http://<your-notebook-ip>:8765 on your phone (same Wi-Fi).

Memory footprint: this is a single-process FastAPI/uvicorn server with no GUI —
typically well under 50MB RAM, since all rendering happens in your phone's browser.
"""

import gc
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
import keyboard


# Versão do programa. É a única fonte da verdade: o make_update.py lê esta linha ao gerar o pacote.
APP_VERSION = "1.1.3"
# Versão embutida no .exe (não muda quando um pacote de atualização é carregado por cima).
_BUNDLED_VERSION = globals().get("_BUNDLED_VERSION") or APP_VERSION

GITHUB_REPO = "Jake-moov/deck"
UPDATE_ASSET = "deck-update.zip"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "DeckServer"


def _ver(v: str) -> tuple:
    """'v1.2.3' -> (1, 2, 3, 0) — para comparar versões."""
    nums = [int(x) for x in re.findall(r"\d+", str(v))[:4]]
    return tuple(nums + [0] * (4 - len(nums)))


def app_dir() -> Path:
    """Pasta do Deck.exe (quando compilado) ou deste arquivo (dev)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def data_dir() -> Path:
    """Dados de cada pessoa (config.json, icons, PIN, atualizações). Fica em %APPDATA%\\Deck
    quando compilado, separado do programa — assim atualizar ou reinstalar nunca apaga os botões.
    Em modo dev continua ao lado do server.py."""
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA")
        d = (Path(base) if base else Path.home() / "AppData" / "Roaming") / "Deck"
        d.mkdir(parents=True, exist_ok=True)
        return d
    return Path(__file__).parent


def update_dir() -> Path:
    return data_dir() / "update"


def active_update_pack():
    """Pasta do pacote de atualização baixado, se ele for mais novo que o .exe instalado."""
    if not getattr(sys, "frozen", False):
        return None
    pack = update_dir()
    try:
        info = json.loads((pack / "update.json").read_text(encoding="utf-8"))
        if _ver(info.get("version", "0")) > _ver(_BUNDLED_VERSION) and (pack / "static" / "index.html").exists():
            return pack
    except Exception:
        pass
    return None


def bundled_static_dir() -> Path:
    """Arquivos web. Um pacote de atualização mais novo tem prioridade sobre a cópia embutida no .exe."""
    if getattr(sys, "frozen", False):
        pack = active_update_pack()
        if pack is not None:
            return pack / "static"
        return Path(sys._MEIPASS) / "static"
    return Path(__file__).parent / "static"


def _documents_dir() -> Path:
    """Pasta Documentos real (pode estar redirecionada para o OneDrive)."""
    try:
        import ctypes
        from ctypes import wintypes
        shell32 = ctypes.WinDLL("shell32")
        fn = shell32.SHGetFolderPathW
        fn.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR]
        fn.restype = ctypes.c_long  # HRESULT
        buf = ctypes.create_unicode_buffer(260)
        if fn(None, 5, None, 0, buf) == 0 and buf.value:  # CSIDL_PERSONAL
            return Path(buf.value)
    except Exception:
        pass
    return Path.home() / "Documents"


def _legacy_data_candidates() -> list:
    """Onde a versão antiga (Deck.exe solto numa pasta) guardava config.json, icons etc."""
    docs = _documents_dir()
    candidates = [app_dir()]
    local = os.environ.get("LOCALAPPDATA")
    if local:
        # instalador anterior (dados ao lado do .exe, em %LOCALAPPDATA%\\Deck): é a cópia mais recente
        candidates.append(Path(local) / "Deck")
    return candidates + [docs / "Deck" / "dist", docs / "Deck"]


def _migrate_legacy_data() -> None:
    """Primeira abertura da versão com instalador: copia config.json, icons e thumbs da versão
    antiga (ao lado do Deck.exe antigo, ex.: Documentos\\Deck\\dist) para %APPDATA%\\Deck.
    Copia (não move): o original fica intacto."""
    if not getattr(sys, "frozen", False):
        return
    new = data_dir()
    try:
        if (new / ".migrated").exists() or (new / "config.json").exists():
            return
        for old in _legacy_data_candidates():
            try:
                if not old.is_dir() or old.resolve() == new.resolve():
                    continue
                files = [n for n in ("config.json",) if (old / n).is_file()]
                folders = [n for n in ("icons", "thumbs") if (old / n).is_dir()]
                if not (old / "config.json").is_file() and not folders:
                    continue
                for n in files:
                    shutil.copy2(old / n, new / n)
                for n in folders:
                    shutil.copytree(old / n, new / n, dirs_exist_ok=True)
                (new / ".migrated").write_text(f"Dados copiados de {old}\n", encoding="utf-8")
                return
            except OSError:
                continue
    except Exception:
        try:
            with open(new / "deck_error.log", "a", encoding="utf-8") as f:
                import traceback
                f.write("\n[migração de dados falhou]\n" + traceback.format_exc())
        except Exception:
            pass


_migrate_legacy_data()

# O login do Spotify foi removido (a Central de Mídia do Windows cobre tudo): apaga o token que sobrou.
try:
    (data_dir() / "spotify_token.json").unlink(missing_ok=True)
except OSError:
    pass

CONFIG_PATH = data_dir() / "config.json"
STATIC_DIR = bundled_static_dir()
ICONS_DIR = data_dir() / "icons"
ICONS_DIR.mkdir(exist_ok=True)

DEFAULT_CONFIG = {
    "grid": {"columns": 3},
    "obs": {"enabled": False, "host": "localhost", "port": 4455, "password": ""},
    "buttons": [
        {"id": "notepad", "label": "Notepad", "icon": "📝", "type": "app", "value": "notepad.exe"},
        {"id": "chrome", "label": "Chrome", "icon": "🌐", "type": "app", "value": "chrome.exe"},
        {"id": "explorer", "label": "Files", "icon": "📁", "type": "app", "value": "explorer.exe"},
        {"id": "play_pause", "label": "Play/Pause", "icon": "⏯", "type": "media", "value": "play_pause"},
        {"id": "vol_up", "label": "Vol +", "icon": "🔊", "type": "media", "value": "vol_up"},
        {"id": "vol_down", "label": "Vol -", "icon": "🔉", "type": "media", "value": "vol_down"},
        {"id": "mute_mic", "label": "Mute Mic", "icon": "🎙", "type": "mic_mute"},
        {"id": "screenshot", "label": "Print", "icon": "📸", "type": "hotkey", "value": "win+shift+s"},
        {"id": "lock", "label": "Bloquear", "icon": "🔒", "type": "hotkey", "value": "win+l"},
        {"id": "backup_script", "label": "Backup", "icon": "🗂", "type": "script", "value": "C:\\scripts\\backup.bat"},
        {"id": "stream_start", "label": "Iniciar Live", "icon": "🚀", "type": "macro", "steps": [
            {"type": "obs_scene", "value": "Main"},
            {"type": "delay", "value": 500},
            {"type": "obs_stream"},
        ]},
        {"id": "obs_scene_main", "label": "Cena: Main", "icon": "🎬", "type": "obs_scene", "value": "Main"},
        {"id": "obs_toggle_mic", "label": "OBS Mic", "icon": "🎚", "type": "obs_mute", "value": "Mic/Aux"},
        {"id": "obs_record", "label": "Gravar", "icon": "⏺", "type": "obs_record"},
    ],
}

app = FastAPI()

# ---------- Pareamento por PIN ----------
#
# O servidor escuta na rede local inteira e os botões executam atalhos, scripts e apps no PC.
# Por isso o celular precisa parear uma vez com o PIN (mostrado no painel do PC). Acessos vindos
# do próprio PC (127.0.0.1) nunca precisam de PIN.

AUTH_PATH = data_dir() / "auth.json"
_auth_lock = threading.Lock()
_auth_cache: dict = {}
_pair_attempts: dict = {}  # ip -> [falhas, bloqueado_até]
COOKIE_NAME = "deck_token"
PUBLIC_PATHS = {
    "/pair", "/api/auth/pair", "/manifest.json", "/static/manifest.json",
    "/static/icon-192.png", "/static/icon-512.png", "/favicon.ico",
}


def _new_pin() -> str:
    return f"{secrets.randbelow(10 ** 6):06d}"


def _auth() -> dict:
    with _auth_lock:
        if not _auth_cache:
            try:
                data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
            except Exception:
                data = {}
            changed = False
            if not re.fullmatch(r"\d{6}", str(data.get("pin", ""))):
                data["pin"] = _new_pin()
                changed = True
            if "required" not in data:
                data["required"] = True
                changed = True
            if not isinstance(data.get("tokens"), list):
                data["tokens"] = []
                changed = True
            _auth_cache.update(data)
            if changed:
                AUTH_PATH.write_text(json.dumps(_auth_cache, indent=2), encoding="utf-8")
        return _auth_cache


def _auth_save() -> None:
    with _auth_lock:
        AUTH_PATH.write_text(json.dumps(_auth_cache, indent=2), encoding="utf-8")


def _is_loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost") or host.startswith("::ffff:127.")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _scope_cookie(scope) -> str:
    for k, v in scope.get("headers", []):
        if k == b"cookie":
            from http.cookies import SimpleCookie
            c = SimpleCookie()
            try:
                c.load(v.decode("latin-1"))
            except Exception:
                return ""
            if COOKIE_NAME in c:
                return c[COOKIE_NAME].value
    return ""


def _token_ok(scope) -> bool:
    token = _scope_cookie(scope)
    if not token:
        return False
    h = _token_hash(token)
    return any(t.get("h") == h for t in _auth().get("tokens", []))


class AuthMiddleware:
    """Middleware ASGI puro (cobre HTTP e WebSocket)."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.inner(scope, receive, send)
        client = (scope.get("client") or ("", 0))[0] or ""
        path = scope.get("path", "")
        if _is_loopback(client) or path in PUBLIC_PATHS or not _auth().get("required", True) or _token_ok(scope):
            return await self.inner(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return
        accepts_html = any(k == b"accept" and b"text/html" in v for k, v in scope.get("headers", []))
        if path == "/" or accepts_html:
            resp = RedirectResponse("/pair")
        else:
            resp = JSONResponse({"error": "não pareado"}, status_code=401)
        await resp(scope, receive, send)


app.add_middleware(AuthMiddleware)



@app.middleware("http")
async def no_cache_for_static(request, call_next):
    """Phones (and browsers in general) tend to cache aggressively by URL —
    this silently hides updates until forced to clear, whether it's the app's
    JS/CSS or an icon that got re-extracted at the same /icons/<hash>.png URL
    after a fix like this one. Always fetch the latest version of everything."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/") or path.startswith("/icons/") or path.startswith("/thumbs/") or path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# OBS client is created lazily and only if obs.enabled is true in config.json
_obs_client = None

MEDIA_KEYS = {
    "play_pause": "play/pause media",
    "next": "next track",
    "prev": "previous track",
    "vol_up": "volume up",
    "vol_down": "volume down",
    "mute": "volume mute",
    "stop": "stop media",
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_obs_client(cfg: dict):
    """Lazily connects to OBS's built-in websocket server (OBS 28+, Tools > obs-websocket Settings)."""
    global _obs_client
    if _obs_client is not None:
        return _obs_client

    obs_cfg = cfg.get("obs") or {}
    if not obs_cfg.get("enabled"):
        return None

    try:
        import obsws_python as obs
        _obs_client = obs.ReqClient(
            host=obs_cfg.get("host", "localhost"),
            port=obs_cfg.get("port", 4455),
            password=obs_cfg.get("password", ""),
            timeout=3,
        )
        return _obs_client
    except Exception as e:
        # print() would crash here in a --windowed build (no stdout at all,
        # not just no visible console) — safe no-op write instead.
        try:
            sys.stderr.write(f"[OBS] connection failed: {e}\n")
        except Exception:
            pass
        return None


def _send_hotkey(value: str, hold: float = 0.05) -> None:
    """Aperta as teclas com pequenas pausas. O Discord (e alguns jogos) ignoram
    atalhos injetados quando tudo é pressionado/solto no mesmo instante."""
    value = value.strip()
    if value.endswith("++"):
        keys = [k.strip() for k in value[:-2].split("+") if k.strip()] + ["+"]
    else:
        keys = [k.strip() for k in value.split("+") if k.strip()]
    pressed = []
    try:
        for k in keys:
            keyboard.press(k)
            pressed.append(k)
            time.sleep(hold)
        time.sleep(hold)
    finally:
        for k in reversed(pressed):
            keyboard.release(k)
            time.sleep(hold)


def run_action(btn: dict, cfg: dict) -> None:
    action_type = btn.get("type")
    value = btn.get("value")

    if action_type == "delay":
        # value: milliseconds — only meaningful inside a macro's steps
        time.sleep(max(0, float(value or 0)) / 1000)
        return

    if action_type == "app":
        # value: an .exe on PATH, or a full path to a program/file/URL
        if os.name == "nt":
            os.startfile(value)
        else:
            subprocess.Popen(value, shell=True)

    elif action_type == "start_app":
        # value: an AppID/AUMID from Get-StartApps — the same mechanism the
        # real Start Menu uses. Required for Microsoft Store / UWP apps
        # (WhatsApp, Store-installed Spotify, etc.) since their .exe lives in
        # a locked-down WindowsApps folder that a normal process usually
        # can't read or execute directly. Works for ordinary desktop apps too.
        subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{value}"])

    elif action_type == "script":
        # value: any shell command/script, with args — for custom automations
        subprocess.Popen(value, shell=True)

    elif action_type == "macro":
        # steps: an ordered list of the same action dicts (no nested macros)
        for step in btn.get("steps", []):
            run_action(step, cfg)

    elif action_type == "hotkey":
        # value: e.g. "ctrl+shift+m", "win+l", "win+shift+s"
        _send_hotkey(value)

    elif action_type == "media":
        key_name = MEDIA_KEYS.get(value)
        if not key_name:
            raise ValueError(f"Unknown media key: {value}")
        keyboard.send(key_name)

    elif action_type == "obs_scene":
        client = get_obs_client(cfg)
        if not client:
            raise RuntimeError("OBS not connected — check obs.enabled in config.json")
        client.set_current_program_scene(value)

    elif action_type == "obs_mute":
        client = get_obs_client(cfg)
        if not client:
            raise RuntimeError("OBS not connected — check obs.enabled in config.json")
        client.toggle_input_mute(value)

    elif action_type == "obs_record":
        client = get_obs_client(cfg)
        if not client:
            raise RuntimeError("OBS not connected — check obs.enabled in config.json")
        status = client.get_record_status()
        client.stop_record() if status.output_active else client.start_record()

    elif action_type == "obs_stream":
        client = get_obs_client(cfg)
        if not client:
            raise RuntimeError("OBS not connected — check obs.enabled in config.json")
        status = client.get_stream_status()
        client.stop_stream() if status.output_active else client.start_stream()

    elif action_type == "mic_mute":
        # Toggles the actual Windows default microphone — unlike a hotkey,
        # this doesn't depend on any app having that shortcut configured.
        toggle_mic_mute()

    else:
        raise ValueError(f"Unknown action type: {action_type}")


def _normalize_icon(img, size: int = 96, pad_ratio: float = 0.06):
    """Crops away transparent padding around the actual artwork and
    re-centers it on a square canvas. .exe icons are usually already tightly
    cropped, but Store app logo assets (WhatsApp, etc.) often ship with a lot
    of transparent margin around a small centered mark — without this, they
    render visibly smaller than icons pulled straight from a .exe."""
    from PIL import Image

    img = img.convert("RGBA")
    # getbbox() on the full RGBA image only treats a pixel as "empty" if
    # every channel (including R/G/B) is zero — but a lot of exported PNGs
    # leave garbage color values in fully-transparent pixels (e.g. white at
    # alpha=0), so the crop never actually trimmed anything. Checking the
    # alpha channel alone is the correct way to find the visible artwork.
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        img = img.crop(bbox)

    pad = int(size * pad_ratio)
    target = max(1, size - 2 * pad)
    w, h = img.size
    if w == 0 or h == 0:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min(target / w, target / h)
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    img = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - new_w) // 2, (size - new_h) // 2), img)
    return canvas


def extract_icon_png(exe_path: str, size: int = 96) -> bytes:
    """Pulls the real Windows icon off an .exe/.dll/.ico and returns it as PNG bytes.
    Prefer a full path (e.g. C:\\Program Files\\App\\app.exe) — bare names like
    'notepad.exe' aren't always resolved the same way the shell resolves them."""
    if os.name != "nt":
        raise RuntimeError("Extração de ícone só funciona no Windows")

    try:
        import win32gui
        import win32ui
        import win32con
        import win32api
    except ImportError:
        raise RuntimeError("Instale o pywin32 para extrair ícones: pip install pywin32")

    import io
    from PIL import Image

    resolved = win32api.FindExecutable(os.path.basename(exe_path), os.path.dirname(exe_path) or None)[1] \
        if not os.path.isabs(exe_path) else exe_path
    resolved = resolved if os.path.exists(resolved) else exe_path

    large, small = win32gui.ExtractIconEx(resolved, 0)
    if not large and not small:
        raise FileNotFoundError(f"Nenhum ícone encontrado em: {resolved}")

    hicon = large[0] if large else small[0]
    try:
        ico_x = win32api.GetSystemMetrics(win32con.SM_CXICON)
        ico_y = win32api.GetSystemMetrics(win32con.SM_CYICON)

        hdc = win32ui.CreateDCFromHandle(win32gui.GetDC(0))
        hbmp = win32ui.CreateBitmap()
        hbmp.CreateCompatibleBitmap(hdc, ico_x, ico_y)
        hdc_mem = hdc.CreateCompatibleDC()
        hdc_mem.SelectObject(hbmp)
        hdc_mem.DrawIcon((0, 0), hicon)

        bmpinfo = hbmp.GetInfo()
        bmpstr = hbmp.GetBitmapBits(True)
        img = Image.frombuffer(
            "RGBA",
            (bmpinfo["bmWidth"], bmpinfo["bmHeight"]),
            bmpstr, "raw", "BGRA", 0, 1,
        )
        img = _normalize_icon(img, size)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    finally:
        for h in large:
            win32gui.DestroyIcon(h)
        for h in small:
            win32gui.DestroyIcon(h)




def extract_store_app_icon(aumid: str, size: int = 96) -> bytes:
    """Store/UWP apps don't have an icon embedded in an accessible .exe — the
    real logo lives as an image file declared in the package's own
    AppxManifest.xml. This resolves it: find the package by its family name
    (the part of the AUMID before '!'), read its manifest, find the declared
    Square logo for the matching app, then pick the largest actual image
    file on disk (manifests reference a base name; Windows ships several
    scale-qualified variants like Square44x44Logo.scale-200.png)."""
    if os.name != "nt":
        raise RuntimeError("Extração de ícone só funciona no Windows")
    if "!" not in aumid:
        raise ValueError("isso não parece ser um AppID de app instalado")

    pfn, app_id = aumid.split("!", 1)

    ps_script = r"""
param([string]$Pfn, [string]$AppId)
$ErrorActionPreference = "Stop"
$pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $Pfn } | Select-Object -First 1
if (-not $pkg) { Write-Error "pacote nao encontrado"; exit 1 }
$manifestPath = Join-Path $pkg.InstallLocation "AppxManifest.xml"
[xml]$manifest = Get-Content $manifestPath
$ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
$ns.AddNamespace("a", $manifest.Package.NamespaceURI)
$appNode = $manifest.SelectSingleNode("//a:Applications/a:Application[@Id='$AppId']", $ns)
if (-not $appNode) { $appNode = $manifest.SelectSingleNode("//a:Applications/a:Application", $ns) }
if (-not $appNode) { Write-Error "app nao encontrado no manifesto"; exit 1 }
$ve = $appNode.VisualElements
$logo = $ve.Square150x150Logo
if (-not $logo) { $logo = $ve.Square44x44Logo }
if (-not $logo) { Write-Error "logo nao declarado no manifesto"; exit 1 }
$logoFull = Join-Path $pkg.InstallLocation $logo
$dir = Split-Path $logoFull
$base = [System.IO.Path]::GetFileNameWithoutExtension($logoFull)
$candidates = Get-ChildItem -Path $dir -Filter "$base*" -ErrorAction SilentlyContinue | Sort-Object Length -Descending
if ($candidates.Count -gt 0) { Write-Output $candidates[0].FullName }
elseif (Test-Path $logoFull) { Write-Output $logoFull }
else { Write-Error "arquivo de logo nao encontrado"; exit 1 }
"""

    import tempfile
    fd, script_path = tempfile.mkstemp(suffix=".ps1")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(ps_script)
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-File", script_path, "-Pfn", pfn, "-AppId", app_id],
            capture_output=True, text=True, timeout=20,
        )
        lines = [l for l in (result.stdout or "").strip().splitlines() if l.strip()]
        logo_path = lines[-1] if lines else ""
        if not logo_path or not os.path.exists(logo_path):
            raise RuntimeError((result.stderr or "").strip() or "logo não encontrado para esse app")
    finally:
        try:
            os.unlink(script_path)
        except Exception:
            pass

    import io
    from PIL import Image

    img = _normalize_icon(Image.open(logo_path), size)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/manifest.json")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.json")


@app.get("/api/config")
def get_config():
    cfg = load_config()
    # Never expose the OBS password to the client
    return JSONResponse({"grid": cfg.get("grid", {}), "buttons": cfg.get("buttons", [])})


@app.put("/api/config")
def save_config(request: Request, payload: dict = Body(...)):
    """Used by the in-app editor to persist grid/button changes to config.json."""
    _local_only(request)  # o editor só funciona na janela do Deck no PC
    cfg = load_config()
    cfg["grid"] = payload.get("grid", cfg.get("grid", {}))
    cfg["buttons"] = payload.get("buttons", cfg.get("buttons", []))
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return {"ok": True}


def _is_mixer_exe(path: str) -> bool:
    """True se `path` é o exe de um app com áudio ativo agora, ou seja, um dos
    que o mixer lista (campo exe_path de /api/volume/apps)."""
    if os.name != "nt" or not path:
        return False
    try:
        alvo = os.path.normcase(os.path.normpath(path))
        return any(
            a.get("exe_path") and os.path.normcase(os.path.normpath(a["exe_path"])) == alvo
            for a in get_app_sessions()
        )
    except Exception:
        return False


@app.post("/api/extract-icon")
def extract_icon_endpoint(request: Request, payload: dict = Body(...)):
    path = (payload.get("path") or "").strip()
    # Caminhos arbitrários continuam só na janela do PC. O celular pareado só pode
    # pedir o ícone dos exes que o próprio mixer está listando (antes, o
    # _local_only barrava o celular com 403 e os cards ficavam com o ícone genérico).
    host = (request.client.host if request.client else "") or ""
    if not _is_loopback(host) and not _is_mixer_exe(path):
        raise HTTPException(status_code=403, detail="Disponível apenas na janela do Deck no PC")
    if not path:
        return JSONResponse({"error": "caminho vazio"}, status_code=400)
    try:
        # An AppID (from Get-StartApps / the "Abrir app instalado" picker)
        # looks like "PackageFamilyName!App" — no slashes, unlike a real
        # file path — so this tells the two apart automatically.
        is_aumid = "!" in path and "\\" not in path and "/" not in path
        png_bytes = extract_store_app_icon(path) if is_aumid else extract_icon_png(path)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    fname = hashlib.sha1(path.encode("utf-8")).hexdigest()[:16] + ".png"
    with open(ICONS_DIR / fname, "wb") as f:
        f.write(png_bytes)
    return {"icon_url": f"/icons/{fname}"}


@app.get("/api/pick-file")
def pick_file_endpoint(request: Request):
    _local_only(request)
    """Pops a native 'Open file' dialog ON THE PC running the server. Only useful
    when the editor is open in a browser on that same PC (the dialog appears on
    its screen, not on the phone) — e.g. via the tray icon's 'Abrir no navegador
    deste PC' option."""
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        import tkinter
        from tkinter import filedialog
    except ImportError:
        return JSONResponse({"error": "tkinter não disponível nesta instalação do Python"}, status_code=500)

    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        path = filedialog.askopenfilename(
            title="Escolher programa ou arquivo",
            filetypes=[
                ("Programas e atalhos", "*.exe;*.lnk;*.bat;*.cmd"),
                ("Todos os arquivos", "*.*"),
            ],
        )
    finally:
        root.destroy()

    if not path:
        return JSONResponse({"error": "nenhum arquivo selecionado"}, status_code=400)
    return {"path": path}


@app.get("/api/installed-apps")
def installed_apps_endpoint(request: Request):
    _local_only(request)
    """Lists every app the real Start Menu knows about (Store/UWP apps like
    WhatsApp included) via PowerShell's Get-StartApps — the same catalog
    Windows itself uses, so it works uniformly for both app types instead of
    needing a raw file path (which Store apps don't reliably expose)."""
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"],
            capture_output=True, text=True, timeout=20,
        )
        raw = (result.stdout or "").strip()
        if not raw:
            return JSONResponse({"error": result.stderr or "lista vazia"}, status_code=500)
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            parsed = [parsed]
        apps = sorted(
            ({"name": a["Name"], "app_id": a["AppID"]} for a in parsed if a.get("Name") and a.get("AppID")),
            key=lambda a: a["name"].lower(),
        )
        return {"apps": apps}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------- COM (pycaw/comtypes) numa thread só ----------
#
# Antes, cada requisição chamava comtypes.CoInitialize() na thread do pool do FastAPI. Essas threads
# são descartadas quando ficam ociosas, sem CoUninitialize, e ponteiros COM criados nelas podiam ser
# liberados depois por OUTRA thread (ex.: ao descartar uma exceção) — uso inseguro de COM via ctypes,
# que derruba o processo com access violation (c0000005) dentro do _ctypes.pyd, sem exceção Python.
# Agora TODO acesso a COM roda numa única thread, inicializada uma vez e que vive até o fim do
# processo; os ponteiros nascem e morrem nela, e só dados simples (números, textos) saem de lá.

from concurrent.futures import BrokenExecutor, ThreadPoolExecutor

_com_pool = None
_com_lock = threading.Lock()


class ComError(RuntimeError):
    """Erro vindo da thread de COM, já sem traceback (o traceback seguraria ponteiros COM)."""


def _com_thread_init() -> None:
    import comtypes
    comtypes.CoInitialize()  # uma única vez; esta thread não termina enquanto o Deck estiver aberto


def _com_run(fn, *args, **kwargs):
    """Executa fn na thread dedicada de COM e devolve o resultado (que deve ser só dado simples)."""
    global _com_pool
    with _com_lock:
        if _com_pool is None:
            _com_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="com", initializer=_com_thread_init)
        pool = _com_pool

    def _job():
        err = None
        try:
            return fn(*args, **kwargs)
        except BaseException as e:  # noqa: BLE001 — convertido em ComError logo abaixo
            err = f"{type(e).__name__}: {e}"
        finally:
            # Roda na thread de COM: coleta AQUI os ciclos formados pelo job
            # (wrappers COM presos em tracebacks ou em ciclos internos do
            # comtypes/pycaw). Se o garbage collector cíclico de OUTRA thread
            # os coletasse, o __del__ → Release() rodaria na thread errada e
            # derrubaria o processo com access violation (c0000005) — foi
            # exatamente o crash capturado pelo faulthandler em 2026-10-09.
            gc.collect()
        # Fora do except de propósito: o nome do `as` já foi apagado pelo
        # interpretador e o traceback desta exceção não referencia frames
        # com ponteiros COM — nada de COM viaja para a thread chamadora.
        if err is not None:
            raise ComError(err)

    try:
        return pool.submit(_job).result(timeout=20)
    except BrokenExecutor as e:
        with _com_lock:
            _com_pool = None  # a próxima chamada recria a thread
        raise ComError(f"thread de COM indisponível ({type(e).__name__})") from None


def _endpoint_volume(flow: str):
    """IAudioEndpointVolume do dispositivo padrão ('render' = alto-falante,
    'capture' = microfone). Usa o enumerador direto: funciona em qualquer versão
    do pycaw (as novas mudaram o retorno de GetSpeakers(), que quebrava aqui).
    SÓ pode ser chamado de dentro da thread de COM (via _com_run)."""
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume, EDataFlow, ERole

    data_flow = EDataFlow.eRender.value if flow == "render" else EDataFlow.eCapture.value
    enumerator = AudioUtilities.GetDeviceEnumerator()
    device = enumerator.GetDefaultAudioEndpoint(data_flow, ERole.eMultimedia.value)
    interface = device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return cast(interface, POINTER(IAudioEndpointVolume))


def get_system_volume() -> dict:
    def job():
        vol = _endpoint_volume("render")
        return {"level": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}
    return _com_run(job)


def set_system_volume(level: int) -> None:
    def job():
        _endpoint_volume("render").SetMasterVolumeLevelScalar(max(0, min(100, level)) / 100, None)
    _com_run(job)


def set_system_mute(muted: bool) -> None:
    def job():
        _endpoint_volume("render").SetMute(1 if muted else 0, None)
    _com_run(job)


def get_mic_state() -> dict:
    def job():
        vol = _endpoint_volume("capture")
        return {"level": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}
    return _com_run(job)


def toggle_mic_mute() -> None:
    def job():
        vol = _endpoint_volume("capture")
        vol.SetMute(0 if vol.GetMute() else 1, None)
    _com_run(job)


def get_app_sessions() -> list:
    """One entry per distinct process that's *actually* producing audio right
    now (not merely every process that has ever opened an audio session).
    Sessions that aren't in the Active state are skipped, matching what the real
    Windows Volume Mixer shows. Sessions with no process (system sounds with none
    playing) are skipped too. Multiple sessions from the same process are merged
    into one entry and controlled together."""
    def job():
        from pycaw.pycaw import AudioUtilities
        try:
            from pycaw.pycaw import AudioSessionState
            active_state = AudioSessionState.Active
        except ImportError:
            active_state = 1  # AudioSessionStateActive's raw value, if the enum isn't exposed by this pycaw version

        groups = {}
        for session in AudioUtilities.GetAllSessions():
            proc = session.Process
            if proc is None:
                continue
            try:
                if session.State != active_state:
                    continue
            except Exception:
                pass  # if the state can't be read, don't let that hide the app
            try:
                pname = proc.name()
            except Exception:
                continue
            if pname in groups:
                continue
            vol = session.SimpleAudioVolume
            try:
                exe_path = proc.exe()
            except Exception:
                exe_path = None
            groups[pname] = {
                "process": pname,
                "label": pname.rsplit(".", 1)[0].replace("_", " ").capitalize(),
                "level": round(vol.GetMasterVolume() * 100),
                "muted": bool(vol.GetMute()),
                "exe_path": exe_path,
            }
        return list(groups.values())
    return _com_run(job)


def set_app_session_volume(process_name: str, level=None, muted=None) -> bool:
    def job():
        from pycaw.pycaw import AudioUtilities
        found = False
        for session in AudioUtilities.GetAllSessions():
            proc = session.Process
            if proc is None:
                continue
            try:
                if proc.name().lower() != process_name.lower():
                    continue
            except Exception:
                continue
            found = True
            vol = session.SimpleAudioVolume
            if level is not None:
                vol.SetMasterVolume(max(0, min(100, level)) / 100, None)
            if muted is not None:
                vol.SetMute(1 if muted else 0, None)
        return found
    return _com_run(job)


# ---------- Central de Mídia do Windows (SMTC) ----------
#
# Lê o que está tocando em QUALQUER app que se registre na Central de Mídia
# (Spotify, Spotube, YouTube Music no navegador, etc.) e permite controlar
# play/pause/próxima/anterior. Feito via PowerShell (a lib winsdk não tem
# suporte ao Python 3.14). Nada a instalar: o PowerShell 5.1 já vem no Windows.

import base64
import threading

_SMTC_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, $type) {
    $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]

  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
  $sessions = @($mgr.GetSessions())
  $current = $mgr.GetCurrentSession()
  $curId = $null
  if ($current) { $curId = $current.SourceAppUserModelId }

  $action = $env:SMTC_ACTION
  $target = $env:SMTC_TARGET
  if ($action) {
    $s = $sessions | Where-Object { $_.SourceAppUserModelId -eq $target } | Select-Object -First 1
    if (-not $s) { $s = $current }
    if (-not $s) {
      '{"ok":false,"error":"nenhuma sessão de mídia ativa"}'
      exit 0
    }
    $r = $false
    switch ($action) {
      'play_pause' { $r = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
      'next'       { $r = Await ($s.TrySkipNextAsync()) ([bool]) }
      'previous'   { $r = Await ($s.TrySkipPreviousAsync()) ([bool]) }
      'seek'       { $r = Await ($s.TryChangePlaybackPositionAsync([TimeSpan]::FromMilliseconds([int64]$env:SMTC_POSITION_MS).Ticks)) ([bool]) }
    }
    ConvertTo-Json -InputObject @{ ok = [bool]$r } -Compress
    exit 0
  }

  $thumbFor = $env:SMTC_THUMB_FOR
  $out = @()
  foreach ($s in $sessions) {
    $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
    $pb = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $thumb = $null
    if ($thumbFor -and $thumbFor -eq $s.SourceAppUserModelId -and $props.Thumbnail) {
      try {
        $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $ct = $stream.ContentType
        if (-not $ct) { $ct = 'image/png' }
        $thumb = 'data:' + $ct + ';base64,' + [Convert]::ToBase64String($ms.ToArray())
      } catch { $thumb = $null }
    }
    $out += [pscustomobject]@{
      app         = $s.SourceAppUserModelId
      title       = $props.Title
      artist      = $props.Artist
      album       = $props.AlbumTitle
      playing     = ([string]$pb.PlaybackStatus -eq 'Playing')
      position_ms = [int64]$tl.Position.TotalMilliseconds
      duration_ms = [int64]($tl.EndTime.TotalMilliseconds - $tl.StartTime.TotalMilliseconds)
      thumb       = $thumb
    }
  }
  ConvertTo-Json -InputObject @{ ok = $true; current = $curId; sessions = @($out) } -Depth 4 -Compress
} catch {
  ConvertTo-Json -InputObject @{ ok = $false; error = $_.Exception.Message } -Compress
}
"""

_smtc_lock = threading.Lock()
_smtc_snapshot_cache = {"t": 0.0, "data": None}
_smtc_thumb_cache: dict = {}  # (app,title,artist,album) -> (data_url|None, timestamp)


def _run_smtc(action: str = "", target: str = "", thumb_for: str = "", timeout: float = 10.0,
              position_ms=None) -> dict:
    if os.name != "nt":
        raise RuntimeError("Central de Mídia só existe no Windows")
    env = os.environ.copy()
    env["SMTC_ACTION"] = action
    env["SMTC_TARGET"] = target
    env["SMTC_THUMB_FOR"] = thumb_for
    env["SMTC_POSITION_MS"] = "" if position_ms is None else str(int(position_ms))
    encoded = base64.b64encode(_SMTC_PS.encode("utf-16-le")).decode("ascii")
    proc = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-EncodedCommand", encoded],
        capture_output=True,
        env=env,
        timeout=timeout,
        creationflags=0x08000000,  # CREATE_NO_WINDOW — sem piscar janela de console
    )
    out = proc.stdout.decode("utf-8-sig", errors="replace").strip()
    if not out:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(err[:500] or "PowerShell não retornou nada")
    try:
        data = json.loads(out.splitlines()[-1])
    except Exception:
        raise RuntimeError(f"saída inesperada do PowerShell: {out[:300]}")
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "erro desconhecido na Central de Mídia")
    return data


def _smtc_snapshot(force: bool = False) -> dict:
    """Sessões de mídia atuais, com cache curto pra não abrir um PowerShell a cada poll."""
    with _smtc_lock:
        now = time.time()
        if not force and _smtc_snapshot_cache["data"] is not None and now - _smtc_snapshot_cache["t"] < 1.5:
            return _smtc_snapshot_cache["data"]
        data = _run_smtc()
        _smtc_snapshot_cache["t"] = time.time()
        _smtc_snapshot_cache["data"] = data
        return data


def _smtc_pick(data: dict):
    sessions = data.get("sessions") or []
    if not sessions:
        return None
    cur = data.get("current")
    playing = [s for s in sessions if s.get("playing")]
    if playing:
        for s in playing:
            if s.get("app") == cur:
                return s
        return playing[0]
    for s in sessions:
        if s.get("app") == cur and s.get("title"):
            return s
    for s in sessions:
        if s.get("title"):
            return s
    return None


def _friendly_app_name(app_id: str) -> str:
    name = app_id or ""
    if "!" in name:
        name = name.split("!")[-1]
    if name.lower().endswith(".exe"):
        name = name[:-4]
    return name.replace("_", " ").strip().capitalize() or "Mídia"


def _smtc_thumbnail(session: dict):
    key = (session.get("app"), session.get("title"), session.get("artist"), session.get("album"))
    cached = _smtc_thumb_cache.get(key)
    if cached and (cached[0] or time.time() - cached[1] < 10):
        return cached[0]
    thumb = None
    try:
        data = _run_smtc(thumb_for=session.get("app") or "")
        for s in data.get("sessions") or []:
            if s.get("app") == session.get("app"):
                thumb = s.get("thumb")
                break
    except Exception:
        thumb = None
    if len(_smtc_thumb_cache) > 20:
        _smtc_thumb_cache.clear()
    _smtc_thumb_cache[key] = (thumb, time.time())
    return thumb


def _smtc_payload(session: dict) -> dict:
    return {
        "title": session.get("title") or None,
        "artist": session.get("artist") or "",
        "album": session.get("album") or "",
        "playing": bool(session.get("playing")),
        "progress_ms": session.get("position_ms"),
        "duration_ms": session.get("duration_ms") or None,
        "thumbnail_url": _smtc_thumbnail(session),  # data URL — funciona direto em <img src>
        "source": session.get("app"),
        "source_name": _friendly_app_name(session.get("app") or ""),
        "controllable": True,
    }


@app.get("/api/nowplaying")
def api_now_playing():
    """Tocando agora: qualquer app que apareça na Central de Mídia do Windows
    (Spotify, Spotube, YouTube Music no navegador, etc.)."""
    if os.name != "nt":
        return {"title": None}
    try:
        pick = _smtc_pick(_smtc_snapshot())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return _smtc_payload(pick) if pick else {"title": None}


@app.get("/api/nowplaying/debug")
def api_now_playing_debug(request: Request):
    _local_only(request)
    """Diagnóstico: resposta crua da Central de Mídia (sem thumbnails)."""
    try:
        return _smtc_snapshot(force=True)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/nowplaying/control")
def api_now_playing_control(payload: dict = Body(...)):
    action = (payload.get("action") or "").strip()
    if action not in ("play_pause", "next", "previous"):
        return JSONResponse({"error": f"ação desconhecida: {action}"}, status_code=400)

    source = (payload.get("source") or "").strip()
    try:
        if not source:
            pick = _smtc_pick(_smtc_snapshot())
            source = (pick or {}).get("app") or ""
        _run_smtc(action=action, target=source)
        _smtc_snapshot_cache["t"] = 0.0  # força leitura fresca no próximo poll
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/nowplaying/seek")
def api_now_playing_seek(payload: dict = Body(...)):
    """Reposiciona a mídia: {"position_ms": 90000, "source": "<aumid>"} (source opcional)."""
    try:
        position_ms = int(payload.get("position_ms"))
    except (TypeError, ValueError, OverflowError):
        return JSONResponse({"error": "position_ms inválido"}, status_code=400)
    if position_ms < 0:
        return JSONResponse({"error": "position_ms não pode ser negativo"}, status_code=400)

    source = (payload.get("source") or "").strip()
    try:
        if not source:
            pick = _smtc_pick(_smtc_snapshot())
            source = (pick or {}).get("app") or ""
        _run_smtc(action="seek", target=source, position_ms=position_ms)
        _smtc_snapshot_cache["t"] = 0.0  # força leitura fresca no próximo poll
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ---------- Sessões de mídia ↔ processo (play/pause por app no mixer) ----------

_aumid_unmapped_logged: set = set()


def _scan_processes() -> tuple:
    """({aumid_minúsculo: nome_do_exe}, [nomes dos exes em execução]).
    O AUMID vem de kernel32.GetApplicationUserModelId, com o handle aberto só com
    PROCESS_QUERY_LIMITED_INFORMATION. Não usa COM, então pode rodar fora do _com_run."""
    import ctypes
    from ctypes import wintypes
    import psutil

    aumids: dict = {}
    names: list = []
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.CloseHandle.argtypes = [wintypes.HANDLE]
        k32.CloseHandle.restype = wintypes.BOOL
        k32.GetApplicationUserModelId.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.UINT), wintypes.LPWSTR]
        k32.GetApplicationUserModelId.restype = wintypes.LONG
    except (OSError, AttributeError):
        k32 = None  # sem a API: só o fallback heurístico

    seen_names = set()
    for p in psutil.process_iter(["pid", "name"]):
        try:
            name = p.info.get("name")
            pid = p.info.get("pid")
        except Exception:
            continue
        if not name:
            continue
        if name.lower() not in seen_names:
            seen_names.add(name.lower())
            names.append(name)
        if k32 is None or not pid:
            continue
        handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            continue
        try:
            length = wintypes.UINT(256)
            buf = ctypes.create_unicode_buffer(256)
            if k32.GetApplicationUserModelId(handle, ctypes.byref(length), buf) == 0 and buf.value:
                aumids.setdefault(buf.value.lower(), name)
        finally:
            k32.CloseHandle(handle)
    return aumids, names


def _norm_app_id(value: str) -> str:
    value = (value or "").strip().lower().split("!", 1)[0]
    return value[:-4] if value.endswith(".exe") else value


def _map_aumid(aumid: str, precise: dict, audio_procs: list, all_procs: list, overrides: dict):
    """AUMID -> nome do exe. Ordem: 1) preciso, 2) heurística, 3) override do config (vence tudo)."""
    proc = precise.get(aumid.lower())
    if not proc:
        norm = _norm_app_id(aumid)
        if len(norm) >= 3:
            # primeiro entre os apps com áudio (os cards do mixer), depois entre todos
            for candidates in (audio_procs, all_procs):
                for c in candidates:
                    cn = _norm_app_id(c)
                    if len(cn) >= 3 and (cn in norm or norm in cn):
                        proc = c
                        break
                if proc:
                    break
    override = overrides.get(aumid.lower())
    if override:
        proc = str(override)
    if proc:
        # devolve com a mesma grafia do card do mixer (get_app_sessions)
        canon = {c.lower(): c for c in all_procs}
        canon.update({c.lower(): c for c in audio_procs})
        proc = canon.get(proc.lower(), proc)
    return proc


@app.get("/api/media/sessions")
def api_media_sessions():
    """Sessões da Central de Mídia com o nome do processo, para o front ligar
    cada sessão ao card do mixer: [{process, aumid, title, artist, playing}]."""
    if os.name != "nt":
        return []
    try:
        sessions = _smtc_snapshot().get("sessions") or []  # cache de 1.5s: sem PowerShell novo por poll
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    if not sessions:
        return []

    try:
        precise, all_procs = _scan_processes()
    except Exception:
        precise, all_procs = {}, []
    try:
        audio_procs = [a["process"] for a in get_app_sessions()]
    except Exception:
        audio_procs = []
    try:
        raw = load_config().get("media_aumid_map") or {}
        overrides = {str(k).lower(): v for k, v in raw.items()} if isinstance(raw, dict) else {}
    except Exception:
        overrides = {}

    out = []
    for s in sessions:
        aumid = s.get("app") or ""
        proc = _map_aumid(aumid, precise, audio_procs, all_procs, overrides) if aumid else None
        if aumid and not proc and aumid not in _aumid_unmapped_logged:
            _aumid_unmapped_logged.add(aumid)  # uma vez só, para não lotar o console
            try:
                sys.stderr.write(f"[media] AUMID sem processo: {aumid!r}. "
                                 f"Ajuste em config.json -> media_aumid_map\n")
            except Exception:
                pass
        out.append({
            "process": proc,
            "aumid": aumid,
            "title": s.get("title") or "",
            "artist": s.get("artist") or "",
            "playing": bool(s.get("playing")),
        })
    return out


@app.get("/api/volume")
def api_get_volume():
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        return get_system_volume()
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.post("/api/volume")
def api_set_volume(payload: dict = Body(...)):
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        if "level" in payload and payload["level"] is not None:
            set_system_volume(int(payload["level"]))
        if "muted" in payload and payload["muted"] is not None:
            set_system_mute(bool(payload["muted"]))
        return get_system_volume()
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.get("/api/volume/debug")
def api_volume_debug(request: Request):
    _local_only(request)
    """Diagnóstico do volume: tenta ler e reescrever (o mesmo valor) o volume geral e o de cada
    app, mostrando versões das libs e o erro exato de cada etapa. Abra no navegador do PC."""
    import traceback
    report: dict = {}
    try:
        import importlib.metadata as md
        report["pycaw"] = md.version("pycaw")
        report["comtypes"] = md.version("comtypes")
    except Exception as e:
        report["versions_error"] = repr(e)

    def master():
        vol = _endpoint_volume("render")
        before = round(vol.GetMasterVolumeLevelScalar() * 100)
        vol.SetMasterVolumeLevelScalar(before / 100, None)
        return {"master_before": before, "master_after_set_same": round(vol.GetMasterVolumeLevelScalar() * 100), "master_ok": True}

    def sessions():
        from pycaw.pycaw import AudioUtilities
        rows = []
        for sess in AudioUtilities.GetAllSessions():
            row: dict = {}
            try:
                row["process"] = sess.Process.name() if sess.Process else None
            except Exception as e:
                row["process"] = f"erro: {e!r}"
            try:
                row["state"] = str(sess.State)
            except Exception as e:
                row["state"] = f"erro: {e!r}"
            try:
                sv = sess.SimpleAudioVolume
                lvl = sv.GetMasterVolume()
                sv.SetMasterVolume(lvl, None)
                row["level"] = round(lvl * 100)
                row["set_ok"] = True
            except Exception as e:
                row["set_error"] = repr(e)
            rows.append(row)
        return rows

    try:
        report.update(_com_run(master))
    except Exception:
        report["master_error"] = traceback.format_exc()
    try:
        report["sessions"] = _com_run(sessions)
    except Exception:
        report["sessions_error"] = traceback.format_exc()
    return report


@app.get("/api/mic")
def api_get_mic():
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        return get_mic_state()
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.post("/api/mic")
def api_set_mic(payload: dict = Body(...)):
    """Microfone do Windows: {"level": 0-100} e/ou {"muted": bool}."""
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    level = payload.get("level")
    muted = payload.get("muted")
    if level is None and muted is None:
        return JSONResponse({"error": "informe level e/ou muted"}, status_code=400)
    if level is not None:
        if isinstance(level, bool) or not isinstance(level, (int, float)) or not (0 <= level <= 100):
            return JSONResponse({"error": "level deve ser um número de 0 a 100"}, status_code=400)
    if muted is not None and not isinstance(muted, bool):
        return JSONResponse({"error": "muted deve ser true ou false"}, status_code=400)

    def job():
        vol = _endpoint_volume("capture")
        if level is not None:
            vol.SetMasterVolumeLevelScalar(float(level) / 100, None)
        if muted is not None:
            vol.SetMute(1 if muted else 0, None)
        return {"level": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}

    try:
        return _com_run(job)
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.post("/api/discord/mute")
def api_discord_mute():
    """Aperta o atalho de mute do Discord (config.json -> discord_mute_hotkey)."""
    hotkey = "ctrl+alt+-"
    try:
        hotkey = (load_config().get("discord_mute_hotkey") or hotkey).strip() or hotkey
    except Exception:
        pass
    try:
        _send_hotkey(hotkey)
        return {"ok": True, "hotkey": hotkey}
    except Exception as e:
        return JSONResponse({"error": f"não consegui enviar o atalho: {e}"}, status_code=500)


@app.get("/api/volume/apps")
def api_get_app_volumes():
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        return {"apps": get_app_sessions()}
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.post("/api/volume/apps")
def api_set_app_volume(payload: dict = Body(...)):
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    process = (payload.get("process") or "").strip()
    if not process:
        return JSONResponse({"error": "process obrigatório"}, status_code=400)
    try:
        found = set_app_session_volume(
            process,
            payload.get("level"),
            payload.get("muted"),
        )
        if not found:
            return JSONResponse({"error": "esse app não está com áudio ativo agora"}, status_code=404)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            btn_id = data.get("id")

            cfg = load_config()  # reload so config.json edits apply without restart
            buttons_by_id = {b["id"]: b for b in cfg.get("buttons", [])}
            btn = buttons_by_id.get(btn_id)

            if not btn:
                await websocket.send_json({"id": btn_id, "ok": False, "error": "unknown button"})
                continue
            try:
                run_action(btn, cfg)
                await websocket.send_json({"id": btn_id, "ok": True})
            except Exception as e:
                await websocket.send_json({"id": btn_id, "ok": False, "error": str(e)})
    except WebSocketDisconnect:
        pass


# ---------- Pareamento: páginas e rotas ----------

PAIR_HTML = r"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0b0a09"><title>Deck — parear</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0b0a09;color:#ece6da;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:340px;text-align:center}
.mark{width:56px;height:56px;margin:0 auto 18px;border-radius:14px;background:#18140f;border:1px solid #42382d;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:11px}
.mark i{border-radius:4px}.mark i:nth-child(1){background:#d9a94a}.mark i:nth-child(2){background:#c97b3f}.mark i:nth-child(3){background:#8d7fa3}.mark i:nth-child(4){background:#7c8f5e}
h1{font-size:15px;letter-spacing:.2em;margin:0 0 6px}p{font-size:13px;color:#a79f90;margin:0 0 22px;line-height:1.5}
input{width:100%;font:600 28px ui-monospace,Consolas,monospace;letter-spacing:.4em;text-align:center;padding:14px 0 14px .4em;background:#14110d;color:#ece6da;border:1px solid #42382d;border-radius:12px;outline:none}
input:focus{border-color:#d9a94a}
button{margin-top:14px;width:100%;padding:14px;border:0;border-radius:12px;background:#d9a94a;color:#2a1f08;font:700 14px system-ui;letter-spacing:.08em;cursor:pointer}
button:disabled{opacity:.5}.err{min-height:18px;margin-top:12px;font-size:12px;color:#e0245e}
</style></head><body><div class="card">
<div class="mark"><i></i><i></i><i></i><i></i></div>
<h1>DECK</h1><p>Digite o PIN de 6 dígitos que aparece no painel do Deck no seu PC.</p>
<input id="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" autofocus>
<button id="go">PAREAR</button><div class="err" id="err"></div></div>
<script>
const pin=document.getElementById("pin"),go=document.getElementById("go"),err=document.getElementById("err");
async function pair(){
  const v=pin.value.replace(/\D/g,"");if(v.length!==6){err.textContent="O PIN tem 6 dígitos.";return}
  go.disabled=true;err.textContent="";
  try{const r=await fetch("/api/auth/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin:v})});
    const d=await r.json();if(r.ok){location.replace("/");return}
    err.textContent=d.error||"PIN incorreto.";
  }catch(e){err.textContent="Sem conexão com o PC."}
  go.disabled=false;
}
go.addEventListener("click",pair);pin.addEventListener("keydown",e=>{if(e.key==="Enter")pair()});
pin.addEventListener("input",()=>{if(pin.value.replace(/\D/g,"").length===6)pair()});
const q=new URLSearchParams(location.search).get("pin");
if(q){pin.value=q;history.replaceState(null,"","/pair");pair()}
</script></body></html>"""


@app.get("/pair", response_class=HTMLResponse)
def pair_page():
    return PAIR_HTML


@app.post("/api/auth/pair")
def api_auth_pair(request: Request, payload: dict = Body(...)):
    ip = (request.client.host if request.client else "") or "?"
    rec = _pair_attempts.get(ip, [0, 0.0])
    if rec[1] > time.time():
        wait = int(rec[1] - time.time()) + 1
        return JSONResponse({"error": f"Muitas tentativas. Aguarde {wait}s."}, status_code=429)
    pin = str(payload.get("pin", "")).strip()
    if secrets.compare_digest(pin, str(_auth()["pin"])):
        _pair_attempts.pop(ip, None)
        token = secrets.token_urlsafe(32)
        _auth()["tokens"].append({
            "h": _token_hash(token),
            "ts": int(time.time()),
            "ua": (request.headers.get("user-agent") or "")[:120],
        })
        _auth_save()
        resp = JSONResponse({"ok": True})
        resp.set_cookie(COOKIE_NAME, token, max_age=60 * 60 * 24 * 365 * 2, httponly=True, samesite="lax")
        return resp
    rec[0] += 1
    if rec[0] >= 5:
        rec = [0, time.time() + 60]
    _pair_attempts[ip] = rec
    return JSONResponse({"error": "PIN incorreto."}, status_code=403)


# ---------- Painel do PC (só acessível de 127.0.0.1) ----------

def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # não envia nada: só descobre qual interface a rede usaria
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _local_only(request: Request):
    host = (request.client.host if request.client else "") or ""
    if not _is_loopback(host):
        raise HTTPException(status_code=403, detail="Disponível apenas na janela do Deck no PC")


def _autostart_command() -> str:
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    interp = pythonw if pythonw.exists() else Path(sys.executable)
    return f'"{interp}" "{Path(__file__).resolve()}"'


def autostart_enabled() -> bool:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as k:
            winreg.QueryValueEx(k, RUN_NAME)
            return True
    except Exception:
        return False


def set_autostart(enabled: bool) -> None:
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, _autostart_command())
        else:
            try:
                winreg.DeleteValue(k, RUN_NAME)
            except FileNotFoundError:
                pass


def _server_port() -> int:
    return 8765


def _effective_version() -> str:
    pack = active_update_pack()
    if pack is not None:
        try:
            v = json.loads((pack / "update.json").read_text(encoding="utf-8")).get("version")
            if v and _ver(v) > _ver(APP_VERSION):
                return v
        except Exception:
            pass
    return APP_VERSION


# ---------- Atualizações (GitHub Releases) ----------

_update_state = {
    "status": "idle",          # idle | checking | available | uptodate | applying | applied | error
    "latest": None, "notes": "", "error": None,
    "needs_reinstall": False, "release_url": f"https://github.com/{GITHUB_REPO}/releases/latest",
    "asset_url": None, "checked_at": 0,
}


def _http_get(url: str, timeout: float = 15.0, max_bytes: int = 60 * 1024 * 1024) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Deck-Updater", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RuntimeError("download grande demais")
    return data


def check_for_update() -> dict:
    """Consulta a última Release do GitHub. Seguro de chamar de qualquer thread."""
    st = _update_state
    if st["status"] in ("checking", "applying"):
        return st
    st["status"], st["error"] = "checking", None
    try:
        rel = json.loads(_http_get(f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"))
        tag = rel.get("tag_name") or ""
        asset = next((a for a in rel.get("assets", []) if a.get("name") == UPDATE_ASSET), None)
        st.update(
            latest=tag.lstrip("vV"), notes=(rel.get("body") or "")[:600],
            release_url=rel.get("html_url") or st["release_url"],
            asset_url=asset.get("browser_download_url") if asset else None,
            checked_at=int(time.time()),
        )
        if _ver(tag) > _ver(_effective_version()):
            st["status"] = "available"
        else:
            st["status"] = "uptodate"
    except urllib.error.HTTPError as e:
        st["status"] = "error"
        st["error"] = "Nenhuma versão publicada ainda." if e.code == 404 else f"GitHub respondeu {e.code}"
    except Exception as e:
        st["status"], st["error"] = "error", f"Sem conexão ({type(e).__name__})"
    return st


_ALLOWED_PACK = re.compile(r"^(server_live\.py|update\.json|static/[^/\\][^/\\]*)$")


def apply_update() -> dict:
    """Baixa o pacote leve da Release, valida e instala em %APPDATA%\\Deck\\update. Precisa reiniciar depois."""
    st = _update_state
    if not st.get("asset_url"):
        raise RuntimeError("Esta versão não tem pacote de atualização — baixe o instalador na página de Releases.")
    if not getattr(sys, "frozen", False):
        raise RuntimeError("Atualização automática só funciona no Deck instalado (.exe).")
    st["status"] = "applying"
    tmp = data_dir() / "update_tmp"
    try:
        raw = _http_get(st["asset_url"], timeout=60.0)
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        root = tmp.resolve()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for info in z.infolist():
                name = info.filename
                if name.endswith("/"):
                    continue
                if not _ALLOWED_PACK.match(name):
                    raise RuntimeError(f"arquivo inesperado no pacote: {name}")
                dest = (tmp / name).resolve()
                if root not in dest.parents:
                    raise RuntimeError("pacote inválido")
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(info))
        meta = json.loads((tmp / "update.json").read_text(encoding="utf-8"))
        if _ver(meta.get("requires_exe", "0")) > _ver(_BUNDLED_VERSION):
            st["needs_reinstall"] = True
            raise RuntimeError("Esta versão precisa do instalador novo (Deck-Setup.exe).")
        compile((tmp / "server_live.py").read_text(encoding="utf-8"), "server_live.py", "exec")
        if not (tmp / "static" / "index.html").exists():
            raise RuntimeError("pacote sem static/index.html")
        old = data_dir() / "update_old"
        shutil.rmtree(old, ignore_errors=True)
        if update_dir().exists():
            update_dir().rename(old)
        tmp.rename(update_dir())
        shutil.rmtree(old, ignore_errors=True)
        st["status"] = "applied"
        return st
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        st["status"], st["error"] = "error", str(e)
        raise


quit_hook = None  # o tray define: encerra o ícone/processo de forma limpa


def restart_app() -> bool:
    """Reabre o Deck.exe e encerra este processo (usado após uma atualização)."""
    if not getattr(sys, "frozen", False):
        return False
    env = os.environ.copy()
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    env.pop("_MEIPASS2", None)
    subprocess.Popen(
        ["cmd.exe", "/c", "ping", "127.0.0.1", "-n", "4", ">nul", "&", "start", "", sys.executable],
        env=env, creationflags=0x08000000 | 0x00000008, close_fds=True,
    )

    def _bye():
        if quit_hook:
            quit_hook()
        else:
            os._exit(0)

    threading.Timer(0.8, _bye).start()
    return True


def _panel_info() -> dict:
    a = _auth()
    ip, port = get_local_ip(), _server_port()
    return {
        "version": _effective_version(),
        "bundled_version": _BUNDLED_VERSION,
        "frozen": bool(getattr(sys, "frozen", False)),
        "ip": ip, "port": port,
        "url": f"http://{ip}:{port}",
        "pin": a["pin"], "pin_required": bool(a.get("required", True)),
        "devices": len(a.get("tokens", [])),
        "autostart": autostart_enabled(),
        "data_dir": str(data_dir()),
        "update": dict(_update_state),
    }


@app.get("/panel")
def panel_page(request: Request):
    _local_only(request)
    return FileResponse(STATIC_DIR / "panel.html", headers={"Cache-Control": "no-store"})


@app.get("/api/panel/info")
def panel_info(request: Request):
    _local_only(request)
    return _panel_info()


@app.get("/api/panel/qr.svg")
def panel_qr(request: Request):
    _local_only(request)
    from fastapi.responses import Response
    info = _panel_info()
    target = f"{info['url']}/pair?pin={info['pin']}" if info["pin_required"] else info["url"]
    try:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(target, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1)
        buf = io.BytesIO()
        img.save(buf)
        return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})
    except Exception as e:
        return JSONResponse({"error": f"QR indisponível: {e}"}, status_code=500)


@app.post("/api/panel/pin/new")
def panel_pin_new(request: Request):
    _local_only(request)
    _auth()["pin"] = _new_pin()
    _auth_save()
    return {"pin": _auth()["pin"]}


@app.post("/api/panel/pin/required")
def panel_pin_required(request: Request, payload: dict = Body(...)):
    _local_only(request)
    _auth()["required"] = bool(payload.get("required", True))
    _auth_save()
    return {"required": _auth()["required"]}


@app.post("/api/panel/devices/revoke")
def panel_devices_revoke(request: Request):
    _local_only(request)
    _auth()["tokens"] = []
    _auth()["pin"] = _new_pin()  # PIN novo também, para o aparelho revogado não voltar com o antigo
    _auth_save()
    return {"ok": True}


@app.post("/api/panel/autostart")
def panel_autostart(request: Request, payload: dict = Body(...)):
    _local_only(request)
    try:
        set_autostart(bool(payload.get("enabled")))
        return {"autostart": autostart_enabled()}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/panel/update/check")
def panel_update_check(request: Request):
    _local_only(request)
    return check_for_update()


@app.post("/api/panel/update/apply")
def panel_update_apply(request: Request):
    _local_only(request)
    try:
        return apply_update()
    except Exception as e:
        return JSONResponse({"error": str(e), "needs_reinstall": _update_state["needs_reinstall"]}, status_code=400)


@app.post("/api/panel/restart")
def panel_restart(request: Request):
    _local_only(request)
    return {"ok": restart_app()}


@app.post("/api/panel/open-deck")
def panel_open_deck(request: Request):
    _local_only(request)
    import webbrowser
    webbrowser.open(f"http://127.0.0.1:{_server_port()}")
    return {"ok": True}


@app.post("/api/panel/open-data")
def panel_open_data(request: Request):
    _local_only(request)
    try:
        os.startfile(str(data_dir()))  # type: ignore[attr-defined]  # só existe no Windows
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


app.mount("/icons", StaticFiles(directory=str(ICONS_DIR)), name="icons")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------- atualização sem recompilar ----------
# Se existir um pacote de atualização mais novo que o .exe em %APPDATA%\\Deck\\update, o
# server_live.py dele substitui a lógica embutida no .exe. Se der erro, o Deck volta para a versão
# embutida e o motivo vai para deck_error.log. Limite: o pacote só pode usar bibliotecas que já
# estão dentro do .exe — uma biblioteca nova exige gerar um instalador novo.
if getattr(sys, "frozen", False) and not globals().get("_LIVE_LOADED"):
    _pack = active_update_pack()
    _live_path = (_pack / "server_live.py") if _pack is not None else None
    if _live_path is not None and _live_path.exists():
        _g = globals()
        _backup = dict(_g)
        try:
            _g["_LIVE_LOADED"] = True
            exec(compile(_live_path.read_text(encoding="utf-8"), str(_live_path), "exec"), _g)
        except BaseException:
            _helpers = ("_g", "_backup", "_pack", "_live_path", "_helpers")
            for _k in [k for k in _g if k not in _backup and k not in _helpers]:
                del _g[_k]
            _g.update(_backup)
            try:
                import traceback
                with open(data_dir() / "deck_error.log", "a", encoding="utf-8") as _f:
                    _f.write("\n[pacote de atualização falhou — usando a versão embutida]\n" + traceback.format_exc())
                # Põe o pacote de quarentena: na próxima abertura o Deck usa tudo embutido no .exe
                # (evita interface nova rodando com lógica antiga).
                shutil.rmtree(data_dir() / "update_failed", ignore_errors=True)
                update_dir().rename(data_dir() / "update_failed")
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
