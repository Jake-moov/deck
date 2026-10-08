; Instalador do Deck (Inno Setup 6) — gerado pelo build.bat.
; Sem administrador: instala em %LOCALAPPDATA%\Programs\Deck. Os dados de cada pessoa
; (botoes, icones, PIN) ficam em %APPDATA%\Deck e sobrevivem a atualizacoes e reinstalacoes.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F3A8C21-4B7D-4E95-A1C2-5D8E9B0F7A31}
AppName=Deck
AppVersion={#AppVersion}
AppPublisher=Jake-moov
AppPublisherURL=https://github.com/Jake-moov/deck
DefaultDirName={localappdata}\Programs\Deck
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=release
OutputBaseFilename=Deck-Setup
SetupIconFile=assets\deck.ico
UninstallDisplayIcon={app}\Deck.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "autostart"; Description: "Iniciar o Deck com o Windows"
Name: "desktopicon"; Description: "Criar um atalho na Área de Trabalho"; Flags: unchecked

[InstallDelete]
; Limpa a pasta de bibliotecas da versao anterior para nao sobrar arquivo velho misturado com o novo.
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "release\Deck\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Deck"; Filename: "{app}\Deck.exe"
Name: "{autodesktop}\Deck"; Filename: "{app}\Deck.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DeckServer"; ValueData: """{app}\Deck.exe"""; Tasks: autostart

[Run]
Filename: "{app}\Deck.exe"; Description: "Abrir o Deck agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/im Deck.exe /f"; Flags: runhidden; RunOnceId: "EncerrarDeck"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // O início automático pode ter sido ligado pelo painel/bandeja, fora do instalador.
    RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\Run', 'DeckServer');
    if MsgBox('Remover também seus botões, ícones e configurações do Deck?' + #13#10 +
              'Se pretende reinstalar depois, escolha Não.',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Deck'), True, True, True);
  end;
end;
