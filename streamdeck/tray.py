"""
Deck tray app — this is the "programa" version: double-click it (or Deck.exe,
once built) and the server starts silently in the system tray, no cmd window,
no typing commands.

Dev mode:   python tray.py
Built mode: build.bat compiles this into dist\\Deck.exe with PyInstaller.
"""

import socket
import sys
import threading
import traceback
import webbrowser
from pathlib import Path

import pystray
import uvicorn
from PIL import Image, ImageDraw

from server import app, app_dir

PORT = 8765
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "DeckServer"

_server = None


def get_local_ip() -> str:
    """Best-effort LAN IP — doesn't actually send any packets, just asks the
    OS which interface it would use to reach the internet."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _log_path() -> Path:
    return app_dir() / "deck_error.log"


def run_server():
    global _server
    # Explicit implementations instead of "auto" — the auto-detection path
    # relies on a dynamic import PyInstaller can't always see ahead of time,
    # which was silently killing the server thread in the compiled .exe
    # (no console, so the failure was invisible). h11/websockets are pure
    # Python and bundle far more reliably than the C-extension alternatives.
    #
    # log_config=None is required too: uvicorn's default logging setup
    # checks sys.stdout.isatty() to decide whether to colorize output, but
    # a --windowed build has no stdout at all (it's None), which crashes
    # that check before a single log line is ever written. There's no
    # console to log to anyway, so we just skip uvicorn's logging setup.
    config = uvicorn.Config(
        app, host="0.0.0.0", port=PORT, log_level="warning",
        loop="asyncio", http="h11", ws="websockets", log_config=None,
    )
    _server = uvicorn.Server(config)
    _server.run()  # blocking — this thread's whole job


def _server_thread_target():
    try:
        run_server()
    except Exception:
        try:
            _log_path().write_text(traceback.format_exc(), encoding="utf-8")
        except Exception:
            pass


def stop_server():
    if _server:
        _server.should_exit = True


def make_icon_image():
    """Draws the tray icon in code — same visual language as the deck itself,
    so there's no separate .ico asset to keep in sync."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, 60, 60], radius=12, fill=(24, 20, 15, 255), outline=(66, 56, 45, 255), width=3)
    dots = [(18, 18), (46, 18), (18, 46), (46, 46)]
    colors = [(217, 169, 74, 255), (201, 123, 63, 255), (141, 127, 163, 255), (124, 143, 94, 255)]
    for (x, y), c in zip(dots, colors):
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=c)
    return img


def is_autostart_enabled() -> bool:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as k:
            winreg.QueryValueEx(k, RUN_NAME)
            return True
    except FileNotFoundError:
        return False


def _autostart_command() -> str:
    """The command written to the registry Run key. Works whether this is the
    compiled Deck.exe or a plain `python tray.py` dev run — in dev mode it
    points at pythonw.exe (no console flash on boot) running this same file."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    python_path = Path(sys.executable)
    pythonw_path = python_path.with_name("pythonw.exe")
    interpreter = pythonw_path if pythonw_path.exists() else python_path
    script_path = Path(__file__).resolve()
    return f'"{interpreter}" "{script_path}"'


def toggle_autostart(icon, item):
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if is_autostart_enabled():
                winreg.DeleteValue(k, RUN_NAME)
                icon.notify("Removido da inicialização do Windows.", "Deck")
            else:
                winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, _autostart_command())
                icon.notify("Pronto — o Deck vai iniciar sozinho com o Windows.", "Deck")
    except OSError as e:
        icon.notify(f"Não consegui alterar a inicialização: {e}", "Deck")
    icon.update_menu()


def show_address(icon, item):
    ip = get_local_ip()
    icon.notify(f"http://{ip}:{PORT}\n(abra este endereço no navegador do celular)", "Deck está no ar")


def open_local(icon, item):
    webbrowser.open(f"http://127.0.0.1:{PORT}")


def quit_app(icon, item):
    stop_server()
    icon.stop()


def main():
    menu = pystray.Menu(
        pystray.MenuItem("Mostrar endereço para o celular", show_address, default=True),
        pystray.MenuItem("Abrir no navegador deste PC", open_local),
        pystray.MenuItem("Iniciar com o Windows", toggle_autostart, checked=lambda item: is_autostart_enabled()),
        pystray.MenuItem("Sair", quit_app),
    )
    icon = pystray.Icon("deck", make_icon_image(), "Deck", menu)

    threading.Thread(target=_server_thread_target, daemon=True).start()

    def _watchdog():
        # Gives the server a few seconds to come up, then checks it actually
        # did — catches failures uvicorn swallows internally instead of
        # raising, which a bare try/except around run_server() would miss.
        if _server is None or not getattr(_server, "started", False):
            log = _log_path()
            msg = f"O servidor não conseguiu iniciar." + (f" Detalhes em {log.name}." if log.exists() else "")
            try:
                icon.notify(msg, "Deck — erro")
            except Exception:
                pass

    threading.Timer(4.0, _watchdog).start()
    icon.run()


if __name__ == "__main__":
    main()
