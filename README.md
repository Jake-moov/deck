# Deck

Um Stream Deck no seu celular: botões de atalhos, apps, mídia, volume por app e "tocando agora",
controlados pelo navegador do celular. O programa roda no Windows (bandeja do sistema).

## Instalar (Windows 10/11)

1. Baixe o **`Deck-Setup.exe`** na [última versão](https://github.com/Jake-moov/deck/releases/latest) e execute.
2. O Windows pode mostrar o aviso "O Windows protegeu o computador" (o instalador não é assinado):
   clique em **Mais informações → Executar assim mesmo**.
3. Ao abrir o Deck pela primeira vez, a **janela do Deck** aparece com um **QR code** e um **PIN**.
4. No celular (na mesma rede Wi-Fi do PC), aponte a câmera para o QR code. Pronto — o celular fica pareado.

Se o Windows perguntar sobre o Firewall, permita o acesso em **redes privadas**.
Para abrir a janela depois, clique no ícone do Deck na bandeja (perto do relógio) — ou use o atalho.
A janela tem duas abas: **Painel** (conexão, segurança, atualizações) e **Botões** (editor). O editor só funciona
nela, no PC; o celular só usa os botões.

Dica: no celular, use "Adicionar à tela inicial" para abrir o Deck como um app em tela cheia.

## Atualizações

O Deck verifica sozinho ao abrir (e a cada 12 horas). Quando houver versão nova, ele avisa:
abra o painel e clique em **Atualizar agora** — não precisa baixar nada. Seus botões e ícones
ficam em `%APPDATA%\Deck` e nunca são apagados por atualizações.

## Problemas comuns

- **O celular não conecta:** confira se PC e celular estão na mesma rede Wi-Fi, se o endereço do painel
  é o que você digitou, e se o Firewall permitiu o Deck em redes privadas.
- **Esqueci / quero trocar o PIN:** painel → **Gerar novo PIN** (ou **Desconectar todos**).
- **Antivírus reclamou:** o `.exe` é gerado com PyInstaller e não é assinado, o que costuma gerar alarme falso.
- **O Deck fechou sozinho:** abra `%APPDATA%\Deck\deck_error.log` — ele registra quando o Deck abriu, por que fechou
  e qualquer erro. Se aparecer "já existe outro Deck", feche o `Deck.exe` no Gerenciador de Tarefas e abra de novo.

## Para quem mantém o projeto

Requisitos: Python 3.x no PATH e, para gerar o instalador, o [Inno Setup 6](https://jrsoftware.org/isdl.php).

- **Mudou só a interface ou a lógica (`static\` / `server.py`):**
  1. Aumente `APP_VERSION` no `server.py` (ex.: `1.0.0` → `1.0.1`).
  2. Rode `make_update.bat` → gera `release\deck-update.zip`.
  3. No GitHub: **Releases → Draft a new release**, tag `v1.0.1`, anexe o `deck-update.zip`, publique.
  4. Em poucas horas (ou ao clicar em "Verificar atualizações") todo mundo recebe, sem reinstalar.
- **Mudou `tray.py`, o `build.bat`, a janela (pywebview) ou passou a usar uma biblioteca nova:**
  1. Aumente `APP_VERSION` **e** coloque a mesma versão em `exe_base.txt`.
  2. Rode `build.bat` → gera `release\Deck-Setup.exe` e o `deck-update.zip`.
  3. Publique a Release com os dois arquivos. Quem estiver com um `.exe` mais antigo vê o aviso para baixar o instalador novo.

A tag da Release precisa ser maior que a versão instalada (`v1.0.1` > `v1.0.0`) e o pacote precisa se chamar
exatamente `deck-update.zip`.

### Como funciona por dentro

- `%APPDATA%\Deck` guarda `config.json`, `icons`, `auth.json` (PIN e celulares pareados) e a pasta `update`
  (pacote baixado). Se o pacote for mais novo que o `.exe`, o `server_live.py` dele e a pasta `static` dele
  substituem os embutidos; se der erro, o Deck volta para a versão embutida e registra no `deck_error.log`.
- O Deck é empacotado em **pasta** (PyInstaller `--onedir`), não em arquivo único: não extrai nada em `Temp`
  (some o aviso "Failed to remove temporary directory"), abre mais rápido e o antivírus reclama menos.
- A janela é o mesmo `Deck.exe` rodando com `--panel`: um processo separado, aberto sob demanda, que usa o WebView2
  do Windows (via pywebview) e devolve toda a memória ao fechar. Se o WebView2 faltar, cai no Edge em modo app.
- O pareamento usa um PIN de 6 dígitos (5 erros bloqueiam o aparelho por 1 minuto). Acessos de `127.0.0.1`
  (o próprio PC) nunca precisam de PIN. O painel (`/panel`) só responde no PC.
