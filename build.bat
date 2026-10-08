@echo off
setlocal
echo ============================================
echo   Compilando Deck.exe
echo ============================================
echo.

python -m pip install --upgrade pyinstaller >nul
python -m pip install -r requirements.txt >nul

for /f %%v in ('python tools\version.py') do set APPVER=%%v
echo Versao: %APPVER%
echo.

echo Empacotando (isso pode levar um minuto)...
python -m PyInstaller --noconfirm --clean --onedir --windowed --name Deck ^
  --icon assets\deck.ico ^
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
  --collect-submodules qrcode ^
  --collect-all webview ^
  --collect-all pythonnet ^
  --collect-all clr_loader ^
  --hidden-import clr ^
  --hidden-import qrcode.image.svg ^
  --hidden-import tkinter ^
  --hidden-import tkinter.filedialog ^
  tray.py

if not exist dist\Deck\Deck.exe goto :falhou

if not exist release mkdir release
if exist release\Deck rmdir /s /q release\Deck
xcopy /e /i /y /q dist\Deck release\Deck >nul

echo.
echo Gerando o pacote de atualizacao...
python tools\make_update.py

set "ISCC="
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not defined ISCC goto :semiscc

echo.
echo Gerando o instalador...
"%ISCC%" /Qp /DAppVersion=%APPVER% installer.iss
goto :pronto

:semiscc
echo.
echo AVISO: Inno Setup 6 nao encontrado - o instalador nao foi gerado.
echo Instale gratis em https://jrsoftware.org/isdl.php e rode build.bat de novo.
goto :pronto

:pronto
echo.
echo ============================================
echo   Pronto! Arquivos em release\
echo ============================================
echo   Deck\               - o programa (pasta com Deck.exe)
echo   Deck-Setup.exe      - instalador para distribuir (se gerado)
echo   deck-update.zip     - pacote de atualizacao leve (Releases do GitHub)
echo.
echo Para usar neste PC: feche o Deck atual pela bandeja e execute release\Deck-Setup.exe.
echo Seus botoes antigos (config.json e icons) sao copiados sozinhos na primeira abertura.
goto :fim

:falhou
echo.
echo Algo deu errado - role para cima e veja o erro do PyInstaller.

:fim
pause
