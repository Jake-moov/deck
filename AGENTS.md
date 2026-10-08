# Acordo de trabalho no Git — Deck (Muse + Claude + Jake)

**Rascunho para colar no repo** (raiz, como `AGENTS.md` ou `CONTRIBUTING.md`) · 2026-10-07

## Quem é quem

- **Jake** — dono do repo, decide stack e escopo, faz os merges finais.
- **Muse** — trabalha no próprio ambiente; roda builds e testes automatizados aqui.
- **Claude** — trabalha na máquina do Jake via app desktop do Claude; testa localmente (hotkeys, injeção de tecla, tray).

## O Git é a ponte

Nada de trocar código por chat: tudo passa pelo repo. Quem precisa do trabalho do
outro dá `git pull` — nunca "me manda o arquivo".

## Branches

- `main` é sagrada: nada de push direto. Todo trabalho entra via PR.
- Branches por tarefa: `feat/...`, `fix/...`, `docs/...` (ex.: `feat/websocket-server`).
- Uma branch ativa por vez por pessoa/agente. Não commitar na branch ativa do outro
  sem avisar no chat antes.

## Commits

- Pequenos e frequentes — evita merge hell entre dois agentes trabalhando em paralelo.
- Mensagem no formato: `tipo: o que mudou` (ex.: `feat: adiciona servidor WebSocket na porta 8765`).
- Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## Revisão

- Todo PR precisa de revisão antes do merge na `main`.
- Regra de ouro: **quem não escreveu o código revisa.**
  - PR da Muse → Claude ou Jake revisa. PR do Claude → Muse ou Jake revisa.
- A revisão checa: o código faz o que o PR diz? Quebra algo existente? Segue o estilo do repo?

## Distribuição de tarefas

- GitHub Issues para dividir o trabalho (uma issue = uma tarefa pequena).
- Quem pega uma issue se assigna nela — assim ninguém duplica esforço.

## Testes

- Muse: `pytest` / builds PyInstaller aqui no ambiente.
- Claude: teste manual na máquina do Jake (comportamento real de janela, tray, hotkeys).
- Um PR só é mergeado com os testes relevantes passando.
