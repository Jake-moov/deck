"""
Deck — programa da bandeja. Dê dois cliques no Deck.exe e o servidor sobe escondido na bandeja
do sistema, sem janela de console. Clique no ícone para abrir a janela do Deck (painel + editor).

Modo dev:   python tray.py            (servidor + bandeja)
            python tray.py --panel    (só a janela do painel)
Compilado:  build.bat gera dist\\Deck\\Deck.exe com o PyInstaller.

Dois tipos de processo usam o mesmo Deck.exe:
  * principal (sem argumentos): bandeja + servidor. Fica sempre aberto, leve.
  * janela (--panel): só a janela do painel/editor, aberta sob demanda. Ao fechar a janela o
    processo termina e toda a memória dela é devolvida; o servidor não é afetado.
  * janela do Deck (--desktop): o próprio Deck (a mesma tela do celular) numa janela nativa, sem
    navegador. Mesma ideia da --panel: processo separado, porque o pywebview precisa da thread
    principal e nela já roda o ícone da bandeja.

Importante: este arquivo vai DENTRO do .exe e só muda com um instalador novo. A lógica do painel,
do PIN e das atualizações fica no server.py (que pode ser atualizado sem recompilar), por isso
tudo do servidor é acessado como `server.<nome>` na hora do uso.
"""

import faulthandler
import os
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path

PORT = 8765
PANEL_TITLE = "Deck · Painel"
DESKTOP_TITLE = "Deck"

# Preenchidos em main() (imports pesados só no processo principal; a janela --panel não precisa deles).
server = None
app = None
pystray = None
uvicorn = None

_server = None
_icon = None
_stop_requested = False
_keep = {}  # mantém vivos os handles dos mutexes


# ---------- log ----------

def _data_dir() -> Path:
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA")
        d = (Path(base) if base else Path.home() / "AppData" / "Roaming") / "Deck"
        d.mkdir(parents=True, exist_ok=True)
        return d
    return Path(__file__).resolve().parent


def log(msg: str) -> None:
    """Diário de bordo em %APPDATA%\\Deck\\deck_error.log — mostra por que o Deck abriu/fechou."""
    try:
        p = _data_dir() / "deck_error.log"
        if p.exists() and p.stat().st_size > 256 * 1024:
            p.write_bytes(p.read_bytes()[-128 * 1024:])
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} [pid {os.getpid()}] {msg}\n")
    except Exception:
        pass


def _install_hooks() -> None:
    def _hook(t, v, tb):
        log("EXCEÇÃO NÃO TRATADA:\n" + "".join(traceback.format_exception(t, v, tb)))

    def _thread_hook(args):
        name = args.thread.name if args.thread else "?"
        log(f"EXCEÇÃO NA THREAD {name}:\n" + "".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)))

    sys.excepthook = _hook
    threading.excepthook = _thread_hook
    _enable_faulthandler()


def _enable_faulthandler() -> None:
    """Crash NATIVO (segfault / access violation, ex.: c0000005 no _ctypes.pyd) não é exceção Python:
    nenhum excepthook roda e o processo morre sem escrever nada. O faulthandler é o único que
    consegue, no instante da queda, despejar o stack Python de TODAS as threads. Em build
    --windowed não existe stderr, então apontamos explicitamente para o deck_error.log."""
    try:
        p = _data_dir() / "deck_error.log"
        if p.exists() and p.stat().st_size > 256 * 1024:
            p.write_bytes(p.read_bytes()[-128 * 1024:])
        f = open(p, "a", encoding="utf-8", buffering=1)
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} [pid {os.getpid()}] faulthandler ativo — se o Deck cair por "
                f"erro nativo, o stack aparece logo abaixo como 'Windows fatal exception'\n")
        f.flush()
        faulthandler.enable(file=f, all_threads=True)
        _keep["faulthandler_file"] = f  # precisa continuar aberto durante toda a vida do processo
    except Exception:
        log("faulthandler não pôde ser ativado:\n" + traceback.format_exc())


def _running_marker() -> Path:
    return _data_dir() / "deck.running"


def _mark_running() -> None:
    """Deixa um marcador enquanto o Deck está aberto. Se na próxima abertura ele ainda existir e o
    processo antigo não existir mais, o Deck anterior caiu sem passar pelo 'Sair'."""
    try:
        import psutil
        marker = _running_marker()
        if marker.exists():
            try:
                pid_s, ctime_s = marker.read_text(encoding="utf-8").split(":")
                pid, ctime = int(pid_s), float(ctime_s)
                alive = psutil.pid_exists(pid) and abs(psutil.Process(pid).create_time() - ctime) < 2
            except Exception:
                alive = False
            if not alive:
                log("ATENÇÃO: a execução anterior do Deck terminou de forma anormal (sem 'Sair'). "
                    "Procure acima por 'Windows fatal exception' — é o stack do crash.")
        me = psutil.Process(os.getpid())
        marker.write_text(f"{me.pid}:{me.create_time()}", encoding="utf-8")
    except Exception:
        log("marcador de execução falhou:\n" + traceback.format_exc())


def _clear_running() -> None:
    try:
        _running_marker().unlink(missing_ok=True)
    except Exception:
        pass


# ---------- utilidades do Windows ----------

def _win(name: str):
    """DLL do Windows com last-error preservado (para ler GetLastError sem ser sobrescrito)."""
    import ctypes
    return ctypes.WinDLL(name, use_last_error=True)


def create_mutex(name: str):
    """(handle, já_existia). Usa use_last_error: ctypes.windll.GetLastError() pode ser sobrescrito
    entre a chamada e a leitura e dava falso positivo/negativo na detecção de segunda instância."""
    if os.name != "nt":
        return None, False
    try:
        import ctypes
        from ctypes import wintypes
        k = _win("kernel32")
        k.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
        k.CreateMutexW.restype = wintypes.HANDLE
        handle = k.CreateMutexW(None, False, name)
        return handle, ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS
    except Exception:
        log("create_mutex falhou:\n" + traceback.format_exc())
        return None, False


def message_box(text: str, title: str = "Deck") -> None:
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes
            u = _win("user32")
            u.MessageBoxW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT]
            u.MessageBoxW.restype = ctypes.c_int
            u.MessageBoxW(None, text, title, 0x30)  # MB_ICONWARNING
            return
        except Exception:
            pass
    print(text)


def server_alive(timeout: float = 1.5) -> bool:
    import urllib.request
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # ignora proxy do sistema
        with opener.open(f"http://127.0.0.1:{PORT}/api/panel/info", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


# ---------- janela do painel (processo separado, sob demanda) ----------

def _find_app_browser():
    """Plano B: Edge/Chrome em modo app (janela sem barra de endereço) se o WebView2 falhar."""
    for parts in (("Microsoft", "Edge", "Application", "msedge.exe"), ("Google", "Chrome", "Application", "chrome.exe")):
        for env in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                candidate = Path(base).joinpath(*parts)
                if candidate.exists():
                    return candidate
    return None


def _open_edge_app(url: str) -> None:
    exe = _find_app_browser()
    if exe:
        try:
            subprocess.Popen(
                [str(exe), f"--app={url}", "--window-size=1120,780", "--window-position=80,40"],
                creationflags=0x00000008, close_fds=True,
            )
            return
        except Exception:
            log("Edge app falhou:\n" + traceback.format_exc())
    webbrowser.open(url)


def _focus_existing_panel(title: str = PANEL_TITLE) -> None:
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes
        u = _win("user32")
        # HWND é um ponteiro de 64 bits: sem restype/argtypes o ctypes o trataria como int de 32 bits
        # e devolveria um handle truncado para ShowWindow/SetForegroundWindow.
        u.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        u.FindWindowW.restype = wintypes.HWND
        u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        u.ShowWindow.restype = wintypes.BOOL
        u.SetForegroundWindow.argtypes = [wintypes.HWND]
        u.SetForegroundWindow.restype = wintypes.BOOL
        hwnd = u.FindWindowW(None, title)
        if hwnd:
            u.ShowWindow(hwnd, 9)  # SW_RESTORE
            u.SetForegroundWindow(hwnd)
    except Exception:
        log("focar janela falhou:\n" + traceback.format_exc())


def run_panel_window() -> None:
    """Processo `Deck.exe --panel`: abre a janela dedicada do Deck (painel + editor) e termina ao fechar."""
    _install_hooks()
    log("janela: abrindo")
    handle, exists = create_mutex("Local\\DeckPanelWindow")
    _keep["panel_mutex"] = handle
    if exists:
        log("janela: já existe uma aberta, trazendo para a frente")
        _focus_existing_panel()
        return
    url = f"http://127.0.0.1:{PORT}/panel"
    try:
        import webview  # pywebview (usa o WebView2 do Windows)
        webview.create_window(PANEL_TITLE, url, width=1120, height=780, min_size=(760, 560), background_color="#0b0a09")
        webview.start(private_mode=False, storage_path=str(_data_dir() / "webview"))
        log("janela: fechada pelo usuário")
    except BaseException:
        log("janela: pywebview falhou, usando Edge em modo app:\n" + traceback.format_exc())
        _open_edge_app(url)


def open_panel(icon=None, item=None) -> None:
    cmd = [sys.executable, "--panel"] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve()), "--panel"]
    try:
        subprocess.Popen(cmd, creationflags=0x00000008, close_fds=True)  # DETACHED_PROCESS
    except Exception:
        log("não consegui abrir a janela:\n" + traceback.format_exc())
        _open_edge_app(f"http://127.0.0.1:{PORT}/panel")


def run_desktop_window() -> None:
    """Processo `Deck.exe --desktop`: abre o Deck (tela do celular) numa janela nativa e termina ao fechar."""
    _install_hooks()
    log("janela do Deck: abrindo")
    handle, exists = create_mutex("Local\\DeckDesktopWindow")
    _keep["desktop_mutex"] = handle
    if exists:
        log("janela do Deck: já existe uma aberta, trazendo para a frente")
        _focus_existing_panel(DESKTOP_TITLE)
        return
    url = f"http://127.0.0.1:{PORT}"
    try:
        import webview  # pywebview (usa o WebView2 do Windows)
        webview.create_window(DESKTOP_TITLE, url, width=420, height=750, resizable=True, min_size=(320, 500))
        webview.start(private_mode=False, storage_path=str(_data_dir() / "webview"))
        log("janela do Deck: fechada pelo usuário")
    except BaseException:
        log("janela do Deck: pywebview falhou, usando Edge em modo app:\n" + traceback.format_exc())
        _open_edge_app(url)


def open_desktop_window() -> dict:
    """Abre (ou traz para a frente) a janela nativa do Deck. Chamada pelo server.py via
    `server.open_desktop_hook` (endpoint POST /api/panel/open-desktop) e na inicialização."""
    cmd = [sys.executable, "--desktop"] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve()), "--desktop"]
    try:
        subprocess.Popen(cmd, creationflags=0x00000008, close_fds=True)  # DETACHED_PROCESS
        return {"ok": True}
    except Exception as e:
        log("não consegui abrir a janela do Deck:\n" + traceback.format_exc())
        return {"ok": False, "error": str(e)}


# ---------- servidor (com supervisão) ----------

def run_server() -> None:
    global _server
    # Implementações explícitas em vez de "auto": a detecção automática usa import dinâmico que o
    # PyInstaller nem sempre enxerga, e o servidor morria em silêncio no .exe (sem console, a falha
    # ficava invisível). log_config=None também é necessário: o logging padrão do uvicorn consulta
    # sys.stdout.isatty(), e num build --windowed o stdout é None.
    config = uvicorn.Config(
        app, host="0.0.0.0", port=PORT, log_level="warning",
        loop="asyncio", http="h11", ws="websockets", log_config=None,
    )
    _server = uvicorn.Server(config)
    _server.run()  # bloqueante — é o trabalho inteiro desta thread


def _supervise_server() -> None:
    """Mantém o servidor de pé: se ele cair sem ninguém pedir, registra o motivo e tenta de novo."""
    quick_failures = 0
    while not _stop_requested:
        started = time.time()
        try:
            log("servidor: iniciando")
            run_server()
        except BaseException:  # inclui SystemExit: o uvicorn chama sys.exit(1) se a porta estiver ocupada
            log("servidor: caiu com erro:\n" + traceback.format_exc())
        if _stop_requested:
            break
        log("servidor: parou sem ser solicitado")
        quick_failures = quick_failures + 1 if time.time() - started < 30 else 0
        if quick_failures >= 3:
            log("servidor: desisti após 3 falhas seguidas (porta ocupada por outro Deck?)")
            try:
                _icon.notify(f"O servidor não consegue iniciar (porta {PORT} ocupada?). Veja deck_error.log.", "Deck — erro")
            except Exception:
                pass
            break
        time.sleep(2)


def stop_server() -> None:
    if _server:
        _server.should_exit = True


# ---------- bandeja ----------

def make_icon_image():
    """Desenha o ícone em código — mesma linguagem visual do deck, sem .ico para manter em sincronia."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, 60, 60], radius=12, fill=(24, 20, 15, 255), outline=(66, 56, 45, 255), width=3)
    dots = [(18, 18), (46, 18), (18, 46), (46, 46)]
    colors = [(217, 169, 74, 255), (201, 123, 63, 255), (141, 127, 163, 255), (124, 143, 94, 255)]
    for (x, y), c in zip(dots, colors):
        d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=c)
    return img


def show_address(icon, item) -> None:
    ip = server.get_local_ip()
    icon.notify(f"http://{ip}:{PORT}\n(abra no navegador do celular — o PIN está no painel)", "Deck está no ar")


def toggle_autostart(icon, item) -> None:
    try:
        enable = not server.autostart_enabled()
        server.set_autostart(enable)
        icon.notify(
            "Pronto — o Deck vai iniciar sozinho com o Windows." if enable else "Removido da inicialização do Windows.",
            "Deck",
        )
    except Exception as e:
        icon.notify(f"Não consegui alterar a inicialização: {e}", "Deck")
    icon.update_menu()


def check_updates(icon, item) -> None:
    def work():
        st = server.check_for_update()
        if st["status"] == "available":
            icon.notify(f"Versão {st['latest']} disponível. Abra o painel para atualizar.", "Deck — atualização")
        elif st["status"] == "uptodate":
            icon.notify("Você está na versão mais recente.", "Deck")
        else:
            icon.notify(st.get("error") or "Não foi possível verificar agora.", "Deck")
    threading.Thread(target=work, daemon=True).start()


def quit_app(icon, item) -> None:
    global _stop_requested
    _stop_requested = True
    log("saindo: pedido do usuário (menu Sair / reinício após atualização)")
    stop_server()
    icon.stop()


def _background_update_check(icon) -> None:
    """Verifica atualizações ao abrir e a cada 12 horas; só avisa quando há novidade."""
    try:
        st = server.check_for_update()
        if st["status"] == "available":
            icon.notify(f"Versão {st['latest']} disponível. Clique para abrir o painel e atualizar.", "Deck — atualização")
    except Exception:
        pass
    t = threading.Timer(12 * 3600, _background_update_check, args=(icon,))
    t.daemon = True
    t.start()


def main() -> None:
    global server, app, pystray, uvicorn, _icon
    _install_hooks()
    log(f"iniciando (compilado={getattr(sys, 'frozen', False)})")

    handle, already_running = create_mutex("Local\\DeckServerSingleInstance")
    _keep["mutex"] = handle
    if already_running:
        log("já existe outro Deck em execução; verificando se ele responde")
        for _ in range(5):
            if server_alive():
                log("o outro Deck responde: abrindo a janela dele e saindo")
                open_panel()
                return
            time.sleep(1.2)
        log("o outro Deck NÃO responde")
        message_box(
            "O Deck já está aberto, mas não está respondendo.\n\n"
            "Feche o processo \"Deck.exe\" no Gerenciador de Tarefas e abra o Deck de novo."
        )
        return

    _mark_running()

    # Imports pesados só aqui (o processo da janela --panel não precisa deles).
    import pystray as _pystray
    import uvicorn as _uvicorn
    import server as _server_module
    pystray, uvicorn, server, app = _pystray, _uvicorn, _server_module, _server_module.app

    menu = pystray.Menu(
        pystray.MenuItem("Abrir o Deck", open_panel, default=True),
        pystray.MenuItem("Mostrar endereço para o celular", show_address),
        pystray.MenuItem("Iniciar com o Windows", toggle_autostart, checked=lambda item: server.autostart_enabled()),
        pystray.MenuItem("Verificar atualizações", check_updates),
        pystray.MenuItem("Sair", quit_app),
    )
    icon = pystray.Icon("deck", make_icon_image(), "Deck", menu)
    _icon = icon
    server.quit_hook = lambda: quit_app(icon, None)  # usado pelo reinício após atualizar
    server.open_desktop_hook = open_desktop_window  # usado por POST /api/panel/open-desktop

    threading.Thread(target=_supervise_server, name="servidor", daemon=True).start()

    def _after_start():
        if _server is None or not getattr(_server, "started", False):
            return  # o supervisor já registra e avisa as falhas
        log(f"servidor: no ar (versão {server._effective_version()})")
        # Primeira abertura depois de instalar: mostra a janela (QR code e PIN) para conectar o celular.
        marker = _data_dir() / "first_run_done"
        if not marker.exists():
            try:
                marker.write_text("1", encoding="utf-8")
            except Exception:
                pass
            open_panel()
        # Preferência "Abrir a janela do Deck ao iniciar" (config.json -> desktop_autostart).
        try:
            if server.load_config().get("desktop_autostart"):
                open_desktop_window()
        except Exception:
            log("desktop_autostart falhou:\n" + traceback.format_exc())

    threading.Timer(3.0, _after_start).start()
    t = threading.Timer(15.0, _background_update_check, args=(icon,))
    t.daemon = True
    t.start()

    try:
        icon.run()
    except BaseException:
        log("icon.run() terminou com erro:\n" + traceback.format_exc())
        raise
    finally:
        if _stop_requested:
            _clear_running()
            log("encerrado normalmente")
        else:
            log("ENCERRADO INESPERADAMENTE: icon.run() retornou sem pedido de saída")


def crash_test() -> None:
    """`Deck.exe --crash-test`: provoca de propósito um access violation, só para conferir que o
    deck_error.log recebe o stack do crash (o faulthandler funcionando num build sem console)."""
    import ctypes
    _install_hooks()
    log("crash-test: vou provocar um access violation de propósito")

    def chamada_ctypes_proposital():
        ctypes.string_at(0)

    chamada_ctypes_proposital()


if __name__ == "__main__":
    if "--crash-test" in sys.argv[1:]:
        crash_test()
    elif "--panel" in sys.argv[1:]:
        run_panel_window()
    elif "--desktop" in sys.argv[1:]:
        run_desktop_window()
    else:
        main()
