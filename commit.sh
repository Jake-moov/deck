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

if [ -z "$MESSAGE" ]; then
  read -r -p "Mensagem do commit (Enter = automática com data/hora): " MESSAGE
  if [ -z "$MESSAGE" ]; then
    MESSAGE="atualização automática - $(date '+%Y-%m-%d %H:%M')"
  fi
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
