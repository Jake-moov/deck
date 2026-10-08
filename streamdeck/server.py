"""
Deck server — a lightweight Stream Deck replacement controlled from your phone.

Run:  python server.py           (dev)
      Deck.exe                   (built with build.bat, or via the tray app)
Then open http://<your-notebook-ip>:8765 on your phone (same Wi-Fi).

Memory footprint: this is a single-process FastAPI/uvicorn server with no GUI —
typically well under 50MB RAM, since all rendering happens in your phone's browser.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
import keyboard


def app_dir() -> Path:
    """Where config.json / icons live — next to Deck.exe when frozen, else this file's folder.
    Keeping this external (never bundled) means edits made from the phone editor survive restarts."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def bundled_static_dir() -> Path:
    """Read-only web assets — bundled inside the .exe when frozen (PyInstaller _MEIPASS)."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "static"
    return Path(__file__).parent / "static"


CONFIG_PATH = app_dir() / "config.json"
STATIC_DIR = bundled_static_dir()
ICONS_DIR = app_dir() / "icons"
ICONS_DIR.mkdir(exist_ok=True)

DEFAULT_CONFIG = {
    "grid": {"columns": 3},
    "obs": {"enabled": False, "host": "localhost", "port": 4455, "password": ""},
    "spotify": {"client_id": "", "client_secret": ""},
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
        keyboard.send(value)

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
        vol = _mic_interface()
        vol.SetMute(0 if vol.GetMute() else 1, None)

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
def save_config(payload: dict = Body(...)):
    """Used by the in-app editor to persist grid/button changes to config.json."""
    cfg = load_config()
    cfg["grid"] = payload.get("grid", cfg.get("grid", {}))
    cfg["buttons"] = payload.get("buttons", cfg.get("buttons", []))
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return {"ok": True}


@app.post("/api/extract-icon")
def extract_icon_endpoint(payload: dict = Body(...)):
    path = (payload.get("path") or "").strip()
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
def pick_file_endpoint():
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
def installed_apps_endpoint():
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


def _volume_interface():
    import comtypes
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

    # Each FastAPI request can land on a different worker thread, and COM
    # requires every thread that touches it to initialize its own apartment
    # first — this was missing, which is why the slider had no real effect.
    try:
        comtypes.CoInitialize()
    except OSError:
        pass  # already initialized on this thread — fine

    devices = AudioUtilities.GetSpeakers()
    interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return cast(interface, POINTER(IAudioEndpointVolume))


def get_system_volume() -> dict:
    vol = _volume_interface()
    return {"level": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}


def set_system_volume(level: int) -> None:
    vol = _volume_interface()
    vol.SetMasterVolumeLevelScalar(max(0, min(100, level)) / 100, None)


def set_system_mute(muted: bool) -> None:
    vol = _volume_interface()
    vol.SetMute(1 if muted else 0, None)


def _mic_interface():
    """Same idea as _volume_interface(), but for the default recording
    device (microphone) instead of the default playback device (speakers)."""
    import comtypes
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume, EDataFlow, ERole

    try:
        comtypes.CoInitialize()
    except OSError:
        pass

    enumerator = AudioUtilities.GetDeviceEnumerator()
    device = enumerator.GetDefaultAudioEndpoint(EDataFlow.eCapture.value, ERole.eMultimedia.value)
    interface = device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return cast(interface, POINTER(IAudioEndpointVolume))


def get_mic_state() -> dict:
    vol = _mic_interface()
    return {"level": round(vol.GetMasterVolumeLevelScalar() * 100), "muted": bool(vol.GetMute())}


def _init_com():
    import comtypes
    try:
        comtypes.CoInitialize()
    except OSError:
        pass


def get_app_sessions() -> list:
    """One entry per distinct process that's *actually* producing audio right
    now (Spotify playing, a game with sound, a browser tab that's playing
    something) — same idea as the Windows volume mixer. Windows creates an
    audio session for a process the moment it touches anything audio-related,
    even with nothing playing (Explorer's idle system-sound session, a
    browser tab that merely loaded audio APIs, etc.) — that's what was
    cluttering the list with folders and silent apps, so sessions that aren't
    in the Active state are skipped, matching what the real Windows Volume
    Mixer shows. Sessions with no process (system sounds with none playing)
    are skipped too. Multiple sessions from the same process are merged into
    one entry and controlled together."""
    _init_com()
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


def set_app_session_volume(process_name: str, level=None, muted=None) -> bool:
    _init_com()
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


# ---------- Spotify (official Web API, via developer.spotify.com) ----------
#
# Needs a one-time setup: create an app at https://developer.spotify.com/dashboard,
# add the redirect URI below to it, and put the Client ID/Secret in config.json's
# "spotify" section. Then visit /spotify/login once from the PC's own browser to
# authorize — after that, the refresh token is stored locally and everything
# renews itself automatically.

SPOTIFY_TOKEN_PATH = app_dir() / "spotify_token.json"
SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8765/spotify/callback"
SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state"


def _spotify_config() -> dict:
    return load_config().get("spotify") or {}


def _save_spotify_tokens(tokens: dict) -> None:
    with open(SPOTIFY_TOKEN_PATH, "w", encoding="utf-8") as f:
        json.dump(tokens, f)


def _load_spotify_tokens() -> dict | None:
    if SPOTIFY_TOKEN_PATH.exists():
        return json.loads(SPOTIFY_TOKEN_PATH.read_text(encoding="utf-8"))
    return None


def _spotify_refresh_access_token() -> str:
    import requests

    tokens = _load_spotify_tokens()
    if not tokens or "refresh_token" not in tokens:
        raise RuntimeError("Spotify ainda não conectado — acesse /spotify/login pelo navegador do PC")

    cfg = _spotify_config()
    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
            "client_id": cfg.get("client_id"),
            "client_secret": cfg.get("client_secret"),
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"falha ao renovar token do Spotify: {resp.text}")

    data = resp.json()
    tokens["access_token"] = data["access_token"]
    tokens["expires_at"] = time.time() + data.get("expires_in", 3600) - 30
    if data.get("refresh_token"):  # Spotify occasionally rotates it
        tokens["refresh_token"] = data["refresh_token"]
    _save_spotify_tokens(tokens)
    return tokens["access_token"]


def _spotify_access_token() -> str:
    tokens = _load_spotify_tokens()
    if not tokens:
        raise RuntimeError("Spotify ainda não conectado — acesse /spotify/login pelo navegador do PC")
    if time.time() >= tokens.get("expires_at", 0):
        return _spotify_refresh_access_token()
    return tokens["access_token"]


@app.get("/spotify/login")
def spotify_login():
    from urllib.parse import urlencode

    cfg = _spotify_config()
    client_id = cfg.get("client_id")
    if not client_id:
        return HTMLResponse(
            "Configure <code>client_id</code> e <code>client_secret</code> na seção "
            "<code>spotify</code> do config.json primeiro (veja o README).",
            status_code=400,
        )
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": SPOTIFY_SCOPES,
    }
    return RedirectResponse("https://accounts.spotify.com/authorize?" + urlencode(params))


@app.get("/spotify/callback")
def spotify_callback(code: str | None = None, error: str | None = None):
    import requests

    if error:
        return HTMLResponse(f"<h2>Spotify recusou a autorização: {error}</h2>", status_code=400)
    if not code:
        return HTMLResponse("<h2>Código de autorização ausente.</h2>", status_code=400)

    cfg = _spotify_config()
    resp = requests.post(
        "https://accounts.spotify.com/api/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": SPOTIFY_REDIRECT_URI,
            "client_id": cfg.get("client_id"),
            "client_secret": cfg.get("client_secret"),
        },
        timeout=10,
    )
    if resp.status_code != 200:
        return HTMLResponse(f"<h2>Falha ao conectar: {resp.text}</h2>", status_code=400)

    data = resp.json()
    _save_spotify_tokens({
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": time.time() + data.get("expires_in", 3600) - 30,
    })
    return HTMLResponse("<h2>Spotify conectado! Pode fechar essa aba.</h2>")


@app.get("/api/nowplaying")
def api_now_playing():
    import requests

    try:
        token = _spotify_access_token()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=401)

    resp = requests.get(
        "https://api.spotify.com/v1/me/player/currently-playing",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if resp.status_code == 204 or not resp.content:
        return {"title": None}  # nothing playing right now — not an error
    if resp.status_code != 200:
        return JSONResponse({"error": resp.text}, status_code=resp.status_code)

    data = resp.json()
    item = data.get("item") or {}
    images = ((item.get("album") or {}).get("images")) or []
    return {
        "title": item.get("name"),
        "artist": ", ".join(a["name"] for a in item.get("artists", [])),
        "album": (item.get("album") or {}).get("name"),
        "playing": data.get("is_playing", False),
        "progress_ms": data.get("progress_ms"),
        "duration_ms": item.get("duration_ms"),
        "thumbnail_url": images[0]["url"] if images else None,  # Spotify's own CDN — no local caching needed
    }


@app.post("/api/nowplaying/control")
def api_now_playing_control(payload: dict = Body(...)):
    import requests

    action = (payload.get("action") or "").strip()
    try:
        token = _spotify_access_token()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=401)

    headers = {"Authorization": f"Bearer {token}"}
    try:
        if action == "play_pause":
            cur = requests.get("https://api.spotify.com/v1/me/player", headers=headers, timeout=10)
            is_playing = cur.json().get("is_playing", False) if cur.content else False
            url = "https://api.spotify.com/v1/me/player/pause" if is_playing else "https://api.spotify.com/v1/me/player/play"
            requests.put(url, headers=headers, timeout=10)
        elif action == "next":
            requests.post("https://api.spotify.com/v1/me/player/next", headers=headers, timeout=10)
        elif action == "previous":
            requests.post("https://api.spotify.com/v1/me/player/previous", headers=headers, timeout=10)
        else:
            raise ValueError(f"ação desconhecida: {action}")
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


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


@app.get("/api/mic")
def api_get_mic():
    if os.name != "nt":
        return JSONResponse({"error": "só funciona no Windows"}, status_code=400)
    try:
        return get_mic_state()
    except Exception as e:
        return JSONResponse({"error": f"pycaw indisponível: {e}"}, status_code=500)


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


app.mount("/icons", StaticFiles(directory=str(ICONS_DIR)), name="icons")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
