"""Imprime a versão (APP_VERSION do server.py) — usado pelo build.bat."""
import re
from pathlib import Path

text = (Path(__file__).resolve().parent.parent / "server.py").read_text(encoding="utf-8")
m = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', text, re.M)
print(m.group(1) if m else "0.0.0")
