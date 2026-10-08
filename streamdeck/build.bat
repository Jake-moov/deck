@echo off
echo ============================================
echo   Compilando Deck.exe
echo ============================================
echo.

python -m pip install --upgrade pyinstaller >nul
python -m pip install -r requirements.txt >nul

echo Empacotando (isso pode levar um minuto)...
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Deck ^
  --add-data "static;static" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.loops.asyncio ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.http.h11_impl ^
  --hidden-import uvicorn.protocols.http.httptools_impl ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.websockets_impl ^
  --hidden-import uvicorn.protocols.websockets.wsproto_impl ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import websockets ^
  --hidden-import websockets.legacy ^
  --hidden-import websockets.legacy.server ^
  --hidden-import h11 ^
  --hidden-import keyboard._winkeyboard ^
  --hidden-import pycaw.pycaw ^
  --collect-submodules comtypes ^
  --hidden-import tkinter ^
  --hidden-import tkinter.filedialog ^
  tray.py

if exist dist\Deck.exe (
  echo.
  echo ============================================
  echo   Pronto! dist\Deck.exe foi criado.
  echo ============================================
  echo.
  echo IMPORTANTE: mova Deck.exe para uma pasta definitiva
  echo ^(ex: Documentos\Deck^) antes de usar - o config.json
  echo e os icones extraidos sao salvos ao lado dele.
) else (
  echo.
  echo Algo deu errado - role para cima e veja o erro do PyInstaller.
)

pause
