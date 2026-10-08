# Deck — Stream Deck no celular

Servidor leve (roda no notebook, sem interface gráfica) + página web (aberta no
navegador do celular). Uso de RAM no notebook: tipicamente menos de 50MB, contra
várias centenas de MB de apps baseados em Electron.

## 1. Instalar (no notebook, Windows)

Precisa de Python 3.9+ instalado ([python.org](https://python.org)).

```powershell
cd streamdeck
pip install -r requirements.txt
```

## 2. Rodar

```powershell
python server.py
```

Isso inicia o servidor na porta 8765. Descubra o IP local do notebook:

```powershell
ipconfig
```

Procure por "Endereço IPv4" (algo como `192.168.0.42`).

## 3. Conectar pelo celular

Celular e notebook precisam estar na **mesma rede Wi-Fi**. No navegador do
celular, acesse:

```
http://192.168.0.42:8765
```

(troque pelo IP do seu notebook). Para abrir em **tela cheia**, toque no ícone
⛶ no topo — funciona direto no Android/Chrome. No iPhone, o Safari não deixa
apps de navegador ficarem em tela cheia sozinhos: toque em Compartilhar →
"Adicionar à Tela de Início" e abra o Deck a partir desse ícone — ele abre sem
nenhuma barra do Safari, como se fosse um app instalado (o Deck já vem
configurado como PWA para isso).

Se não conectar, o Firewall do Windows pode estar bloqueando — na primeira
execução ele deve perguntar se permite acesso à rede; escolha "Permitir" para
redes privadas.

## 4. Personalizar os botões

Toque no ícone ⚙ no topo da tela do celular para abrir o **editor visual**:
dá para adicionar, editar, reordenar (↑↓) e apagar (🗑) botões direto pelo
celular, sem mexer em arquivo nenhum. Ao salvar (✓), as mudanças são gravadas
em `config.json` no notebook na hora.

Pra cada botão, em vez de digitar um emoji, dá pra tocar em **"🎨 Escolher
ícone pronto"** e escolher entre um conjunto de ícones estilizados (engrenagem,
pasta, navegador, controle de jogo, câmera, cadeado, etc.) — fica mais
consistente visualmente. O campo de emoji continua lá como alternativa, caso
prefira.

Se preferir editar o arquivo à mão, o formato de cada botão é:

```json
{ "id": "notepad", "label": "Notepad", "icon": "📝", "type": "app", "value": "notepad.exe" }
```

Tipos de ação (`type`) suportados:

| type         | value                                    | Efeito                                  |
|--------------|-------------------------------------------|------------------------------------------|
| `app`        | caminho do .exe, ou nome se estiver no PATH | Abre um programa                        |
| `script`     | qualquer comando, com argumentos           | Roda um script ou comando personalizado  |
| `hotkey`     | ex: `"ctrl+shift+m"`, `"win+l"`            | Simula um atalho de teclado              |
| `media`      | `play_pause`, `next`, `prev`, `vol_up`, `vol_down`, `mute`, `stop` | Controla mídia do sistema |
| `obs_scene`  | nome exato da cena no OBS                  | Troca de cena                            |
| `obs_mute`   | nome exato da fonte de áudio no OBS        | Muta/desmuta                             |
| `obs_record` | —                                          | Inicia/para gravação                     |
| `obs_stream` | —                                          | Inicia/para transmissão                  |
| `macro`      | uma lista `steps` com passos na ordem      | Executa vários passos em sequência       |

### Macros

Um botão `macro` roda uma sequência de ações (qualquer tipo acima, exceto
outra macro), incluindo um passo especial `delay` (espera em milissegundos
entre ações). Exemplo — trocar de cena e começar a transmitir meio segundo
depois:

```json
{ "id": "stream_start", "label": "Iniciar Live", "icon": "🚀", "type": "macro", "steps": [
  { "type": "obs_scene", "value": "Main" },
  { "type": "delay", "value": 500 },
  { "type": "obs_stream" }
]}
```

O editor visual monta macros também — escolha o tipo "Macro (sequência)" e
use "+ adicionar passo".

A cor de cada tecla é definida automaticamente pelo tipo (app = azul, mídia =
âmbar, atalho = violeta, OBS = vermelho, macro = verde-água).

`grid.columns` no topo do config.json controla quantas colunas aparecem na tela.

### Ícones originais dos programas

Para um botão do tipo `app` ou `script`, abra o botão no editor (expanda
tocando nele) e toque em **"🖼 Usar ícone do programa"**. O servidor extrai o
ícone de verdade do `.exe` e ele passa a aparecer na tecla, no lugar do emoji.

Funciona melhor com o **caminho completo** do executável — por exemplo:

```
C:\Program Files\Google\Chrome\Application\chrome.exe
```

em vez de só `chrome.exe`. Pra achar o caminho completo: clique com o botão
direito no atalho do programa → Propriedades → campo "Destino".

Isso precisa do pacote `pywin32` (já está no requirements.txt) e só funciona
no Windows.

### Apps da Microsoft Store (WhatsApp, etc.)

Apps instalados pela Microsoft Store (WhatsApp, Spotify via Store, etc.)
ficam numa pasta especial do Windows (`WindowsApps`) — o caminho do `.exe`
não funciona de forma confiável nesses casos. Pra eles, use o tipo **"Abrir
app instalado"** em vez de "Abrir programa": toque em **"🔎 Escolher app
instalado"** e busque pelo nome — a lista vem do mesmo catálogo que o Menu
Iniciar do Windows usa, então funciona tanto pra apps da Store quanto pra
programas comuns, sem precisar de caminho nenhum.

O ícone real também é puxado automaticamente assim que você escolhe o app —
não precisa tocar em nada a mais. Pra apps da Store, ele vem do próprio
pacote instalado (lendo o manifesto do app); pra programas comuns, do
próprio `.exe`. Se por algum motivo não conseguir extrair, a tecla continua
com o emoji normalmente.

Também só funciona editando pelo navegador do próprio PC (veja a seção
abaixo).

### Configurar pelo PC em vez do celular

Quatro atalhos do editor só funcionam quando você está editando pelo
navegador do **próprio notebook** (ex: clicando em "Abrir no navegador deste
PC" no menu da bandeja) — porque eles interagem com o Windows diretamente:

- **📂 Escolher arquivo no PC** (nos tipos "Abrir programa" e "Rodar
  script"): abre a janela de arquivos nativa do Windows pra você navegar e
  escolher o `.exe` ou script, em vez de digitar o caminho na mão.
- **🔎 Escolher app instalado** (no tipo "Abrir app instalado"): busca pelo
  nome na lista de apps do Menu Iniciar — inclusive apps da Microsoft Store.
- **⌨ Gravar atalho** (no tipo "Atalho de teclado"): clique, pressione a
  combinação de teclas que quiser usar (ex: Ctrl+Shift+M) e ela é capturada
  automaticamente — sem precisar saber a sintaxe (`ctrl+shift+m`) de cor.

Pelo celular esses botões não funcionam (não tem como abrir uma janela do
Windows, listar apps instalados nem capturar tecla física a partir do
navegador do celular) — use o campo de texto normal nesse caso.

## 5. Player do Spotify

Um mini player aparece automaticamente no topo (abaixo do cabeçalho) sempre
que o Spotify estiver com uma música tocando — capa do álbum, nome da
música, artista, barra de progresso, e botões de anterior/play-pause/próxima.
Some sozinho quando não tem nada tocando.

Isso usa a **API oficial do Spotify** (não a Central de Mídia do Windows),
então precisa de uma configuração única — leva uns 5 minutos:

1. Acesse [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
   e faça login com sua conta do Spotify (não precisa ser Premium pra *ver*
   a música tocando — só os botões de play/pause/pular exigem Premium, por
   ser uma exigência da própria API do Spotify).
2. Clique em **"Create app"**. Preencha nome e descrição (qualquer coisa
   serve), e em **"Redirect URI"** cole exatamente:
   ```
   http://127.0.0.1:8765/spotify/callback
   ```
3. Marque a API **"Web API"** e salve.
4. Abra o app criado, clique em **"Settings"**, e copie o **Client ID** e o
   **Client Secret** (clique em "View client secret" pra revelar).
5. Abra `config.json` e preencha a seção `spotify`:
   ```json
   "spotify": {
     "client_id": "cole_o_client_id_aqui",
     "client_secret": "cole_o_client_secret_aqui"
   }
   ```
6. Reinicie o `Deck.exe` (ou `python tray.py`), e no navegador do **próprio
   PC**, acesse:
   ```
   http://127.0.0.1:8765/spotify/login
   ```
   Isso abre a tela de login/autorização do Spotify. Depois de autorizar,
   aparece "Spotify conectado!" — pode fechar a aba. Essa autorização fica
   salva (`spotify_token.json`, do lado do `config.json`) e se renova
   sozinha, então esse passo é só uma vez.

Depois disso, toque uma música no Spotify (em qualquer dispositivo — celular,
PC, alto-falante) e o mini player aparece no Deck automaticamente.

## 6. Telas e volume

O Deck agora tem duas telas, trocadas pelas abinhas na parte de baixo:

- **⌨ Apps** — a grade de botões à esquerda, e um fader vertical compacto do
  volume geral encostado na lateral direita (arraste pra ajustar, toque no
  alto-falante pra mutar).
- **🎚 Áudio** — uma tela dedicada só a volume: o fader geral de novo (pra
  não precisar trocar de tela só por isso), e um **fader vertical por
  aplicativo** pra cada app que estiver produzindo áudio de verdade naquele
  momento — tipo o Mixer de Volume do Windows, só que com faders verticais.
  Abre o Spotify, aparece um fader "Spotify"; fecha ou silencia, ele some
  sozinho. Cada fader já vem com o ícone real do programa.

Tudo isso usa os pacotes `pycaw`, `comtypes` e `psutil` (já incluídos no
requirements.txt) pra controlar o volume real do Windows, e só funciona no
Windows.

A tela inteira é fixa — sem barra de rolagem, os blocos e faders se ajustam
pro tamanho da tela do seu celular.

## 7. Rodar sem abrir o cmd (o "programa")

Em vez de digitar `python server.py` toda vez, tem uma versão com ícone na
bandeja do sistema (perto do relógio, no canto da barra de tarefas):

```powershell
python tray.py
```

Isso já roda sem janela de console. Clicando com o botão direito no ícone da
bandeja, aparecem as opções:

- **Mostrar endereço para o celular** — mostra uma notificação com o
  `http://IP:8765` pra você digitar no celular
- **Abrir no navegador deste PC** — só pra conferir que está no ar
- **Iniciar com o Windows** — liga o Deck sozinho toda vez que o notebook
  ligar (só funciona na versão compilada, veja abaixo)
- **Sair** — encerra o servidor

### Transformar em um .exe de verdade

Se quiser um programa de fato, com ícone, sem precisar do Python instalado
pra rodar (só pra compilar), dê duplo-clique em `build.bat` uma única vez
(ou rode ele no cmd). Ele instala o `pyinstaller` e gera `dist\Deck.exe`.

Depois de gerado:

1. Mova `Deck.exe` para uma pasta definitiva, tipo `Documentos\Deck` — o
   `config.json` e os ícones extraídos são salvos do lado dele, então essa
   pasta vira o "lugar" do programa.
2. Dê dois cliques no `Deck.exe` — ele sobe direto na bandeja do sistema,
   sem janela nenhuma.
3. Crie um atalho dele na Área de Trabalho, ou marque "Iniciar com o
   Windows" no menu da bandeja pra nunca mais precisar abrir manualmente.

Se o ícone aparecer na bandeja mas o servidor não responder (ex: "Abrir no
navegador deste PC" não carrega nada), ele pode ter falhado ao iniciar
silenciosamente — problema conhecido de empacotar o uvicorn com o
PyInstaller, já mitigado no `build.bat`. Se ainda acontecer: o próprio ícone
mostra uma notificação de erro em vez de falhar quieto, e cria um arquivo
`deck_error.log` do lado do `Deck.exe` — me manda o conteúdo dele.

### Atualizando o Deck.exe depois de mudanças

O `.exe` empacota o código (server.py, tray.py, static/) — `config.json` e
os ícones extraídos ficam de fora, do lado dele. Então, pra atualizar:

1. Feche o `Deck.exe` (menu da bandeja → Sair).
2. Substitua os arquivos atualizados na pasta de origem (a que tem
   `build.bat`) — não na pasta onde o `Deck.exe` roda.
3. Rode `build.bat` de novo.
4. Copie o novo `dist\Deck.exe` por cima do antigo, na pasta definitiva —
   `config.json` e os ícones continuam intactos, só o `.exe` muda.

## 8. Ativar controle do OBS (opcional)

No OBS: **Tools > obs-websocket Settings** → marque "Enable WebSocket server",
anote a porta (padrão 4455) e defina uma senha. Depois, em `config.json`:

```json
"obs": { "enabled": true, "host": "localhost", "port": 4455, "password": "sua-senha" }
```

## Observações

- A biblioteca `keyboard` simula pressionamentos de tecla em nível baixo do
  sistema — alguns antivírus podem sinalizar isso como suspeito (falso
  positivo comum nesse tipo de biblioteca). Se preferir, rode como
  administrador para evitar qualquer bloqueio de permissão.
- Tudo roda na sua rede local — nada é enviado para a internet.
- O visual usa fundo preto puro (AMOLED) com painéis de vidro translúcido —
  se estiver no Android com tela AMOLED, isso já economiza bateria sozinho.
- **Depois de atualizar os arquivos, sempre reinicie o `tray.py` (ou o
  `Deck.exe`)** — mudanças no servidor só valem depois de reiniciado.
- **Se o celular não mostrar novidades mesmo com o servidor atualizado**,
  isso é cache do navegador do celular guardando a versão antiga da página.
  O servidor agora manda o celular sempre buscar a versão mais nova, mas se
  ainda assim aparecer algo desatualizado, force uma atualização: no Chrome
  do Android, segure o botão de recarregar; no Safari do iPhone, feche a aba
  completamente e abra de novo (ou remova e adicione de novo à Tela de
  Início, se estiver usando como PWA).
- **Mutar microfone**: o botão de exemplo "Mute Mic" agora controla o
  microfone de verdade no nível do Windows (tipo "Mutar microfone
  (sistema)"), em vez de mandar um atalho de teclado que só funciona dentro
  de apps que tenham essa combinação configurada. Se você já tinha
  personalizado esse botão, abra o editor, expanda-o e troque o tipo para
  "Mutar microfone (sistema)".
- **Se o volume ainda não responder** mesmo depois de reinstalar as
  dependências e reiniciar o servidor: abra o navegador no próprio PC (menu
  da bandeja → "Abrir no navegador deste PC"), toque no controle de volume,
  e olhe o número que aparece no lugar da porcentagem — se disser "erro",
  isso já é o motivo específico (em vez de eu ter que adivinhar); me conta
  o que aparecer que eu ajusto.
