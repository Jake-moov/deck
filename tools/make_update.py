r"""
Gera release\deck-update.zip — o pacote leve de atualização (sem recompilar o .exe).

Conteúdo: server_live.py (cópia do server.py), static\\ (toda a interface) e update.json.
A versão vem da linha APP_VERSION do server.py. A versão mínima do .exe exigida vem de
exe_base.txt (suba esse número quando mudar tray.py, o build.bat ou usar uma biblioteca nova;
quem tiver um .exe mais antigo será avisado para baixar o instalador).

Uso:  python tools\\make_update.py
"""

import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "release"


def main() -> int:
    server = ROOT / "server.py"
    m = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', server.read_text(encoding="utf-8"), re.M)
    if not m:
        print("ERRO: não achei APP_VERSION no server.py")
        return 1
    version = m.group(1)

    exe_base_file = ROOT / "exe_base.txt"
    requires_exe = exe_base_file.read_text(encoding="utf-8").strip() if exe_base_file.exists() else "1.0.0"

    static = ROOT / "static"
    if not (static / "index.html").exists():
        print("ERRO: static\\index.html não existe")
        return 1

    # Confere que o server.py compila antes de empacotar — um pacote quebrado chegaria em todo mundo.
    try:
        compile(server.read_text(encoding="utf-8"), "server.py", "exec")
    except SyntaxError as e:
        print(f"ERRO de sintaxe no server.py: {e}")
        return 1

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / "deck-update.zip"
    meta = {
        "version": version,
        "requires_exe": requires_exe,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("update.json", json.dumps(meta, indent=2))
        z.write(server, "server_live.py")
        for f in sorted(static.iterdir()):
            if f.is_file():
                z.write(f, f"static/{f.name}")

    print(f"OK: {out}")
    print(f"    versão {version} | exige .exe >= {requires_exe}")
    print(f"    Crie uma Release com a tag v{version} e anexe {out.name}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
