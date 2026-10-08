#define MyAppName "Deck"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Jake-moov"
#define MyAppURL "https://github.com/Jake-moov/deck"
#define MyAppExeName "Deck.exe"

[Setup]
AppId={{9F2C7B6A-5E4D-4A3B-9C1E-DECKAPP00001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
; AppData\Local em vez de Program Files -- o Deck precisa GRAVAR na propria
; pasta (config.json, icons, spotify_token.json), e Program Files exige
; admin pra isso. Instalar por usuario, sem precisar de admin, evita o problema.
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=installer_output
OutputBaseFilename=DeckSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos adicionais:"
Name: "autostart"; Description: "Iniciar o Deck junto com o Windows"; GroupDescription: "Opções:"

[Files]
Source: "dist\Deck.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DeckServer"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir o Deck agora"; Flags: nowait postinstall skipifsilent
