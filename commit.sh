#!/usr/bin/env bash
# commit.sh — commit rápido do projeto Deck (Linux/macOS/Git Bash)
# Uso:
#   ./commit.sh                    → pergunta a mensagem, depois commita + push
#   ./commit.sh "minha mensagem"    → pula a pergunta e usa a mensagem informada
#   ./commit.sh --no-push           → commit sem fazer push
# Rode dentro da pasta do repositório.

MESSAGE=""
PUSH=true

for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=false ;;
    *) MESSAGE="$arg" ;;
  esac
done

# Blindagem: remove sequências de escape ANSI (setas, delete etc. que vazam
# quando você edita a mensagem no prompt) e outros caracteres de controle.
# Evita mensagens corrompidas no git log.
sanitize() {
  printf '%s' "$1" \
    | sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g' -e 's/\x1b[()][0-9A-B]//g' \
    | tr -d '\000-\010\013\014\016-\037\177'
}

if [ -z "$MESSAGE" ]; then
  # -e ativa a edição readline: as setas movem o cursor em vez de sujar a mensagem
  read -r -e -p "Mensagem do commit (Enter = automática com data/hora): " MESSAGE
  if [ -z "$MESSAGE" ]; then
    MESSAGE="atualização automática - $(date '+%Y-%m-%d %H:%M')"
  fi
fi

MESSAGE="$(sanitize "$MESSAGE")"
if [ -z "$MESSAGE" ]; then
  MESSAGE="atualização automática - $(date '+%Y-%m-%d %H:%M')"
fi

git add -A

if [ -z "$(git status --porcelain)" ]; then
  echo "Nada para commitar. Tudo limpo. ✅"
  exit 0
fi

git commit -m "$MESSAGE" || { echo "Falha no commit."; exit 1; }

if [ "$PUSH" = true ]; then
  git push || { echo "Falha no push."; exit 1; }
fi

echo "✔ Commit feito e enviado."
